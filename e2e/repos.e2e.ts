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

test('Knowledge Base: ringkasan repo, system map, halaman modul, hubungkan agent, index ulang', async ({ page }) => {
  await loginAs(page, 'uid-admin1');
  await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
  await expect(page).toHaveURL(/\/kb\/\d+$/);
  // dropdown kustom (menu M3), bukan <select> native
  await page.getByTestId('kb-repo').click();
  await page.getByRole('menuitemradio', { name: 'tim/sample-repo' }).click();
  await expect(page).toHaveURL(/\/kb\/4242$/);
  const ov = page.getByTestId('repo-overview');
  await expect(ov).toContainText('tim/sample-repo');
  await expect(ov).toContainText('Siap');
  await expect(page.getByTestId('kb-orientation')).toContainText('7 modul dengan 11 file dan 24 simbol');
  const stats = page.getByTestId('index-stats');
  await expect(stats).toContainText('11');
  await expect(stats).toContainText('24');
  await expect(stats).toContainText('84% ter-resolve');
  const map = page.getByTestId('system-map');
  await expect(map.locator('[data-module]')).toHaveCount(7);
  // services→api, components→services, legacy→api, web→api
  await expect(map.locator('path.edge')).toHaveCount(4);
  await map.locator('[data-module="src/api"]').click();
  await expect(page).toHaveURL(/\/kb\/4242\/src__api$/);
  const doc = page.getByTestId('module-doc');
  await expect(doc).toContainText('fetchUser');
  await expect(doc).toContainText('mengembalikan');
  await expect(doc).toContainText('src/services');

  await page.getByTestId('connect-agent').click();
  await expect(page.getByTestId('mcp-memory')).toContainText('memory-mcp');
  await expect(page.getByTestId('mcp-graph')).toContainText('graph-mcp --db ~/.chefjuno/index/4242/graph.db');
  await page.keyboard.press('Escape');

  await page.getByTestId('reindex').click();
  await expect(page.getByText('Index ulang dijadwalkan.')).toBeVisible();
  const jobs = await db.collection('jobs').where('type', '==', 'index').get();
  expect(jobs.size).toBe(1);
  expect(jobs.docs[0].get('index.mode')).toBe('full');
});

test('Repositori: menu sendiri di sidebar, branch knowledge base, status code map, review aktif/nonaktif', async ({
  page,
}) => {
  await loginAs(page, 'uid-admin1');
  await page.locator('cj-nav-rail').getByRole('link', { name: 'Repositori' }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.locator('cj-nav-rail a[aria-current="page"]')).toContainText('Repositori');
  const table = page.getByTestId('repositories');
  const sample = table.locator('[data-repo="tim/sample-repo"]').locator('xpath=..');
  await expect(sample).toContainText('Siap');
  await expect(sample).toContainText('commit 9f1c2ab');
  await expect(sample.getByTestId('repo-kb-branch')).toHaveText('main');
  const dash = table.locator('[data-repo="tim/dashboard-web"]').locator('xpath=..');
  await expect(dash.getByTestId('repo-kb-branch')).toHaveText('rewrite/v2');
  await expect(dash).toContainText('branch utama main');
  // matikan review untuk satu repo → tersimpan di Firestore
  await dash.getByRole('switch', { name: 'Review aktif untuk tim/dashboard-web' }).click();
  await expect.poll(async () => (await db.doc('repos/5151').get()).get('enabled')).toBe(false);
  // nama repo menuju Knowledge Base repo itu
  await sample.getByRole('link', { name: 'tim/sample-repo' }).click();
  await expect(page).toHaveURL(/\/kb\/4242$/);
  // Pengaturan tidak lagi memuat daftar repo, hanya tautan
  await page.goto('/settings');
  await expect(page.getByTestId('repositories')).toHaveCount(0);
  // tautan di Pengaturan (bukan menu rail yang juga bernama Repositori)
  await page.getByRole('link', { name: /Repo yang terpasang GitHub App/ }).click();
  await expect(page).toHaveURL(/\/repos$/);
});

test('Dampak (admin): mengubah target pilot tersimpan di Pengaturan dan status target ikut berubah', async ({
  page,
}) => {
  await loginAs(page, 'uid-admin1');
  await page.goto('/analytics/dampak');
  await expect(page.getByTestId('impact-admin')).toBeVisible();
  const precisionTarget = page.getByTestId('impact-trust').locator('.tgt').first();
  await expect(precisionTarget).toContainText('target ≥ 60%');
  await page.getByTestId('target-precision').fill('95');
  await page.getByTestId('target-precision').dispatchEvent('change');
  await expect(precisionTarget).toContainText('target ≥ 95%');
  await expect.poll(async () => (await db.doc('settings/global').get()).get('impactTargets.precision')).toBe(0.95);
  await expect(page.getByTestId('impact-backfill')).toBeVisible();
});
