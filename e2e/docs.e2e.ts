import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await importGithubUser('uid-dev2', '2002', 'dev2');
});

test('Panduan: dibuka dari rail, tautan antar-halaman tetap di dashboard, diagram mermaid terender, daftar isi', async ({
  page,
}) => {
  await loginAs(page, 'uid-dev2');
  await page.getByTestId('nav-docs').click();
  await expect(page).toHaveURL(/\/docs$/);
  const content = page.getByTestId('docs-content');
  await expect(content.getByRole('heading', { level: 1 })).toHaveText('Dokumentasi Chef Juno');

  // tautan Markdown "02-cara-kerja-review.md" → rute dashboard, bukan file
  await content.getByRole('link', { name: 'Cara kerja review' }).click();
  await expect(page).toHaveURL(/\/docs\/02-cara-kerja-review$/);
  await expect(content.getByRole('heading', { level: 1 })).toHaveText('Cara kerja review');
  await expect(content.locator('pre.mermaid svg').first()).toBeVisible();
  await expect(content.locator('pre.mermaid svg')).toHaveCount(await content.locator('pre.mermaid').count());
  await expect(page.getByRole('complementary', { name: 'Di halaman ini' })).toContainText('5. Posting');

  // halaman lain lewat sidebar
  await page.getByRole('navigation', { name: 'Halaman panduan' }).getByRole('link', { name: 'Model & biaya' }).click();
  await expect(page).toHaveURL(/\/docs\/04-model-dan-biaya$/);
  // tingkat model (Cepat/Standar/Kuat) dan siapa memakai Opus untuk validasi
  await expect(content.locator('table').first()).toContainText('Kuat');
  await expect(content.locator('table').nth(1)).toContainText('validasi Opus');
});
