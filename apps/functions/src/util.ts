import { createHash, randomBytes, randomInt } from 'node:crypto';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';
import { CODE_ALPHABET } from '@chefjuno/shared';
import { db } from './admin.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export interface MemberCtx {
  uid: string;
  githubUserId: string;
  role: 'admin' | 'member';
  login: string;
}

/** Pastikan pemanggil anggota aktif (claim + dokumen members masih ada). */
export async function requireMember(req: CallableRequest, admin = false): Promise<MemberCtx> {
  const t = req.auth?.token as Record<string, unknown> | undefined;
  if (!req.auth || !t || typeof t.cjGh !== 'string') throw new HttpsError('permission-denied', 'Bukan anggota.');
  const snap = await db().doc(`members/${t.cjGh}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Bukan anggota.');
  const role = snap.get('role') as 'admin' | 'member';
  if (admin && role !== 'admin') throw new HttpsError('permission-denied', 'Hanya admin.');
  return { uid: req.auth.uid, githubUserId: t.cjGh, role, login: String(snap.get('githubLogin') ?? '') };
}

export async function audit(action: string, actorUid: string, target: string, data: Record<string, unknown> = {}) {
  await db().collection('auditLog').add({ action, actorUid, target, data, createdAt: FieldValue.serverTimestamp() });
}

export function parseInput<T>(
  schema: {
    safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
  data: unknown,
): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpsError('invalid-argument', r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}
