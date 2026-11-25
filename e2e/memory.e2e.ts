import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';
import { seedSample } from '../scripts/seed-sample.mjs';

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await seedSample(db);
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

test('Memory: usulan → setujui massal; tambah aturan manual; tab Aktif & Suppressed', async ({ page }) => {
  await loginAs(page, 'uid-admin1');
  await page.getByRole('link', { name: 'Memory', exact: true }).click();
  await page.getByRole('tab', { name: /Usulan/ }).click();
  const sugg = page.getByTestId('memory-suggested');
  await expect(sugg).toContainText('trackBy');
  await expect(sugg).toContainText('Promise tidak di-await');
  await sugg.getByText('Pilih semua').click();
  await page.getByTestId('approve').click();
  await expect(page.getByText('2 aturan disetujui.')).toBeVisible();
  expect((await db.doc('rules/rule-sugg-1').get()).get('status')).toBe('active');
  expect((await db.doc('rules/rule-sugg-2').get()).get('decidedBy')).toBe('admin1');

  await page.getByRole('tab', { name: /Aturan tim/ }).click();
  const active = page.getByTestId('memory-active');
  await expect(active).toContainText('trackBy');
  await expect(active.locator('tr', { hasText: 'Semua fungsi API yang bisa gagal' })).toContainText('4');

  await page.getByRole('tab', { name: 'Tambah aturan' }).click();
  await page.getByTestId('rule-text').fill('Jangan commit file .env ke repo.');
  await page.getByTestId('rule-create').click();
  await expect(page.getByText('Aturan ditambahkan dan langsung aktif.')).toBeVisible();
  const manual = await db.collection('rules').where('text', '==', 'Jangan commit file .env ke repo.').get();
  expect(manual.docs[0].get('status')).toBe('active');

  await page.getByRole('tab', { name: 'Suppressed' }).click();
  await expect(page.getByTestId('memory-suppressed')).toContainText('Hasil fetchUser tidak dicek null');
});
