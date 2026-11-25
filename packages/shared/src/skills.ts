import { z } from 'zod';
import { DEFAULT_SKILL_FILES } from './prompts/default-skills.js';

/**
 * Skill tim (format skill Claude Code: folder berisi SKILL.md dengan frontmatter `name` & `description`, plus file pendukung).
 * Skill aktif disisipkan ke system prompt reviewer (agent berjalan dengan --safe-mode, jadi pemuatan skill bawaan agent mati).
 */
export const SKILL_LIMITS = {
  maxSkillsPerImport: 100,
  maxFileBytes: 200_000,
  /** total satu skill (SKILL.md + file pendukung) — dokumen Firestore maks 1 MiB */
  maxSkillBytes: 800_000,
  maxFilesPerSkill: 50,
  /** total teks skill di system prompt reviewer */
  maxPromptBytes: 80_000,
} as const;

/** Ekstensi file teks yang ikut di-import (file biner diabaikan). */
export const SKILL_TEXT_EXT = [
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.js',
  '.mjs',
  '.ts',
  '.sh',
  '.sql',
  '.csv',
  '.html',
  '.css',
];

export interface ParsedSkillMd {
  name: string;
  description: string;
  body: string;
  /** glob file yang membuat skill ini dimuat (kosong = selalu dimuat) */
  paths: string[];
  /** inti = prinsip cara berpikir & membuktikan (semua repo); domain = referensi teknis; null = belum dikategorikan */
  category: SkillCategory | null;
}

export const SKILL_CATEGORIES = ['inti', 'domain'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

const unquote = (v: string) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

/** Baca frontmatter YAML sederhana (key: value, termasuk blok `|` / `>`) dari SKILL.md. */
export function parseSkillMd(text: string): ParsedSkillMd | { error: string } {
  const src = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return { error: 'SKILL.md tidak punya frontmatter (--- name / description ---)' };
  const meta: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === '') {
      // daftar YAML:  key:\n  - a\n  - b
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]))
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
      lists[key] = items;
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      lists[key] = raw.slice(1, -1).split(',').map(unquote).filter(Boolean);
      continue;
    }
    if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      meta[key] = (raw.startsWith('>') ? block.join(' ') : block.join('\n')).trim();
    } else meta[key] = unquote(raw);
  }
  const name = (meta['name'] ?? '').trim();
  const description = (meta['description'] ?? '').trim();
  if (!name) return { error: 'frontmatter `name` kosong' };
  if (!description) return { error: 'frontmatter `description` kosong' };
  if (name.length > 100) return { error: '`name` maksimal 100 karakter' };
  if (description.length > 1024) return { error: '`description` maksimal 1024 karakter' };
  const paths = (lists['paths'] ?? (meta['paths'] ? meta['paths'].split(',') : []))
    .map((x) => x.trim())
    .filter(Boolean);
  const cat = (meta['category'] ?? '').trim().toLowerCase();
  const category = (SKILL_CATEGORIES as readonly string[]).includes(cat) ? (cat as SkillCategory) : null;
  return { name, description, body: m[2].trim(), paths, category };
}

