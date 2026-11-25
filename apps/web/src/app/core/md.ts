/**
 * Markdown sangat kecil & aman untuk ringkasan modul (keluaran agent = tidak dipercaya):
 * escape HTML dulu, baru dukung `code`, **tebal**, daftar "- ", dan paragraf.
 */
export function miniMarkdown(src: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let listTag: 'ul' | 'ol' = 'ul';
  const flush = () => {
    if (list.length) out.push(`<${listTag}>${list.map((l) => `<li>${l}</li>`).join('')}</${listTag}>`);
    list = [];
  };
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list.length && tag !== listTag) flush();
      listTag = tag;
      list.push(miniInline((ul ?? ol)![1]));
      continue;
    }
    flush();
    if (h) out.push(`<h${h[1].length + 2}>${miniInline(h[2])}</h${h[1].length + 2}>`);
    else if (line) out.push(`<p>${miniInline(line)}</p>`);
  }
  flush();
  return out.join('');
}

/** Varian inline (tanpa <p>/<ul>) untuk teks satu baris: judul temuan, aturan, pelajaran. Tetap escape dulu. */
export function miniInline(src: string): string {
  const esc = String(src ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
}
