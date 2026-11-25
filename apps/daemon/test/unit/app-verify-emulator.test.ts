import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expandBuildCommand, LocalAppProfileSchema, safeDefines } from '@chefjuno/shared';
import {
  acquireLocks,
  applyPatches,
  buildArgs,
  changeGap,
  cleanupOrphanAppRuns,
  ensureEmulatorUp,
  planPrompt,
  prepareEmulator,
  runnerArgs,
  tsvAccount,
} from '../../src/jobs/app-verify.js';

const dir = () => mkdtempSync(join(tmpdir(), 'cj-emu-unit-'));

describe('uji aplikasi mode emulator', () => {
  it('defines hanya --dart-define tanpa karakter shell', () => {
    expect(safeDefines('--dart-define=EMU_HOST=127.0.0.1 --dart-define=LLM_BASE_URL=http://127.0.0.1:8010 \n')).toBe(
      '--dart-define=EMU_HOST=127.0.0.1 --dart-define=LLM_BASE_URL=http://127.0.0.1:8010',
    );
    expect(safeDefines('--dart-define=APP_CHECK_RECAPTCHA_SITE_KEY=')).toBe(
      '--dart-define=APP_CHECK_RECAPTCHA_SITE_KEY=',
    );
    expect(safeDefines('--dart-define=X=1; rm -rf /')).toBeNull();
    expect(safeDefines('--dart-define=X=$(id)')).toBeNull();
    expect(safeDefines('--release')).toBeNull();
  });

  it('kredensial di perintah build menjadi referensi env, bukan nilai', () => {
    expect(
      expandBuildCommand(
        'flutter build web {{defines}} --dart-define=EMU_EMAIL={{email}} --dart-define=EMU_UID={{uid}}',
        '--dart-define=A=1',
      ),
    ).toBe(
      'flutter build web --dart-define=A=1 --dart-define=EMU_EMAIL="$CHEFJUNO_APP_EMAIL" --dart-define=EMU_UID="$CHEFJUNO_APP_UID"',
    );
    const a = buildArgs({ image: 'img', dir: '/x', script: 's', envNames: ['CHEFJUNO_APP_EMAIL'] });
    expect(a.slice(0, 4)).toEqual(['run', '--rm', '-e', 'CHEFJUNO_APP_EMAIL']);
    const cached = buildArgs({
      image: 'img',
      dir: '/x',
      script: 's',
      cache: [{ volume: 'cj-pub', path: '/root/.pub-cache' }],
    });
    expect(cached).toContain('cj-pub:/root/.pub-cache');
    expect(
      LocalAppProfileSchema.safeParse({ buildCache: [{ volume: '/etc', path: '/root/.pub-cache' }] }).success,
    ).toBe(false); // hanya volume bernama, bukan path mesin
    expect(
      runnerArgs({ image: 'i', appDir: 'a', runnerDir: 'r', pwDir: 'p', outDir: 'o', hostGateway: true }),
    ).toContain('host.docker.internal:host-gateway');
    expect(runnerArgs({ image: 'i', appDir: 'a', runnerDir: 'r', pwDir: 'p', outDir: 'o' })).not.toContain(
      '--add-host',
    );
  });

  it('akun dari tabel TSV: baris terakhir yang cocok', () => {
    const d = dir();
    const f = join(d, 'a.tsv');
    writeFileSync(f, 'A\tu1\ta@x.invalid\tp1\nD8\tu-lama\td@x.invalid\tlama\nD8\tu8\td8@x.invalid\tp8\n');
    expect(tsvAccount({ tsv: f, row: 'D8' })).toEqual({ uid: 'u8', email: 'd8@x.invalid', password: 'p8' });
    expect(tsvAccount({ tsv: f, row: 'Z' })).toBeNull();
    expect(tsvAccount({ tsv: join(d, 'tidak-ada.tsv'), row: 'A' })).toBeNull();
  });

  it('kunci kedua gagal → kunci pertama dilepas, alasan dikembalikan', async () => {
    const d = dir();
    const log = join(d, 'log');
    const ok = join(d, 'ok.sh');
    const no = join(d, 'no.sh');
    writeFileSync(ok, `#!/bin/sh\necho "$1 $2" >> "${log}"\n`);
    writeFileSync(no, '#!/bin/sh\necho "akun D8 dipakai sesi lain" >&2\nexit 1\n');
    chmodSync(ok, 0o755);
    chmodSync(no, 0o755);
    const r = await acquireLocks([
      { acquire: [ok, 'acquire', 'stack'], release: [ok, 'release', 'stack'], env: {}, timeoutSec: 10 },
      { acquire: [no, 'acquire', 'D8'], env: {}, timeoutSec: 10 },
    ]);
    expect(r).toBe('kunci emulator tidak didapat (no.sh acquire D8): akun D8 dipakai sesi lain');
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['acquire stack', 'release stack']);
  });

  it('perencana: aturan produksi vs emulator', () => {
    expect(planPrompt(false)).toContain('backend produksi');
    expect(planPrompt(true)).toContain('emulator lokal');
    expect(planPrompt(true)).not.toContain('{{BACKEND}}');
  });

  it('profil lokal: default emulator terisi', () => {
    const p = LocalAppProfileSchema.parse({ emulator: { patches: ['/p.patch'] } });
    expect(p.emulator).toMatchObject({ forwardHost: 'host.docker.internal', forwardPorts: [], locks: [] });
    expect(LocalAppProfileSchema.safeParse({ emulator: { forwardHost: 'evil host;' } }).success).toBe(false);
  });
});

