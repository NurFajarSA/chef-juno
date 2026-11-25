import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTcp, type Server as TcpServer, type AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearAuth, clearFirestore } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

// Uji aplikasi mode emulator (profil lokal mesin ~/.chefjuno/app-local.json): patch emulator dipasang ke salinan kode PR,
// defines dari perintah stack, akun dari tabel TSV, kunci stack diambil & dilepas, port emulator diteruskan ke 127.0.0.1
// di runner. "Emulator" di test ini = server HTTP di [::1] (bukan 127.0.0.1), jadi aplikasi hanya bisa menjangkaunya
// lewat penerus port runner.
const FAKE_CONTAINER = fileURLToPath(new URL('../../../daemon/test/fake-container.mjs', import.meta.url));
const WEB_APP = readFileSync(
  fileURLToPath(new URL('../../../daemon/test/fixtures/web-app/index.html', import.meta.url)),
  'utf8',
)
  // tanpa patch, /emu.js tidak ada (server runner mengembalikan index.html → skrip gagal, aplikasi minta login)
  .replace(
    '<main id="app"></main>',
    '<main id="app"></main><p id="emu">Emulator: belum tersambung</p><script src="/emu.js"></script>',
  );

let h: Harness;
let emu: Server;
let health: TcpServer;
let emuPort = 0;
let work = '';
const lockLog = () => readFileSync(join(work, 'locks.log'), 'utf8').trim().split('\n');

/** patch yang menambah web/emu.js: login otomatis sebagai akun emulator + baca data dari "emulator" di 127.0.0.1 */
const emuPatch = (port: number) => {
  const js = [
    "if (!localStorage.getItem('user')) localStorage.setItem('user', 'emu@emu-stack.invalid');",
    `fetch('http://127.0.0.1:${port}/whoami').then((r) => r.text()).then((t) => { document.getElementById('emu').textContent = 'Emulator: ' + t; });`,
  ];
  return [
    'diff --git a/web/emu.js b/web/emu.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/web/emu.js',
    `@@ -0,0 +1,${js.length} @@`,
    ...js.map((l) => `+${l}`),
    '',
  ].join('\n');
};

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await h.startMachine({ agents: ['claude'] });
  process.env.CHEFJUNO_CONTAINER_BIN = FAKE_CONTAINER;
  emu = createServer((_req, res) => {
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
    res.end('emu-tester');
  });
  await new Promise<void>((r) => emu.listen(0, '::1', r));
  emuPort = (emu.address() as AddressInfo).port;
  // port "emulator hidup" di 127.0.0.1 untuk requirePorts
  health = createTcp((s) => s.end());
  await new Promise<void>((r) => health.listen(0, '127.0.0.1', r));
  const healthPort = (health.address() as AddressInfo).port;

  work = mkdtempSync(join(tmpdir(), 'cj-emu-'));
  writeFileSync(join(work, 'emu.patch'), emuPatch(emuPort));
  writeFileSync(join(work, 'stale.patch'), emuPatch(emuPort).replace('/dev/null', 'a/web/tidak-ada.js'));
  writeFileSync(join(work, 'accounts.tsv'), 'D8\temu-uid-8\temu@emu-stack.invalid\tsandi-emulator-8\n');
  const script = (name: string, body: string) => {
    const p = join(work, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const defines = script('defines.sh', 'echo "--dart-define=EMU_HOST=127.0.0.1 --dart-define=EMU_FIRESTORE_PORT=8399"');
  const lock = script('lock.sh', `echo "$1 $2 $LOCK_PID" >> "${join(work, 'locks.log')}"`);
  const profile = {
    [h.repo.fullName]: {
      config: {
        build: {
          image: 'fake-flutter',
          // patch sudah terpasang di salinan kode sebelum perintah build; defines & uid diganti
          commands: [
            'mkdir -p build && cp -R web build/web && test -f web/emu.js && echo "{{defines}} --dart-define=EMU_UID={{uid}}" > build/web/defines.txt',
          ],
          outDir: 'build/web',
        },
        flutterSemantics: false,
        viewport: { width: 412, height: 800 },
        login: [{ do: 'wait', text: 'Beranda' }],
        timeoutSec: 120,
      },
      emulator: {
        patches: [join(work, 'stale.patch'), join(work, 'emu.patch')],
        definesCommand: [defines],
        forwardPorts: [emuPort],
        forwardHost: '::1',
        requirePorts: [healthPort],
        account: { tsv: join(work, 'accounts.tsv'), row: 'D8' },
        locks: [
          {
            acquire: [lock, 'acquire', 'stack'],
            release: [lock, 'release', 'stack'],
            env: { LOCK_PID: '{{pid}}' },
          },
          { acquire: [lock, 'acquire', 'D8'], release: [lock, 'release', 'D8'], env: { LOCK_PID: '{{pid}}' } },
        ],
        prepare: [{ command: [lock, 'prepare', 'D8'], env: { LOCK_PID: 'prep' } }],
      },
    },
  };
  writeFileSync(join(dirname(h.recordDir), 'app-local.json'), JSON.stringify(profile));
});
afterAll(async () => {
  delete process.env.CHEFJUNO_CONTAINER_BIN;
  emu?.close();
  health?.close();
  await h?.stop();
});

