import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';
import { seedReportFixture } from '../scripts/seed-reports.mjs';
import { buildWeeklyReport } from '../apps/functions/src/reports.js';

const W = '2026-11-16';

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await seedReportFixture(db, W);
  await buildWeeklyReport(db, W);
  await db
    .doc(`reports/${W}_team`)
    .set({ narrative: 'Null-check membaik. Test jalur error masih bolong. Perbaiki.' }, { merge: true });
  await importGithubUser('uid-dev3', '3003', 'dev3');
});

test('Rapor tim & pribadi tampil dengan data seed (bukan kosong)', async ({ page }) => {
  await loginAs(page, 'uid-dev3');
  await page.getByRole('link', { name: 'Rapor' }).click();
  await expect(page.getByTestId('team-stats')).toContainText('3');
  await expect(page.getByTestId('team-narrative')).toContainText('Null-check membaik');
  await expect(page.getByTestId('most-improved')).toContainText('@dev2: temuan per PR turun 1.5 (3 → 1.5)');
  await expect(page.getByTestId('team-members')).toContainText('@dev2');
  await expect(page.getByTestId('team-members')).toContainText('temuan/PR 3 → 1,5');

  // rapor pribadi orang lain bisa dilihat semua anggota
  await page.getByTestId('team-members').getByRole('link', { name: /@dev2/ }).click();
  await expect(page).toHaveURL(/\/rapor\/dev2$/);
  const stats = page.getByTestId('person-stats');
  await expect(stats).toContainText('3,5');
  await expect(stats).toContainText('67%');
  await expect(stats).toContainText('minggu lalu 17%');
  await expect(page.getByTestId('person-development')).toContainText(
    'bug: turun 33% dibanding rata-rata 3 minggu sebelumnya',
  );
  const mistakes = page.getByTestId('person-mistakes');
  await expect(mistakes).toContainText('Hasil fetchUser tidak dicek null');
  await expect(mistakes).toContainText('9x');
  await expect(mistakes).toContainText('turun');
  await expect(page.getByTestId('category-chart').locator('rect')).not.toHaveCount(0);
  await expect(page.getByTestId('good-examples')).toContainText('@dev3');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-memory').click();
  await expect(page.getByTestId('copy-memory')).toContainText('Tersalin');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('# Memori Chef Juno untuk @dev2');
  expect(clip).toContain('**Hasil fetchUser tidak dicek null** (bug, 9x, turun)');
});
