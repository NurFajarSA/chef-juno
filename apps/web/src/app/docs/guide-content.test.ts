import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_PAGES } from './guide-content';

// Dijalankan oleh vitest root (project unit), bukan ng test: memastikan Panduan di dashboard = docs/guide/*.md.
const dir = new URL('../../../../../docs/guide/', import.meta.url);

describe('Panduan dashboard (docs/guide)', () => {
  it('bundel sama persis dengan file Markdown (jalankan node scripts/gen-guide.mjs bila beda)', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(GUIDE_PAGES.map((p) => p.file).sort()).toEqual(files.sort());
    for (const p of GUIDE_PAGES) expect(p.md).toBe(readFileSync(new URL(p.file, dir), 'utf8'));
  });
  it('README jadi halaman pertama (index); tiap halaman punya judul H1 dan tautan antar-halaman valid', () => {
    expect(GUIDE_PAGES[0]).toMatchObject({ slug: 'index', file: 'README.md' });
    const files = new Set(GUIDE_PAGES.map((p) => p.file));
    for (const p of GUIDE_PAGES) {
      expect(p.title.length).toBeGreaterThan(3);
      for (const m of p.md.matchAll(/\]\(([0-9a-z-]+\.md)(#[^)]*)?\)/g)) expect(files.has(m[1])).toBe(true);
    }
  });
});
