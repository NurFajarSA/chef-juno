import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { db, importGithubUser, loginAs, resetEmulators } from '../support.js';
import { seedBase } from '../../scripts/seed-data.mjs';
import { seedSample } from '../../scripts/seed-sample.mjs';
import { seedReportFixture } from '../../scripts/seed-reports.mjs';
import { buildWeeklyReport } from '../../apps/functions/src/reports.js';
import { previousWeek, weekStartJakarta } from '@chefjuno/shared';

const OUT = 'docs/evidence/screenshots';
const PAGES: [string, string, string][] = [
  ['review-kode', '/reviews', 'Review Kode'],
  ['review-detail', '/reviews/sample-job-1', 'PR #12'],
  ['analitik', '/analytics', 'Review PR'],
  ['analitik-temuan', '/analytics/temuan', 'Temuan'],
  ['knowledge', '/kb/4242', 'Knowledge Base'],
  ['knowledge-modul', '/kb/4242/src__api', 'src/api'],
  ['memory', '/memory', 'Memory'],
  ['rapor', '/rapor', 'Rapor tim'],
  ['rapor-pribadi', '/rapor/dev2', '@dev2'],
  ['machines', '/machines', 'Mesin'],
  ['repositori', '/repos', 'Repositori'],
  ['biaya', '/analytics/biaya', 'Biaya & waktu'],
  ['analitik-skills', '/analytics/skills', 'Skills'],
  ['dampak', '/analytics/dampak', 'Dampak'],
  ['skills', '/skills', 'Skills'],
  ['panduan', '/docs/02-cara-kerja-review', 'Cara kerja review'],
  ['skills-review', '/skills?f=core%2Freview.md', 'Skills'],
  ['pengaturan', '/settings', 'Pengaturan'],
];

test.beforeAll(async () => {
  await resetEmulators();
  await seedBase(db);
  await seedSample(db);
  const week = previousWeek(weekStartJakarta(new Date()));
  await seedReportFixture(db, week);
  await buildWeeklyReport(db, week);
  await db
    .doc(`reports/${week}_team`)
    .set(
      { narrative: 'Null-check membaik. Test jalur error masih bolong. Perbaiki sebelum minta review lagi.' },
      { merge: true },
    );
  // versi prompt kedua supaya riwayat & diff tidak kosong
  const v1 = (await db.doc('prompts/review/versions/1').get()).get('content') as string;
  await db.doc('prompts/review/versions/2').set({
    version: 2,
    content:
      v1.replace('Cara review', 'Cara review (v2: periksa null-check lebih dulu)') +
      '\n- Periksa null-check sebelum hal lain.\n',
    message: 'Pertegas null-check',
    authorUid: 'uid-admin1',
    authorLogin: 'admin1',
    parentVersion: 1,
    createdAt: new Date(),
  });
  await db.doc('prompts/review').update({ latestVersion: 2, activeVersion: 2 });
  for (const [uid, id, login] of [
    ['uid-admin1', '1001', 'admin1'],
    ['uid-luar', '9999', 'orangluar'],
  ])
    await importGithubUser(uid, id, login).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
});

test('screenshot semua halaman', async ({ page }, info) => {
  const variant = info.project.name; // light-desktop, dark-mobile, ...
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}-${variant}.png`, fullPage: true });

  await page.goto('/login');
  await expect(page.getByTestId('login-github')).toBeVisible();
  await shot('login');

  await loginAs(page, 'uid-admin1');
  await expect(page.getByTestId('shell-main')).toBeVisible();
  for (const [name, path, heading] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.locator('.cj-skeleton')).toHaveCount(0);
    await page.waitForTimeout(500);
    await shot(name);
  }

  // bukti toggle mode gelap lewat tombol (bukan hanya colorScheme)
  if (variant === 'light-desktop') {
    await page.goto('/reviews');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    await shot('review-kode-toggle-gelap');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveClass(/theme-light/);
  }

  await page
    .getByRole('button', { name: 'Keluar' })
    .click()
    .catch(() => undefined);
  await page.goto('/login');
  await loginAs(page, 'uid-luar');
  await expect(page.getByTestId('no-access')).toBeVisible();
  await shot('no-access');
});
