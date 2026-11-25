import type { DocumentData } from 'firebase/firestore';
import type { FindingRow, JobRow } from './rows';
import { toMs } from './format';
import { percentile } from './cost';

/** Catatan PR (koleksi `prs`): semua PR di repo terpasang, juga yang tidak direview Chef Juno. */
export interface PrRow {
  id: string;
  repo: string;
  number: number;
  author: string;
  authorIsBot: boolean;
  state: 'open' | 'closed' | 'merged';
  createdAtMs: number | null;
  mergedAtMs: number | null;
  firstHumanReviewAtMs: number | null;
  revertedAtMs: number | null;
  backfilled: boolean;
}

export function prRow(id: string, d: DocumentData): PrRow {
  return {
    id,
    repo: String(d['repoFullName'] ?? ''),
    number: Number(d['number'] ?? 0),
    author: String(d['author'] ?? ''),
    authorIsBot: d['authorIsBot'] === true,
    state: d['state'] === 'merged' ? 'merged' : d['state'] === 'closed' ? 'closed' : 'open',
    createdAtMs: toMs(d['createdAt']),
    mergedAtMs: toMs(d['mergedAt']),
    firstHumanReviewAtMs: toMs(d['firstHumanReviewAt']),
    revertedAtMs: toMs(d['revertedAt']),
    backfilled: d['backfilled'] === true,
  };
}

/** Target pilot (bisa diubah admin; disimpan di settings.impactTargets). */
export interface ImpactTargets {
  /** presisi = diperbaiki / (diperbaiki + dibantah) */
  precision: number;
  /** bug P0/P1 yang diperbaiki sebelum merge, per minggu */
  bugsPerWeek: number;
  /** developer yang memanggil Chef Juno di ≥2 PR / developer yang pernah memanggil */
  reuse: number;
  /** median menit sampai komentar Chef Juno tampil di PR */
  feedbackMinutes: number;
}
export const DEFAULT_TARGETS: ImpactTargets = { precision: 0.6, bugsPerWeek: 1, reuse: 0.7, feedbackMinutes: 15 };

export type TargetStatus = 'met' | 'missed' | 'nodata';

export interface ImpactMetrics {
  days: number;
  /** review pertama Chef Juno (awal pilot) */
  pilotStartMs: number | null;
  reviews: number;
  // lapis 1 — bisa dipercaya?
  addressed: number;
  disputed: number;
  precision: number | null;
  precisionStatus: TargetStatus;
  bugsCaught: number;
  bugsPerWeek: number | null;
  bugsStatus: TargetStatus;
  bugExamples: { title: string; severity: string; repo: string; jobId: string }[];
  // lapis 2 — dipakai tim?
  mergedPrs: number;
  reviewedMerged: number;
  adoption: number | null;
  callers: number;
  repeatCallers: number;
  reuse: number | null;
  reuseStatus: TargetStatus;
  feedbackMedianMin: number | null;
  feedbackStatus: TargetStatus;
  humanReviewMedianMin: number | null;
  // lapis 3 — kualitas membaik?
  revertRateReviewed: number | null;
  revertRateNotReviewed: number | null;
  revertedReviewed: number;
  revertedNotReviewed: number;
  notReviewedMerged: number;
  baseline: PeriodStats | null;
  current: PeriodStats;
  tokensPerUseful: number | null;
}

export interface PeriodStats {
  merged: number;
  revertRate: number | null;
  cycleMedianH: number | null;
  firstHumanReviewMedianH: number | null;
}

const DAY = 86400_000;
const median = (xs: number[]) => percentile(xs, 0.5);

function periodStats(prs: PrRow[]): PeriodStats {
  const merged = prs.filter((p) => p.state === 'merged' && !p.authorIsBot && p.mergedAtMs != null);
  const cycle = merged.filter((p) => p.createdAtMs != null).map((p) => (p.mergedAtMs! - p.createdAtMs!) / 3600_000);
  const fhr = merged
    .filter((p) => p.firstHumanReviewAtMs != null && p.createdAtMs != null)
    .map((p) => (p.firstHumanReviewAtMs! - p.createdAtMs!) / 3600_000)
    .filter((h) => h >= 0);
  return {
    merged: merged.length,
    revertRate: merged.length ? merged.filter((p) => p.revertedAtMs != null).length / merged.length : null,
    cycleMedianH: median(cycle),
    firstHumanReviewMedianH: median(fhr),
  };
}

const status = (v: number | null, ok: (v: number) => boolean, enough: boolean): TargetStatus =>
  v == null || !enough ? 'nodata' : ok(v) ? 'met' : 'missed';

/**
 * Dampak dalam tiga lapis: (1) temuan bisa dipercaya, (2) dipakai tim, (3) kualitas membaik — dibanding target pilot
 * dan periode sebelum pilot (baseline dari riwayat PR).
 */
