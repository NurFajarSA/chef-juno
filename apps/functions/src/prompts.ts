import { onCall, HttpsError } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';
import { PromptKeySchema, SavePromptVersionInputSchema } from '@chefjuno/shared';
import { db } from './admin.js';
import { audit, parseInput, requireMember } from './util.js';

/** Simpan versi baru (immutable). Transaction: latestVersion + 1; opsional langsung aktif. */
export const savePromptVersion = onCall(async (req) => {
  const me = await requireMember(req);
  const input = parseInput(SavePromptVersionInputSchema, req.data);
  const ref = db().doc(`prompts/${input.key}`);
  const version = await db().runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw new HttpsError('not-found', 'Prompt tidak ada.');
    const latest = Number(p.get('latestVersion') ?? 0);
    const active = Number(p.get('activeVersion') ?? latest);
    const parent = await tx.get(ref.collection('versions').doc(String(latest)));
    if (parent.exists && parent.get('content') === input.content)
      throw new HttpsError('failed-precondition', 'Isi sama dengan versi terakhir.');
    const v = latest + 1;
    tx.create(ref.collection('versions').doc(String(v)), {
      version: v,
      content: input.content,
      message: input.message,
      authorUid: me.uid,
      authorLogin: me.login,
      parentVersion: latest || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, {
      latestVersion: v,
      activeVersion: input.activate ? v : active,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: me.login,
    });
    return v;
  });
  await audit('prompt.save', me.uid, `${input.key}@${version}`, { message: input.message });
  if (input.activate) await audit('prompt.activate', me.uid, `${input.key}@${version}`);
  return { version };
});

/** Aktifkan versi mana pun (rollback = aktifkan versi lama). */
export const activatePromptVersion = onCall(async (req) => {
  const me = await requireMember(req);
  const key = parseInput(PromptKeySchema, (req.data as { key?: unknown })?.key);
  const version = Number((req.data as { version?: unknown })?.version);
  if (!Number.isInteger(version) || version < 1) throw new HttpsError('invalid-argument', 'Versi tidak valid.');
  const ref = db().doc(`prompts/${key}`);
  const prev = await db().runTransaction(async (tx) => {
    const v = await tx.get(ref.collection('versions').doc(String(version)));
    if (!v.exists) throw new HttpsError('not-found', `Versi ${version} tidak ada.`);
    const p = await tx.get(ref);
    tx.update(ref, { activeVersion: version, updatedAt: FieldValue.serverTimestamp(), updatedBy: me.login });
    return Number(p.get('activeVersion'));
  });
  await audit('prompt.activate', me.uid, `${key}@${version}`, { from: prev });
  return { activeVersion: version, previous: prev };
});
