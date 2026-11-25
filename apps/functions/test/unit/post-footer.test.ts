import { describe, expect, it } from 'vitest';
import { footerModel } from '../../src/post.js';

describe('model di footer ringkasan', () => {
  it('mode mendalam: model unik dari langkah yang berhasil, urut kemunculan', () => {
    const passes = [
      { model: 'sonnet', ok: true },
      { model: 'sonnet', ok: true },
      { model: 'opus', ok: true },
      { model: 'fable', ok: false },
    ];
    expect(footerModel({ model: null, passes })).toBe('sonnet + opus');
  });
  it('hasil lama tanpa daftar langkah → model dari meta', () => {
    expect(footerModel({ model: 'sonnet' })).toBe('sonnet');
    expect(footerModel(undefined)).toBeNull();
  });
});
