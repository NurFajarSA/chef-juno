import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { db } from './admin.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hasil job index dibaca bebas lalu dipilih field-nya */
export const moduleDocId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '__') || 'root';

/** Job index selesai → repos/{id}.index + repos/{id}/modules/* (mesin tidak menulis modules langsung, §12.3). */
export async function applyIndexResult(ref: DocumentReference, job: any) {
  const r = job.result ?? {};
  const repoRef = db().doc(`repos/${job.repo.id}`);
  const batch = db().batch();
  batch.set(
    repoRef,
    {
      index: {
        status: 'ready',
        indexedSha: r.indexedSha ?? null,
        indexedAt: FieldValue.serverTimestamp(),
        byMachineId: job.machineId ?? null,
        mode: r.mode ?? job.index?.mode ?? 'full',
        stats: r.stats ?? {},
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  for (const m of (r.modules ?? []) as any[]) {
    batch.set(
      repoRef.collection('modules').doc(moduleDocId(String(m.id))),
      {
        path: String(m.path ?? m.id),
        name: String(m.name ?? m.id),
        ...(m.summary ? { summary: String(m.summary).slice(0, 20_000) } : {}),
        keyFiles: (m.keyFiles ?? []).slice(0, 30),
        exports: (m.exports ?? []).slice(0, 50),
        dependsOn: m.dependsOn ?? [],
        dependents: m.dependents ?? [],
        stats: m.stats ?? {},
        summarySha: m.summarySha ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  await ref.update({ 'result.appliedAt': FieldValue.serverTimestamp() });
}
