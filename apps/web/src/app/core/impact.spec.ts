import { DEFAULT_TARGETS, impactMetrics, prRow, type PrRow } from './impact';
import type { FindingRow, JobRow } from './rows';

const NOW = Date.parse('2026-12-20T00:00:00Z');
const D = 86400_000;
const H = 3600_000;
const job = (o: Partial<JobRow>): JobRow =>
  ({ type: 'review', status: 'posted', repo: 'tim/app', prNumber: 1, trigger: 'dev2', createdAtMs: NOW - 5 * D, totalMs: 6 * 60_000, inputTokens: 9000, outputTokens: 1000, ...o }) as JobRow;
const fin = (outcome: string, severity = 'P1'): FindingRow => ({ outcome, severity, title: 'bug ' + outcome, repo: 'tim/app', jobId: 'j' }) as FindingRow;
const pr = (o: Partial<PrRow>): PrRow => ({
  id: 'x',
  repo: 'tim/app',
  number: 1,
  author: 'dev2',
  authorIsBot: false,
  state: 'merged',
  createdAtMs: NOW - 6 * D,
  mergedAtMs: NOW - 5 * D,
  firstHumanReviewAtMs: null,
  revertedAtMs: null,
  backfilled: false,
  ...o,
});

describe('dampak', () => {
  it('lapis 1: presisi & bug P0/P1 yang diperbaiki per minggu, dengan status target', () => {
    const findings = [...Array(4)].map(() => fin('addressed')).concat([fin('disputed'), fin('addressed', 'P2'), fin('pending')]);
    const jobs = [job({}), job({ prNumber: 2 }), job({ prNumber: 3 })];
    const m = impactMetrics({ prs: [], allJobs: jobs, jobs, findings, days: 14, targets: DEFAULT_TARGETS, now: NOW });
    expect(m.precision).toBeCloseTo(5 / 6);
    expect(m.precisionStatus).toBe('met');
    expect(m.bugsCaught).toBe(4);
    expect(m.bugsPerWeek).toBe(2);
    expect(m.bugsStatus).toBe('met');
    // data belum cukup → status "nodata", bukan "missed"
    const few = impactMetrics({ prs: [], allJobs: [job({})], jobs: [job({})], findings: [fin('addressed')], days: 14, targets: DEFAULT_TARGETS, now: NOW });
    expect(few.precisionStatus).toBe('nodata');
    expect(few.bugsStatus).toBe('nodata');
  });

  it('lapis 2: adopsi PR yang di-merge, pemakaian ulang, feedback vs review manusia pertama', () => {
    const jobs = [job({ prNumber: 1, trigger: 'dev2' }), job({ prNumber: 2, trigger: 'dev2' }), job({ prNumber: 3, trigger: 'dev3' })];
    const prs = [
      pr({ number: 1, firstHumanReviewAtMs: NOW - 6 * D + 2 * H }),
      pr({ number: 2 }),
      pr({ number: 9, firstHumanReviewAtMs: NOW - 6 * D + 4 * H }),
      pr({ number: 10, author: 'renovate[bot]', authorIsBot: true }), // bot tidak dihitung
      pr({ number: 11, mergedAtMs: NOW - 40 * D }), // di luar periode
    ];
    const m = impactMetrics({ prs, allJobs: jobs, jobs, findings: [], days: 14, targets: DEFAULT_TARGETS, now: NOW });
    expect(m.mergedPrs).toBe(3);
    expect(m.reviewedMerged).toBe(2);
    expect(m.adoption).toBeCloseTo(2 / 3);
    expect([m.callers, m.repeatCallers, m.reuse]).toEqual([2, 1, 0.5]);
    expect(m.reuseStatus).toBe('missed');
    expect(m.feedbackMedianMin).toBe(6);
    expect(m.feedbackStatus).toBe('met');
    expect(m.humanReviewMedianMin).toBe(120); // median (persentil 50, nilai bawah) dari 2 jam dan 4 jam
  });

  it('lapis 3: revert PR yang direview vs tidak, baseline sebelum pilot vs sekarang, token per temuan berguna', () => {
    const jobs = [job({ prNumber: 1, createdAtMs: NOW - 5 * D })];
    const prs = [
      pr({ number: 1 }),
      pr({ number: 2, revertedAtMs: NOW - 2 * D }),
      pr({ number: 3 }),
      // sebelum pilot (baseline): 2 PR, 1 di-revert, cycle 10 jam
      pr({ number: 50, createdAtMs: NOW - 12 * D - 10 * H, mergedAtMs: NOW - 12 * D, revertedAtMs: NOW - 11 * D }),
      pr({ number: 51, createdAtMs: NOW - 13 * D - 10 * H, mergedAtMs: NOW - 13 * D }),
    ];
    const m = impactMetrics({ prs, allJobs: jobs, jobs, findings: [fin('addressed'), fin('addressed')], days: 14, targets: DEFAULT_TARGETS, now: NOW });
    expect(m.revertRateReviewed).toBe(0);
    // sejak pilot (review pertama 5 hari lalu): tidak direview #2, #3 → yang di-revert #2; #50/#51 masuk baseline
    expect(m.revertRateNotReviewed).toBeCloseTo(0.5);
    expect(m.notReviewedMerged).toBe(2);
    expect(m.current.merged).toBe(3);
    expect(m.baseline).toMatchObject({ merged: 2, revertRate: 0.5, cycleMedianH: 10 });
    expect(m.tokensPerUseful).toBe(5000);
  });

  it('prRow membaca dokumen prs', () => {
    const r = prRow('1_7', { repoFullName: 'tim/app', number: 7, author: 'dev3', state: 'merged', authorIsBot: false, backfilled: true });
    expect(r).toMatchObject({ repo: 'tim/app', number: 7, state: 'merged', backfilled: true, mergedAtMs: null });
  });
});
