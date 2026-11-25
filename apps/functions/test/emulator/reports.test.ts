import { beforeAll, describe, expect, it } from 'vitest';
import { admin, clearFirestore } from '../helpers.js';
import { buildWeeklyReport } from '../../src/reports.js';
import { EXPECTED, seedReportFixture } from '../../../../scripts/seed-reports.mjs';

const W = '2026-11-16';
const { db } = admin();

beforeAll(async () => {
  await clearFirestore();
  await seedReportFixture(db, W);
  await buildWeeklyReport(db, W);
});

const rep = async (id: string) => (await db.doc(`reports/${id}`).get()).data()!;

describe('buildWeeklyReport dengan data seed berlabel', () => {
  it('rapor pribadi dev2: angka per kategori, skor, addressed rate, minggu lalu', async () => {
    const r = await rep(`${W}_u_dev2`);
    const e = EXPECTED.dev2;
    expect(r.weekStart).toBe(W);
    expect(r.prsReviewed).toBe(e.prsReviewed);
    expect(r.avgScore).toBe(e.avgScore);
    expect(r.findings).toBe(e.findings);
    expect(r.byCategory.bug).toBe(e.bug);
    expect(r.byCategory.test).toBe(e.test);
    expect(r.bySeverity).toEqual({ P0: 0, P1: 1, P2: 2 });
    expect(r.addressedRate).toBe(e.addressedRate);
    expect(r.prev.prsReviewed).toBe(e.prevPrs);
    expect(r.prev.findings).toBe(e.prevFindings);
    expect(r.prev.addressedRate).toBe(e.prevAddressedRate);
    expect(r.findingsPerPr).toBe(e.findingsPerPr);
    expect(r.prev.findingsPerPr).toBe(e.prevFindingsPerPr);
  });

  it('tren & perkembangan: bug turun 33% vs rata-rata 3 minggu sebelumnya', async () => {
    const r = await rep(`${W}_u_dev2`);
    const bug = r.development.find((d: { category: string }) => d.category === 'bug');
    expect(bug.pct).toBe(EXPECTED.dev2.bugDevPct);
    expect(bug.text).toBe('bug: turun 33% dibanding rata-rata 3 minggu sebelumnya');
    expect(r.highlights).toContain('bug: turun 33% dibanding rata-rata 3 minggu sebelumnya');
    expect(r.highlights).toContain('Temuan yang diperbaiki naik dari 17% ke 67%.');
    expect(r.improvement).toBe(EXPECTED.dev2.improvement);
  });

  it('contoh baik: PR anggota lain skor ≥ 4 tanpa temuan di kategori yang sering ia salah', async () => {
    const r = await rep(`${W}_u_dev2`);
    expect(r.goodExamples.map((g: { pr: number }) => g.pr).sort()).toEqual([191, 201]);
    expect(r.goodExamples.every((g: { author: string }) => g.author === 'dev3')).toBe(true);
  });

  it('rapor tim + papan "paling berkembang" (tanpa ranking kesalahan)', async () => {
    const t = await rep(`${W}_team`);
    expect(t.login).toBeNull();
    expect(t.prsReviewed).toBe(EXPECTED.team.prsReviewed);
    expect(t.findings).toBe(EXPECTED.team.findings);
    expect(t.avgScore).toBe(EXPECTED.team.avgScore);
    expect(t.mostImproved.map((m: { login: string }) => m.login)).toEqual(EXPECTED.team.mostImproved);
    expect(t.mostImproved[0].text).toBe('@dev2: temuan per PR turun 1.5 (3 → 1.5)');
    expect(t.members.map((m: { login: string }) => m.login)).toEqual(['dev2', 'dev3']);
    expect(Object.keys(t)).not.toContain('worst');
    const d3 = await rep(`${W}_u_dev3`);
    expect(d3.prsReviewed).toBe(EXPECTED.dev3.prsReviewed);
    expect(d3.avgScore).toBe(EXPECTED.dev3.avgScore);
    expect(d3.improvement).toBe(EXPECTED.dev3.improvement);
  });

  it('people.stats diperbarui', async () => {
    const p = (await db.doc('people/dev2').get()).data()!;
    expect(p.stats).toMatchObject({ prsReviewed: 2, avgScore: 3.5, addressedRate: 0.67, weekStart: W });
  });
});
