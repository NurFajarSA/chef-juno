import { onDocumentUpdated } from 'firebase-functions/firestore';
import { applyAppVerifyFailed, applyAppVerifyResult } from './app-result.js';
import { onCall, HttpsError } from 'firebase-functions/https';
import { onSchedule } from 'firebase-functions/scheduler';
import { logger } from 'firebase-functions';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DB_ID, MAX_ATTEMPTS } from '@chefjuno/shared';
import { db } from './admin.js';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET } from './params.js';
import { createRepoReadToken } from './github.js';
import { notifyReviewFailed, postReview } from './post.js';
import { applyIndexResult } from './index-result.js';
import { applyLearnResult } from './learn.js';
import { applyRecapResult } from './reports.js';

/** Satu dispatcher hasil job berdasarkan `type` (§12.3). */
export const onJobCompleted = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    database: DB_ID,
    secrets: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET],
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const ref = event.data!.after.ref;
    try {
      if (after.status === 'completed' && before.status !== 'completed') {
        switch (after.type) {
          case 'review':
            if (!after.github?.postedAt) await postReview(ref, after);
            break;
          case 'index':
            await applyIndexResult(ref, after);
            break;
          case 'learn':
            await applyLearnResult(ref, after);
            break;
          case 'recap':
            await applyRecapResult(ref, after);
            break;
          case 'app-verify':
            await applyAppVerifyResult(ref, after);
            break;
        }
      } else if (after.status === 'failed' && before.status !== 'failed') {
        if (after.type === 'review') await notifyReviewFailed(ref, after);
        if (after.type === 'app-verify') await applyAppVerifyFailed(ref, after);
        if (after.type === 'index' && after.repo?.id) {
          await db()
            .doc(`repos/${after.repo.id}`)
            .set({ index: { status: 'failed' } }, { merge: true });
        }
      }
    } catch (e) {
      logger.error('onJobCompleted gagal', { jobId: ref.id, err: String(e) });
      await ref.update({
        status: 'failed',
        error: { stage: 'post', message: String((e as Error).message).slice(0, 300) },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

/** Callable mesin: token GitHub read-only berumur pendek khusus job yang sedang dipegangnya (§6.3.2). */
export const getJobRepoAccess = onCall({ secrets: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY] }, async (req) => {
  const t = req.auth?.token as Record<string, unknown> | undefined;
  if (!req.auth || t?.machine !== true || typeof t.machineId !== 'string')
    throw new HttpsError('permission-denied', 'Hanya mesin.');
  const machineId = t.machineId;
  const m = await db().doc(`machines/${machineId}`).get();
  if (!m.exists || m.get('revoked')) throw new HttpsError('permission-denied', 'Mesin dicabut.');
  const jobId = String((req.data as { jobId?: unknown })?.jobId ?? '');
  const job = await db().doc(`jobs/${jobId}`).get();
  if (!job.exists) throw new HttpsError('not-found', 'Job tidak ada.');
  if (job.get('machineId') !== machineId || !['claimed', 'running'].includes(job.get('status')))
    throw new HttpsError('permission-denied', 'Job bukan milik mesin ini.');
  const tok = await createRepoReadToken(Number(job.get('repo.installationId')), Number(job.get('repo.id')));
  return { token: tok.token, expiresAt: tok.expiresAt, fullName: job.get('repo.fullName') };
});

/**
 * §6.5 — fungsi murni pemeliharaan (dipanggil onSchedule, test, dan demo; emulator tidak menjalankan cron).
 * Lease lewat → queued lagi kalau attempts < 3, selain itu failed. Queued > 2 jam → failed (stale).
 */
export async function runMaintenance(fs: Firestore, nowMs = Date.now(), staleMs = 2 * 3600_000) {
  const out = { requeued: [] as string[], failed: [] as string[], stale: [] as string[] };
  const running = await fs.collection('jobs').where('status', 'in', ['claimed', 'running']).get();
  for (const d of running.docs) {
    const lease = (d.get('leaseExpiresAt') as Timestamp | undefined)?.toMillis() ?? 0;
    if (lease > nowMs) continue;
    const attempts = Number(d.get('attempts') ?? 0);
    if (attempts < MAX_ATTEMPTS) {
      await d.ref.update({
        status: 'queued',
        machineId: null,
        leaseExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      out.requeued.push(d.id);
    } else {
      await d.ref.update({
        status: 'failed',
        error: { stage: 'lease', message: `Lease habis ${attempts}x` },
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      out.failed.push(d.id);
    }
  }
  const queued = await fs.collection('jobs').where('status', '==', 'queued').get();
  for (const d of queued.docs) {
    const created = (d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? nowMs;
    if (nowMs - created > staleMs) {
      await d.ref.update({
        status: 'failed',
        error: { stage: 'stale', message: 'Antre lebih dari 2 jam' },
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      out.stale.push(d.id);
    }
  }
  return out;
}

export const maintenance = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Jakarta' }, async () => {
  const r = await runMaintenance(db());
  logger.info('maintenance', r);
});