describe('uji aplikasi terhadap emulator lokal', () => {
  it('patch & defines dipasang, akun emulator login otomatis, data dari emulator lewat penerus port, kunci dilepas', async () => {
    const head = h.repo.commit({ 'web/index.html': WEB_APP }, 'feat: halaman keranjang', 'feat/cache-user');
    h.repo.git('push', '-q', '-f', h.repo.bare, `${head}:refs/pull/1/head`);
    const pr = h.mock.repos.get(h.repo.fullName)!.prs.get(1)!;
    pr.headSha = head;
    await h.db.doc('settings/global').update({ appVerifyEnabled: true, reviewMode: 'standard' });
    // memory tim khusus uji aplikasi (mis. akun tes harus premium)
    await h.db.collection('rules').add({
      text: 'Uji aplikasi: akun tes harus premium supaya alur di balik paywall bisa dicoba.',
      scope: { repoId: null, paths: [] },
      source: 'manual',
      status: 'active',
      kind: 'rule',
      category: 'bug',
      usageCount: 0,
    });

    await h.comment('lapor @chefjuno');
    const review = await h.waitJob((j) => j.type === 'review' && j.status === 'posted', 120_000);
    const app = await h.waitJob((j) => j.type === 'app-verify' && j.status === 'posted', 180_000);
    const done = { data: (await h.db.doc(`jobs/${review.id}`).get()).data()! };
    const meta = done.data.result.meta.appVerification;
    expect(meta.reason ?? null).toBeNull();
    expect(meta).toMatchObject({ ran: true, loginOk: true, backend: 'emulator', jobId: app.id });
    expect(meta.scenarios.find((x: { finding: number }) => x.finding >= 0).status).toBe('reproduced');
    expect(meta.change).toMatchObject({ status: 'not_reproduced' });

    const recs = readdirSync(h.recordDir).map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')));
    // perencana tahu ini emulator (boleh menulis data), bukan produksi
    const plan = recs.find((r) => String(r.system).includes('QA engineer'))!;
    expect(plan.system).toContain('tersambung ke emulator lokal');
    // memory tim "Uji aplikasi:" masuk ke prompt penguji, tidak ke prompt reviewer kode
    expect(plan.prompt).toContain('## Memory tim untuk uji aplikasi\n- akun tes harus premium');
    const lensRecs = recs.filter((r) => String(r.system).includes('# Tujuan'));
    expect(lensRecs.length).toBeGreaterThan(0);
    expect(lensRecs.some((r) => `${r.system}\n${r.prompt}`.includes('akun tes harus premium'))).toBe(false);
    expect(plan.system).not.toContain('backend produksi');
    // aplikasi membaca "emulator" di [::1] lewat 127.0.0.1 → hanya mungkin lewat penerus port runner
    const judge = recs.find((r) => String(r.prompt).includes('Snapshot aksesibilitas'))!;
    expect(judge.prompt).toContain('Emulator: emu-tester');

    // kunci: stack lalu akun, dilepas terbalik; penahan = proses yang sama untuk semua kunci
    const log = lockLog();
    expect(log.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual([
      'acquire stack',
      'acquire D8',
      'prepare D8', // setelah kunci, sebelum build (mis. reset data akun emulator)
      'release D8',
      'release stack',
    ]);
    const pid = Number(log[0].split(' ')[2]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow(); // penahan sudah dimatikan

    // kata sandi emulator tidak masuk hasil job / komentar
    const all = JSON.stringify(done.data) + JSON.stringify(app.data) + JSON.stringify(h.mock.reviewComments);
    expect(all).not.toContain('sandi-emulator-8');
  });

  it('emulator mati → uji dilewati dengan alasan, kunci tidak diambil, review tetap diposting', async () => {
    const port = (health.address() as AddressInfo).port;
    await new Promise<void>((r) => health.close(() => r()));
    const before = lockLog().length;
    const posted = async () =>
      (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'posted').get()).size;
    const n = await posted();
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await posted()) === n + 1, 120_000, 'uji aplikasi kedua');
    const jobs = await h.db.collection('jobs').where('type', '==', 'review').where('status', '==', 'posted').get();
    const last = jobs.docs.map((d) => d.data()).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
    expect(last.result.meta.appVerification).toMatchObject({
      ran: false,
      reason: `emulator lokal belum menyala (port ${port} tidak menjawab)`,
    });
    expect(lockLog()).toHaveLength(before);
  });
});