export function impactMetrics(o: {
  prs: PrRow[];
  /** semua review (untuk awal pilot & atribusi PR yang direview) */
  allJobs: JobRow[];
  /** review di periode & filter */
  jobs: JobRow[];
  findings: FindingRow[];
  days: number;
  targets: ImpactTargets;
  now?: number;
}): ImpactMetrics {
  const now = o.now ?? Date.now();
  const from = now - o.days * DAY;
  const reviewsAll = o.allJobs.filter((j) => j.type === 'review' && j.status === 'posted' && j.createdAtMs != null);
  const pilotStartMs = reviewsAll.length ? Math.min(...reviewsAll.map((j) => j.createdAtMs!)) : null;
  const reviewedKeys = new Set(reviewsAll.map((j) => `${j.repo}#${j.prNumber}`));
  const posted = o.jobs.filter((j) => j.type === 'review' && j.status === 'posted');

  // lapis 1
  const decided = o.findings.filter((f) => f.outcome === 'addressed' || f.outcome === 'disputed');
  const addressed = decided.filter((f) => f.outcome === 'addressed').length;
  const disputed = decided.length - addressed;
  const precision = decided.length ? addressed / decided.length : null;
  const bugs = o.findings.filter((f) => f.outcome === 'addressed' && (f.severity === 'P0' || f.severity === 'P1'));
  const weeks = Math.max(1, o.days / 7);
  const bugsPerWeek = o.findings.length ? bugs.length / weeks : null;

  // lapis 2 — PR yang di-merge sejak pilot dimulai (dan dalam periode); sebelum pilot = baseline
  const start = Math.max(from, pilotStartMs ?? from);
  const inPeriod = o.prs.filter((p) => p.mergedAtMs != null && p.mergedAtMs >= start && !p.authorIsBot && p.state === 'merged');
  const reviewedMerged = inPeriod.filter((p) => reviewedKeys.has(`${p.repo}#${p.number}`));
  const byCaller = new Map<string, Set<string>>();
  for (const j of posted) if (j.trigger) byCaller.set(j.trigger, (byCaller.get(j.trigger) ?? new Set()).add(`${j.repo}#${j.prNumber}`));
  const callers = byCaller.size;
  const repeatCallers = [...byCaller.values()].filter((s) => s.size >= 2).length;
  const reuse = callers ? repeatCallers / callers : null;
  const feedbackMedianMin = median(posted.map((j) => j.totalMs).filter((x): x is number => x != null && x >= 0)) ;
  const fhr = inPeriod
    .filter((p) => p.firstHumanReviewAtMs != null && p.createdAtMs != null)
    .map((p) => (p.firstHumanReviewAtMs! - p.createdAtMs!) / 60_000)
    .filter((m) => m >= 0);

  // lapis 3
  const notReviewed = inPeriod.filter((p) => !reviewedKeys.has(`${p.repo}#${p.number}`));
  const revertedReviewed = reviewedMerged.filter((p) => p.revertedAtMs != null).length;
  const revertedNotReviewed = notReviewed.filter((p) => p.revertedAtMs != null).length;
  const before = pilotStartMs != null ? o.prs.filter((p) => p.mergedAtMs != null && p.mergedAtMs < pilotStartMs && p.mergedAtMs >= pilotStartMs - o.days * DAY) : [];
  const baseline = before.length ? periodStats(before) : null;
  const tokens = posted.reduce((a, j) => a + (j.inputTokens ?? 0) + (j.outputTokens ?? 0), 0);

  return {
    days: o.days,
    pilotStartMs,
    reviews: posted.length,
    addressed,
    disputed,
    precision,
    precisionStatus: status(precision, (v) => v >= o.targets.precision, decided.length >= 5),
    bugsCaught: bugs.length,
    bugsPerWeek,
    bugsStatus: status(bugsPerWeek, (v) => v >= o.targets.bugsPerWeek, posted.length >= 3),
    bugExamples: bugs.slice(0, 5).map((f) => ({ title: f.title, severity: f.severity, repo: f.repo, jobId: f.jobId })),
    mergedPrs: inPeriod.length,
    reviewedMerged: reviewedMerged.length,
    adoption: inPeriod.length ? reviewedMerged.length / inPeriod.length : null,
    callers,
    repeatCallers,
    reuse,
    reuseStatus: status(reuse, (v) => v >= o.targets.reuse, callers >= 2),
    feedbackMedianMin: feedbackMedianMin == null ? null : feedbackMedianMin / 60_000,
    feedbackStatus: status(feedbackMedianMin == null ? null : feedbackMedianMin / 60_000, (v) => v <= o.targets.feedbackMinutes, posted.length >= 3),
    humanReviewMedianMin: median(fhr),
    revertRateReviewed: reviewedMerged.length ? revertedReviewed / reviewedMerged.length : null,
    revertRateNotReviewed: notReviewed.length ? revertedNotReviewed / notReviewed.length : null,
    revertedReviewed,
    revertedNotReviewed,
    notReviewedMerged: notReviewed.length,
    baseline,
    current: periodStats(inPeriod),
    tokensPerUseful: addressed ? tokens / addressed : null,
  };
}
