import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';
import { seedSample } from '../scripts/seed-sample.mjs';

const PAGES = [
  '/reviews',
  '/reviews/sample-job-1',
  '/analytics',
  '/analytics/temuan',
  '/kb/4242',
  '/kb/4242/src__api',
  '/memory',
  '/rapor',
  '/machines',
  '/repos',
  '/analytics/biaya',
  '/analytics/skills',
  '/analytics/dampak',
  '/skills',
  '/docs/04-model-dan-biaya',
  '/skills?f=core%2Freview.md',
  '/settings',
];

test.beforeAll(async () => {
  await resetEmulators();
  await seedBase(db);
  await seedSample(db);
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`aksesibilitas dasar (axe: tanpa pelanggaran serious/critical) — mode ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loginAs(page, 'uid-admin1');
    await expect(page.getByTestId('shell-main')).toBeVisible();
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('.cj-skeleton')).toHaveCount(0);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map(
          (v) =>
            `${path} ${v.id}: ${v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(' '))
              .join(' | ')}`,
        ),
      ).toEqual([]);
    }
  });
}
