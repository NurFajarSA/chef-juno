import type { Timestamp } from 'firebase/firestore';

type TsLike = Timestamp | { toMillis(): number } | Date | number | null | undefined;

export function toMs(t: TsLike): number | null {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (typeof (t as { toMillis?: unknown }).toMillis === 'function') return (t as { toMillis(): number }).toMillis();
  return null;
}

const dtf = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const df = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });
const nf = new Intl.NumberFormat('id-ID');
const rtf = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

export const fmtDateTime = (t: TsLike) => {
  const ms = toMs(t);
  return ms == null ? '—' : dtf.format(ms);
};
export const fmtDate = (t: TsLike) => {
  const ms = toMs(t);
  return ms == null ? '—' : df.format(ms);
};
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? '—' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(n);
export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const fmtPct = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : `${fmtNum(n * 100, 0)}%`);

export function fmtRelative(t: TsLike, now = Date.now()): string {
  const ms = toMs(t);
  if (ms == null) return '—';
  const diff = Math.round((ms - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}d` : `${s}d`;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Antre',
  claimed: 'Diambil',
  running: 'Berjalan',
  completed: 'Selesai',
  posted: 'Diposting',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};
export const OUTCOME_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  addressed: 'Diperbaiki',
  ignored: 'Diabaikan',
  disputed: 'Dibantah',
  accepted_by_merge: 'Diterima (merge)',
};
export const CATEGORY_LABEL: Record<string, string> = {
  bug: 'Bug',
  security: 'Keamanan',
  performance: 'Performa',
  maintainability: 'Keterawatan',
  test: 'Test',
};
