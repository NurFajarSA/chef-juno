import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callFn, clearAuth, clearFirestore, FN_BASE, idTokenFor } from '../helpers.js';
import { createHarness, FULL_NAME, REPO_ID, type Harness } from '../harness.js';
import { installationRepositories, push, sendWebhook } from '../../../../scripts/lib/payloads.mjs';

let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await h.db.doc(`repos/${REPO_ID}`).delete();
  await h.startMachine({ name: 'Mesin Index', agents: ['claude'] });
});
afterAll(async () => h?.stop());

const repoDoc = async () => (await h.db.doc(`repos/${REPO_ID}`).get()).data()!;

describe('peta kode: job index (emulator)', () => {
  it('pasang repo (installation_repositories) → job index penuh → repo ready + statistik + ringkasan modul', async () => {
    const r = await sendWebhook(
      FN_BASE,
      'installation_repositories',
      installationRepositories({ fullName: FULL_NAME, repoId: REPO_ID }),
    );
    expect(r.status).toBe(200);
    const j = await h.waitJob((x) => x.type === 'index' && x.status === 'completed');
    expect(j.data.index.mode).toBe('full');
    // ringkasan modul tercatat untuk Analitik biaya & waktu: model per peran (index = cepat → sonnet, tanpa Haiku) + token dari CLI
    expect(j.data.result.meta).toMatchObject({ model: 'sonnet', inputTokens: 1200, outputTokens: 340 }); // tanpa Haiku
    expect(j.data.result.meta.passes).toEqual([
      expect.objectContaining({
        role: 'index',
        label: 'index-1',
        model: 'sonnet',
        ok: true,
        inputTokens: 1200,
        outputTokens: 340,
      }),
    ]);
    await h.waitFor(async () => (await repoDoc()).index?.status === 'ready', 20_000, 'repo ready');
    const repo = await repoDoc();
    expect(repo.index.indexedSha).toBe(h.repo.baseSha);
    expect(repo.index.stats.files).toBe(15);
    expect(repo.index.stats.symbols).toBeGreaterThan(15);
    expect(repo.index.stats.edges).toBeGreaterThan(10);
    expect(repo.index.byMachineId).toBe(h.daemons[0].machineId);
    const mods = await h.db.collection(`repos/${REPO_ID}/modules`).get();
    const byPath = Object.fromEntries(mods.docs.map((d) => [d.get('path'), d.data()]));
    expect(Object.keys(byPath)).toEqual(expect.arrayContaining(['src/api', 'src/services', 'web', 'py', 'go']));
    expect(byPath['src/api'].summary).toContain('src/api');
    expect(byPath['src/api'].exports).toEqual(expect.arrayContaining(['fetchUser']));
    expect(byPath['src/api'].dependents).toEqual(expect.arrayContaining(['src/services', 'web', 'src/legacy']));
  });

  it('push ke default branch → job index incremental → indexedSha maju; push ke branch lain diabaikan', async () => {
    const sha = h.repo.commit(
      {
        'src/api/extra.ts':
          "import { fetchUser } from './user';\nexport async function exists(id: string) {\n  return (await fetchUser(id)) !== null;\n}\n",
      },
      'feat: exists',
    );
    const other = await sendWebhook(
      FN_BASE,
      'push',
      push({ fullName: FULL_NAME, repoId: REPO_ID, before: h.repo.baseSha, after: sha, ref: 'refs/heads/feat/x' }),
    );
    // branch knowledge base default = branch utama repo; push ke branch lain tidak memicu index
    expect(other.body).toMatchObject({ result: 'bukan branch knowledge base' });
    await sendWebhook(
      FN_BASE,
      'push',
      push({ fullName: FULL_NAME, repoId: REPO_ID, before: h.repo.baseSha, after: sha }),
    );
    const j = await h.waitJob((x) => x.type === 'index' && x.status === 'completed' && x.index?.targetSha === sha);
    expect(j.data.result.mode).toBe('incremental');
    expect(j.data.result.stats.parsedFiles).toBe(1);
    await h.waitFor(async () => (await repoDoc()).index?.indexedSha === sha, 20_000, 'indexedSha maju');
    // hanya modul src/api yang diringkas ulang
    expect(j.data.result.summarized).toEqual(['src/api']);
  });

  it('tombol Index ulang (admin) → job index penuh; member biasa ditolak', async () => {
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    expect((await callFn('requestReindex', { repoId: REPO_ID }, member)).ok).toBe(false);
    const r = await callFn<{ jobId: string }>('requestReindex', { repoId: REPO_ID }, admin);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const id = r.result!.jobId;
    await h.waitFor(
      async () => (await h.db.doc(`jobs/${id}`).get()).get('status') === 'completed',
      30_000,
      'reindex selesai',
    );
    const j = (await h.db.doc(`jobs/${id}`).get()).data()!;
    expect(j.index.mode).toBe('full');
    expect(j.result.mode).toBe('full');
  });

  it('review PR yang mengubah signature → prompt fake agent memuat caller dari peta kode; ringkasan menyebut dampak', async () => {
    await h.comment('lapor @chefjuno');
    const done = await h.waitJob((x) => x.type === 'review' && ['posted', 'failed'].includes(x.status));
    expect(done.data.error ?? null).toBeNull();
    const j = done;
    expect(j.data.result.impact[0]).toContain('`fetchUser` dipakai di');
    const recs = readdirSync(h.recordDir)
      .filter((f) => f.startsWith('claude-'))
      .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
      .filter((r) => r.prompt.includes('# PR #1'))
      // prompt review, bukan panggilan reviewer akhir yang datang sesudahnya
      .filter((r) => !r.prompt.includes('# Ringkasan reviewer sebelumnya'));
    const p = recs.at(-1).prompt as string;
    expect(p).toContain('## Konteks dari peta kode');
    expect(p).toContain('`loadProfile` di src/services/profile.ts:4');
    expect(p).toContain('`userSlug` di src/legacy/helpers.js:8');
    expect(p).toContain('`refresh` di web/UserBadge.vue:13');
    expect(p).toContain('signature berubah');
    const sum = h.mock.summaryComments(FULL_NAME, 1)[0].body;
    expect(sum).toContain('**Dampak (dari code map)**');
    expect(sum).toContain('`fetchUser` dipakai di');
  });

  it('event instalasi tanpa default_branch → branch utama diambil dari GitHub; data repo yang salah terkoreksi', async () => {
    // seperti produksi: repo pernah tercatat dengan tebakan branch yang salah (repo aslinya memakai `master`)
    await h.db.doc(`repos/${REPO_ID}`).update({ defaultBranch: 'branch-tebakan-salah' });
    const r = await sendWebhook(
      FN_BASE,
      'installation_repositories',
      installationRepositories({ fullName: FULL_NAME, repoId: REPO_ID }),
    );
    expect(r.status).toBe(200);
    // GitHub palsu menjawab default_branch fixture (`main`)
    await h.waitFor(async () => (await repoDoc()).defaultBranch === 'main', 20_000, 'defaultBranch terkoreksi');
    expect(h.mock.calls('GET', new RegExp(`^/repos/${FULL_NAME}$`)).length).toBeGreaterThan(0);
  });

  it('admin memilih branch knowledge base: dicek ke GitHub, index penuh dari branch itu, push ke branch utama diabaikan', async () => {
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    expect((await callFn('setIndexBranch', { repoId: REPO_ID, branch: 'feat/cache-user' }, member)).ok).toBe(false);
    const missing = await callFn('setIndexBranch', { repoId: REPO_ID, branch: 'rewrite/tidak-ada' }, admin);
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toContain('Branch "rewrite/tidak-ada" tidak ada');
    expect((await callFn('setIndexBranch', { repoId: REPO_ID, branch: '../etc' }, admin)).error?.message).toContain(
      'tidak sah',
    );

    const r = await callFn<{ jobId: string; branch: string }>(
      'setIndexBranch',
      { repoId: REPO_ID, branch: 'feat/cache-user' },
      admin,
    );
    expect(r.result?.branch).toBe('feat/cache-user');
    expect((await repoDoc()).indexBranch).toBe('feat/cache-user');
    const j = await h.waitJob(
      (x) => x.type === 'index' && x.status === 'completed' && x.index?.ref === 'feat/cache-user',
    );
    expect(j.data.index.mode).toBe('full');
    // code map dibangun dari ujung branch pilihan (head PR fixture), bukan branch utama
    await h.waitFor(
      async () => (await repoDoc()).index?.indexedSha === h.repo.headSha,
      20_000,
      'index dari branch pilihan',
    );

    const onMain = await sendWebhook(
      FN_BASE,
      'push',
      push({ fullName: FULL_NAME, repoId: REPO_ID, before: h.repo.baseSha, after: h.repo.baseSha }),
    );
    expect(onMain.body).toMatchObject({ result: 'bukan branch knowledge base' });

    // kosongkan → kembali ke branch utama repo
    const reset = await callFn<{ jobId: string; branch: string }>(
      'setIndexBranch',
      { repoId: REPO_ID, branch: '' },
      admin,
    );
    expect(reset.result?.branch).toBe('main');
    expect((await repoDoc()).indexBranch).toBeUndefined();
    // index ulang dari branch utama berjalan sampai selesai (jangan tinggalkan job menggantung saat harness berhenti)
    const backRef = h.db.doc(`jobs/${reset.result!.jobId}`);
    await h.waitFor(
      async () => (await backRef.get()).get('status') === 'completed',
      45_000,
      'index ulang branch utama',
    );
    expect((await backRef.get()).get('index.ref')).toBe('main');
  });
});
