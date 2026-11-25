import { FieldValue } from 'firebase-admin/firestore';
import { jaccard, trigrams } from '@chefjuno/shared';
import { db } from './admin.js';

/**
 * Simpan fakta ke memory Chef Juno (koleksi rules, kind "fact"), langsung aktif — seperti memory biasa; tim bisa
 * menonaktifkannya di dashboard. Fakta yang hampir sama dengan yang sudah ada tidak disimpan dua kali.
 */
export async function saveFact(o: {
  repoId: number | null;
  text: string;
  source: 'ingat' | 'uji-aplikasi' | 'manual';
  by: string;
}): Promise<{ id: string; duplicate: boolean }> {
  const text = o.text.replace(/\s+/g, ' ').trim().slice(0, 600);
  const existing = await db().collection('rules').where('kind', '==', 'fact').where('status', '==', 'active').get();
  const tg = trigrams(text.toLowerCase());
  const same = existing.docs.find(
    (d) =>
      (d.get('scope.repoId') ?? null) === o.repoId && jaccard(trigrams(String(d.get('text')).toLowerCase()), tg) >= 0.7,
  );
  if (same) return { id: same.id, duplicate: true };
  const ref = db().collection('rules').doc();
  await ref.set({
    text,
    scope: { repoId: o.repoId, paths: [] },
    source: o.source,
    status: 'active',
    kind: 'fact',
    category: 'maintainability',
    evidence: [],
    usageCount: 0,
    lastUsedAt: null,
    createdBy: o.by,
    decidedBy: o.by,
    decidedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, duplicate: false };
}
