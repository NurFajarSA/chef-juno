import { expect, test } from '@playwright/test';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';

test.beforeEach(async () => {
  await resetEmulators();
  await db.doc('members/2002').set({ githubLogin: 'dev2', name: 'Dev Dua', role: 'member', level: 'junior' });
  await importGithubUser('uid-dev2', '2002', 'dev2');
  await importGithubUser('uid-luar', '9999', 'orangluar');
});

test('anggota login lewat emulator → melihat shell dengan nav rail', async ({ page }) => {
  await loginAs(page, 'uid-dev2');
  await expect(page.getByTestId('shell-main')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await expect(page).toHaveURL(/\/reviews$/);
  await expect(page.getByRole('heading', { name: 'Review Kode', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Mesin', exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(page.getByRole('heading', { name: 'Mesin', exact: true })).toBeVisible();
});

test('non-anggota diarahkan ke /no-access', async ({ page }) => {
  await loginAs(page, 'uid-luar');
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByTestId('no-access')).toContainText('Tidak punya akses');
});

test('tanpa login diarahkan ke /login', async ({ page }) => {
  await page.goto('/reviews');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-github')).toContainText('Masuk dengan GitHub');
});

test('bootstrap admin (BOOTSTRAP_ADMIN_GITHUB_IDS) otomatis jadi admin dan masuk onboarding (instalasi baru)', async ({
  page,
}) => {
  await importGithubUser('uid-admin', '1001', 'admin1');
  await loginAs(page, 'uid-admin');
  // database ini belum punya settings/global → admin pertama diarahkan ke Setup (onboarding)
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByTestId('setup-panel')).toBeVisible();
  const m = await db.doc('members/1001').get();
  expect(m.get('role')).toBe('admin');
});

test('ganti akun tanpa keluar → status anggota dihitung ulang (anggota → non-anggota)', async ({ page }) => {
  await loginAs(page, 'uid-dev2');
  await expect(page.getByTestId('shell-main')).toBeVisible();
  await loginAs(page, 'uid-luar');
  await expect(page).toHaveURL(/\/no-access$/);
});
