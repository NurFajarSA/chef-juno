import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS } from './defaults.js';

const md = (k: string) => readFileSync(new URL(`../../../../prompts/seed/${k}.md`, import.meta.url), 'utf8');

describe('DEFAULT_PROMPTS', () => {
  it('sama persis dengan prompts/seed/*.md (jalankan node scripts/gen-default-prompts.mjs bila beda)', () => {
    expect(DEFAULT_PROMPTS.persona.content).toBe(md('persona'));
    expect(DEFAULT_PROMPTS.review.content).toBe(md('review'));
    expect(DEFAULT_PROMPTS.review.content.length).toBeGreaterThan(200);
  });
});

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SKILL_FILES } from './default-skills.js';
import { DEFAULT_SKILLS } from '../skills.js';

describe('DEFAULT_SKILLS (folder skills/ di repo)', () => {
  const dir = fileURLToPath(new URL('../../../../skills/', import.meta.url));
  const onDisk: { path: string; content: string }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else onDisk.push({ path: relative(dir, p).split('\\').join('/'), content: readFileSync(p, 'utf8') });
    }
  };
  for (const d of readdirSync(dir).sort()) if (statSync(join(dir, d)).isDirectory()) walk(join(dir, d));

  it('bundel sama persis dengan isi folder skills/ (jalankan node scripts/gen-default-prompts.mjs bila beda)', () => {
    expect(DEFAULT_SKILL_FILES).toEqual(onDisk);
  });
  it('tidak ada skill bawaan: cara mereview diserahkan ke model, skill hanya untuk pengetahuan khusus tim', () => {
    expect(DEFAULT_SKILL_FILES).toEqual([]);
    expect(DEFAULT_SKILLS).toEqual([]);
  });
});
