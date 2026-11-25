import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearAuth, clearFirestore, FN_BASE } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

// Uji aplikasi (verifikasi empiris tahap 2): build web PR → agent merencanakan langkah → runner SUNGGUHAN (Chromium
// Playwright di host, lewat container palsu) mencoba aplikasi fixture yang punya bug → agent menilai → screenshot bukti.
const FAKE_CONTAINER = fileURLToPath(new URL('../../../daemon/test/fake-container.mjs', import.meta.url));
// aplikasi memanggil URL berisi API key web (seperti Firebase ?key=AIza…) yang gagal → tidak boleh ikut tercatat
const FAKE_WEB_KEY = 'AIza' + 'SyFAKEFAKEFAKEFAKEFAKEFAKE01';
const WEB_APP = readFileSync(
  fileURLToPath(new URL('../../../daemon/test/fixtures/web-app/index.html', import.meta.url)),
  'utf8',
).replace(
  '<main id="app"></main>',
  `<main id="app"></main><script>fetch('http://127.0.0.1:9/v1/accounts:lookup?key=${FAKE_WEB_KEY}').catch(() => {});</script>`,
);
const APP_CONFIG = {
  build: {
    image: 'ghcr.io/cirruslabs/flutter:stable',
    commands: ['mkdir -p build && cp -R web build/web'],
    outDir: 'build/web',
  },
  flutterSemantics: false,
  viewport: { width: 412, height: 800 },
  login: [
    { do: 'fill', label: 'Email', value: '{{email}}' },
    { do: 'fill', label: 'Kata sandi', value: '{{password}}' },
    { do: 'click', role: 'button', name: 'Masuk' },
    { do: 'wait', text: 'Beranda' },
  ],
  blockHosts: ['*.amplitude.com'],
  timeoutSec: 120,
};

let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await h.startMachine({ agents: ['claude'] });
  process.env.CHEFJUNO_CONTAINER_BIN = FAKE_CONTAINER;
  process.env.CHEFJUNO_APP_EMAIL = 'tester@contoh.id';
  process.env.CHEFJUNO_APP_PASSWORD = 'rahasia-uji';
});
afterAll(async () => {
  delete process.env.CHEFJUNO_CONTAINER_BIN;
  delete process.env.CHEFJUNO_APP_EMAIL;
  delete process.env.CHEFJUNO_APP_PASSWORD;
  await h?.stop();
});

