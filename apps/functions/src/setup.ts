import { onCall, HttpsError } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_PROMPTS, DEFAULT_SETTINGS, DEFAULT_SKILLS, PromptKeySchema } from '@chefjuno/shared';
import { db } from './admin.js';
import { GITHUB_APP_SLUG } from './params.js';
import { audit, requireMember } from './util.js';

/**
 * Onboarding admin pertama (instalasi baru).
 * - `init`: idempoten — buat `settings/global` (nilai default + status onboarding), prompt persona/review v1,
 *   dan skill bawaan (folder skills/ di repo, aktif) kalau belum ada. Dokumen yang sudah ada tidak disentuh,
 *   kecuali skill bawaan yang versi terakhirnya masih buatan sistem: diperbarui bila isi bundel berubah.
 * - `complete`: tandai onboarding selesai (atau dilewati).
 * Mengembalikan `githubAppInstallUrl` (dari param GITHUB_APP_SLUG; kosong bila belum diisi).
 */
export const setupWorkspace = onCall(async (req) => {
  const me = await requireMember(req, true);
  const action = String((req.data as { action?: unknown } | null)?.action ?? 'init');
  if (action !== 'init' && action !== 'complete') throw new HttpsError('invalid-argument', 'Aksi tidak dikenal.');
  const settingsRef = db().doc('settings/global');
  const created: string[] = [];

  if (action === 'init') {
    await db().runTransaction(async (tx) => {
      const promptRefs = PromptKeySchema.options.map((k) => db().doc(`prompts/${k}`));
      const [s, ...ps] = await Promise.all([tx.get(settingsRef), ...promptRefs.map((r) => tx.get(r))]);
      if (!s.exists) {
        tx.set(settingsRef, {
          ...DEFAULT_SETTINGS,
          onboarding: { startedAt: FieldValue.serverTimestamp(), startedBy: me.login, completedAt: null },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: me.login,
        });
        created.push('settings');
      }
      ps.forEach((p, i) => {
        if (p.exists) return;
        const key = PromptKeySchema.options[i];
        const d = DEFAULT_PROMPTS[key];
        tx.set(promptRefs[i], {
          title: d.title,
          description: d.description,
          activeVersion: 1,
          latestVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: me.login,
        });
        tx.set(promptRefs[i].collection('versions').doc('1'), {
          version: 1,
          content: d.content,
          message: 'Versi awal (default Chef Juno)',
          authorUid: me.uid,
          authorLogin: me.login,
          parentVersion: null,
          createdAt: FieldValue.serverTimestamp(),
        });
        created.push(`prompt:${key}`);
      });
    });
    // skill bawaan (satu transaksi per skill supaya tidak melewati batas transaksi)
    for (const sk of DEFAULT_SKILLS) {
      const ref = db().doc(`skills/${sk.slug}`);
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const latest = Number(snap.get('latestVersion') ?? 0);
        if (snap.exists) {
          if (snap.get('source') !== 'default') return; // nama sama tapi skill milik tim: jangan disentuh
          const prev = await tx.get(ref.collection('versions').doc(String(latest)));
          const prevFiles = (prev.get('files') ?? {}) as Record<string, string>;
          const same =
            JSON.stringify(Object.entries(prevFiles).sort()) === JSON.stringify(Object.entries(sk.files).sort());
          if (same || prev.get('authorUid') !== 'system') return; // sudah sama, atau sudah diedit tim
        }
        const v = latest + 1;
        tx.set(ref.collection('versions').doc(String(v)), {
          version: v,
          files: sk.files,
          message: latest ? 'Pembaruan skill bawaan Chef Juno' : 'Skill bawaan Chef Juno',
          authorUid: 'system',
          authorLogin: 'chefjuno',
          parentVersion: latest || null,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          ref,
          {
            name: sk.name,
            description: sk.description,
            paths: sk.paths,
            category: sk.category ?? null,
            latestVersion: v,
            fileCount: Object.keys(sk.files).length,
            source: 'default',
            ...(snap.exists
              ? {}
              : { enabled: true, everEnabled: true, createdAt: FieldValue.serverTimestamp(), createdBy: me.login }),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: 'chefjuno',
          },
          { merge: true },
        );
        created.push(`${latest ? 'skill-update' : 'skill'}:${sk.slug}`);
      });
    }
    if (created.length) await audit('setup.init', me.uid, 'settings/global', { created });
  } else {
    // set + merge: aman juga untuk instalasi lama yang settings/global-nya belum punya field onboarding
    await settingsRef.set(
      { onboarding: { completedAt: FieldValue.serverTimestamp(), completedBy: me.login } },
      { merge: true },
    );
    await audit('setup.complete', me.uid, 'settings/global');
  }

  const slug = GITHUB_APP_SLUG.value();
  return { created, githubAppInstallUrl: slug ? `https://github.com/apps/${slug}/installations/new` : '' };
});
