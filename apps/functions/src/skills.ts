import { onCall, HttpsError } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';
import {
  groupSkillFiles,
  ImportSkillsInputSchema,
  parseSkillMd,
  SaveSkillVersionInputSchema,
  SKILL_LIMITS,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { audit, parseInput, requireMember } from './util.js';

/**
 * Skill tim (§ skills): versi immutable di skills/{slug}/versions/{n}; versi terbaru = versi yang dipakai.
 * - importSkills (anggota): import massal. Skill baru aktif bila diimport admin, nonaktif (menunggu admin) bila oleh anggota.
 * - saveSkillVersion (anggota): edit SKILL.md → versi baru (file pendukung dibawa dari versi sebelumnya).
 * - setSkillEnabled / deleteSkill (admin).
 */

const sameFiles = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

export const importSkills = onCall(async (req) => {
  const me = await requireMember(req);
  const input = parseInput(ImportSkillsInputSchema, req.data);
  // validasi ulang di server: tiap entri harus menghasilkan tepat satu skill yang sah
  const parsed = input.skills.map((s, i) => {
    const g = groupSkillFiles(Object.entries(s.files).map(([path, content]) => ({ path, content })));
    if (g.errors.length || g.skills.length !== 1)
      throw new HttpsError('invalid-argument', `Skill #${i + 1}: ${g.errors[0] ?? 'harus berisi tepat satu SKILL.md'}`);
    return g.skills[0];
  });
  const result = { created: [] as string[], updated: [] as string[], unchanged: [] as string[] };
  for (const s of parsed) {
    const ref = db().doc(`skills/${s.slug}`);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const latest = Number(snap.get('latestVersion') ?? 0);
      if (latest) {
        const prev = await tx.get(ref.collection('versions').doc(String(latest)));
        if (prev.exists && sameFiles((prev.get('files') ?? {}) as Record<string, string>, s.files)) {
          result.unchanged.push(s.slug);
          return;
        }
      }
      const v = latest + 1;
      tx.set(ref.collection('versions').doc(String(v)), {
        version: v,
        files: s.files,
        message: input.message || (latest ? 'Diperbarui lewat import' : 'Diimport'),
        authorUid: me.uid,
        authorLogin: me.login,
        parentVersion: latest || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        ref,
        {
          name: s.name,
          description: s.description,
          paths: s.paths,
          category: s.category ?? null,
          latestVersion: v,
          fileCount: Object.keys(s.files).length,
          ...(latest
            ? {}
            : {
                enabled: me.role === 'admin',
                everEnabled: me.role === 'admin',
                source: 'import',
                createdAt: FieldValue.serverTimestamp(),
                createdBy: me.login,
              }),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: me.login,
        },
        { merge: true },
      );
      (latest ? result.updated : result.created).push(s.slug);
    });
  }
  await audit('skill.import', me.uid, [...result.created, ...result.updated].join(',') || '-', result);
  return result;
});

export const saveSkillVersion = onCall(async (req) => {
  const me = await requireMember(req);
  const input = parseInput(SaveSkillVersionInputSchema, req.data);
  const p = parseSkillMd(input.content);
  if ('error' in p) throw new HttpsError('invalid-argument', p.error);
  const ref = db().doc(`skills/${input.slug}`);
  const version = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Skill tidak ditemukan.');
    const latest = Number(snap.get('latestVersion') ?? 0);
    const prev = await tx.get(ref.collection('versions').doc(String(latest)));
    const files = { ...((prev.get('files') ?? {}) as Record<string, string>), 'SKILL.md': input.content };
    const total = Object.values(files).reduce((a, c) => a + Buffer.byteLength(c), 0);
    if (total > SKILL_LIMITS.maxSkillBytes) throw new HttpsError('invalid-argument', 'Skill terlalu besar.');
    const v = latest + 1;
    tx.set(ref.collection('versions').doc(String(v)), {
      version: v,
      files,
      message: input.message,
      authorUid: me.uid,
      authorLogin: me.login,
      parentVersion: latest || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, {
      name: p.name,
      description: p.description,
      paths: p.paths,
      category: p.category ?? null,
      latestVersion: v,
      fileCount: Object.keys(files).length,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: me.login,
    });
    return v;
  });
  await audit('skill.save', me.uid, `${input.slug}@${version}`);
  return { version };
});

const slugOf = (d: unknown) => {
  const slug = String((d as { slug?: unknown } | null)?.slug ?? '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new HttpsError('invalid-argument', 'Slug skill tidak valid.');
  return slug;
};

export const setSkillEnabled = onCall(async (req) => {
  const me = await requireMember(req, true);
  const slug = slugOf(req.data);
  const enabled = (req.data as { enabled?: unknown }).enabled === true;
  const ref = db().doc(`skills/${slug}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Skill tidak ditemukan.');
  await ref.update({
    enabled,
    ...(enabled ? { everEnabled: true } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: me.login,
  });
  await audit(enabled ? 'skill.enable' : 'skill.disable', me.uid, slug);
  return { enabled };
});

export const deleteSkill = onCall(async (req) => {
  const me = await requireMember(req, true);
  const slug = slugOf(req.data);
  const ref = db().doc(`skills/${slug}`);
  await db().recursiveDelete(ref);
  await audit('skill.delete', me.uid, slug);
  return { deleted: slug };
});

/** Versi skill aktif yang dipin ke job saat dibuat (supaya review bisa direproduksi). */
export async function activeSkillVersions(): Promise<{ slug: string; version: number }[]> {
  const snap = await db().collection('skills').where('enabled', '==', true).get();
  return snap.docs
    .map((d) => ({ slug: d.id, version: Number(d.get('latestVersion') ?? 0) }))
    .filter((s) => s.version > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
