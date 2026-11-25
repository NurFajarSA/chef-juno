import type { JobRow, PassRow } from './rows';

/** Harga per 1 juta token (USD) per model; kunci boleh alias (`sonnet`) atau ID lengkap (`claude-sonnet-5-5`). */
export type ModelPrices = Record<string, { in: number; out: number }>;

/** Harga untuk sebuah model: kunci persis, lalu kunci terpanjang yang termuat di ID model (huruf kecil). */
export function priceFor(model: string | null, prices: ModelPrices): { in: number; out: number } | null {
  if (!model) return null;
  const m = model.toLowerCase();
  const keys = Object.keys(prices).filter((k) => prices[k] && (prices[k].in > 0 || prices[k].out > 0));
  const exact = keys.find((k) => k.toLowerCase() === m);
  if (exact) return prices[exact];
  const partial = keys.filter((k) => k && m.includes(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return partial ? prices[partial] : null;
}

/** Estimasi setara harga API (USD); null bila harga model belum diatur atau token tidak tercatat. */
export function passCost(p: PassRow, prices: ModelPrices): number | null {
  const pr = priceFor(p.model, prices);
  if (!pr || (p.inputTokens == null && p.outputTokens == null)) return null;
  return ((p.inputTokens ?? 0) * pr.in + (p.outputTokens ?? 0) * pr.out) / 1_000_000;
}

export const allPasses = (jobs: JobRow[]) => jobs.flatMap((j) => j.passes);
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

export function percentile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

export interface UsageRow {
  key: string;
  /** model: agent pemakai; peran: model yang dipakai */
  detail: string[];
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number | null;
  /** null = sebagian/semua harga belum diatur */
  cost: number | null;
  /** jumlah panggilan yang bisa dihitung biayanya */
  priced: number;
}

function usage(passes: PassRow[], key: (p: PassRow) => string, detail: (p: PassRow) => string, prices: ModelPrices): UsageRow[] {
  const groups = new Map<string, PassRow[]>();
  for (const p of passes) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return [...groups.entries()]
    .map(([k, ps]) => {
      const costs = ps.map((p) => passCost(p, prices));
      const priced = costs.filter((c) => c != null).length;
      const durs = ps.filter((p) => p.ok && p.durationMs != null).map((p) => p.durationMs as number);
      return {
        key: k,
        detail: [...new Set(ps.map(detail).filter(Boolean))].sort(),
        calls: ps.length,
        failed: ps.filter((p) => !p.ok).length,
        inputTokens: sum(ps.map((p) => p.inputTokens)),
        outputTokens: sum(ps.map((p) => p.outputTokens)),
        avgDurationMs: durs.length ? sum(durs) / durs.length : null,
        cost: priced ? sum(costs) : null,
        priced,
      };
    })
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || b.calls - a.calls);
}

/** Rincian per model persis yang dilaporkan CLI (atau "default CLI" bila tidak dilaporkan). */
export const usageByModel = (jobs: JobRow[], prices: ModelPrices) =>
  usage(allPasses(jobs), (p) => p.model ?? 'default CLI', (p) => ROLE_NAME[p.role] ?? p.role, prices);

/** Rincian per peran agent. */
export const usageByRole = (jobs: JobRow[], prices: ModelPrices) =>
  usage(allPasses(jobs), (p) => p.role, (p) => p.model ?? 'default CLI', prices);

export const ROLE_NAME: Record<string, string> = {
  review: 'Review standar',
  triage: 'Triase',
  lens: 'Putaran spesialis',
  validate: 'Validasi / penilai',
  lead: 'Lead',
  app: 'Rencana uji aplikasi',
  index: 'Ringkasan modul',
  learn: 'Belajar dari PR',
  recap: 'Narasi rapor',
};

export interface TimingSummary {
  reviews: number;
  /** waktu kerja agent (klaim → hasil) */
  medianAgentMs: number | null;
  p90AgentMs: number | null;
  /** antre sampai diambil mesin */
  medianQueueMs: number | null;
  /** komentar pemicu sampai hasil tampil di PR */
  medianTotalMs: number | null;
  p90TotalMs: number | null;
}

export function timing(jobs: JobRow[]): TimingSummary {
  const done = jobs.filter((j) => j.type === 'review' && j.status === 'posted');
  const agent = done.map((j) => j.durationMs).filter((x): x is number => x != null);
  const queue = done.map((j) => j.queueMs).filter((x): x is number => x != null && x >= 0);
  const total = done.map((j) => j.totalMs).filter((x): x is number => x != null && x >= 0);
  return {
    reviews: done.length,
    medianAgentMs: percentile(agent, 0.5),
    p90AgentMs: percentile(agent, 0.9),
    medianQueueMs: percentile(queue, 0.5),
    medianTotalMs: percentile(total, 0.5),
    p90TotalMs: percentile(total, 0.9),
  };
}

export interface ModeRow {
  mode: 'goal' | 'standard' | 'deep';
  reviews: number;
  avgTokens: number | null;
  medianAgentMs: number | null;
  avgCalls: number | null;
}

const hasTokens = (j: JobRow) => j.inputTokens != null || j.outputTokens != null;

/** Rata-rata token per review — hanya dari review yang tercatat tokennya (review lama tanpa data tidak ikut dibagi). */
export function tokensPerReview(jobs: JobRow[]): { reviews: number; avg: number | null } {
  const js = jobs.filter((j) => j.type === 'review' && j.status === 'posted' && hasTokens(j));
  return { reviews: js.length, avg: js.length ? sum(js.map((j) => (j.inputTokens ?? 0) + (j.outputTokens ?? 0))) / js.length : null };
}

export function byMode(jobs: JobRow[]): ModeRow[] {
  const done = jobs.filter((j) => j.type === 'review' && j.status === 'posted');
  return (['standard', 'deep', 'goal'] as const).map((mode) => {
    const js = done.filter((j) => (j.mode ?? 'standard') === mode);
    // rata-rata hanya dari review yang punya datanya
    const withTok = js.filter(hasTokens);
    const withPasses = js.filter((j) => j.passes.length);
    return {
      mode,
      reviews: js.length,
      avgTokens: withTok.length ? sum(withTok.map((j) => (j.inputTokens ?? 0) + (j.outputTokens ?? 0))) / withTok.length : null,
      medianAgentMs: percentile(js.map((j) => j.durationMs).filter((x): x is number => x != null), 0.5),
      avgCalls: withPasses.length ? sum(withPasses.map((j) => j.passes.length)) / withPasses.length : null,
    };
  });
}
