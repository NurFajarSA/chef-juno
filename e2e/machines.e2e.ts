import { expect, test } from '@playwright/test';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';

const FN = 'http://127.0.0.1:5001/demo-chefjuno/asia-southeast2';

test.beforeEach(async () => {
  await resetEmulators();
  await db.doc('members/1001').set({ githubLogin: 'admin1', name: 'Admin', role: 'admin', level: 'senior' });
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

test('halaman Mesin realtime: tambah mesin → kode → daemon login → muncul; status online/offline', async ({ page }) => {
  await db.doc('machines/lama').set({
    name: 'Mesin Lama',
    ownerUid: 'x',
    ownerLogin: 'dev2',
    lastSeenAt: Timestamp.fromMillis(Date.now() - 10 * 60_000),
    agents: {
      claude: {
        version: '2.1.323',
        enabled: true,
        subscription: true,
        isolation: 'safe',
        authMethod: 'claude.ai',
        warning: null,
      },
    },
    concurrency: 1,
    currentJobIds: [],
    revoked: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  await loginAs(page, 'uid-admin1');
  await page.goto('/machines');
  await expect(page.getByTestId('machines-table')).toContainText('Mesin Lama');
  await expect(page.locator('[data-status="offline"]')).toHaveCount(1);

  await page.getByTestId('add-machine').click();
  await page.getByTestId('machine-name').fill('Laptop Uji');
  await page.getByTestId('machine-submit').click();
  const code = (await page.getByTestId('machine-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(page.getByTestId('machine-command')).toContainText(
    `node apps/daemon/dist/cli.js login --server ${FN} --code ${code}`,
  );

  // daemon menukar kode (seperti `chefjuno login`)
  const r = await fetch(`${FN}/exchangeMachineCode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  expect(r.status).toBe(200);
  const { machineId } = (await r.json()) as { machineId: string };
  await db.doc(`machines/${machineId}`).update({ lastSeenAt: FieldValue.serverTimestamp() });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('machines-table')).toContainText('Laptop Uji');
  await expect(page.locator('[data-status="online"]')).toHaveCount(1);
  await expect(page.getByTestId('online-count')).toHaveText('1');
});