describe('uji aplikasi', () => {
  it('temuan P1 dicoba di browser: terbukti, screenshot tersimpan, komentar PR menautkan bukti; kredensial tidak bocor', async () => {
    // konfigurasi dari branch tujuan; kode aplikasi (yang dibangun) dari PR
    const base = h.repo.commit({ '.chefjuno/app.json': JSON.stringify(APP_CONFIG) }, 'chore: konfigurasi uji aplikasi');
    const head = h.repo.commit({ 'web/index.html': WEB_APP }, 'feat: halaman keranjang', 'feat/cache-user');
    h.repo.git('push', '-q', '-f', h.repo.bare, `${head}:refs/pull/1/head`);
    const pr = h.mock.repos.get(h.repo.fullName)!.prs.get(1)!;
    pr.baseSha = base;
    pr.headSha = head;
    await h.db.doc('settings/global').update({ appVerifyEnabled: true, reviewMode: 'standard' });

    await h.comment('lapor @chefjuno');
    // satu standar: review diposting dulu (uji menyusul), lalu job uji aplikasi lanjutan
    const review = await h.waitJob((j) => j.type === 'review' && j.status === 'posted', 120_000);
    expect(review.data.config.appVerifyEnabled).toBe(true);
    expect(review.data.result.meta.appVerification).toMatchObject({ ran: false, pending: true });
    const app = await h.waitJob(
      (j) => j.type === 'app-verify' && j.status === 'posted' && j.parentJobId === review.id,
      180_000,
    );
    const parent = (await h.db.doc(`jobs/${review.id}`).get()).data()!;
    const meta = parent.result.meta.appVerification;
    // tanpa alasan dilewati (kalau gagal, alasannya tercetak)
    expect(meta.reason ?? null).toBeNull();
    expect(meta).toMatchObject({ ran: true, loginOk: true, jobId: app.id });
    // temuan 1 dicoba + alur yang diubah PR selalu dicoba; temuan lain dilewati dengan alasan
    expect(meta.scenarios).toHaveLength(2);
    const sc = meta.scenarios.find((x: { finding: number }) => x.finding >= 0);
    expect(sc.status).toBe('reproduced');
    expect(sc.steps.map((s: { do: string; ok: boolean }) => `${s.do}:${s.ok}`)).toEqual([
      'goto:true',
      'click:true',
      'screenshot:true',
      'expectNoText:false',
    ]);
    expect(meta.change).toMatchObject({ status: 'not_reproduced' });
    expect(meta.skipped.length).toBeGreaterThan(0);
    // peran agent: rencana (sonnet) & penilai (opus)
    const roles = (app.data.result.meta.passes as { label: string; model: string }[]).map(
      (p) => `${p.label}:${p.model}`,
    );
    expect(roles).toEqual(expect.arrayContaining(['app-plan:sonnet', 'app-judge:opus']));

    // temuan diperbarui: keyakinan ≥ 0.95, bukti menunjuk screenshot yang tersimpan di job uji
    const f = app.data.result.findings[sc.finding];
    expect(f.evidence.status).toBe('reproduced');
    expect(f.confidence).toBeGreaterThanOrEqual(0.95);
    expect(f.evidence.shots[0]).toBe(`f${sc.finding}-0`);
    const ev = await h.db.collection(`jobs/${app.id}/evidence`).get();
    const main = ev.docs.find((d) => d.id === f.evidence.shots[0])!.data();
    expect(main.name).toBe('bukti');
    expect(main.mime).toBe('image/jpeg');
    // JPEG asli dari Chromium (magic number FF D8 FF)
    expect(Buffer.from(main.data, 'base64').subarray(0, 3).toString('hex')).toBe('ffd8ff');
    // dokumen temuan di dashboard ikut diperbarui
    const doc = (await h.db.doc(`findings/${f.findingId}`).get()).data()!;
    expect(doc.evidence.status).toBe('reproduced');

    // komentar inline temuan itu diperbarui: menautkan bukti ke halaman review induk
    const inline = h.mock.reviewComments.find((c: { body: string }) => c.body.includes(f.title));
    expect(inline?.body).toContain('🧪 **Terbukti saat dicoba di aplikasi**');
    expect(inline?.body).toContain(`http://localhost:4200/reviews/${review.id}#bukti-${f.evidence.shots[0]}`);

    // screenshot tampil langsung di GitHub: <img> bertanda tangan di komentar inline & komentar 🧪
    const imgRe = new RegExp(`<img src="(http://localhost:4200/evidence\\?j=${app.id}&s=[\\w-]+&sig=[0-9a-f]{32})"`);
    const inlineImg = imgRe.exec(inline!.body)?.[1];
    expect(inlineImg).toBeTruthy();
    // URL disajikan function evidenceImage (di produksi lewat rewrite Hosting /evidence)
    const viaFn = `${FN_BASE}/evidenceImage${new URL(inlineImg!).search}`;
    const img = await fetch(viaFn);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(
      Buffer.from(await img.arrayBuffer())
        .subarray(0, 3)
        .toString('hex'),
    ).toBe('ffd8ff');
    // tanda tangan palsu / id lain → ditolak
    expect((await fetch(viaFn.replace(/sig=[0-9a-f]{32}/, `sig=${'0'.repeat(32)}`))).status).toBe(403);
    expect((await fetch(viaFn.replace(/&s=[\w-]+/, '&s=f9-0'))).status).toBe(403);

    // satu komentar 🧪 + status gate akhir (kode FAIL → tetap failure, kini diuji di aplikasi)
    const appComments = h.mock.issueComments.filter((c) => c.body.includes('<!-- chefjuno-ai:app -->'));
    expect(appComments).toHaveLength(1);
    expect(appComments[0].body).toContain('✅ **Alur yang diubah PR:** berjalan normal');
    expect(appComments[0].body).toContain('Terbukti saat dicoba');
    expect(appComments[0].body).toMatch(imgRe); // screenshot alur & temuan inline
    const st = h.mock.statuses.filter((x) => x.sha === head);
    expect(st.at(-1)).toMatchObject({ state: 'failure', context: 'Chef Juno' });
    expect(st.at(-1)!.description).toContain('diuji di aplikasi');
    expect(parent.result.appGate).toMatchObject({ verdict: 'FAIL', state: 'failure' });

    // request gagal dicatat tanpa query string (kunci di URL tidak ikut; job tidak digagalkan pengaman kebocoran)
    const failed = meta.scenarios.flatMap((x: { failedRequests: string[] }) => x.failedRequests);
    expect(failed.some((u: string) => u.includes('127.0.0.1:9/v1/accounts:lookup'))).toBe(true);
    // kredensial akun testing tidak pernah masuk hasil job / komentar
    const all =
      JSON.stringify(parent) +
      JSON.stringify(app.data) +
      JSON.stringify(h.mock.reviewComments) +
      JSON.stringify(h.mock.issueComments);
    expect(all).not.toContain('rahasia-uji');
    expect(all).not.toContain('tester@contoh.id');
    expect(all).not.toContain(FAKE_WEB_KEY);
  });

  it('akun testing belum diatur → uji dilewati dengan alasan, review tetap diposting; PR belum teruji (bukan lulus)', async () => {
    delete process.env.CHEFJUNO_APP_EMAIL;
    delete process.env.CHEFJUNO_APP_PASSWORD;
    const appPosted = async () =>
      (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'posted').get()).size;
    const before = await appPosted();
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await appPosted()) === before + 1, 120_000, 'uji aplikasi kedua');
    const jobs = await h.db.collection('jobs').where('type', '==', 'review').where('status', '==', 'posted').get();
    const last = jobs.docs.map((d) => d.data()).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
    expect(last.result.meta.appVerification).toMatchObject({
      ran: false,
      reason: 'akun testing belum diatur di mesin ini (~/.chefjuno/app-accounts.json)',
    });
    expect(last.result.appGate).toMatchObject({ verdict: 'UNTESTED', state: 'error' });
    const st = h.mock.statuses.at(-1)!;
    expect(st).toMatchObject({ state: 'error' });
    expect(st.description).toContain('Belum teruji di aplikasi: akun testing belum diatur');
    expect(h.mock.issueComments.find((c) => c.body.includes('<!-- chefjuno-ai:app -->'))!.body).toContain(
      '⚠️ **Belum teruji di aplikasi:** akun testing belum diatur',
    );
  });
});
