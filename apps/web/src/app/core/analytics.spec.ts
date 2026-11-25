import { addressedRate, dayKey, dayRange, perDay, toCsv, topBy } from './analytics';
import type { FindingRow } from './rows';

describe('analytics helpers', () => {
  it('dayKey memakai zona WIB', () => {
    expect(dayKey(Date.parse('2026-11-22T20:00:00Z'))).toBe('2026-11-23');
  });
  it('dayRange & perDay', () => {
    const now = Date.parse('2026-11-24T05:00:00Z');
    const days = dayRange(3, now);
    expect(days).toEqual(['2026-11-22', '2026-11-23', '2026-11-24']);
    expect(perDay([now, now, now - 86400_000], days, (x) => x)).toEqual([0, 1, 2]);
  });
  it('topBy & addressedRate & toCsv', () => {
    expect(topBy(['a', 'b', 'a'], (x) => x)).toEqual([{ key: 'a', count: 2 }, { key: 'b', count: 1 }]);
    const f = (outcome: string) => ({ outcome }) as FindingRow;
    expect(addressedRate([f('addressed'), f('disputed'), f('pending')])).toBe(0.5);
    expect(addressedRate([f('pending')])).toBeNull();
    expect(toCsv([{ a: 'x,y', b: 1 }])).toBe('a,b\n"x,y",1');
  });
});

import { byMode, passCost, percentile, priceFor, timing, tokensPerReview, usageByModel, usageByRole } from './cost';
import { jobRow, type JobRow, type PassRow } from './rows';

const pass = (o: Partial<PassRow>): PassRow => ({ role: 'review', label: 'review', model: 'claude-sonnet-5-5', agent: 'claude', ok: true, durationMs: 60_000, inputTokens: 10_000, outputTokens: 1_000, ...o });
const job = (o: Partial<JobRow>): JobRow =>
  ({ type: 'review', status: 'posted', mode: 'standard', passes: [pass({})], inputTokens: 10_000, outputTokens: 1_000, durationMs: 60_000, queueMs: 5_000, totalMs: 90_000, ...o }) as JobRow;

describe('biaya & waktu', () => {
  it('harga: kunci persis, lalu alias terpanjang yang termuat di ID model; tanpa harga → null', () => {
    const prices = { sonnet: { in: 3, out: 15 }, 'claude-sonnet-5-5': { in: 2, out: 10 }, opus: { in: 0, out: 0 } };
    expect(priceFor('claude-sonnet-5-5', prices)).toEqual({ in: 2, out: 10 });
    expect(priceFor('claude-sonnet-4-6', prices)).toEqual({ in: 3, out: 15 });
    expect(priceFor('claude-opus-5-5', prices)).toBeNull(); // harga 0 = belum diatur
    expect(priceFor(null, prices)).toBeNull();
    // 10k masuk × $3/1M + 1k keluar × $15/1M = 0.03 + 0.015
    expect(passCost(pass({ model: 'claude-sonnet-4-6' }), prices)).toBeCloseTo(0.045, 6);
    expect(passCost(pass({ model: 'haiku' }), prices)).toBeNull();
  });
  it('rincian per model & peran: panggilan, gagal, token, durasi rata-rata (yang sukses), biaya hanya bila berharga', () => {
    const jobs = [
      job({ mode: 'deep', passes: [pass({ role: 'triage', model: 'haiku', inputTokens: 2_000, outputTokens: 100 }), pass({ role: 'lens' }), pass({ role: 'lens', ok: false, durationMs: 1 }), pass({ role: 'validate', model: 'opus', inputTokens: 20_000 })] }),
      job({}),
    ];
    const m = usageByModel(jobs, { sonnet: { in: 3, out: 15 } });
    const sonnet = m.find((x) => x.key === 'claude-sonnet-5-5')!;
    expect(sonnet).toMatchObject({ calls: 3, failed: 1, inputTokens: 30_000, outputTokens: 3_000, avgDurationMs: 60_000, priced: 3 });
    expect(sonnet.detail).toEqual(['Putaran spesialis', 'Review standar']);
    expect(m.find((x) => x.key === 'opus')!.cost).toBeNull();
    expect(m[0].key).toBe('claude-sonnet-5-5'); // urut token terbanyak
    const roles = usageByRole(jobs, {});
    expect(roles.find((x) => x.key === 'lens')).toMatchObject({ calls: 2, failed: 1 });
  });
  it('waktu: median/p90 kerja agent, antre, total sampai diposting; per mode', () => {
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.9)).toBe(100);
    expect(percentile([], 0.5)).toBeNull();
    const jobs = [job({ durationMs: 60_000, totalMs: 80_000 }), job({ durationMs: 240_000, totalMs: 300_000, mode: 'deep', inputTokens: 50_000, outputTokens: 5_000, passes: [pass({}), pass({}), pass({})] }), job({ status: 'failed' })];
    expect(timing(jobs)).toMatchObject({ reviews: 2, medianAgentMs: 60_000, p90AgentMs: 240_000, medianQueueMs: 5_000, medianTotalMs: 80_000 });
    const [std, deep] = byMode(jobs);
    expect(std).toMatchObject({ mode: 'standard', reviews: 1, avgTokens: 11_000, avgCalls: 1 });
    expect(deep).toMatchObject({ mode: 'deep', reviews: 1, avgTokens: 55_000, avgCalls: 3 });
    // mode tujuan (satu agent) dihitung terpisah supaya bisa dibandingkan dengan pipeline lama
    expect(byMode([job({ mode: 'goal', inputTokens: 30_000, outputTokens: 3_000 })])[2]).toMatchObject({ mode: 'goal', reviews: 1, avgTokens: 33_000, avgCalls: 1 });
  });
  it('review lama tanpa data token/putaran tidak ikut menurunkan rata-rata', () => {
    const old = job({ passes: [], inputTokens: null, outputTokens: null });
    const jobs = [job({}), old, old];
    expect(tokensPerReview(jobs)).toEqual({ reviews: 1, avg: 11_000 });
    expect(byMode(jobs)[0]).toMatchObject({ reviews: 3, avgTokens: 11_000, avgCalls: 1 });
  });
  it('job dengan passes kosong (tanpa panggilan model) dihitung 0 panggilan; job lama tanpa passes → satu putaran dari meta', () => {
    const none = jobRow('a', { type: 'index', status: 'completed', result: { meta: { agent: 'claude', model: null, durationMs: 5000, passes: [] } } });
    expect(none.passes).toEqual([]);
    const old = jobRow('b', { type: 'learn', status: 'completed', result: { meta: { agent: 'claude', model: 'claude-haiku-5-5', durationMs: 9000 } } });
    expect(old.passes).toEqual([{ role: 'learn', label: 'learn', model: 'claude-haiku-5-5', agent: 'claude', ok: true, durationMs: 9000, inputTokens: null, outputTokens: null }]);
    const idx = jobRow('c', { type: 'index', status: 'completed', result: { meta: { agent: 'claude', passes: [{ role: 'index', label: 'index-1', model: 'claude-haiku-5-5', ok: true, durationMs: 40000, inputTokens: 9000, outputTokens: 2500 }] } } });
    expect(usageByModel([idx], {})[0]).toMatchObject({ key: 'claude-haiku-5-5', calls: 1, inputTokens: 9000, outputTokens: 2500, detail: ['Ringkasan modul'] });
  });
});

