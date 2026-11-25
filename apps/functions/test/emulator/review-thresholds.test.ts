import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearAuth, clearFirestore } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

// Kontrak review v4: temuan di bawah ambang keyakinan tidak diposting (tetap tersimpan), diff terpotong = review sebagian.
let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
});
afterAll(async () => h?.stop());

describe('ambang posting & review sebagian', () => {
  it('semua temuan di bawah minConfidence → tidak ada komentar inline, ditahan di dashboard; diff terpotong → "Review sebagian"', async () => {
    // fake agent memberi confidence 0.9 → ambang 0.95 menahan semuanya; diff dibatasi supaya terpotong
    await h.db.doc('settings/global').update({ minConfidence: 0.95, maxDiffBytes: 200 });
    // keyakinan rendah dari reviewer & validator (penanda fake di deskripsi PR)
    h.mock.repos.get('tim/sample-repo')!.prs.get(1)!.body = 'FAKE_LOW_CONF';
    await h.startMachine({ agents: ['claude'] });
    await h.comment('lapor @chefjuno');
    const done = await h.waitJob((j) => j.type === 'review' && j.status === 'posted');

    expect(done.data.config).toMatchObject({ minConfidence: 0.95, maxPostPriority: 'P2' });
    expect(done.data.result.meta.diffTruncated).toBe(true);
    expect(done.data.result.reviewCompletion).toBe('incomplete');
    expect(done.data.result.effectiveScore).toBeLessThanOrEqual(3);
    expect(done.data.result.held.length).toBeGreaterThan(0);
    expect(done.data.result.held.every((f: { heldReason: string }) => f.heldReason === 'confidence')).toBe(true);
    expect(done.data.result.postedInline).toBe(0);
    expect(h.mock.calls('POST', /\/pulls\/1\/reviews$/)).toHaveLength(0);

    const summary = h.mock.summaryComments('tim/sample-repo', 1)[0].body;
    expect(summary).toContain('⚠️ Review sebagian');
    expect(summary).toContain('dipotong');
    expect(summary).toMatch(/\d+ temuan dengan keyakinan rendah/);
    expect(summary).not.toContain('Bersih. Merge.');

    const findings = await h.db.collection('findings').where('jobId', '==', done.id).get();
    expect(findings.size).toBe(done.data.result.held.length);
    expect(
      findings.docs.every(
        (d) => d.get('held') === 'confidence' && d.get('postedInline') === false && d.get('confidence') < 0.95,
      ),
    ).toBe(true);
  });
});
