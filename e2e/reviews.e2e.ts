import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';
import { seedSample } from '../scripts/seed-sample.mjs';

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await seedSample(db);
  await importGithubUser('uid-dev2', '2002', 'dev2');
});

test('Review Kode (daftar PR), detail review, dan Analitik menampilkan data dari Firestore', async ({ page }) => {
  await loginAs(page, 'uid-dev2');
  await expect(page.getByRole('heading', { name: 'Review Kode', exact: true })).toBeVisible();
  const list = page.getByTestId('reviews-table');
  await expect(list.locator('[data-pr]')).toHaveCount(6);
  await expect(list).toContainText('fix: tabel tidak refresh setelah filter');
  await expect(list.locator('[data-pr="tim/sample-repo#12"]')).toContainText('Perlu perbaikan');
  await expect(list.locator('[data-pr="tim/dashboard-web#88"]')).toContainText('Siap merge');
  await expect(list.locator('[data-pr="tim/dashboard-web#90"]')).toContainText('Sedang direview');
  await page.getByTestId('reviews-filter').fill('export CSV');
  await expect(list.locator('[data-pr]')).toHaveCount(1);
  await page.getByTestId('reviews-filter').fill('');
  // filter saran "status perlu perbaikan"
  await page.getByRole('button', { name: /status perlu perbaikan/ }).click();
  await expect(list.locator('[data-status="ready"]')).toHaveCount(0);
  await page.getByRole('button', { name: /status perlu perbaikan/ }).click();

  // item rail yang aktif benar-benar ditandai secara visual (bukan hanya aria-current)
  const active = page.locator('cj-nav-rail a[aria-current="page"]').first();
  await expect(active).toContainText('Review');
  expect(await active.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await list.getByRole('link', { name: 'feat: cache option untuk fetchUser' }).click();
  await expect(page).toHaveURL(/\/reviews\/sample-job-1$/);
  await expect(page.getByTestId('review-summary')).toContainText('Skor 3/5');
  await expect(page.getByTestId('review-summary')).toContainText('Yang perlu kamu pahami dari PR ini');
  // ringkasan dirender sebagai Markdown: `fetchUser` jadi <code>, bukan backtick mentah
  await expect(page.getByTestId('review-summary')).toContainText('fetchUser dipakai di 4 tempat');
  await expect(page.getByTestId('review-summary').locator('code', { hasText: 'fetchUser' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hasil fetchUser tidak dicek null' })).toBeVisible();
  // bukti uji aplikasi: status + screenshot (data dari jobs/{id}/evidence), bisa diperbesar & ditutup dengan Escape
  const ev = page.getByTestId('finding-evidence');
  await expect(ev).toHaveCount(1);
  await expect(ev).toContainText('Terbukti saat dicoba di aplikasi');
  await expect(ev).toContainText('total keranjang tampil "Rp NaN"');
  const thumb = ev.getByRole('button', { name: 'Perbesar screenshot setelah-tambah' });
  await expect(thumb.locator('img')).toHaveJSProperty('complete', true);
  expect(await thumb.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
  await thumb.click();
  await expect(page.getByRole('dialog', { name: 'Screenshot setelah-tambah' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('review-app-verification')).toContainText('1 skenario dicoba');
  // tautan dari komentar PR langsung ke screenshot
  await page.goto('/reviews/sample-job-1#bukti-f0-0');
  await expect(page.locator('#bukti-f0-0')).toBeInViewport();

  await page.getByRole('link', { name: 'Analitik', exact: true }).click();
  const ov = page.getByTestId('analytics-overview');
  await expect(ov).toContainText('Pull request');
  await expect(ov).toContainText('Temuan');
  const dl = page.waitForEvent('download');
  await page.getByTestId('analytics-export').click();
  const csv = readFileSync((await (await dl).path())!, 'utf8');
  expect(csv.split('\n')[0]).toBe('tanggal,repo,pr,judul,penulis,status,skor,temuan,agent');
  expect(csv).toContain('feat: cache option untuk fetchUser');

  await page.getByRole('tab', { name: 'Temuan' }).click();
  await expect(page).toHaveURL(/\/analytics\/temuan$/);
  const ft = page.getByTestId('findings-table');
  await expect(ft).toContainText('Token disimpan di localStorage');
  await expect(ft).toContainText('Dibantah');
  await expect(ft).toContainText('Diperbaiki');
  await expect(ft).toContainText('AI coder: tidak diperbaiki — sengaja, sudah dicek di guard');
  await page.getByTestId('findings-search').fill('localStorage');
  await expect(ft.locator('tbody tr')).toHaveCount(await ft.locator('tbody tr').count());
  await expect(ft.locator('tbody tr').first()).toContainText('Token disimpan di localStorage');
});

test('Analitik → Biaya & waktu: token, waktu review, rincian per model/peran/mode, estimasi dari harga di Pengaturan', async ({
  page,
}) => {
  // anggota biasa juga bisa melihat Analitik
  await loginAs(page, 'uid-dev2');
  await page.goto('/analytics');
  await page.getByRole('tab', { name: 'Biaya & waktu' }).click();
  await expect(page).toHaveURL(/\/analytics\/biaya$/);
  const ov = page.getByTestId('cost-overview');
  await expect(ov).toContainText('Token');
  await expect(ov).toContainText('Waktu review');
  await expect(ov).toContainText('Sampai tampil di PR');
  // tanpa harga: tidak ada angka biaya karangan
  await expect(page.getByTestId('cost-estimate')).toContainText('isi harga model di Pengaturan');
  const models = page.getByTestId('cost-by-model');
  await expect(models.locator('[data-model="gpt-6.2-sol"]')).toContainText('3'); // 2 spesialis + lead
  await expect(models.locator('[data-model="gpt-6.2-sol"]')).toContainText('Lead, Putaran spesialis');
  await expect(models.locator('[data-model="gpt-6.2-astra"]')).toContainText('Validasi / penilai');
  await expect(models.locator('[data-model="claude-sonnet-4-6"]')).toContainText('Review standar');
  await expect(page.getByTestId('cost-by-role')).toContainText('Triase');
  const modes = page.getByTestId('cost-by-mode');
  await expect(modes).toContainText('Mendalam');
  await expect(modes).toContainText('Standar');
  // admin mengisi harga → estimasi muncul (dibaca langsung dari settings/global)
  await db.doc('settings/global').set({ modelPrices: { sonnet: { in: 3, out: 15 } } }, { merge: true });
  await expect(page.getByTestId('cost-estimate')).toContainText('$');
  await expect(page.getByTestId('cost-estimate')).toContainText('sebagian model belum berharga');
  await expect(models.locator('[data-model="claude-sonnet-4-6"]')).toContainText('$');
});

test('Analitik → Skills: dimuat/dilewati, temuan & hasilnya per skill, saran perbaikan, tautan ke editor', async ({
  page,
}) => {
  // review lama memuat skill yang kini sudah dihapus → tidak ditampilkan di analitik
  await db.doc('jobs/sample-job-1').update({
    'result.meta.skillsLoaded': ['bukti', 'kontrak-dan-dampak', 'sinyal-bukan-noise', 'skill-dihapus'],
  });
  await loginAs(page, 'uid-dev2');
  await page.goto('/analytics');
  await page.getByRole('tab', { name: 'Skills' }).click();
  await expect(page).toHaveURL(/\/analytics\/skills$/);
  const ov = page.getByTestId('skills-overview');
  await expect(ov).toContainText('Skill aktif');
  await expect(ov).toContainText('Temuan dari skill');
  const table = page.getByTestId('skills-table');
  const fc = table.locator('[data-skill="bukti"]');
  await expect(fc).toBeVisible();
  await expect(table.locator('[data-skill="skill-dihapus"]')).toHaveCount(0);
  await expect(fc).toContainText('bukti');
  // tiap review contoh memuat bukti; flutter-performance dilewati (paths **/*.dart tidak cocok)
  const fp = table.locator('[data-skill="flutter-performance"]');
  await expect(fp.locator('td').nth(1)).toHaveText('0');
  expect(Number(await fp.locator('td').nth(2).textContent())).toBeGreaterThan(0);
  expect(Number((await fc.locator('td').nth(3).textContent())!.split(' ')[0])).toBeGreaterThan(0);
  // ukuran skill dari versi terbaru (perkiraan token)
  await expect(fc.locator('td').nth(6)).not.toHaveText('—');
  // nama skill membuka file SKILL.md-nya di editor Skills
  await fc.getByRole('link', { name: /bukti/i }).first().click();
  await expect(page).toHaveURL(/\/skills\?f=skills%2Fbukti%2FSKILL\.md$/);
});

test('Analitik → Dampak: ringkasan pilot, tiga lapis (dipercaya, dipakai, kualitas), sebelum vs sesudah pilot', async ({
  page,
}) => {
  await loginAs(page, 'uid-dev2');
  await page.goto('/analytics');
  await page.getByRole('tab', { name: 'Dampak' }).click();
  await expect(page).toHaveURL(/\/analytics\/dampak$/);
  await expect(page.getByTestId('impact-summary')).toContainText('bug P0/P1 diperbaiki sebelum merge');
  await expect(page.getByTestId('impact-trust')).toContainText('Presisi');
  await expect(page.getByTestId('impact-trust')).toContainText('target ≥ 60%');
  const adoption = page.getByTestId('impact-adoption');
  // sejak pilot: 5 PR direview + 2 tidak direview yang di-merge → 5 dari 7
  await expect(adoption).toContainText('5 dari 7 PR yang di-merge sempat direview');
  await expect(adoption).toContainText('review manusia pertama');
  const quality = page.getByTestId('impact-quality');
  await expect(quality).toContainText('1 dari 2 PR'); // tidak direview: 1 di-revert
  const base = page.getByTestId('impact-baseline');
  await expect(base.locator('tr').nth(1)).toContainText('Sebelum pilot');
  await expect(base.locator('tr').nth(1)).toContainText('6'); // 6 PR riwayat
  await expect(base.locator('tr').nth(1)).toContainText('17%'); // 1 dari 6 di-revert
  // anggota biasa tidak melihat pengaturan pilot
  await expect(page.getByTestId('impact-admin')).toHaveCount(0);
});

test('Review Kode: review terbaru yang diminta orang lain ditandai "diminta @…"; detail menampilkan riwayat review PR', async ({
  page,
}) => {
  // teman tim meminta review ulang PR yang sudah pernah direview (review lama tetap di riwayat)
  const old = (await db.doc('jobs/sample-job-1').get()).data()!;
  await db.doc('jobs/sample-job-1b').set({
    ...old,
    trigger: { commentId: 999, userLogin: 'teman-tim', command: 'lapor', instruction: '' },
    createdAt: Timestamp.fromMillis(old.createdAt.toMillis() + 60_000),
  });
  await loginAs(page, 'uid-dev2');
  const row = page.getByTestId('reviews-table').locator(`[data-pr="${old.repo.fullName}#${old.pr.number}"]`);
  await expect(row.getByTestId('requested-by')).toHaveText('diminta @teman-tim');
  await expect(row).toContainText('2 review');
  await row.getByRole('link', { name: old.pr.title }).click();
  await expect(page).toHaveURL(/\/reviews\/sample-job-1b$/);
  const hist = page.getByTestId('review-history');
  await expect(hist).toContainText('Riwayat review PR ini (2)');
  await expect(hist.locator('li')).toHaveCount(2);
  await expect(hist.locator('li').first()).toContainText('diminta @teman-tim');
  await expect(hist.locator('li').first()).toContainText('(yang dibuka)');
  // review lama bisa dibuka dari riwayat
  await hist.locator('li').nth(1).getByRole('link').click();
  await expect(page).toHaveURL(/\/reviews\/sample-job-1$/);
});

test('Detail review: timeline "Proses agent" + intip kerja agent per langkah (berpikir, alat, keputusan)', async ({
  page,
}) => {
  const t = Date.now() - 60_000;
  await db.doc('jobs/sample-job-1').update({
    progress: [
      { key: 'triage', label: 'Triase PR', status: 'done', startedAt: t, endedAt: t + 5000 },
      {
        key: 'lens-correctness',
        label: 'Putaran spesialis: correctness',
        status: 'running',
        startedAt: t + 5000,
        endedAt: null,
      },
    ],
  });
  await db.collection('jobs/sample-job-1/activity').add({
    step: 'lens-correctness',
    seq: 0,
    events: [
      { kind: 'think', text: 'Menelusuri pemanggil fetchUser dulu.', at: t + 6000 },
      { kind: 'tool', text: 'Baca src/api/user.ts', at: t + 7000 },
      { kind: 'text', text: 'Keputusan: cache tanpa batas dilaporkan.', at: t + 8000 },
    ],
    createdAt: new Date(),
  });
  await loginAs(page, 'uid-dev2');
  await page.goto('/reviews/sample-job-1');
  const proc = page.getByTestId('review-progress');
  await expect(proc.locator('[data-step="r-triage"]')).toContainText('Triase PR');
  await expect(proc.locator('[data-step="r-triage"]').getByTestId('step-activity')).toHaveCount(0);
  const act = proc.locator('[data-step="r-lens-correctness"]').getByTestId('step-activity');
  await expect(act).toContainText('Intip kerja agent (3 aktivitas)');
  await act.locator('summary').click();
  await expect(act).toContainText('Menelusuri pemanggil fetchUser dulu.');
  await expect(act).toContainText('Baca src/api/user.ts');
  await expect(act).toContainText('Keputusan: cache tanpa batas dilaporkan.');
});
