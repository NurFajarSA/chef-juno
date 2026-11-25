import type { FindingRow, JobRow } from './rows';

const WIB = 7 * 3600_000;
/** 'YYYY-MM-DD' di zona Asia/Jakarta */
export const dayKey = (ms: number) => new Date(ms + WIB).toISOString().slice(0, 10);

export function dayRange(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * 86400_000));
  return out;
}

export interface Filters {
  repo: string;
  author: string;
  days: number;
}

export const inPeriod = (ms: number | null, f: Filters, now = Date.now()) => ms != null && ms >= now - f.days * 86400_000;

export function filterJobs(jobs: JobRow[], f: Filters, now = Date.now()) {
  return jobs.filter((j) => inPeriod(j.createdAtMs, f, now) && (!f.repo || j.repo === f.repo) && (!f.author || j.author === f.author));
}
export function filterFindings(fs: FindingRow[], f: Filters, now = Date.now()) {
  return fs.filter((x) => inPeriod(x.createdAtMs, f, now) && (!f.repo || x.repo === f.repo) && (!f.author || x.author === f.author));
}

/** hitung per hari */
export function perDay<T>(items: T[], days: string[], ms: (t: T) => number | null, val: (t: T) => number = () => 1): number[] {
  const idx = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const it of items) {
    const m = ms(it);
    if (m == null) continue;
    const i = idx.get(dayKey(m));
    if (i !== undefined) out[i] += val(it);
  }
  return out;
}

export function topBy<T>(items: T[], key: (t: T) => string, n = 3): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export const decided = (f: FindingRow) => f.outcome !== 'pending';
export function addressedRate(fs: FindingRow[]): number | null {
  const d = fs.filter(decided);
  return d.length ? d.filter((f) => f.outcome === 'addressed').length / d.length : null;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
