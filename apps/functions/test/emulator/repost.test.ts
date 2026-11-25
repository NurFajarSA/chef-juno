import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFn, clearAuth, clearFirestore, idTokenFor } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

// GitHub gangguan saat memposting review: hasil yang sudah jadi bisa diposting ulang dari dashboard tanpa review ulang.
let h: Harness;
const reviews = async () => (await h.db.collection('jobs').where('type', '==', 'review').get()).docs;

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await h.startMachine({ agents: ['claude'] });
});
afterAll(async () => {
  await h?.stop();
});

describe('posting ulang review', () => {
  it('gagal di tahap post → admin/peminta memposting ulang hasil yang tersimpan; agent tidak dijalankan lagi', async () => {
    h.mock.outage = /\/pulls\/\d+\/reviews$/; // review PR dibalas 502, seperti GitHub yang sedang gangguan
    await h.comment('lapor @chefjuno'); // peminta: dev2
    const job = await h.waitFor(
      async () => (await reviews()).find((d) => d.get('status') === 'failed' && d.get('error.stage') === 'post'),
      60_000,
      'review gagal di tahap post',
    );
    expect(job.get('result')).toBeTruthy();
    const passes = (job.get('passes') as unknown[] | undefined)?.length ?? 0;
    h.mock.outage = false;

    const dev3 = await idTokenFor('uid-dev3', { cj: 'member', cjGh: '3003' });
    const denied = await callFn('repostReview', { jobId: job.id }, dev3);
    expect(JSON.stringify(denied.error)).toContain('Hanya admin atau yang meminta review ini');

    const dev2 = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    const r = await callFn<{ jobId: string }>('repostReview', { jobId: job.id }, dev2);
    expect(r.result?.jobId).toBe(job.id);
    const posted = await h.waitFor(
      async () => {
        const d = await h.db.doc(`jobs/${job.id}`).get();
        return d.get('github.postedAt') ? d : null;
      },
      30_000,
      'review diposting ulang',
    );
    expect(posted.get('status')).toBe('posted');
    expect(posted.get('error')).toBeUndefined();
    expect(h.mock.reviews.length).toBeGreaterThan(0);
    // hasil lama dipakai: tidak ada review baru, tidak ada langkah agent tambahan
    expect((await reviews()).length).toBe(1);
    expect((posted.get('passes') as unknown[] | undefined)?.length ?? 0).toBe(passes);

    // sudah terposting → tidak bisa diposting ulang lagi
    const again = await callFn('repostReview', { jobId: job.id }, dev2);
    expect(JSON.stringify(again.error)).toContain('Hanya review yang gagal di tahap posting');
  });
});
