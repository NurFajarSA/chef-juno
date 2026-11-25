import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFn, clearAuth, clearFirestore, FN_BASE, idTokenFor } from '../helpers.js';
import { createHarness, FULL_NAME, REPO_ID, type Harness } from '../harness.js';
import { repoJson, sendWebhook } from '../../../../scripts/lib/payloads.mjs';

// Analitik → Dampak: catatan semua PR (juga yang tidak direview), review manusia pertama, revert, riwayat (baseline).
let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
});
afterAll(async () => h?.stop());

const MERGE_SHA = 'a'.repeat(40);
const prPayload = (action: string, o: Record<string, unknown> = {}) => ({
  action,
  number: 7,
  pull_request: {
    number: 7,
    title: 'feat: ekspor laporan',
    state: action === 'closed' ? 'closed' : 'open',
    draft: false,
    user: { login: 'dev3', id: 3003, type: 'User' },
    base: { ref: 'main', sha: h.repo.baseSha },
    head: { ref: 'feat/ekspor', sha: h.repo.headSha },
    created_at: '2026-11-20T01:00:00Z',
    additions: 120,
    deletions: 30,
    changed_files: 5,
    ...o,
  },
  repository: repoJson(FULL_NAME, REPO_ID),
  installation: { id: 777 },
});
const pr = async (n: number) => (await h.db.doc(`prs/${REPO_ID}_${n}`).get()).data()!;

describe('data dampak', () => {
  it('PR yang tidak direview Chef Juno tetap dicatat: dibuka → di-merge, review manusia pertama (bukan bot/penulis)', async () => {
    h.mock.addPr(FULL_NAME, {
      number: 7,
      title: 'feat: ekspor laporan',
      author: 'dev3',
      baseSha: h.repo.baseSha,
      headSha: h.repo.headSha,
      humanReviews: [
        { user: { login: 'dev3', type: 'User' }, submitted_at: '2026-11-20T01:30:00Z', state: 'COMMENTED' }, // penulis sendiri
        { user: { login: 'renovate[bot]', type: 'Bot' }, submitted_at: '2026-11-20T01:40:00Z', state: 'COMMENTED' },
        { user: { login: 'admin1', type: 'User' }, submitted_at: '2026-11-20T04:00:00Z', state: 'APPROVED' },
        { user: { login: 'dev2', type: 'User' }, submitted_at: '2026-11-20T03:00:00Z', state: 'COMMENTED' },
      ],
    });
    expect((await sendWebhook(FN_BASE, 'pull_request', prPayload('opened'))).status).toBe(200);
    expect(await pr(7)).toMatchObject({ state: 'open', author: 'dev3', additions: 120, changedFiles: 5 });
    await sendWebhook(
      FN_BASE,
      'pull_request',
      prPayload('closed', {
        merged: true,
        merged_at: '2026-11-20T06:00:00Z',
        closed_at: '2026-11-20T06:00:00Z',
        merge_commit_sha: MERGE_SHA,
      }),
    );
    const d = await pr(7);
    expect(d.state).toBe('merged');
    expect(d.mergeCommitSha).toBe(MERGE_SHA);
    expect(d.mergedAt.toDate().toISOString()).toBe('2026-11-20T06:00:00.000Z');
    // review manusia pertama: dev2 03:00 (penulis & bot diabaikan)
    expect(d.firstHumanReviewAt.toDate().toISOString()).toBe('2026-11-20T03:00:00.000Z');
  });

  it('commit revert di branch utama menandai PR yang di-revert (lewat nomor PR atau SHA merge)', async () => {
    const r = await sendWebhook(FN_BASE, 'push', {
      ref: 'refs/heads/main',
      before: h.repo.baseSha,
      after: h.repo.baseSha,
      repository: repoJson(FULL_NAME, REPO_ID),
      installation: { id: 777 },
      commits: [
        { id: 'c1', message: 'fix: tipo', timestamp: '2026-11-21T01:00:00Z' },
        {
          id: 'c2',
          message: `Revert "feat: ekspor laporan"\n\nThis reverts commit ${MERGE_SHA}.`,
          timestamp: '2026-11-22T02:00:00Z',
        },
      ],
    });
    expect(r.status).toBe(200);
    const d = await pr(7);
    expect(d.revertSha).toBe('c2');
    expect(d.revertedAt.toDate().toISOString()).toBe('2026-11-22T02:00:00.000Z');
  });

  it('ambil riwayat (baseline): PR tertutup periode itu + review manusia + revert di branch utama; hanya admin', async () => {
    const recent = new Date(Date.now() - 3 * 86400_000).toISOString();
    h.mock.addPr(FULL_NAME, {
      number: 8,
      title: 'feat: filter tanggal',
      author: 'dev2',
      state: 'closed',
      merged: true,
      createdAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
      closedAt: recent,
      mergedAt: recent,
      mergeSha: 'b'.repeat(40),
      baseSha: h.repo.baseSha,
      headSha: h.repo.headSha,
      humanReviews: [{ user: { login: 'admin1', type: 'User' }, submitted_at: recent, state: 'APPROVED' }],
    });
    h.repo.commit({ 'CHANGELOG.md': 'batal\n' }, 'Revert "feat: filter tanggal (#8)"');
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    expect((await callFn('backfillPrs', { repoId: REPO_ID, days: 30 }, member)).ok).toBe(false);
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const r = await callFn<{ prs: number; reviews: number; reverts: number }>(
      'backfillPrs',
      { repoId: REPO_ID, days: 30 },
      admin,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result).toMatchObject({ prs: 1, reviews: 1, reverts: 1 });
    const d = await pr(8);
    expect(d).toMatchObject({ backfilled: true, state: 'merged', author: 'dev2' });
    expect(d.firstHumanReviewAt).toBeTruthy();
    expect(d.revertedAt).toBeTruthy();
  });
});
