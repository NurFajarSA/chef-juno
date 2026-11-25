import { onCall, HttpsError } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';
import { UpsertMemberInputSchema } from '@chefjuno/shared';
import { auth, db } from './admin.js';
import { BOOTSTRAP_ADMIN_GITHUB_IDS } from './params.js';
import { audit, parseInput, requireMember } from './util.js';
import { githubUserByLogin } from './github.js';

/** Gabungkan claim `cj`/`cjGh` ke customClaims yang sudah ada — jangan menimpa (Auth dipakai app lain). */
async function mergeClaims(uid: string, patch: Record<string, unknown | undefined>) {
  const user = await auth().getUser(uid);
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete claims[k];
    else claims[k] = v;
  }
  if (JSON.stringify(claims).length > 1000) throw new HttpsError('internal', 'Custom claims melebihi 1000 byte.');
  await auth().setCustomUserClaims(uid, claims);
}

export async function syncMembershipFor(uid: string, bootstrapIds: string[]) {
  const user = await auth().getUser(uid);
  const gh = user.providerData.find((p) => p.providerId === 'github.com');
  if (!gh) return { member: false as const, githubLogin: null, reason: 'Akun ini tidak login dengan GitHub.' };
  const githubUserId = String(gh.uid);
  const githubLogin = (gh as unknown as { screenName?: string }).screenName ?? gh.displayName ?? null;
  const ref = db().doc(`members/${githubUserId}`);
  let snap = await ref.get();
  if (!snap.exists && bootstrapIds.includes(githubUserId)) {
    await ref.set({
      githubLogin: githubLogin ?? githubUserId,
      name: gh.displayName ?? githubLogin ?? '',
      avatarUrl: gh.photoURL ?? null,
      role: 'admin',
      addedBy: 'bootstrap',
      createdAt: FieldValue.serverTimestamp(),
    });
    await audit('member.bootstrap', uid, githubUserId);
    snap = await ref.get();
  }
  if (!snap.exists) {
    await mergeClaims(uid, { cj: undefined, cjGh: undefined });
    return { member: false as const, githubLogin };
  }
  const role = snap.get('role') as 'admin' | 'member';
  await mergeClaims(uid, { cj: role, cjGh: githubUserId });
  await db()
    .doc(`users/${uid}`)
    .set(
      {
        githubUserId,
        githubLogin: snap.get('githubLogin') ?? githubLogin,
        avatarUrl: gh.photoURL ?? snap.get('avatarUrl') ?? null,
        role,
        lastLoginAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return { member: true as const, role, githubLogin: snap.get('githubLogin') as string };
}

export const syncMembership = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Harus login.');
  return syncMembershipFor(req.auth.uid, BOOTSTRAP_ADMIN_GITHUB_IDS.value());
});

export const upsertMember = onCall(async (req) => {
  const me = await requireMember(req, true);
  const input = parseInput(UpsertMemberInputSchema, req.data);
  let id = input.githubUserId;
  let avatarUrl: string | null = null;
  let login = input.githubLogin;
  if (!id) {
    const u = await githubUserByLogin(input.githubLogin);
    if (!u) throw new HttpsError('not-found', `Login GitHub "${input.githubLogin}" tidak ditemukan.`);
    id = String(u.id);
    avatarUrl = u.avatar_url;
    login = u.login;
  }
  const ref = db().doc(`members/${id}`);
  const exists = (await ref.get()).exists;
  await ref.set(
    {
      githubLogin: login,
      name: input.name ?? login,
      ...(avatarUrl ? { avatarUrl } : {}),
      role: input.role,
      ...(exists ? {} : { addedBy: me.login, createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
  await audit(exists ? 'member.update' : 'member.add', me.uid, id, { role: input.role });
  return { githubUserId: id };
});

export const removeMember = onCall(async (req) => {
  const me = await requireMember(req, true);
  const id = String((req.data as { githubUserId?: unknown })?.githubUserId ?? '');
  if (!/^\d+$/.test(id)) throw new HttpsError('invalid-argument', 'githubUserId tidak valid.');
  if (id === me.githubUserId) throw new HttpsError('failed-precondition', 'Tidak bisa menghapus diri sendiri.');
  await db().doc(`members/${id}`).delete();
  const users = await db().collection('users').where('githubUserId', '==', id).get();
  for (const u of users.docs) {
    await mergeClaims(u.id, { cj: undefined, cjGh: undefined }).catch(() => undefined);
    await auth()
      .revokeRefreshTokens(u.id)
      .catch(() => undefined);
  }
  await audit('member.remove', me.uid, id);
  return { ok: true };
});
