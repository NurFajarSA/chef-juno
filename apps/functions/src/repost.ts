import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { audit, requireMember } from './util.js';
import { db } from './admin.js';

/**
 * Dashboard: posting ulang hasil review yang gagal di tahap `post` (mis. GitHub sedang gangguan) tanpa mereview ulang.
 * Job dikembalikan ke `completed`; trigger onJobCompleted memposting hasil yang sudah tersimpan. Gagal lagi → kembali
 * `failed` tahap `post` dan bisa dicoba lagi. Boleh oleh admin atau anggota yang meminta review itu.
 */
export const repostReview = onCall(async (req) => {
  const me = await requireMember(req);
  const jobId = String((req.data as { jobId?: unknown })?.jobId ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError('invalid-argument', 'jobId tidak sah.');
  const ref = db().doc(`jobs/${jobId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Job tidak ditemukan.');
  const requester = String(snap.get('trigger.userLogin') ?? '');
  if (me.role !== 'admin' && (!requester || requester.toLowerCase() !== me.login.toLowerCase()))
    throw new HttpsError(
      'permission-denied',
      'Hanya admin atau yang meminta review ini yang bisa mempostingnya ulang.',
    );
  if (snap.get('type') !== 'review' || snap.get('status') !== 'failed' || snap.get('error.stage') !== 'post')
    throw new HttpsError('failed-precondition', 'Hanya review yang gagal di tahap posting yang bisa diposting ulang.');
  if (!snap.get('result'))
    throw new HttpsError('failed-precondition', 'Hasil review tidak tersimpan; minta review ulang.');
  // review yang lebih baru untuk PR yang sama (sedang berjalan atau sudah selesai) tidak boleh ditimpa hasil lama
  const created = snap.get('createdAt') as Timestamp | undefined;
  const siblings = await db()
    .collection('jobs')
    .where('repo.id', '==', snap.get('repo.id'))
    .where('pr.number', '==', snap.get('pr.number'))
    .get();
  const newer = siblings.docs.some(
    (d) =>
      d.id !== jobId &&
      d.get('type') === 'review' &&
      !['failed', 'cancelled'].includes(String(d.get('status'))) &&
      ((d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0) > (created?.toMillis() ?? 0),
  );
  if (newer) throw new HttpsError('failed-precondition', 'Sudah ada review yang lebih baru untuk PR ini.');
  const ok = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.get('status') !== 'failed' || s.get('error.stage') !== 'post') return false;
    tx.update(ref, {
      status: 'completed',
      error: FieldValue.delete(),
      'github.failureNotifiedAt': FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!ok) throw new HttpsError('failed-precondition', 'Status job berubah; muat ulang halaman.');
  await audit('job.repost', me.uid, jobId, {});
  return { jobId };
});
