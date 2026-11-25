// Data seed bersama untuk `npm run seed`, demo, dan Playwright. Menulis via Admin SDK ke emulator.
import { readFileSync } from 'node:fs';
import { FieldValue } from 'firebase-admin/firestore';

const ROOT = new URL('..', import.meta.url);
export const readSeedPrompt = (key) => readFileSync(new URL(`prompts/seed/${key}.md`, ROOT), 'utf8');

export const SEED_MEMBERS = [
  { id: '1001', githubLogin: 'admin1', name: 'Admin Satu', role: 'admin', level: 'senior' },
  { id: '2002', githubLogin: 'dev2', name: 'Dev Dua', role: 'member', level: 'junior' },
  { id: '3003', githubLogin: 'dev3', name: 'Dev Tiga', role: 'member', level: 'mid' },
];

export async function seedBase(db, members = SEED_MEMBERS) {
  for (const m of members) {
    const { id, ...rest } = m;
    await db
      .doc(`members/${id}`)
      .set({ ...rest, avatarUrl: null, addedBy: 'seed', createdAt: FieldValue.serverTimestamp() });
  }
  await db.doc('settings/global').set({
    botHandle: 'chefjuno',
    maxInlineComments: 10,
    preferredAgent: 'any',
    models: {},
    agentMaxTurns: 40,
    reviewTimeoutMinutes: 15,
    maxDiffBytes: 1000000,
  });
  for (const [key, title, description] of [
    ['persona', 'Persona Chef Juno', 'Karakter dan gaya bicara reviewer'],
    ['review', 'Instruksi review', 'Cara mereview PR dan format temuan'],
  ]) {
    const ref = db.doc(`prompts/${key}`);
    if ((await ref.get()).exists) continue;
    await ref.set({
      title,
      description,
      activeVersion: 1,
      latestVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'seed',
    });
    await ref
      .collection('versions')
      .doc('1')
      .set({
        version: 1,
        content: readSeedPrompt(key),
        message: 'Versi awal dari prompts/seed',
        authorUid: 'seed',
        authorLogin: 'seed',
        parentVersion: null,
        createdAt: FieldValue.serverTimestamp(),
      });
  }
}
