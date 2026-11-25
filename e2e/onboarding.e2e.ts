import { expect, test } from '@playwright/test';
import { FieldValue } from 'firebase-admin/firestore';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { installationRepositories, sendWebhook } from '../scripts/lib/payloads.mjs';

const FN_BASE = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001'}/demo-chefjuno/asia-southeast2`;

// Instalasi baru: database kosong, hanya akun GitHub bootstrap (ID 1001) yang belum jadi anggota.
test.beforeEach(async () => {
  await resetEmulators();
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

test('Onboarding: admin pertama diarahkan ke Setup, langkah tercentang dari data live, selesai → dashboard', async ({
  page,
}) => {
  await loginAs(page, 'uid-admin1');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByTestId('setup-init')).toContainText('Workspace siap');
  // setupWorkspace init membuat setting & prompt default
  const s = (await db.doc('settings/global').get()).data()!;
  expect(s.onboarding.completedAt).toBeNull();
  expect((await db.doc('prompts/review/versions/1').get()).exists).toBe(true);

  // Langkah 2: repo muncul setelah webhook instalasi GitHub App
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('install-app')).toHaveAttribute(
    'href',
    'https://github.com/apps/chefjuno-demo/installations/new',
  );
  const r = await sendWebhook(
    FN_BASE,
    'installation_repositories',
    installationRepositories({ fullName: 'tim/baru', repoId: 6161 }),
  );
  expect(r.status).toBeLessThan(300);
  await expect(page.getByTestId('setup-repos')).toContainText('tim/baru');
  await expect(page.getByTestId('step-github')).toContainText('(selesai)');

  // Langkah 3: buat kode mesin; mesin online → tercentang
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-machine-name').fill('MacBook Tim');
  await page.getByTestId('setup-machine-code').click();
  await expect(page.getByTestId('setup-machine-command')).toContainText('login --server');
  await db.doc('machines/m1').set({
    name: 'MacBook Tim',
    revoked: false,
    concurrency: 1,
    currentJobIds: [],
    agents: { claude: { version: '2.1.323' } },
    lastSeenAt: FieldValue.serverTimestamp(),
  });
  await expect(page.getByTestId('setup-machines')).toContainText('MacBook Tim online');

  // Langkah 5: selesai → onboarding ditandai selesai, dashboard terbuka, tidak diarahkan ke Setup lagi
  await page.getByTestId('step-first').click();
  await page.getByTestId('setup-finish').click();
  await expect(page).toHaveURL(/\/reviews$/);
  expect((await db.doc('settings/global').get()).get('onboarding.completedAt')).toBeTruthy();
  await page.goto('/memory');
  await expect(page).toHaveURL(/\/memory$/);
});

test('Onboarding: instalasi lama (settings tanpa field onboarding) tidak diarahkan ke Setup', async ({ page }) => {
  await db.doc('members/1001').set({ githubLogin: 'admin1', role: 'admin' });
  await db.doc('settings/global').set({ maxInlineComments: 10 });
  await loginAs(page, 'uid-admin1');
  await expect(page).toHaveURL(/\/reviews$/);
});
