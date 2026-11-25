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
import { DEFAULT_SKILLS, groupSkillFiles, renderSkillsForPrompt, SKILL_LIMITS, skillAppliesTo } from '../skills.js';

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
  it('semua skill bawaan sah (frontmatter lengkap, tanpa error) dan muat di prompt reviewer', () => {
    const g = groupSkillFiles(DEFAULT_SKILL_FILES);
    expect(g.errors).toEqual([]);
    // hanya 10 skill inti (prinsip cara berpikir & membuktikan). Pengetahuan teknis umum (bahasa, framework, DB)
    // sudah dikuasai model; pengetahuan khusus repo ada di adapter repo (CLAUDE.md, skill verify) & memory Chef Juno.
    expect(DEFAULT_SKILLS.map((s) => s.slug)).toEqual([
      'akar-masalah',
      'bukti',
      'desain-dari-domain',
      'jujur-soal-kelengkapan',
      'kesederhanaan',
      'komentar-kode',
      'kontrak-dan-dampak',
      'memory-tim',
      'migrasi-tuntas',
      'sinyal-bukan-noise',
    ]);
    expect(DEFAULT_SKILLS.every((s) => s.category === 'inti' && !s.paths.length)).toBe(true);
  });
  it('skill inti selalu dimuat untuk file apa pun dan muat di batas prompt', () => {
    for (const files of [['lib/a.dart'], ['apps/api/src/x.ts'], ['README.md']])
      expect(DEFAULT_SKILLS.filter((s) => skillAppliesTo(s.paths, files))).toHaveLength(DEFAULT_SKILLS.length);
    const text = renderSkillsForPrompt(DEFAULT_SKILLS);
    expect(text.length).toBeLessThan(SKILL_LIMITS.maxPromptBytes);
    for (const s of DEFAULT_SKILLS) expect(text).toContain(`(\`${s.slug}\`)`);
  });
});
