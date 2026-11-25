import { describe, expect, it } from 'vitest';
import { diffLines, diffStats, sideBySide } from './textdiff.js';

describe('diffLines / sideBySide', () => {
  it('teks sama → semua same', () => {
    expect(diffLines('a\nb', 'a\nb').every((o) => o.type === 'same')).toBe(true);
  });
  it('tambah, hapus, ubah baris', () => {
    const ops = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(ops.map((o) => `${o.type}:${o.text}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c', 'add:d']);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
    const rows = sideBySide(ops);
    expect(rows[1]).toEqual({ left: { n: 2, text: 'b', type: 'del' }, right: { n: 2, text: 'B', type: 'add' } });
    expect(rows.at(-1)).toEqual({ left: null, right: { n: 4, text: 'd', type: 'add' } });
  });
  it('kosong ke isi', () => {
    expect(diffStats(diffLines('', 'x\ny'))).toEqual({ added: 2, removed: 1 });
  });
});