describe('pemulihan otomatis emulator', () => {
  const mk = (d: string, name: string, body: string) => {
    const p = join(d, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const step = (command: string[]) => ({ command, env: {}, timeoutSec: 10 });

  it('persiapan gagal → pemulihan → persiapan diulang & berhasil', async () => {
    const d = dir();
    const prep = mk(d, 'prep.sh', `test -f "${d}/sehat" || { echo "salinan stack rusak" >&2; exit 1; }`);
    const fix = mk(d, 'fix.sh', `touch "${d}/sehat"`);
    expect(await prepareEmulator({ prepare: [step([prep])], repair: [step([fix])] })).toEqual({
      error: null,
      repaired: true,
    });
  });

  it('tanpa langkah pemulihan / pemulihan tidak menolong → alasan jelas', async () => {
    const d = dir();
    const prep = mk(d, 'prep.sh', 'echo "API rusak" >&2; exit 1');
    const fixNoop = mk(d, 'fix.sh', 'exit 0');
    expect((await prepareEmulator({ prepare: [step([prep])], repair: [] })).error).toBe(
      'persiapan emulator gagal (prep.sh: API rusak)',
    );
    expect((await prepareEmulator({ prepare: [step([prep])], repair: [step([fixNoop])] })).error).toBe(
      'persiapan emulator gagal setelah pemulihan (prep.sh: API rusak)',
    );
  });

  it('data emulator kosong: perbaikan "tidak ada yang rusak" → stack dinyalakan & diisi ulang → persiapan berhasil', async () => {
    const d = dir();
    const prep = mk(
      d,
      'prep.sh',
      `test -f "${d}/seeded" || { echo "subscriptions/x is not in the emulator" >&2; exit 1; }`,
    );
    const fix = mk(d, 'fix.sh', 'echo "stack sehat; tidak ada yang dipulihkan" >&2; exit 1');
    const seed = mk(d, 'seed.sh', `touch "${d}/seeded"`);
    expect(await prepareEmulator({ prepare: [step([prep])], repair: [step([fix])], start: [step([seed])] })).toEqual({
      error: null,
      repaired: true,
    });
  });

  it('persiapan tetap gagal setelah pemulihan → alasan lengkap (perbaikan & stack)', async () => {
    const d = dir();
    const prep = mk(d, 'prep.sh', 'echo "akun hilang" >&2; exit 1');
    const fix = mk(d, 'fix.sh', 'echo "tidak ada yang dipulihkan" >&2; exit 1');
    const up = mk(d, 'up.sh', 'echo "port diambil" >&2; exit 1');
    expect((await prepareEmulator({ prepare: [step([prep])], repair: [step([fix])], start: [step([up])] })).error).toBe(
      'persiapan emulator gagal setelah pemulihan (prep.sh: akun hilang); pemulihan: fix.sh: tidak ada yang dipulihkan; menyalakan stack: up.sh: port diambil',
    );
  });

  it('pemulihan berjalan di luar kunci job (lepas → perbaiki/seed → ambil lagi); kunci gagal diambil → alasan', async () => {
    const d = dir();
    const prep = mk(d, 'prep.sh', `test -f "${d}/seeded" || { echo "kosong" >&2; exit 1; }`);
    const seed = mk(d, 'seed.sh', `touch "${d}/seeded"; echo seed >> "${d}/urutan"`);
    const order: string[] = [];
    const r = await prepareEmulator({ prepare: [step([prep])], repair: [], start: [step([seed])] }, async (fn) => {
      order.push('lepas');
      await fn();
      order.push(readFileSync(join(d, 'urutan'), 'utf8').trim());
      order.push('ambil');
    });
    expect(r).toEqual({ error: null, repaired: true });
    expect(order).toEqual(['lepas', 'seed', 'ambil']);
    const d2 = dir();
    const prep2 = mk(d2, 'prep.sh', 'echo "kosong" >&2; exit 1');
    const r2 = await prepareEmulator(
      { prepare: [step([prep2])], repair: [], start: [step([mk(d2, 'ok.sh', 'exit 0')])] },
      async (fn) => {
        await fn();
        throw new Error('lajur D8 dipegang sesi lain');
      },
    );
    expect(r2.error).toBe(
      'persiapan emulator gagal (prep.sh: kosong); kunci emulator tidak bisa diambil lagi: lajur D8 dipegang sesi lain',
    );
  });

  it('persiapan sehat → pemulihan tidak dijalankan', async () => {
    const d = dir();
    const ok = mk(d, 'ok.sh', 'exit 0');
    const fix = mk(d, 'fix.sh', `touch "${d}/dipanggil"`);
    expect(await prepareEmulator({ prepare: [step([ok])], repair: [step([fix])] })).toEqual({
      error: null,
      repaired: false,
    });
    expect(existsSync(join(d, 'dipanggil'))).toBe(false);
  });
});

describe('patch emulator per file', () => {
  // dua varian patch: varian A cocok untuk a.txt (kode baru) tapi tidak untuk b.txt; varian B sebaliknya
  const sec = (file: string, from: string, to: string) =>
    [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ -1,2 +1,2 @@',
      ' baris-1',
      `-${from}`,
      `+${to}`,
      '',
    ].join('\n');

  it('tidak ada patch yang cocok utuh → tiap file memakai varian yang cocok', async () => {
    const d = dir();
    const src = join(d, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'baris-1\nlama-a-baru\n');
    writeFileSync(join(src, 'b.txt'), 'baris-1\nlama-b\n');
    const A = join(d, 'A.patch');
    const B = join(d, 'B.patch');
    writeFileSync(A, sec('a.txt', 'lama-a-baru', 'emu-a') + sec('b.txt', 'lama-b-baru', 'emu-b'));
    writeFileSync(B, sec('a.txt', 'lama-a', 'emu-a') + sec('b.txt', 'lama-b', 'emu-b'));
    expect(await applyPatches(src, [A, B], join(d, 'tmp'))).toBeNull();
    expect(readFileSync(join(src, 'a.txt'), 'utf8')).toBe('baris-1\nemu-a\n');
    expect(readFileSync(join(src, 'b.txt'), 'utf8')).toBe('baris-1\nemu-b\n');
  });

  it('ada file tanpa varian yang cocok → tidak ada yang dipasang, alasan menyebut file', async () => {
    const d = dir();
    const src = join(d, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'baris-1\nlain\n');
    const A = join(d, 'A.patch');
    writeFileSync(A, sec('a.txt', 'lama-a', 'emu-a'));
    expect(await applyPatches(src, [A], join(d, 'tmp'))).toBe('A.patch: tidak cocok untuk a.txt');
    expect(readFileSync(join(src, 'a.txt'), 'utf8')).toBe('baris-1\nlain\n');
  });

  it('patch untuk branch lain (file yang tidak ada di sini) tidak ikut dipasang', async () => {
    const d = dir();
    const src = join(d, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'baris-1\nlama-a\n');
    const branchIni = join(d, 'ini.patch');
    const branchLain = join(d, 'lain.patch');
    // varian "ini" sedikit basi untuk a.txt; varian "lain" punya bagian a.txt yang cocok + file yang tidak ada di sini
    writeFileSync(branchIni, sec('a.txt', 'lama-a-basi', 'emu-a'));
    writeFileSync(branchLain, sec('a.txt', 'lama-a', 'emu-a') + sec('lib/config/app_env.dart', 'x', 'y'));
    expect(await applyPatches(src, [branchIni, branchLain], join(d, 'tmp'))).toBeNull();
    expect(readFileSync(join(src, 'a.txt'), 'utf8')).toBe('baris-1\nemu-a\n');
  });

  it('patch utuh yang cocok dipakai langsung', async () => {
    const d = dir();
    const src = join(d, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'baris-1\nlama-a\n');
    const A = join(d, 'A.patch');
    writeFileSync(A, sec('a.txt', 'lama-a', 'emu-a'));
    expect(await applyPatches(src, [A], join(d, 'tmp'))).toBeNull();
    expect(readFileSync(join(src, 'a.txt'), 'utf8')).toBe('baris-1\nemu-a\n');
  });
});

describe('laporan penguji agent', () => {
  it('teks/daftar yang terlalu panjang dipotong, bukan ditolak', async () => {
    const { AppAgentOutputSchema } = await import('@chefjuno/shared');
    const long = 'x'.repeat(5000);
    const p = AppAgentOutputSchema.safeParse({
      change: { status: 'not_reproduced', note: long, shots: Array.from({ length: 12 }, (_, i) => `s${i}.png`) },
      findings: [],
      skipped: [],
      lessons: [long, 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    expect(p.success).toBe(true);
    expect(p.data!.change.note).toHaveLength(1500);
    expect(p.data!.change.shots).toHaveLength(8);
    expect(p.data!.lessons).toHaveLength(6);
    expect(p.data!.lessons[0]).toHaveLength(400);
  });
});

describe('pembersihan app penguji', () => {
  it('saat mesin menyala: perintah cleanup profil dijalankan di worktree job yang tersisa', async () => {
    const home = dir();
    const wt = join(home, 'jobs', 'jobA-x', 'worktree');
    mkdirSync(join(wt, 'scripts'), { recursive: true });
    const stop = join(wt, 'scripts', 'app.sh');
    writeFileSync(stop, '#!/bin/sh\ntouch "$PWD/berhenti-$1"\n');
    chmodSync(stop, 0o755);
    mkdirSync(join(home, 'jobs', 'jobB-y'), { recursive: true }); // tanpa worktree → dilewati
    writeFileSync(
      join(home, 'app-local.json'),
      JSON.stringify({
        'tim/app': { agentTest: { cleanup: [{ command: ['scripts/app.sh', 'web'] }] } },
      }),
    );
    const prev = process.env.CHEFJUNO_HOME;
    process.env.CHEFJUNO_HOME = home;
    const logs: string[] = [];
    try {
      expect(await cleanupOrphanAppRuns((m) => logs.push(m))).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.CHEFJUNO_HOME;
      else process.env.CHEFJUNO_HOME = prev;
    }
    expect(existsSync(join(wt, 'berhenti-web'))).toBe(true);
    expect(logs).toEqual(['🧹 sisa uji aplikasi jobA-x dibersihkan']);
  });

  it('profil: cleanup opsional (default kosong)', () => {
    const p = LocalAppProfileSchema.parse({ agentTest: { instructions: 'x' } });
    expect(p.agentTest!.cleanup).toEqual([]);
  });
});

describe('emulator mati → dinyalakan otomatis', () => {
  const step = (command: string[]) => ({ command, env: {}, timeoutSec: 10 });
  const sh = (body: string) => {
    const p = join(dir(), 's.sh');
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const freePort = async () => {
    const s = createServer().listen(0);
    await new Promise((r) => s.once('listening', r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    return port;
  };

  it('port menjawab → langkah start tidak dijalankan', async () => {
    const srv = createServer().listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as AddressInfo).port;
    const d = dir();
    try {
      expect(
        await ensureEmulatorUp({ requirePorts: [port], start: [step([sh(`touch "${d}/dipanggil"`)])] }),
      ).toBeNull();
      expect(existsSync(join(d, 'dipanggil'))).toBe(false);
    } finally {
      srv.close();
    }
  });

  it('port mati: tanpa start → alasan; start gagal → alasan; start jalan tapi port tetap mati → alasan', async () => {
    const port = await freePort();
    expect(await ensureEmulatorUp({ requirePorts: [port], start: [] })).toBe(
      `emulator lokal belum menyala (port ${port} tidak menjawab)`,
    );
    expect(
      await ensureEmulatorUp({ requirePorts: [port], start: [step([sh('echo "java hilang" >&2; exit 1')])] }),
    ).toBe(`emulator lokal mati (port ${port}) dan gagal dinyalakan (s.sh: java hilang)`);
    expect(await ensureEmulatorUp({ requirePorts: [port], start: [step([sh('exit 0')])] }, { tries: 2, ms: 10 })).toBe(
      `emulator lokal dinyalakan tapi port ${port} belum menjawab`,
    );
    // start gagal → perbaikan dijalankan → start dicoba sekali lagi (berhasil setelah perbaikan)
    const d = dir();
    const up = sh(`test -f "${d}/diperbaiki" || { echo "pid lama" >&2; exit 1; }`);
    const fix = sh(`touch "${d}/diperbaiki"`);
    expect(
      await ensureEmulatorUp(
        { requirePorts: [port], start: [step([up])], repair: [step([fix])] },
        { tries: 1, ms: 10 },
      ),
    ).toBe(`emulator lokal dinyalakan tapi port ${port} belum menjawab`);
    expect(existsSync(join(d, 'diperbaiki'))).toBe(true);
  });
});

describe('alur yang diubah harus terbukti', () => {
  const out = (change: Record<string, unknown>) =>
    ({ success: true, data: { change, findings: [], skipped: [], lessons: [] } }) as unknown as Parameters<
      typeof changeGap
    >[0];
  it('tidak dicoba / tanpa screenshot → alasan; dicoba + screenshot ada → null', () => {
    const d = dir();
    writeFileSync(join(d, 'alur.png'), 'x');
    expect(changeGap(out({ status: 'inconclusive', note: '', shots: [] }), d)).toBe(
      'alur yang diubah tidak sampai dicoba',
    );
    expect(changeGap(out({ status: 'not_reproduced', note: '', shots: ['hilang.png'] }), d)).toBe(
      'tidak ada screenshot bukti alur yang diubah',
    );
    expect(changeGap(out({ status: 'not_reproduced', note: '', shots: ['alur.png'] }), d)).toBeNull();
    expect(changeGap(out({ status: 'reproduced', note: '', shots: ['/x/y/alur.png'] }), d)).toBeNull();
    expect(changeGap({ success: false } as Parameters<typeof changeGap>[0], d)).toBeNull();
  });
});
