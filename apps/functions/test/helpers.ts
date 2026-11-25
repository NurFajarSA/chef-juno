// Helper test emulator. @firebase/rules-unit-testing tidak mendukung named database (§5),
// jadi klien dibuat sendiri dengan getFirestore(app, 'chefjuno') + mockUserToken.
import { initializeApp as initClient, deleteApp, type FirebaseApp } from 'firebase/app';
import { getFirestore as getClientFs, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { DB_ID, DEMO_PROJECT_ID } from '@chefjuno/shared';

export const PROJECT = DEMO_PROJECT_ID;
export const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
export const FN_BASE = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001'}/${PROJECT}/asia-southeast2`;

process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.GCLOUD_PROJECT = PROJECT;

let adminApp: App;
export function admin() {
  adminApp = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  return { db: getFirestore(adminApp, DB_ID), auth: getAuth(adminApp) };
}

const clients: FirebaseApp[] = [];
let n = 0;
export type Token = Record<string, unknown> & { sub?: string; user_id?: string };

/** Klien Firestore dengan token palsu (null = tanpa login). */
export function clientDb(token: Token | null): Firestore {
  const app = initClient({ projectId: PROJECT, apiKey: 'demo-key' }, `c${n++}`);
  clients.push(app);
  const db = getClientFs(app, DB_ID);
  const [host, port] = FS_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port), token ? { mockUserToken: token as { sub: string } } : undefined);
  return db;
}

export async function cleanup() {
  await Promise.all(clients.splice(0).map((a) => deleteApp(a)));
}

export async function clearFirestore() {
  // Emulator kadang membalas 499 kalau masih ada listener aktif dari test sebelumnya → coba ulang.
  let status = 0;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/${DB_ID}/documents`, {
      method: 'DELETE',
    });
    if (r.ok) return;
    status = r.status;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`clear firestore gagal: ${status}`);
}

export async function clearAuth() {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

export const memberToken = (gh: string, role: 'admin' | 'member' = 'member', uid = `u${gh}`): Token => ({
  sub: uid,
  user_id: uid,
  cj: role,
  cjGh: gh,
});
export const machineToken = (id: string): Token => ({
  sub: `machine:${id}`,
  user_id: `machine:${id}`,
  machine: true,
  machineId: id,
});

/** Panggil callable via HTTP (protokol callable) dengan ID token. */
export async function callFn<T = unknown>(
  name: string,
  data: unknown,
  idToken?: string,
): Promise<{ ok: boolean; result?: T; error?: { status: string; message: string } }> {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const text = await res.text();
  let body: { result?: T; error?: { status: string; message: string } };
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { status: String(res.status), message: text } };
  }
  return { ok: res.ok && !body.error, ...body };
}

/** Tukar custom token → ID token lewat Auth emulator REST. */
export async function idTokenFor(uid: string, claims?: Record<string, unknown>): Promise<string> {
  const { auth } = admin();
  const ct = await auth.createCustomToken(uid, claims);
  const r = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ct, returnSecureToken: true }),
    },
  );
  const j = (await r.json()) as { idToken: string };
  return j.idToken;
}

/** Buat user GitHub di Auth emulator (importUsers dengan providerData github.com). */
export async function importGithubUser(uid: string, githubId: string, login: string) {
  const { auth } = admin();
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

/**
 * Skill tim contoh (aktif): tiga berkategori `inti` (dipakai juga oleh validator, reviewer akhir, penguji) dan satu
 * `domain`. Chef Juno tidak membawa skill bawaan; ini hanya fixture test.
 */
export const TEAM_SKILL_FIXTURES = [
  { slug: 'bukti', category: 'inti', body: 'Bedakan yang terukur dari yang disimpulkan.' },
  { slug: 'jujur-soal-kelengkapan', category: 'inti', body: 'Sebut yang tidak dinilai.' },
  { slug: 'sinyal-bukan-noise', category: 'inti', body: 'Hanya yang layak waktu manusia.' },
  { slug: 'flutter-tim', category: 'domain', body: 'Konvensi widget tim.' },
] as const;

export async function seedTeamSkills() {
  const { db } = admin();
  for (const sk of TEAM_SKILL_FIXTURES) {
    const md = `---\nname: ${sk.slug}\ndescription: ${sk.body}\ncategory: ${sk.category}\n---\n\n# ${sk.slug}\n\n${sk.body}\n`;
    await db.doc(`skills/${sk.slug}`).set({
      name: sk.slug,
      description: sk.body,
      paths: [],
      category: sk.category,
      latestVersion: 1,
      fileCount: 1,
      source: 'import',
      enabled: true,
    });
    await db
      .doc(`skills/${sk.slug}/versions/1`)
      .set({ version: 1, files: { 'SKILL.md': md }, authorUid: 'uid-admin1' });
  }
}
