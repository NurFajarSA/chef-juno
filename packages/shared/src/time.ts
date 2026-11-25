const JAKARTA_OFFSET_MS = 7 * 3600_000; // Asia/Jakarta UTC+7, tanpa DST

/** Senin (Asia/Jakarta) dari minggu yang memuat `date`, sebagai 'YYYY-MM-DD'. */
export function weekStartJakarta(date: Date): string {
  const local = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = Senin
  local.setUTCDate(local.getUTCDate() - dow);
  return local.toISOString().slice(0, 10);
}

/** Rentang epoch ms [start, end) untuk minggu yang dimulai weekStart (YYYY-MM-DD, Senin WIB). */
export function weekRangeMs(weekStart: string): { start: number; end: number } {
  const start = Date.parse(`${weekStart}T00:00:00+07:00`);
  return { start, end: start + 7 * 86400_000 };
}

export function previousWeek(weekStart: string): string {
  const { start } = weekRangeMs(weekStart);
  return weekStartJakarta(new Date(start - 86400_000));
}

export const reportId = (weekStart: string, login: string | null) =>
  login ? `${weekStart}_u_${login}` : `${weekStart}_team`;
