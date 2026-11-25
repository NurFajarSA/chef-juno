import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { audit, requireMember } from './util.js';
import { db } from './admin.js';
import { ACTIVE_STATUSES } from './jobs.js';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } from './params.js';
import { installationOctokit } from './github.js';
import { setCommitStatus } from './status.js';

/**
 * Batalkan job yang masih aktif (antre / diambil / berjalan). Atomik per job: job yang sudah selesai tidak disentuh.
 * Mesin yang sedang mengerjakannya melihat status `cancelled`, menghentikan agent, dan membereskan app sisa uji.
 */
export async function cancelJobs(refs: DocumentReference[], message: string): Promise<string[]> {
  const done: string[] = [];
  for (const ref of refs) {
    const ok = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists || !ACTIVE_STATUSES.includes(String(s.get('status')))) return false;
      tx.update(ref, {
        status: 'cancelled',
        error: { stage: 'cancelled', message },
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (ok) done.push(ref.id);
  }
  return done;
}

/** Review untuk commit baru menggantikan review & uji aplikasi PR yang sama yang masih aktif untuk commit lama. */
export async function supersedeOlderHeads(repoId: number, prNumber: number, headSha: string): Promise<string[]> {
  const snap = await db()
    .collection('jobs')
    .where('repo.id', '==', repoId)
    .where('pr.number', '==', prNumber)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();
  const stale = snap.docs.filter(
    (d) => ['review', 'app-verify'].includes(String(d.get('type'))) && d.get('pr.headSha') !== headSha,
  );
  return cancelJobs(
    stale.map((d) => d.ref),
    'Digantikan review untuk commit yang lebih baru',
  );
}

/** Dashboard: batalkan review (dan uji aplikasi turunannya). Boleh oleh admin atau anggota yang meminta review itu. */
export const cancelJob = onCall({ secrets: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY] }, async (req) => {
  const me = await requireMember(req);
  const jobId = String((req.data as { jobId?: unknown })?.jobId ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError('invalid-argument', 'jobId tidak sah.');
  const ref = db().doc(`jobs/${jobId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Job tidak ditemukan.');
  // uji aplikasi dibatalkan lewat review induknya (yang menentukan siapa peminta)
  const root =
    snap.get('type') === 'app-verify' && snap.get('parentJobId') ? db().doc(`jobs/${snap.get('parentJobId')}`) : ref;
  const rootSnap = root.id === ref.id ? snap : await root.get();
  const requester = String(rootSnap.get('trigger.userLogin') ?? '');
  if (me.role !== 'admin' && (!requester || requester.toLowerCase() !== me.login.toLowerCase()))
    throw new HttpsError('permission-denied', 'Hanya admin atau yang meminta review ini yang bisa membatalkannya.');
  const children = await db().collection('jobs').where('parentJobId', '==', root.id).get();
  const cancelled = await cancelJobs([root, ...children.docs.map((d) => d.ref)], `Dibatalkan oleh @${me.login}`);
  if (!cancelled.length) throw new HttpsError('failed-precondition', 'Tidak ada job aktif yang bisa dibatalkan.');
  // status commit tidak boleh tertinggal "pending" selamanya
  const repo = rootSnap.get('repo') as { fullName?: string; installationId?: number } | undefined;
  const sha = String(rootSnap.get('pr.headSha') ?? '');
  if (repo?.installationId && repo.fullName && sha) {
    try {
      const octo = await installationOctokit(Number(repo.installationId));
      await setCommitStatus(octo, {
        fullName: repo.fullName,
        sha,
        state: 'error',
        description: `Dibatalkan oleh @${me.login} — minta review ulang bila perlu`,
        jobId: root.id,
      });
    } catch (e) {
      logger.warn('status commit pembatalan gagal', { jobId: root.id, err: String(e) });
    }
  }
  await audit('job.cancel', me.uid, root.id, { cancelled });
  return { cancelled };
});
