import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS, DEFAULT_SKILLS } from '@chefjuno/shared';
import { admin, callFn, clearAuth, clearFirestore, idTokenFor } from '../helpers.js';

// Instalasi baru: database kosong, hanya ada admin pertama (hasil bootstrap) dan satu anggota biasa.
const { db } = admin();
let adminTok: string;
let memberTok: string;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  await db.doc('members/1001').set({ githubLogin: 'pemilik', role: 'admin' });
  await db.doc('members/2002').set({ githubLogin: 'dev2', role: 'member' });
  adminTok = await idTokenFor('uid-pemilik', { cj: 'admin', cjGh: '1001' });
  memberTok = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
});
afterAll(async () => clearFirestore());

describe('setupWorkspace (onboarding admin pertama)', () => {
  it('anggota biasa ditolak', async () => {
    const r = await callFn('setupWorkspace', { action: 'init' }, memberTok);
    expect(r.ok).toBe(false);
    expect((await db.doc('settings/global').get()).exists).toBe(false);
  });

  it('init: membuat settings default + prompt persona/review v1 + skill bawaan aktif, mengembalikan link pasang GitHub App', async () => {
    const r = await callFn<{ created: string[]; githubAppInstallUrl: string }>(
      'setupWorkspace',
      { action: 'init' },
      adminTok,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result!.created.sort()).toEqual(
      ['prompt:persona', 'prompt:review', 'settings', ...DEFAULT_SKILLS.map((k) => `skill:${k.slug}`)].sort(),
    );
    const sk = (await db.doc('skills/bukti').get()).data()!;
    // skill bawaan menyimpan kategori (inti = prinsip)
    expect(sk).toMatchObject({ source: 'default', enabled: true, latestVersion: 1, category: 'inti' });
    const skv = (await db.doc('skills/bukti/versions/1').get()).data()!;
    expect(skv.files['SKILL.md']).toContain('Bukti, bukan pendapat');
    expect(skv.authorUid).toBe('system');
    expect(r.result!.githubAppInstallUrl).toBe('https://github.com/apps/chefjuno-demo/installations/new');
    const s = (await db.doc('settings/global').get()).data()!;
    expect(s).toMatchObject({ maxInlineComments: 10, preferredAgent: 'any', botHandle: 'chefjuno' });
    expect(s.onboarding.completedAt).toBeNull();
    expect(s.onboarding.startedBy).toBe('pemilik');
    const p = (await db.doc('prompts/review').get()).data()!;
    expect(p).toMatchObject({ activeVersion: 1, latestVersion: 1, title: 'Instruksi review' });
    const v1 = (await db.doc('prompts/review/versions/1').get()).data()!;
    expect(v1.content).toBe(DEFAULT_PROMPTS.review.content);
    expect(v1.authorLogin).toBe('pemilik');
  });

  it('init idempoten: tidak menimpa setting, prompt, atau skill bawaan yang sudah diedit/dimatikan tim', async () => {
    await db.doc('settings/global').update({ maxInlineComments: 3 });
    await db.doc('skills/akar-masalah').update({ enabled: false });
    await db
      .doc('skills/sinyal-bukan-noise/versions/1')
      .update({ authorUid: 'uid-pemilik', files: { 'SKILL.md': 'diedit tim' } });
    await db.doc('prompts/review/versions/1').update({ content: 'sudah diubah' });
    const r = await callFn<{ created: string[] }>('setupWorkspace', { action: 'init' }, adminTok);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result!.created).toEqual([]);
    expect((await db.doc('settings/global').get()).get('maxInlineComments')).toBe(3);
    expect((await db.doc('prompts/review/versions/1').get()).get('content')).toBe('sudah diubah');
    expect((await db.doc('skills/akar-masalah').get()).get('enabled')).toBe(false);
    expect((await db.doc('skills/sinyal-bukan-noise').get()).get('latestVersion')).toBe(1);
  });

  it('complete: menandai onboarding selesai + auditLog; aksi tak dikenal ditolak', async () => {
    expect((await callFn('setupWorkspace', { action: 'hapus' }, adminTok)).ok).toBe(false);
    const r = await callFn('setupWorkspace', { action: 'complete' }, adminTok);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const s = (await db.doc('settings/global').get()).data()!;
    expect(s.onboarding.completedAt).toBeTruthy();
    expect(s.onboarding.completedBy).toBe('pemilik');
    const logs = await db.collection('auditLog').where('action', 'in', ['setup.init', 'setup.complete']).get();
    expect(logs.size).toBe(2);
  });
});
