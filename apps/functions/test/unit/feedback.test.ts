import { describe, expect, it } from 'vitest';
import { codeChangedNear } from '../../src/feedback.js';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,2 +10,3 @@',
  ' x',
  '-y',
  '+y2',
  '+z',
].join('\n');

describe('codeChangedNear (kode di sekitar temuan berubah setelah review, ±3 baris)', () => {
  it('berubah di dekat baris', () => {
    expect(codeChangedNear(diff, 'src/a.ts', 12)).toBe(true);
    expect(codeChangedNear(diff, 'src/a.ts', 7)).toBe(true);
  });
  it('jauh dari perubahan / file lain / diff kosong', () => {
    expect(codeChangedNear(diff, 'src/a.ts', 40)).toBe(false);
    expect(codeChangedNear(diff, 'src/b.ts', 10)).toBe(false);
    expect(codeChangedNear('', 'src/a.ts', 10)).toBe(false);
  });
});
