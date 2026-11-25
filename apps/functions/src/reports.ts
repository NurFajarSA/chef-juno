import { onSchedule } from 'firebase-functions/scheduler';
import { logger } from 'firebase-functions';
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import {
  CATEGORIES,
  SEVERITIES,
  RecapOutputSchema,
  previousWeek,
  reportId,
  weekRangeMs,
  weekStartJakarta,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { createJob } from './jobs.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- dokumen dibaca bebas untuk agregasi */

interface Agg {
  login: string;
  prs: Set<string>;
  reviews: number;
  scoreSum: number;
  scored: number;
  findings: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  decided: number;
  addressed: number;
}

const zero = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
const newAgg = (login: string): Agg => ({
  login,
  prs: new Set(),
  reviews: 0,
  scoreSum: 0,
  scored: 0,
  findings: 0,
  bySeverity: zero(SEVERITIES),
  byCategory: zero(CATEGORIES),
  decided: 0,
  addressed: 0,
});
const ms = (t: any) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : null);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function aggregate(jobs: any[], findings: any[], start: number, end: number): Map<string, Agg> {
  const m = new Map<string, Agg>();
  const get = (l: string) => {
    if (!m.has(l)) m.set(l, newAgg(l));
    return m.get(l)!;
  };
  for (const j of jobs) {
    const t = ms(j.createdAt);
    if (t == null || t < start || t >= end || j.type !== 'review' || j.status !== 'posted') continue;
    const a = get(String(j.pr?.authorLogin ?? ''));
    a.reviews++;
    a.prs.add(`${j.repo?.fullName}#${j.pr?.number}`);
    if (typeof j.result?.score === 'number') {
      a.scoreSum += j.result.score;
      a.scored++;
    }
  }
  for (const f of findings) {
    const t = ms(f.createdAt);
    if (t == null || t < start || t >= end) continue;
    const a = get(String(f.prAuthorLogin ?? ''));
    a.findings++;
    a.bySeverity[f.severity] = (a.bySeverity[f.severity] ?? 0) + 1;
    a.byCategory[f.category] = (a.byCategory[f.category] ?? 0) + 1;
    if (f.outcome && f.outcome !== 'pending') {
      a.decided++;
      if (f.outcome === 'addressed') a.addressed++;
    }
  }
  m.delete('');
  return m;
}

const summary = (a: Agg | undefined) =>
  a
    ? {
        prsReviewed: a.prs.size,
        reviews: a.reviews,
        avgScore: a.scored ? round(a.scoreSum / a.scored) : null,
        findings: a.findings,
        findingsPerPr: a.prs.size ? round(a.findings / a.prs.size) : null,
        bySeverity: a.bySeverity,
        byCategory: a.byCategory,
        addressedRate: a.decided ? round(a.addressed / a.decided) : null,
      }
    : {
        prsReviewed: 0,
        reviews: 0,
        avgScore: null,
        findings: 0,
        findingsPerPr: null,
        bySeverity: zero(SEVERITIES),
        byCategory: zero(CATEGORIES),
        addressedRate: null,
      };

const CAT_ID: Record<string, string> = {
  bug: 'bug',
  security: 'keamanan',
  performance: 'performa',
  maintainability: 'keterawatan',
  test: 'test',
};

/**
 * §6.9 — agregat minggu `weekStart` (Senin WIB) → reports/{week}_u_{login} & reports/{week}_team (tanpa LLM).
 * Fungsi murni terhadap isi Firestore; dipanggil scheduler, test, dan demo.
 */
