import { describe, expect, it } from 'vitest';
import { withRepoLock } from '../../src/jobs/git.js';
import { clampConcurrency } from '../../src/daemon.js';

describe('kapasitas & kunci repo', () => {
  it('kapasitas mesin dibatasi 1–4, nilai aneh → 1', () => {
    expect(clampConcurrency(2)).toBe(2);
    expect(clampConcurrency(9)).toBe(4);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(undefined)).toBe(1);
    expect(clampConcurrency('3')).toBe(3);
    expect(clampConcurrency(2.7)).toBe(2);
  });

  it('operasi git di repo yang sama bergiliran; repo berbeda tetap paralel; error tidak mengunci selamanya', async () => {
    const log: string[] = [];
    const op = (repo: string, name: string, ms: number) =>
      withRepoLock(repo, async () => {
        log.push(`${name}:mulai`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${name}:selesai`);
        return name;
      });
    const res = await Promise.all([op('/r/a', 'a1', 60), op('/r/a', 'a2', 10), op('/r/b', 'b1', 10)]);
    expect(res).toEqual(['a1', 'a2', 'b1']);
    // a2 baru mulai setelah a1 selesai; b1 (repo lain) tidak menunggu a1
    expect(log.indexOf('a2:mulai')).toBeGreaterThan(log.indexOf('a1:selesai'));
    expect(log.indexOf('b1:selesai')).toBeLessThan(log.indexOf('a1:selesai'));
    await expect(withRepoLock('/r/a', async () => Promise.reject(new Error('gagal')))).rejects.toThrow('gagal');
    expect(await withRepoLock('/r/a', async () => 'lanjut')).toBe('lanjut');
  });
});
