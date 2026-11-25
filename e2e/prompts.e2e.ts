import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await importGithubUser('uid-dev2', '2002', 'dev2');
});

test('Prompt inti di editor Skills: buat versi baru → diff side-by-side tampil → aktifkan v1 lagi (rollback)', async ({
  page,
}) => {
  await loginAs(page, 'uid-dev2');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  // explorer: prompt inti review.md dengan versi aktif v1
  await expect(page.locator('[data-prompt="review"]')).toContainText('review.md');
  await expect(page.locator('[data-prompt="review"]')).toContainText('v1');
  await page.locator('[data-prompt="review"]').click();
  await expect(page).toHaveURL(/\/skills\?f=core%2Freview\.md$/);
  await expect(page.getByTestId('editor-status-version')).toContainText('aktif v1');
  const editor = page.getByTestId('prompt-editor');
  await expect(editor).toHaveValue(/Chef Juno|review/i);
  await editor.fill((await editor.inputValue()) + '\n- Baris baru dari Playwright: cek null-check dulu.');
  await page.getByTestId('prompt-save').click();
  await expect(page.getByText('Pesan perubahan minimal 3 karakter')).toBeVisible();
  await page.getByTestId('prompt-message').fill('Tambah aturan null-check');
  await page.getByTestId('prompt-save').click();
  await expect(page.getByText('Versi v2 tersimpan.')).toBeVisible();
  const diff = page.getByTestId('prompt-diff');
  await expect(diff).toContainText('v1');
  await expect(diff).toContainText('v2');
  await expect(diff.locator('.cell.add')).toContainText('Baris baru dari Playwright: cek null-check dulu.');

  const v2 = await db.doc('prompts/review/versions/2').get();
  expect(v2.get('message')).toBe('Tambah aturan null-check');
  expect((await db.doc('prompts/review').get()).get('activeVersion')).toBe(1);

  await page.getByRole('tab', { name: 'Riwayat' }).click();
  const hist = page.getByTestId('prompt-history');
  await expect(hist).toContainText('v2');
  await expect(hist).toContainText('Tambah aturan null-check');
  await page.getByTestId('activate-2').click();
  await expect(page.getByText('v2 sekarang aktif.')).toBeVisible();
  await page.getByTestId('activate-1').click();
  await expect(page.getByText('v1 sekarang aktif.')).toBeVisible();
  expect((await db.doc('prompts/review').get()).get('activeVersion')).toBe(1);
});
