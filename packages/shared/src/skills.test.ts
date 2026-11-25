import { describe, expect, it } from 'vitest';
import {
  globToRegExp,
  groupSkillFiles,
  ImportSkillsInputSchema,
  parseSkillMd,
  renderSkillsForPrompt,
  SKILL_LIMITS,
  skillAppliesTo,
  skillSlug,
} from './skills.js';

const md = (name: string, desc: string, body = 'Isi skill.') =>
  `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;

describe('parseSkillMd', () => {
  it('kategori inti / domain dari frontmatter; nilai lain → null', () => {
    const c = (v: string) =>
      (parseSkillMd(`---\nname: a\ndescription: b\ncategory: ${v}\n---\nx`) as { category: unknown }).category;
    expect(c('inti')).toBe('inti');
    expect(c('Domain')).toBe('domain');
    expect(c('lainnya')).toBeNull();
  });
  it('membaca name, description, dan body', () => {
    expect(parseSkillMd(md('review-sql', 'Cek query SQL', '# Langkah\n1. a'))).toEqual({
      name: 'review-sql',
      description: 'Cek query SQL',
      body: '# Langkah\n1. a',
      paths: [],
      category: null,
    });
  });
  it('mendukung nilai berkutip, CRLF, BOM, dan blok > / |', () => {
    const t = '\uFEFF---\r\nname: "Angular Signals"\r\ndescription: >\r\n  Pakai signal\r\n  bukan RxJS\r\n---\r\nbody';
    expect(parseSkillMd(t)).toEqual({
      name: 'Angular Signals',
      description: 'Pakai signal bukan RxJS',
      body: 'body',
      paths: [],
      category: null,
    });
    const u = "---\nname: 'x'\ndescription: |\n  baris 1\n  baris 2\n---\n";
    expect(parseSkillMd(u)).toMatchObject({ description: 'baris 1\nbaris 2' });
  });
  it('menolak tanpa frontmatter / name / description', () => {
    expect(parseSkillMd('# judul saja')).toHaveProperty('error');
    expect(parseSkillMd('---\ndescription: d\n---\n')).toEqual({ error: 'frontmatter `name` kosong' });
    expect(parseSkillMd('---\nname: n\n---\n')).toEqual({ error: 'frontmatter `description` kosong' });
  });
});

describe('skillSlug', () => {
  it('huruf kecil, tanda hubung, maks 64', () => {
    expect(skillSlug('Angular Signals & Forms!')).toBe('angular-signals-forms');
    expect(skillSlug('  --Ç Café--  ')).toBe('c-cafe');
    expect(skillSlug('a'.repeat(80))).toHaveLength(64);
    expect(skillSlug('!!!')).toBe('');
  });
});

describe('groupSkillFiles', () => {
  it('folder berisi banyak skill: tiap SKILL.md jadi satu skill beserta file pendukungnya', () => {
    const r = groupSkillFiles([
      { path: 'skills/sql/SKILL.md', content: md('sql-review', 'SQL') },
      { path: 'skills/sql/references/n+1.md', content: 'contoh' },
      { path: 'skills/ui/skill.md', content: md('UI Review', 'UI') },
      { path: 'skills/ui/.DS_Store', content: 'x' },
      { path: 'README.md', content: '# bukan skill' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.skills.map((s) => [s.slug, Object.keys(s.files).sort()])).toEqual([
      ['sql-review', ['SKILL.md', 'references/n+1.md']],
      ['ui-review', ['SKILL.md']],
    ]);
  });
  it('skill bersarang tidak ditelan skill induk; file .md lepas berfrontmatter juga jadi skill', () => {
    const r = groupSkillFiles([
      { path: 'a/SKILL.md', content: md('induk', 'i') },
      { path: 'a/b/SKILL.md', content: md('anak', 'a') },
      { path: 'a/b/x.txt', content: 'x' },
      { path: 'lepas.md', content: md('lepas', 'l') },
    ]);
    expect(r.skills.map((s) => [s.slug, Object.keys(s.files).sort()])).toEqual([
      ['anak', ['SKILL.md', 'x.txt']],
      ['induk', ['SKILL.md']],
      ['lepas', ['SKILL.md']],
    ]);
  });
  it('melaporkan error: frontmatter rusak, nama ganda, file terlalu besar', () => {
    const r = groupSkillFiles([
      { path: 'x/SKILL.md', content: '# tanpa frontmatter' },
      { path: 'y/SKILL.md', content: md('sama', 's') },
      { path: 'z/SKILL.md', content: md('sama', 's') },
      { path: 'w/SKILL.md', content: md('besar', 'b', 'a'.repeat(SKILL_LIMITS.maxFileBytes + 1)) },
    ]);
    expect(r.skills.map((s) => s.slug)).toEqual(['sama']);
    expect(r.errors).toHaveLength(3);
    expect(r.errors.join('\n')).toMatch(/frontmatter/);
    expect(r.errors.join('\n')).toMatch(/lebih dari sekali/);
    expect(r.errors.join('\n')).toMatch(/KB/);
  });
});

describe('ImportSkillsInputSchema', () => {
  it('membatasi jumlah skill per import', () => {
    const one = { files: { 'SKILL.md': md('a', 'b') } };
    expect(ImportSkillsInputSchema.safeParse({ skills: [one] }).success).toBe(true);
    expect(ImportSkillsInputSchema.safeParse({ skills: [] }).success).toBe(false);
    expect(
      ImportSkillsInputSchema.safeParse({ skills: Array(SKILL_LIMITS.maxSkillsPerImport + 1).fill(one) }).success,
    ).toBe(false);
  });
});

describe('renderSkillsForPrompt', () => {
  const s = (slug: string, body: string, extra: Record<string, string> = {}) => ({
    slug,
    name: slug,
    description: `desk ${slug}`,
    files: { 'SKILL.md': md(slug, `desk ${slug}`, body), ...extra },
  });
  it('kosong bila tidak ada skill aktif', () => expect(renderSkillsForPrompt([])).toBe(''));
  it('memuat body (tanpa frontmatter) dan file pendukung', () => {
    const out = renderSkillsForPrompt([s('sql', 'Cek N+1', { 'ref.md': 'contoh query' })]);
    expect(out).toContain('# Skill tim');
    expect(out).toContain('## Skill: sql (`sql`)');
    expect(out).toContain('Cek N+1');
    expect(out).toContain('### File: ref.md');
    expect(out).not.toContain('name: sql');
  });
  it('skill yang melewati batas ukuran dilewati dengan catatan', () => {
    const out = renderSkillsForPrompt([s('kecil', 'ok'), s('besar', 'x'.repeat(5000))], 1000);
    expect(out).toContain('kecil');
    expect(out).not.toContain('xxxxx');
    expect(out).toContain('1 skill tidak dimuat karena batas ukuran: besar');
  });
});

describe('paths & pemuatan selektif', () => {
  it('frontmatter paths: daftar YAML, inline [..], atau dipisah koma', () => {
    expect(
      parseSkillMd('---\nname: a\ndescription: d\npaths:\n  - "**/*.dart"\n  - pubspec.yaml\n---\nx'),
    ).toMatchObject({ paths: ['**/*.dart', 'pubspec.yaml'] });
    expect(parseSkillMd("---\nname: a\ndescription: d\npaths: ['**/*.ts', firestore.rules]\n---\nx")).toMatchObject({
      paths: ['**/*.ts', 'firestore.rules'],
    });
    expect(parseSkillMd('---\nname: a\ndescription: d\npaths: lib/**, test/**\n---\nx')).toMatchObject({
      paths: ['lib/**', 'test/**'],
    });
  });
  it('globToRegExp: **, *, ?, {a,b}, pola tanpa folder cocok di mana pun', () => {
    expect(globToRegExp('**/*.dart').test('lib/src/home_page.dart')).toBe(true);
    expect(globToRegExp('**/*.dart').test('main.dart')).toBe(true);
    expect(globToRegExp('*.dart').test('lib/a/b.dart')).toBe(true);
    expect(globToRegExp('lib/*.dart').test('lib/a/b.dart')).toBe(false);
    expect(globToRegExp('android/**').test('android/app/src/main/AndroidManifest.xml')).toBe(true);
    expect(globToRegExp('**/*.{ts,tsx}').test('src/app.tsx')).toBe(true);
    expect(globToRegExp('pubspec.yaml').test('packages/core/pubspec.yaml')).toBe(true);
    expect(globToRegExp('pubspec.yaml').test('pubspec.lock')).toBe(false);
    expect(globToRegExp('file?.md').test('file1.md')).toBe(true);
  });
  it('skillAppliesTo: tanpa paths selalu; dengan paths hanya bila ada file cocok', () => {
    expect(skillAppliesTo([], ['a.py'])).toBe(true);
    expect(skillAppliesTo(['**/*.dart'], ['lib/main.dart', 'README.md'])).toBe(true);
    expect(skillAppliesTo(['**/*.dart', 'pubspec.yaml'], ['src/app.ts'])).toBe(false);
  });
  it('groupSkillFiles membawa paths dari frontmatter', () => {
    const r = groupSkillFiles([
      { path: 'flutter/SKILL.md', content: '---\nname: flutter\ndescription: d\npaths:\n  - "**/*.dart"\n---\nisi' },
    ]);
    expect(r.skills[0].paths).toEqual(['**/*.dart']);
  });
});