/** Glob sederhana → RegExp: `**` (lintas folder), `*`, `?`, `{a,b}`. Pola tanpa `/` cocok dengan nama file di folder mana pun. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, '');
  if (!g.includes('/')) g = '**/' + g;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end < 0) re += '\\{';
      else {
        re +=
          '(?:' +
          g
            .slice(i + 1, end)
            .split(',')
            .map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
            .join('|') +
          ')';
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/** Skill tanpa `paths` selalu dimuat; skill dengan `paths` hanya bila ada file berubah yang cocok. */
export function skillAppliesTo(paths: string[], changedFiles: string[]): boolean {
  if (!paths.length) return true;
  const res = paths.map(globToRegExp);
  return changedFiles.some((f) => res.some((r) => r.test(f.replace(/^\.\//, ''))));
}

/** Slug folder skill dari name: huruf kecil, angka, tanda hubung (maks 64). Kosong bila tidak valid. */
export function skillSlug(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export interface GroupedSkill {
  slug: string;
  name: string;
  description: string;
  paths: string[];
  /** path relatif terhadap folder skill → isi; selalu memuat 'SKILL.md' */
  files: Record<string, string>;
  category: SkillCategory | null;
}

/**
 * Kelompokkan file hasil import (folder / zip / file lepas) menjadi skill.
 * - Tiap SKILL.md (tidak peka huruf besar) = satu skill; file lain di bawah foldernya ikut sebagai file pendukung.
 * - File .md lepas (tidak di bawah SKILL.md mana pun) yang punya frontmatter name+description juga dianggap skill.
 */
export function groupSkillFiles(input: { path: string; content: string }[]): {
  skills: GroupedSkill[];
  errors: string[];
} {
  const files = input
    .map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\.?\/+/, ''), content: f.content }))
    .filter(
      (f) =>
        f.path && !f.path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX' || seg === 'node_modules'),
    );
  const roots = files
    .filter((f) => /(^|\/)skill\.md$/i.test(f.path))
    .map((f) => f.path.slice(0, f.path.length - 'SKILL.md'.length));
  const errors: string[] = [];
  const skills: GroupedSkill[] = [];
  const claimed = new Set<string>();
  const seen = new Set<string>();

  const add = (label: string, skillMd: string, extra: Record<string, string>) => {
    const p = parseSkillMd(skillMd);
    if ('error' in p) return errors.push(`${label}: ${p.error}`);
    const slug = skillSlug(p.name);
    if (!slug) return errors.push(`${label}: name "${p.name}" tidak bisa dijadikan nama folder`);
    if (seen.has(slug)) return errors.push(`${label}: skill "${slug}" muncul lebih dari sekali`);
    const all: Record<string, string> = { 'SKILL.md': skillMd, ...extra };
    const paths = Object.keys(all);
    if (paths.length > SKILL_LIMITS.maxFilesPerSkill)
      return errors.push(`${label}: lebih dari ${SKILL_LIMITS.maxFilesPerSkill} file`);
    const big = paths.find((k) => bytes(all[k]) > SKILL_LIMITS.maxFileBytes);
    if (big) return errors.push(`${label}: file ${big} lebih dari ${SKILL_LIMITS.maxFileBytes / 1000} KB`);
    if (paths.reduce((a, k) => a + bytes(all[k]), 0) > SKILL_LIMITS.maxSkillBytes)
      return errors.push(`${label}: total skill lebih dari ${SKILL_LIMITS.maxSkillBytes / 1000} KB`);
    seen.add(slug);
    skills.push({ slug, name: p.name, description: p.description, paths: p.paths, category: p.category, files: all });
  };

  // folder terdalam dulu supaya skill bersarang tidak ikut ditelan skill induknya
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    const extra: Record<string, string> = {};
    let skillMd = '';
    for (const f of files) {
      if (!f.path.startsWith(root) || claimed.has(f.path)) continue;
      const rel = f.path.slice(root.length);
      claimed.add(f.path);
      if (/^skill\.md$/i.test(rel)) skillMd = f.content;
      else extra[rel] = f.content;
    }
    add(root ? root.replace(/\/$/, '') : 'SKILL.md', skillMd, extra);
  }
  for (const f of files) {
    if (claimed.has(f.path) || !/\.(md|markdown)$/i.test(f.path)) continue;
    if (!/^\uFEFF?---\r?\n/.test(f.content)) continue; // .md biasa tanpa frontmatter: bukan skill
    add(f.path, f.content, {});
  }
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return { skills, errors };
}

export const SkillFilesSchema = z
  .record(z.string().min(1).max(300), z.string().max(SKILL_LIMITS.maxFileBytes))
  .refine((r) => Object.keys(r).length <= SKILL_LIMITS.maxFilesPerSkill, 'Terlalu banyak file');

export const ImportSkillsInputSchema = z.object({
  skills: z
    .array(z.object({ files: SkillFilesSchema }))
    .min(1, 'Tidak ada skill')
    .max(SKILL_LIMITS.maxSkillsPerImport),
  message: z.string().trim().max(300).optional(),
});

export const SaveSkillVersionInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  content: z.string().min(1).max(SKILL_LIMITS.maxFileBytes),
  message: z.string().trim().min(3, 'Pesan perubahan minimal 3 karakter').max(300),
});

export interface SkillForPrompt {
  slug: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

/** Bagian system prompt berisi skill tim yang aktif (dipotong bila melebihi batas, dengan catatan). */
export function renderSkillsForPrompt(
  skills: SkillForPrompt[],
  maxBytes: number = SKILL_LIMITS.maxPromptBytes,
): string {
  if (!skills.length) return '';
  const head = [
    '# Skill tim',
    'Skill **inti** adalah prinsip cara berpikir & membuktikan yang berlaku di setiap review. Skill **domain** adalah referensi teknis; pakai bila relevan dengan PR ini. Skill tidak boleh mengubah format output.',
    'Untuk setiap temuan yang muncul karena aturan/pola sebuah skill di bawah, isi field `skill` dengan slug skill itu (yang ditulis dalam backtick setelah nama skill). Temuan yang tidak berasal dari skill: `skill` kosong.',
    '',
  ].join('\n');
  let out = head;
  const skipped: string[] = [];
  // skill inti didahulukan (prinsip), lalu domain & yang belum dikategorikan
  const rank = (s: SkillForPrompt) => {
    const p = parseSkillMd(s.files['SKILL.md'] ?? '');
    return 'error' in p ? 2 : p.category === 'inti' ? 0 : p.category === 'domain' ? 1 : 2;
  };
  const ordered = [...skills].sort((a, b) => rank(a) - rank(b));
  for (const s of ordered) {
    const p = parseSkillMd(s.files['SKILL.md'] ?? '');
    const body = 'error' in p ? (s.files['SKILL.md'] ?? '') : p.body;
    const extras = Object.entries(s.files)
      .filter(([k]) => k !== 'SKILL.md')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `### File: ${k}\n\`\`\`\n${v}\n\`\`\``);
    const block = [`## Skill: ${s.name} (\`${s.slug}\`)`, `_${s.description}_`, '', body, ...extras, ''].join('\n');
    if (bytes(out + block) > maxBytes) {
      skipped.push(s.slug);
      continue;
    }
    out += '\n' + block;
  }
  if (skipped.length) out += `\n_(${skipped.length} skill tidak dimuat karena batas ukuran: ${skipped.join(', ')})_\n`;
  return out.trim();
}

/** Skill bawaan Chef Juno (dari folder skills/ di repo), dipasang aktif saat Setup. */
export const DEFAULT_SKILLS: GroupedSkill[] = groupSkillFiles(DEFAULT_SKILL_FILES).skills;