export async function buildWeeklyReport(fs: Firestore, weekStart: string) {
  const { start, end } = weekRangeMs(weekStart);
  const w1 = previousWeek(weekStart);
  const histStart = weekRangeMs(previousWeek(previousWeek(previousWeek(w1)))).start; // 4 minggu sebelum
  const [jobsSnap, findSnap] = await Promise.all([
    fs
      .collection('jobs')
      .where('createdAt', '>=', Timestamp.fromMillis(histStart))
      .where('createdAt', '<', Timestamp.fromMillis(end))
      .get(),
    fs
      .collection('findings')
      .where('createdAt', '>=', Timestamp.fromMillis(histStart))
      .where('createdAt', '<', Timestamp.fromMillis(end))
      .get(),
  ]);
  const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const findings = findSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const cur = aggregate(jobs, findings, start, end);
  const prevRange = weekRangeMs(w1);
  const prev = aggregate(jobs, findings, prevRange.start, prevRange.end);
  const past3 = aggregate(jobs, findings, histStart + 7 * 86400_000, start); // 3 minggu sebelum minggu ini
  const logins = new Set([...cur.keys(), ...prev.keys()]);

  const batch = fs.batch();
  const members: any[] = [];
  for (const login of logins) {
    const c = summary(cur.get(login));
    const p = summary(prev.get(login));
    const h = past3.get(login);
    // Perkembangan: per kategori, minggu ini vs rata-rata 3 minggu sebelumnya
    const development: { category: string; from: number; to: number; pct: number; text: string }[] = [];
    for (const cat of CATEGORIES) {
      const before = h ? h.byCategory[cat] / 3 : 0;
      const now = c.byCategory[cat];
      if (before <= 0) continue;
      const pct = Math.round(((now - before) / before) * 100);
      if (pct === 0) continue;
      development.push({
        category: cat,
        from: round(before, 1),
        to: now,
        pct,
        text: `${CAT_ID[cat]}: ${pct < 0 ? 'turun' : 'naik'} ${Math.abs(pct)}% dibanding rata-rata 3 minggu sebelumnya`,
      });
    }
    development.sort((a, b) => a.pct - b.pct);
    const topCats = Object.entries(c.byCategory)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k]) => k);
    // Contoh baik: PR anggota lain skor ≥ 4 tanpa temuan di kategori yang sering ia salah
    const goodExamples = jobs
      .filter(
        (j: any) =>
          j.type === 'review' && j.status === 'posted' && j.pr?.authorLogin !== login && (j.result?.score ?? 0) >= 4,
      )
      .filter((j: any) => !(j.result?.findings ?? []).some((f: any) => topCats.includes(f.category)))
      .slice(0, 3)
      .map((j: any) => ({
        jobId: j.id,
        repo: j.repo?.fullName,
        pr: j.pr?.number,
        title: j.pr?.title,
        author: j.pr?.authorLogin,
        score: j.result?.score,
        url: j.pr?.htmlUrl ?? null,
      }));
    const highlights: string[] = [];
    if (development[0]?.pct < 0) highlights.push(development[0].text);
    if (c.addressedRate != null && p.addressedRate != null && c.addressedRate > p.addressedRate)
      highlights.push(
        `Temuan yang diperbaiki naik dari ${Math.round(p.addressedRate * 100)}% ke ${Math.round(c.addressedRate * 100)}%.`,
      );
    if (c.bySeverity.P0 > 0) highlights.push(`${c.bySeverity.P0} temuan P0 minggu ini. Jangan diulang.`);
    const improvement =
      p.findingsPerPr != null && c.findingsPerPr != null ? round(p.findingsPerPr - c.findingsPerPr) : null;
    const doc = {
      weekStart,
      login,
      ...c,
      prev: p,
      development,
      goodExamples,
      highlights,
      improvement,
      narrative: '',
      createdAt: FieldValue.serverTimestamp(),
    };
    batch.set(fs.doc(`reports/${reportId(weekStart, login)}`), doc, { merge: true });
    members.push({
      login,
      prsReviewed: c.prsReviewed,
      avgScore: c.avgScore,
      findings: c.findings,
      findingsPerPr: c.findingsPerPr,
      prevFindingsPerPr: p.findingsPerPr,
      addressedRate: c.addressedRate,
      improvement,
    });
    batch.set(
      fs.doc(`people/${login}`),
      {
        stats: {
          prsReviewed: c.prsReviewed,
          avgScore: c.avgScore,
          addressedRate: c.addressedRate,
          byCategory: c.byCategory,
          bySeverity: c.bySeverity,
          weekStart,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  const all = (m: Map<string, Agg>) => {
    const t = newAgg('team');
    for (const a of m.values()) {
      a.prs.forEach((x) => t.prs.add(x));
      t.reviews += a.reviews;
      t.scoreSum += a.scoreSum;
      t.scored += a.scored;
      t.findings += a.findings;
      t.decided += a.decided;
      t.addressed += a.addressed;
      for (const k of SEVERITIES) t.bySeverity[k] += a.bySeverity[k];
      for (const k of CATEGORIES) t.byCategory[k] += a.byCategory[k];
    }
    return summary(t);
  };
  // "Paling berkembang": penurunan temuan per PR terbesar (tidak ada ranking kesalahan)
  const mostImproved = members
    .filter((m) => m.improvement != null && m.improvement > 0)
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 3)
    .map((m) => ({
      login: m.login,
      improvement: m.improvement,
      text: `@${m.login}: temuan per PR turun ${m.improvement} (${m.prevFindingsPerPr} → ${m.findingsPerPr})`,
    }));
  const team = {
    weekStart,
    login: null,
    ...all(cur),
    prev: all(prev),
    members: members.sort((a, b) => a.login.localeCompare(b.login)),
    mostImproved,
    highlights: mostImproved.map((m) => m.text),
    createdAt: FieldValue.serverTimestamp(),
  };
  batch.set(fs.doc(`reports/${reportId(weekStart, null)}`), team, { merge: true });
  await batch.commit();
  return { weekStart, team, members };
}

/** Senin 08.00 WIB: rekap minggu lalu + job recap (narasi via agent langganan). */
export const weeklyRecap = onSchedule({ schedule: 'every monday 08:00', timeZone: 'Asia/Jakarta' }, async () => {
  const week = previousWeek(weekStartJakarta(new Date()));
  const r = await buildWeeklyReport(db(), week);
  await enqueueRecap(week, r.team);
  logger.info('weeklyRecap', { week, members: r.members.length });
});

export async function enqueueRecap(weekId: string, data: unknown) {
  return createJob({
    type: 'recap',
    repo: { id: 0, fullName: '-', installationId: 0 },
    recap: { weekId, login: null, data },
  });
}

/** Job recap selesai → reports/{id}.narrative (§12.3). */
export async function applyRecapResult(ref: DocumentReference, job: any) {
  const parsed = RecapOutputSchema.safeParse(job.result);
  if (!parsed.success) {
    await ref.update({ status: 'failed', error: { stage: 'parse', message: 'Hasil recap tidak sesuai schema' } });
    return;
  }
  await db()
    .doc(`reports/${reportId(job.recap.weekId, job.recap.login ?? null)}`)
    .set({ narrative: parsed.data.narrative.slice(0, 2000) }, { merge: true });
}
