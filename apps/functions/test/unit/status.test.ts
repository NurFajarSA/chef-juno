import { describe, expect, it } from 'vitest';
import { gateVerdict } from '../../src/status.js';

describe('gate commit status "Chef Juno"', () => {
  it('ada P0/P1 → FAIL; hanya P2 → PASS+NOTES; kosong → PASS', () => {
    expect(
      gateVerdict([{ severity: 'P1' }, { severity: 'P2' }, { severity: 'P2' }], { incomplete: false, score: 3 }),
    ).toEqual({
      verdict: 'FAIL',
      state: 'failure',
      description: 'FAIL · 1 P1, 2 P2 · skor 3/5',
    });
    expect(gateVerdict([{ severity: 'P2' }], { incomplete: false, score: 4 })).toEqual({
      verdict: 'PASS+NOTES',
      state: 'success',
      description: 'PASS+NOTES · 1 P2 · skor 4/5',
    });
    expect(gateVerdict([], { incomplete: false, score: 5 })).toEqual({
      verdict: 'PASS',
      state: 'success',
      description: 'PASS · skor 5/5',
    });
  });
  it('review sebagian tidak pernah lulus, walau tanpa temuan', () => {
    expect(gateVerdict([], { incomplete: true, score: 3 })).toMatchObject({ verdict: 'FAIL', state: 'failure' });
    expect(gateVerdict([], { incomplete: true, score: 3 }).description).toBe('FAIL · review sebagian · skor 3/5');
  });
});
