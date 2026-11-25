import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { audit, requireMember } from './util.js';
import { db } from './admin.js';
import { createJob, type RepoRef } from './jobs.js';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } from './params.js';
import { installationOctokit } from './github.js';

/**
 * Branch yang dipakai knowledge base (code map) sebuah repo: `indexBranch` pilihan admin, atau branch utama GitHub.
 * Review PR tidak memakai ini — review selalu membandingkan PR dengan branch tujuannya sendiri.
 */
export function indexBranchOf(d: { indexBranch?: unknown; defaultBranch?: unknown } | undefined): string {
  const pick = typeof d?.indexBranch === 'string' ? d.indexBranch.trim() : '';
  return pick || String(d?.defaultBranch || 'main');
}

/** Nama branch git yang aman (tanpa `..`, spasi, atau awalan `-`/`/`). */
export const isValidBranchName = (b: string) =>
  /^[A-Za-z0-9._/-]{1,200}$/.test(b) &&
  !b.includes('..') &&
  !/^[-/]/.test(b) &&
  !b.endsWith('/') &&
  !b.endsWith('.lock');

/** Enqueue job index; kalau sudah ada job index antre untuk repo itu, perbarui targetSha (jangan dobel, §6.7.E). */
export async function enqueueIndex(
  repo: RepoRef,
  o: { mode: 'full' | 'incremental'; targetSha: string | null; ref: string },
) {
  const q = await db()
    .collection('jobs')
    .where('type', '==', 'index')
    .where('repo.id', '==', repo.id)
    .where('status', '==', 'queued')
    .get();
  if (!q.empty) {
    const d = q.docs[0];
    const mode = d.get('index.mode') === 'full' || o.mode === 'full' ? 'full' : 'incremental';
    await d.ref.update({
      'index.targetSha': o.targetSha,
      'index.mode': mode,
      'index.ref': o.ref,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return d.id;
  }
  const ref = await createJob({ type: 'index', repo, index: { mode: o.mode, targetSha: o.targetSha, ref: o.ref } });
  await db()
    .doc(`repos/${repo.id}`)
    .set({ index: { status: 'queued' } }, { merge: true });
  return ref.id;
}

/** Tombol "Index ulang" (admin) → job index penuh. */
export const requestReindex = onCall(async (req) => {
  const me = await requireMember(req, true);
  const repoId = Number((req.data as { repoId?: unknown })?.repoId);
  const snap = await db().doc(`repos/${repoId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Repo tidak ditemukan.');
  const id = await enqueueIndex(
    { id: repoId, fullName: snap.get('fullName'), installationId: Number(snap.get('installationId')) },
    { mode: 'full', targetSha: null, ref: indexBranchOf(snap.data()) },
  );
  await audit('repo.reindex', me.uid, String(repoId), { jobId: id });
  return { jobId: id };
});

/**
 * Admin memilih branch knowledge base (mis. `rewrite/masterpiece` saat kode sedang ditulis ulang). Branch dicek ke
 * GitHub, lalu code map dibangun ulang penuh dari branch itu. `branch` kosong = kembali ke branch utama repo.
 */
export const setIndexBranch = onCall({ secrets: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY] }, async (req) => {
  const me = await requireMember(req, true);
  const data = (req.data ?? {}) as { repoId?: unknown; branch?: unknown };
  const repoId = Number(data.repoId);
  const branch = String(data.branch ?? '').trim();
  if (branch && !isValidBranchName(branch)) throw new HttpsError('invalid-argument', 'Nama branch tidak sah.');
  const ref = db().doc(`repos/${repoId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Repo tidak ditemukan.');
  const fullName = String(snap.get('fullName'));
  const installationId = Number(snap.get('installationId'));
  if (branch) {
    const [owner, repo] = fullName.split('/');
    try {
      const gh = await installationOctokit(installationId);
      await gh.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner, repo, branch });
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        throw new HttpsError('not-found', `Branch "${branch}" tidak ada di ${fullName}.`);
      throw new HttpsError('unavailable', 'Tidak bisa memeriksa branch ke GitHub. Coba lagi.');
    }
  }
  await ref.update({ indexBranch: branch ? branch : FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  const effective = indexBranchOf({ indexBranch: branch, defaultBranch: snap.get('defaultBranch') });
  const id = await enqueueIndex(
    { id: repoId, fullName, installationId },
    { mode: 'full', targetSha: null, ref: effective },
  );
  await audit('repo.indexBranch', me.uid, String(repoId), { branch: effective, jobId: id });
  return { jobId: id, branch: effective };
});
