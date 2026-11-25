import { miniMarkdown } from './md';

describe('miniMarkdown', () => {
  it('escape HTML dulu (tidak ada tag mentah dari agent)', () => {
    expect(miniMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
  it('code, tebal, dan daftar', () => {
    expect(miniMarkdown('Pakai `fetchUser` **selalu**\n- a\n- b')).toBe('<p>Pakai <code>fetchUser</code> <strong>selalu</strong></p><ul><li>a</li><li>b</li></ul>');
  });
});

import { miniInline } from './md';
describe('miniInline', () => {
  it('code & tebal tanpa paragraf, tetap escape', () => {
    expect(miniInline('Pakai `with_retry` <b>x</b>')).toBe('Pakai <code>with_retry</code> &lt;b&gt;x&lt;/b&gt;');
  });
});

describe('miniMarkdown (editor)', () => {
  it('heading, miring, daftar bernomor', () => {
    expect(miniMarkdown('# Judul\nteks *miring*\n1. satu\n2. dua')).toBe('<h3>Judul</h3><p>teks <em>miring</em></p><ol><li>satu</li><li>dua</li></ol>');
  });
});
