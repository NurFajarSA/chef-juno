import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callFn, clearAuth, clearFirestore, idTokenFor } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

let h: Harness;
let member: string;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
});
afterAll(async () => h?.stop());

const prompt = async (k: string) => (await h.db.doc(`prompts/${k}`).get()).data()!;

describe('prompt versioning', () => {
  it('simpan versi baru → latestVersion+1, immutable, auditLog; pesan wajib', async () => {
    const bad = await callFn('savePromptVersion', { key: 'review', content: 'x', message: '' }, member);
    expect(bad.ok).toBe(false);
    const r = await callFn<{ version: number }>(
      'savePromptVersion',
      { key: 'review', content: 'Review v2: fokus null-check.', message: 'Tambah fokus null-check' },
      member,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result!.version).toBe(2);
    const p = await prompt('review');
    expect(p.latestVersion).toBe(2);
    expect(p.activeVersion).toBe(1);
    const v2 = (await h.db.doc('prompts/review/versions/2').get()).data()!;
    expect(v2).toMatchObject({ version: 2, message: 'Tambah fokus null-check', parentVersion: 1, authorLogin: 'dev2' });
    const audits = await h.db.collection('auditLog').where('action', '==', 'prompt.save').get();
    expect(audits.size).toBe(1);
    const same = await callFn(
      'savePromptVersion',
      { key: 'review', content: 'Review v2: fokus null-check.', message: 'sama' },
      member,
    );
    expect(same.ok).toBe(false);
  });

  it('aktifkan v2 lalu aktifkan v1 lagi = rollback', async () => {
    expect((await callFn('activatePromptVersion', { key: 'review', version: 2 }, member)).ok).toBe(true);
    expect((await prompt('review')).activeVersion).toBe(2);
    const r = await callFn<{ activeVersion: number; previous: number }>(
      'activatePromptVersion',
      { key: 'review', version: 1 },
      member,
    );
    expect(r.result).toEqual({ activeVersion: 1, previous: 2 });
    expect((await prompt('review')).activeVersion).toBe(1);
    expect((await callFn('activatePromptVersion', { key: 'review', version: 99 }, member)).ok).toBe(false);
    const acts = await h.db.collection('auditLog').where('action', '==', 'prompt.activate').get();
    expect(acts.size).toBe(2);
  });

  it('non-anggota tidak bisa menyimpan / mengaktifkan', async () => {
    const t = await idTokenFor('uid-luar');
    expect((await callFn('savePromptVersion', { key: 'review', content: 'y', message: 'abc' }, t)).ok).toBe(false);
    expect((await callFn('activatePromptVersion', { key: 'review', version: 2 }, t)).ok).toBe(false);
  });

  it('job memakai versi yang dipin walaupun versi aktif berubah setelah enqueue', async () => {
    // enqueue saat review v1 aktif, belum ada mesin
    await h.comment('lapor @chefjuno');
    const q = await h.waitJob((j) => j.type === 'review' && j.status === 'queued');
    expect(q.data.promptVersions).toEqual({ persona: 1, review: 1 });
    // aktifkan v2 setelah enqueue
    await callFn('activatePromptVersion', { key: 'review', version: 2 }, member);
    await h.startMachine({ agents: ['claude'] });
    const done = await h.waitJob((j) => j.type === 'review' && j.status === 'posted');
    expect(done.data.promptVersions.review).toBe(1);
    const rec = readdirSync(h.recordDir).map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))[0];
    expect(rec.system).not.toContain('Review v2: fokus null-check.');
    expect(h.mock.summaryComments('tim/sample-repo', 1)[0].body).toContain('prompt persona v1 / review v1');
    // job berikutnya memakai v2
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () => (await h.db.collection('jobs').where('status', '==', 'posted').get()).size === 2,
      45_000,
      'job kedua',
    );
    const recs = readdirSync(h.recordDir).map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')));
    expect(recs.some((r) => String(r.system).includes('Review v2: fokus null-check.'))).toBe(true);
    expect(h.mock.summaryComments('tim/sample-repo', 1)[0].body).toContain('review v2');
  });
});
