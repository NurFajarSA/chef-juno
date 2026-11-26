import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS, PROMPT_KEYS } from './defaults.js';

const md = (k: string) => readFileSync(new URL(`../../../../prompts/seed/${k}.md`, import.meta.url), 'utf8');

describe('DEFAULT_PROMPTS', () => {
  it('sama persis dengan prompts/seed/*.md (jalankan node scripts/gen-default-prompts.mjs bila beda)', () => {
    for (const k of PROMPT_KEYS) {
      expect(DEFAULT_PROMPTS[k].content, k).toBe(md(k));
      expect(DEFAULT_PROMPTS[k].content.length, k).toBeGreaterThan(200);
    }
    // semua prompt agent di mesin ada di registry (tidak lagi tertanam di kode daemon)
    expect([...PROMPT_KEYS]).toEqual([
      'persona',
      'review',
      'method',
      'final',
      'triage',
      'validate',
      'tester',
      'tester-plan',
      'tester-judge',
    ]);
    expect(DEFAULT_PROMPTS['tester-plan'].content).toContain('{{BACKEND}}');
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
