import { describe, it, expect } from 'vitest';
import { previousWeek, reportId, weekRangeMs, weekStartJakarta } from './time.js';

describe('weekStartJakarta (Senin, Asia/Jakarta)', () => {
  it('Minggu 2026-11-22T20:00Z sudah Senin 2026-11-23 di WIB', () => {
    expect(weekStartJakarta(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23');
  });

  it('batas tengah malam WIB Minggu → Senin', () => {
    expect(weekStartJakarta(new Date('2026-11-22T16:59:59.999Z'))).toBe('2026-11-16');
    expect(weekStartJakarta(new Date('2026-11-22T17:00:00Z'))).toBe('2026-11-23');
  });

  it('hari-hari dalam satu minggu memberi Senin yang sama', () => {
    for (const iso of [
      '2026-11-16T00:00:00+07:00',
      '2026-11-18T12:00:00Z',
      '2026-11-21T23:00:00+07:00',
      '2026-11-22T23:59:00+07:00',
    ])
      expect(weekStartJakarta(new Date(iso)), iso).toBe('2026-11-16');
  });

  it('melintasi batas bulan & tahun', () => {
    expect(weekStartJakarta(new Date('2027-01-01T10:00:00+07:00'))).toBe('2026-12-28');
    expect(weekStartJakarta(new Date('2026-12-01T10:00:00+07:00'))).toBe('2026-11-30');
  });
});

describe('weekRangeMs & previousWeek', () => {
  it('rentang [Senin 00:00 WIB, Senin berikutnya)', () => {
    const r = weekRangeMs('2026-11-23');
    expect(new Date(r.start).toISOString()).toBe('2026-11-22T17:00:00.000Z');
    expect(r.end - r.start).toBe(7 * 86_400_000);
    expect(weekStartJakarta(new Date(r.start))).toBe('2026-11-23');
    expect(weekStartJakarta(new Date(r.end - 1))).toBe('2026-11-23');
    expect(weekStartJakarta(new Date(r.end))).toBe('2026-11-30');
  });

  it('previousWeek', () => {
    expect(previousWeek('2026-11-23')).toBe('2026-11-16');
    expect(previousWeek('2026-12-07')).toBe('2026-11-30');
    expect(previousWeek('2027-01-04')).toBe('2026-12-28');
  });
});

describe('reportId (§12.11)', () => {
  it('pribadi dan tim', () => {
    expect(reportId('2026-11-16', 'dev2')).toBe('2026-11-16_u_dev2');
    expect(reportId('2026-11-16', null)).toBe('2026-11-16_team');
  });

  it('login kosong dianggap tim', () => {
    expect(reportId('2026-11-16', '')).toBe('2026-11-16_team');
  });
});
