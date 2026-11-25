import { onCall, HttpsError } from 'firebase-functions/https';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { LearnOutputSchema, ManualRuleInputSchema, trigrams } from '@chefjuno/shared';
import { db } from './admin.js';
import { audit, parseInput, requireMember } from './util.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- data job dibaca bebas lalu divalidasi zod */

/** Job learn selesai → rules (suggested) + people.recurringMistakes/lessons (§12.3). */
export async function applyLearnResult(ref: DocumentReference, job: any) {
  const parsed = LearnOutputSchema.safeParse(job.result);
  if (!parsed.success) {
    await ref.update({ status: 'failed', error: { stage: 'parse', message: 'Hasil learn tidak sesuai schema' } });
    return;
  }
  const items: any[] = job.learn?.items ?? [];
  const byId = new Map(items.map((x) => [x.id, x]));
  const batch = db().batch();
  const created: string[] = [];
  for (const r of parsed.data.rules) {
    // Tidak pernah menekan security atau P0 (§6.8, §12.10)
    if (r.kind === 'suppression') {
      const ev = r.evidence.map((id) => byId.get(id)).filter(Boolean);
      if (r.category === 'security' || ev.some((e) => e.severity === 'P0' || e.category === 'security')) continue;
      if (!r.matchTitle) continue;
    }
    const doc = db().collection('rules').doc();
    created.push(doc.id);
    batch.set(doc, {
      text: r.text,
      scope: { repoId: job.repo?.id != null ? String(job.repo.id) : null, paths: r.paths },
      source: 'learned',
      status: 'suggested',
      kind: r.kind,
      category: r.category,
      ...(r.kind === 'suppression'
        ? { match: { category: r.category, titleTrigrams: trigrams(r.matchTitle!) }, matchTitle: r.matchTitle }
        : {}),
      evidence: r.evidence,
      usageCount: 0,
      lastUsedAt: null,
      createdBy: `job:${ref.id}`,
      decidedBy: null,
      decidedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  // Pelajaran pribadi: kesalahan yang sama muncul ≥ 2 kali → recurringMistakes
  for (const l of parsed.data.personalLessons) {
    const pref = db().doc(`people/${l.login}`);
    await db().runTransaction(async (tx) => {
      const p = await tx.get(pref);
      const list: any[] = p.get('recurringMistakes') ?? [];
      const now = new Date().toISOString();
      const ex = list.find((m) => m.key === l.key);
      if (ex) {
        ex.count += 1;
        ex.lastSeen = now;
        ex.trend = 'up';
      } else
        list.push({
          key: l.key,
          title: l.title,
          category: l.category,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          trend: 'flat',
        });
      const lessons: any[] = [
        { text: l.lesson, prNumber: job.learn?.prNumber ?? null, at: now },
        ...(p.get('lessons') ?? []),
      ].slice(0, 50);
      tx.set(pref, { recurringMistakes: list, lessons, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  await ref.update({ 'result.createdRuleIds': created });
}

/** Aturan manual → langsung aktif. */
export const createManualRule = onCall(async (req) => {
  const me = await requireMember(req);
  const input = parseInput(ManualRuleInputSchema, req.data);
  const doc = db().collection('rules').doc();
  await doc.set({
    text: input.text,
    scope: { repoId: input.repoId, paths: input.paths },
    source: 'manual',
    status: 'active',
    kind: 'rule',
    category: input.category,
    evidence: [],
    usageCount: 0,
    lastUsedAt: null,
    createdBy: me.login,
    decidedBy: me.login,
    decidedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  await audit('rule.create', me.uid, doc.id);
  return { id: doc.id };
});

/** Admin: setujui / tolak / nonaktifkan / aktifkan lagi / edit, bisa massal. */
export const decideRules = onCall(async (req) => {
  const me = await requireMember(req, true);
  const data = (req.data ?? {}) as { ids?: unknown; action?: unknown; text?: unknown };
  const ids = Array.isArray(data.ids) ? data.ids.map(String).slice(0, 200) : [];
  const action = String(data.action ?? '');
  const map: Record<string, string> = {
    approve: 'active',
    reject: 'rejected',
    deactivate: 'inactive',
    reactivate: 'active',
  };
  if (!ids.length) throw new HttpsError('invalid-argument', 'Tidak ada aturan dipilih.');
  if (!map[action] && action !== 'edit') throw new HttpsError('invalid-argument', 'Aksi tidak dikenal.');
  const batch = db().batch();
  for (const id of ids) {
    const ref = db().doc(`rules/${id}`);
    if (action === 'edit') {
      const text = String(data.text ?? '').trim();
      if (text.length < 5) throw new HttpsError('invalid-argument', 'Aturan minimal 5 karakter.');
      batch.update(ref, { text, decidedBy: me.login, decidedAt: FieldValue.serverTimestamp() });
    } else batch.update(ref, { status: map[action], decidedBy: me.login, decidedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  await audit(`rule.${action}`, me.uid, ids.join(','));
  return { updated: ids.length };
});
