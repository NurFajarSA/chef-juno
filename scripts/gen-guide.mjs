// Bundel docs/guide/*.md → apps/web/src/app/docs/guide-content.ts (halaman Panduan di dashboard).
// Satu sumber: edit Markdown di docs/guide, lalu jalankan: node scripts/gen-guide.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const dir = new URL('docs/guide/', ROOT);
const pages = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : a.localeCompare(b)))
  .map((f) => {
    const md = readFileSync(new URL(f, dir), 'utf8');
    const title = (/^#\s+(.+)$/m.exec(md)?.[1] ?? f).trim();
    return { slug: f === 'README.md' ? 'index' : f.replace(/\.md$/, ''), file: f, title, md };
  });
const out = `// FILE DIBUAT OTOMATIS oleh scripts/gen-guide.mjs dari docs/guide/*.md — jangan diedit manual.
// Test guide-content.test.ts memastikan isinya sama dengan file Markdown.

export interface GuidePage {
  slug: string;
  file: string;
  title: string;
  md: string;
}

export const GUIDE_PAGES: GuidePage[] = ${JSON.stringify(pages, null, 2)};
`;
writeFileSync(new URL('apps/web/src/app/docs/guide-content.ts', ROOT), out);
console.log(`guide-content.ts diperbarui (${pages.length} halaman)`);
