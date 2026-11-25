import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { onRequest } from 'firebase-functions/https';
import { db } from './admin.js';
import { DASHBOARD_URL, GITHUB_WEBHOOK_SECRET } from './params.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Kunci tanda tangan tautan bukti, diturunkan dari secret webhook (tanpa secret baru). */
function key(): Buffer {
  return createHash('sha256').update(`chefjuno-evidence:${GITHUB_WEBHOOK_SECRET.value().trim()}`).digest();
}

export function evidenceSig(jobId: string, shotId: string): string {
  return createHmac('sha256', key()).update(`${jobId}/${shotId}`).digest('hex').slice(0, 32);
}

/**
 * URL gambar bukti untuk komentar GitHub (tampil inline): disajikan lewat domain dashboard (rewrite Hosting ke
 * function evidenceImage), hanya dengan tanda tangan yang benar. null bila DASHBOARD_URL belum diisi.
 */
export function evidenceImageUrl(jobId: string, shotId: string): string | null {
  const base = DASHBOARD_URL.value().replace(/\/+$/, '');
  if (!base || !ID_RE.test(jobId) || !ID_RE.test(shotId)) return null;
  return `${base}/evidence?j=${jobId}&s=${shotId}&sig=${evidenceSig(jobId, shotId)}`;
}

/** Sajikan screenshot bukti (JPEG) dari jobs/{j}/evidence/{s}; tanda tangan salah → 403. */
export const evidenceImage = onRequest({ secrets: [GITHUB_WEBHOOK_SECRET], cors: false }, async (req, res) => {
  const j = String(req.query.j ?? '');
  const s = String(req.query.s ?? '');
  const sig = String(req.query.sig ?? '');
  if (req.method !== 'GET' || !ID_RE.test(j) || !ID_RE.test(s) || !/^[0-9a-f]{32}$/.test(sig)) {
    res.status(400).send('permintaan tidak sah');
    return;
  }
  const want = Buffer.from(evidenceSig(j, s));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    res.status(403).send('tanda tangan salah');
    return;
  }
  const d = (await db().doc(`jobs/${j}/evidence/${s}`).get()).data();
  if (!d?.data) {
    res.status(404).send('tidak ada');
    return;
  }
  res.set('content-type', 'image/jpeg');
  // isi gambar per id tidak pernah berubah
  res.set('cache-control', 'public, max-age=31536000, immutable');
  res.set('x-content-type-options', 'nosniff');
  res.send(Buffer.from(String(d.data), 'base64'));
});
