import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';
import { GithubMock } from '../scripts/lib/github-mock.mjs';

let mock: GithubMock;
test.beforeAll(async () => {
  mock = await new GithubMock().start(4010); // resolve login → ID lewat GitHub palsu
});
test.afterAll(async () => mock.stop());
test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

test('Pengaturan: tambah anggota via login GitHub, ubah peran, simpan setting, hapus anggota', async ({ page }) => {
  await loginAs(page, 'uid-admin1');
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click();
  const members = page.getByTestId('members');
  await expect(members).toContainText('@dev2');
  await page.getByTestId('member-login').fill('budi');
  await page.getByTestId('member-add').click();
  await expect(page.getByText('@budi ditambahkan.')).toBeVisible();
  await expect(members).toContainText('@budi');
  const budi = (await db.collection('members').where('githubLogin', '==', 'budi').get()).docs[0];
  expect(budi.data()).toMatchObject({ role: 'member' });
  expect(budi.get('level')).toBeUndefined();

  await page.getByTestId('role-budi').click();
  await page.getByRole('menuitemradio', { name: 'Admin' }).click();
  await expect(page.getByText('@budi diperbarui.')).toBeVisible();
  expect((await budi.ref.get()).get('role')).toBe('admin');

  await page.getByTestId('max-inline').fill('7');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Setting disimpan.')).toBeVisible();
  expect((await db.doc('settings/global').get()).get('maxInlineComments')).toBe(7);

  // sakelar baru berlaku setelah disimpan: bar "belum disimpan" muncul, simpan, refresh → tetap aktif
  await expect(page.getByTestId('unsaved-bar')).toHaveCount(0);
  await page.getByTestId('app-verify-enabled').getByRole('switch').click();
  await expect(page.getByTestId('unsaved-bar')).toBeVisible();
  await page.getByTestId('unsaved-save').click();
  await expect(page.getByTestId('unsaved-bar')).toHaveCount(0);
  expect((await db.doc('settings/global').get()).get('appVerifyEnabled')).toBe(true);
  await page.reload();
  await expect(page.getByTestId('app-verify-enabled').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('unsaved-bar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Hapus budi' }).click();
  await expect(page.getByText('@budi dihapus.')).toBeVisible();
  await expect(members).not.toContainText('@budi');
});
