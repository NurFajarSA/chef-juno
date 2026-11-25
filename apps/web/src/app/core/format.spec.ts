import { fmtDuration, fmtInt, fmtPct, toMs } from './format';

describe('format id-ID', () => {
  it('angka & persen memakai format Indonesia', () => {
    expect(fmtInt(12345)).toBe('12.345');
    expect(fmtPct(0.5)).toBe('50%');
    expect(fmtPct(null)).toBe('—');
  });
  it('durasi', () => {
    expect(fmtDuration(151_000)).toBe('2m 31d');
    expect(fmtDuration(9_000)).toBe('9d');
  });
  it('toMs menerima Timestamp-like, Date, number', () => {
    expect(toMs({ toMillis: () => 5 })).toBe(5);
    expect(toMs(new Date(7))).toBe(7);
    expect(toMs(null)).toBeNull();
  });
});
