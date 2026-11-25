// Seed lewat Admin SDK ke emulator + login dengan custom token khusus test (§9 Fase 1).
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type { Page } from '@playwright/test';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const app = getApps()[0] ?? initializeApp({ projectId: 'demo-chefjuno' });
export const db = getFirestore(app, 'chefjuno');
export const auth = getAuth(app);

export async function resetEmulators() {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-chefjuno/databases/chefjuno/documents`,
    { method: 'DELETE' },
  );
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-chefjuno/accounts`, {
    method: 'DELETE',
  });
}

export async function importGithubUser(uid: string, githubId: string, login: string) {
  const res = await auth.importUsers([
    {
      uid,
      displayName: login,
      email: `${login}@example.test`,
      providerData: [{ uid: githubId, providerId: 'github.com', displayName: login, email: `${login}@example.test` }],
    },
  ]);
  if (res.failureCount) throw new Error('importUsers gagal: ' + JSON.stringify(res.errors.map((e) => e.error.message)));
}

export async function loginAs(page: Page, uid: string) {
  const token = await auth.createCustomToken(uid);
  await page.goto(`/login?customToken=${encodeURIComponent(token)}`);
}
