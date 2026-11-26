import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clearAuth, clearFirestore, seedTeamSkills } from '../helpers.js';
import { createHarness, REPO_ID, type Harness } from '../harness.js';

// Uji aplikasi oleh satu agent (seperti lane functional reviewer-agent) + memory Chef Juno:
// `@chefjuno ingat …` dan pelajaran penguji tersimpan sebagai fakta, dipakai reviewer & penguji berikutnya.
let h: Harness;
const recs = () =>
  readdirSync(h.recordDir)
    .filter((f) => f.startsWith('claude-'))
    .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')));
const facts = async () =>
  (await h.db.collection('rules').where('kind', '==', 'fact').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await seedTeamSkills();
  await h.startMachine({ agents: ['claude'] });
  writeFileSync(
    join(dirname(h.recordDir), 'app-local.json'),
    JSON.stringify({
      [h.repo.fullName]: { agentTest: { instructions: 'fake: jalankan app lewat skill verify', readFirst: [] } },
    }),
  );
  await h.db.doc('settings/global').update({ appVerifyEnabled: true });
});
afterAll(async () => {
  await h?.stop();
});

describe('memory Chef Juno & uji aplikasi oleh agent', () => {
  it('`@chefjuno ingat …` menyimpan fakta (sekali saja); duplikat dikenali', async () => {
    await h.comment('@chefjuno ingat akun uji butuh langganan premium supaya kuis terbuka');
    await h.waitFor(async () => (await facts()).length === 1, 15_000, 'fakta tersimpan');
    const [f] = await facts();
    expect(f).toMatchObject({
      text: 'akun uji butuh langganan premium supaya kuis terbuka',
      status: 'active',
      source: 'ingat',
      scope: { repoId: REPO_ID, paths: [] },
    });
    await h.waitFor(
      async () => h.mock.issueComments.some((c) => c.body.startsWith('🧠 Disimpan ke memory Chef Juno')),
      10_000,
      'balasan',
    );
    // hampir sama → tidak disimpan dua kali
    await h.comment('@chefjuno ingat akun uji butuh langganan premium agar kuis terbuka');
    await h.waitFor(
      async () => h.mock.issueComments.some((c) => c.body === '🧠 Sudah ada di memory Chef Juno.'),
      10_000,
      'duplikat',
    );
    expect(await facts()).toHaveLength(1);
  });

  it('review & penguji memakai fakta; penguji agent menyetir app, screenshot tampil di PR, pelajarannya diingat', async () => {
    await h.comment('lapor @chefjuno');
    const review = await h.waitJob((j) => j.type === 'review' && j.status === 'posted', 90_000);
    const app = await h.waitJob((j) => j.type === 'app-verify' && j.status === 'posted', 90_000);

    // reviewer melihat fakta yang diingat
    const lens = recs().find((r) => String(r.system).includes('# Tujuan'));
    expect(lens.prompt + lens.system).toContain('Fakta yang diingat: akun uji butuh langganan premium');
    // penguji: satu agent yang boleh menjalankan perintah (seperti lane functional), membaca memory
    const tester = recs().find((r) => String(r.system).includes('penguji aplikasi independen'));
    expect(tester.argv).toContain('bypassPermissions');
    // skill tim berkategori inti ikut mengikat penguji; skill domain tidak
    expect(tester.system).toContain('(`bukti`)');
    expect(tester.system).toContain('(`jujur-soal-kelengkapan`)');
    expect(tester.system).not.toContain('(`flutter-tim`)');
    expect(tester.prompt).toContain(
      '## Memory Chef Juno (fakta yang sudah dipelajari)\n- akun uji butuh langganan premium',
    );
    expect(tester.prompt).toContain('## Instruksi tim untuk uji aplikasi\nfake: jalankan app lewat skill verify');
    // penguji diberi commit base untuk membandingkan perilaku base vs PR
    expect(tester.prompt).toMatch(/## Commit base\n[0-9a-f]{40} \(folder job: \S+\)/);
    expect(tester.system).toContain('Bandingkan dengan base');

    // hasil uji di review induk: alur yang diubah berjalan normal + temuan terbukti, screenshot tersimpan
    const parent = (await h.db.doc(`jobs/${review.id}`).get()).data()!;
    const meta = parent.result.meta.appVerification;
    expect(meta).toMatchObject({ ran: true, jobId: app.id, change: { status: 'not_reproduced' } });
    const ev = await h.db.collection(`jobs/${app.id}/evidence`).get();
    expect(ev.docs.map((d) => d.id)).toContain('c-0');
    expect(ev.docs.find((d) => d.id === 'c-0')!.get('mime')).toBe('image/jpeg');
    const appComment = h.mock.issueComments.find((c) => c.body.includes('<!-- chefjuno-ai:app -->'))!;
    expect(appComment.body).toContain('✅ **Alur yang diubah PR:** berjalan normal');
    expect(appComment.body).toMatch(/<img src="http:\/\/localhost:4200\/evidence\?j=\w+&s=c-0&sig=[0-9a-f]{32}"/);

    // pelajaran penguji → fakta baru di memory (sumber: uji aplikasi)
    const all = await facts();
    expect(all.find((f) => (f as { source?: string }).source === 'uji-aplikasi')).toMatchObject({
      text: 'Akun uji harus premium supaya kuis dan laporan terbuka (fake).',
      status: 'active',
    });
    expect((await h.db.doc(`jobs/${app.id}`).get()).get('result.remembered')).toHaveLength(1);
  });

  it('penguji melewatkan alur yang diubah → ditegur & diulang sekali; hasil kedua yang dipakai', async () => {
    h.mock.repos.get(h.repo.fullName)!.prs.get(1)!.body = 'FAKE_APP_SKIP_CHANGE';
    const before = recs().filter((r) => String(r.system).includes('penguji aplikasi independen')).length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () =>
        (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'posted').get()).size ===
        2,
      120_000,
      'uji kedua',
    );
    const testers = recs()
      .filter((r) => String(r.system).includes('penguji aplikasi independen'))
      .slice(before);
    expect(testers).toHaveLength(2);
    expect(testers[0].system).not.toContain('PERHATIAN: percobaan sebelumnya');
    expect(testers[1].system).toContain('PERHATIAN: percobaan sebelumnya belum membuktikan ALUR YANG DIUBAH PR');
    const app = (await h.db.collection('jobs').where('type', '==', 'app-verify').get()).docs
      .map((d) => d.data())
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
    expect(app.result.meta.passes.map((x: { label: string }) => x.label)).toEqual(['app-agent', 'app-agent-retry']);
    expect(app.result.appVerification.change).toMatchObject({ status: 'not_reproduced' });
    expect(app.result.appVerification.change.shots.length).toBeGreaterThan(0);
  });

  it('deskripsi PR bertemplate → penguji & reviewer menerima "Alur yang diubah PR" dan "Cara mencoba" terstruktur', async () => {
    h.mock.repos.get(h.repo.fullName)!.prs.get(1)!.body = [
      '## Why',
      '<!-- intent -->',
      'Opsi cache baru untuk keranjang.',
      '',
      '## Behavior change',
      'Keranjang dimuat dari cache saat offline.',
      '',
      '## Affected screens and flows',
      '- Beranda → Keranjang: kosong saat offline → isi terakhir tampil',
      '',
      '## How to try it',
      '- Account: akun uji biasa',
      '- Data: keranjang berisi dua barang',
      '- Steps:',
      '  1. Buka Keranjang',
      '  2. Matikan jaringan, muat ulang',
      '',
      '## Verification',
      '- Tests and analyze: cache_test lulus',
      '- Device or emulator: belum',
    ].join('\n');
    const before = recs().filter((r) => String(r.system).includes('penguji aplikasi independen')).length;
    const posted = async () =>
      (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'posted').get()).size;
    const done = await posted();
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await posted()) === done + 1, 120_000, 'uji aplikasi');

    const tester = recs()
      .filter((r) => String(r.system).includes('penguji aplikasi independen'))
      .slice(before)[0];
    expect(tester.prompt).toContain(
      '## Alur yang diubah PR (dari penulis; wajib dicoba semua)\nPerubahan perilaku:\nKeranjang dimuat dari cache ' +
        'saat offline.\n\nLayar & alur:\n- Beranda → Keranjang: kosong saat offline → isi terakhir tampil',
    );
    expect(tester.prompt).toContain(
      '## Cara mencoba (dari penulis)\nAkun: akun uji biasa\nData: keranjang berisi dua barang\nLangkah:\n' +
        '1. Buka Keranjang\n2. Matikan jaringan, muat ulang',
    );
    expect(tester.prompt).not.toContain('<!-- intent -->');
    expect(tester.system).toContain(
      'Kalau brief punya bagian "Alur yang diubah PR" dan\n   "Cara mencoba" dari penulis',
    );
    // agent review (mode tujuan) membaca brief yang sama
    const reviewers = recs().filter((r) => String(r.system).includes('# Tujuan'));
    expect(reviewers.some((r) => String(r.prompt).includes('## Cara mencoba (dari penulis)'))).toBe(true);
  });

  it('mesin tanpa emulator (--no-app) hanya mengambil review; uji aplikasi menunggu mesin yang punya emulator', async () => {
    // matikan mesin utama, nyalakan mesin "tim" tanpa uji aplikasi
    await h.stop();
    await clearFirestore();
    await clearAuth();
    h = await createHarness();
    await seedTeamSkills();
    writeFileSync(
      join(dirname(h.recordDir), 'app-local.json'),
      JSON.stringify({ [h.repo.fullName]: { agentTest: { instructions: 'fake', readFirst: [] } } }),
    );
    await h.db.doc('settings/global').update({ appVerifyEnabled: true });
    await h.startMachine({ agents: ['claude'], noApp: true });
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () =>
        (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'queued').get()).size >=
        1,
      90_000,
      'uji aplikasi antre',
    );
    // review sudah diposting oleh mesin tim, uji aplikasi tetap antre (tidak diserobot lalu dilewati)
    expect(
      (await h.db.collection('jobs').where('type', '==', 'review').where('status', '==', 'posted').get()).size,
    ).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 3000));
    const app = (await h.db.collection('jobs').where('type', '==', 'app-verify').get()).docs.map((d) => d.data());
    // tidak ada uji yang diambil mesin tanpa emulator
    expect(app.length).toBeGreaterThan(0);
    expect(app.every((j) => j.status === 'queued' && !j.machineId)).toBe(true);
    // mesin dengan emulator menyala → mengambil uji yang antre
    await h.startMachine({ agents: ['claude'] });
    await h.waitFor(
      async () =>
        (await h.db.collection('jobs').where('type', '==', 'app-verify').where('status', '==', 'posted').get()).size >=
        1,
      90_000,
      'uji diambil mesin emulator',
    );
  });
});
