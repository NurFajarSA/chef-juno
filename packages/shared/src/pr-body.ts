import { z } from 'zod';

// Bagian deskripsi PR yang mengikuti template tim (mis. `.github/pull_request_template.md`). Penguji aplikasi
// dan reviewer membaca bagian ini sebagai brief terstruktur; deskripsi tanpa template tetap dipakai apa adanya.

export const PrHowToTrySchema = z.object({
  account: z.string().nullable(),
  data: z.string().nullable(),
  steps: z.string().nullable(),
  /** isi bagian di luar ketiga label (mis. `na: …` untuk seluruh bagian) */
  text: z.string().nullable(),
});
export type PrHowToTry = z.infer<typeof PrHowToTrySchema>;

export const PrBodySectionsSchema = z.object({
  /** true bila deskripsi memuat bagian layar terdampak atau cara mencoba */
  templated: z.boolean(),
  why: z.string().nullable(),
  behavior: z.string().nullable(),
  affected: z.string().nullable(),
  howToTry: PrHowToTrySchema.nullable(),
  outOfScope: z.string().nullable(),
  risk: z.string().nullable(),
  verification: z.string().nullable(),
});
export type PrBodySections = z.infer<typeof PrBodySectionsSchema>;

type Key = 'why' | 'behavior' | 'affected' | 'howToTry' | 'outOfScope' | 'risk' | 'verification';

/** Nama heading per bagian (huruf besar/kecil diabaikan), Inggris seperti template umum dan padanan Indonesianya. */
const SECTION_NAMES: Record<Key, string[]> = {
  why: ['why', 'alasan', 'kenapa'],
  behavior: ['behavior change', 'behaviour change', 'perubahan perilaku'],
  affected: ['affected screens and flows', 'affected screens', 'layar dan alur terdampak', 'alur terdampak'],
  howToTry: ['how to try it', 'how to try', 'cara mencoba'],
  outOfScope: ['out of scope', 'di luar cakupan'],
  risk: ['risk', 'risiko'],
  verification: ['verification', 'verifikasi', 'test plan'],
};

const HOW_LABELS: Record<'account' | 'data' | 'steps', string[]> = {
  account: ['account', 'akun'],
  data: ['data'],
  steps: ['steps', 'langkah'],
};

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// Fence backtick tidak boleh punya backtick di info string-nya (CommonMark).
const FENCE = /^\s{0,3}(`{3,}(?=[^`]*$)|~{3,})(.*)$/;
const LABEL = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\*\*)?([A-Za-z][A-Za-z /]*?)(?:\*\*)?:(?:\*\*)?\s*(.*)$/;
/** batas per bagian supaya brief tidak membengkak oleh satu bagian yang panjang */
export const PR_SECTION_MAX = 1500;

/** Komentar HTML dibuang di luar inline code; komentar yang belum ditutup berlanjut ke baris berikutnya. */
function withoutComments(line: string, inComment: boolean): [string, boolean] {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (inComment) {
      const end = line.indexOf('-->', i);
      if (end < 0) return [out, true];
      inComment = false;
      i = end + 3;
    } else if (line[i] === '`') {
      const end = line.indexOf('`', i + 1);
      const stop = end < 0 ? line.length : end + 1;
      out += line.slice(i, stop);
      i = stop;
    } else if (line.startsWith('<!--', i)) {
      inComment = true;
      i += 4;
    } else {
      out += line[i];
      i += 1;
    }
  }
  return [out, inComment];
}

const clean = (lines: string[]): string | null => {
  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > PR_SECTION_MAX ? `${text.slice(0, PR_SECTION_MAX)}…` : text;
};

function howToTry(lines: string[]): PrHowToTry | null {
  const found: Record<'account' | 'data' | 'steps', string[]> = { account: [], data: [], steps: [] };
  const free: string[] = [];
  let current: keyof typeof found | null = null;
  for (const line of lines) {
    const l = LABEL.exec(line);
    const name = l?.[1].trim().toLowerCase() ?? '';
    const key = (Object.keys(HOW_LABELS) as (keyof typeof found)[]).find((k) => HOW_LABELS[k].includes(name));
    if (l && key) {
      current = key;
      if (l[2].trim()) found[key].push(l[2].trim());
      continue;
    }
    if (current) found[current].push(line.replace(/^\s{2}/, ''));
    else free.push(line);
  }
  const out = { account: clean(found.account), data: clean(found.data), steps: clean(found.steps), text: clean(free) };
  return out.account || out.data || out.steps || out.text ? out : null;
}

/** Bagian-bagian deskripsi PR. Deskripsi tanpa bagian yang dikenali → semua null, `templated: false`. */
export function parsePrBody(body: string): PrBodySections {
  const lines = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const headings: { level: number; key: Key | null; start: number }[] = [];
  let fence = '';
  let inComment = false;
  for (const [i, line] of lines.entries()) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = '';
      continue;
    }
    if (f && !inComment) {
      fence = f[1];
      continue;
    }
    [lines[i], inComment] = withoutComments(line, inComment);
    const h = HEADING.exec(lines[i]);
    if (!h) continue;
    const name = h[2].toLowerCase();
    const key = (Object.keys(SECTION_NAMES) as Key[]).find((k) => SECTION_NAMES[k].includes(name)) ?? null;
    headings.push({ level: h[1].length, key, start: i });
  }
  const content = (key: Key): string[] | null => {
    const at = headings.findIndex((h) => h.key === key);
    if (at < 0) return null;
    const { level, start } = headings[at];
    const next = headings.slice(at + 1).find((h) => h.level <= level);
    return lines.slice(start + 1, next ? next.start : lines.length);
  };
  const text = (key: Key) => {
    const c = content(key);
    return c ? clean(c) : null;
  };
  const how = content('howToTry');
  const sections = {
    why: text('why'),
    behavior: text('behavior'),
    affected: text('affected'),
    howToTry: how ? howToTry(how) : null,
    outOfScope: text('outOfScope'),
    risk: text('risk'),
    verification: text('verification'),
  };
  return PrBodySectionsSchema.parse({ templated: Boolean(sections.affected || sections.howToTry), ...sections });
}

/** batas deskripsi apa adanya (PR tanpa template), sama seperti sebelumnya */
export const PR_BODY_FALLBACK_MAX = 4000;

/**
 * Brief PR untuk reviewer & penguji aplikasi. Deskripsi bertemplate menjadi bagian terstruktur
 * ("Alur yang diubah PR", "Cara mencoba", …); tanpa template, deskripsi dipotong apa adanya.
 * Bagian "## File yang berubah" selalu terakhir (dibaca penanda temuan uji aplikasi).
 */
export function buildPrBrief(o: {
  number: number;
  title: string;
  body: string | null | undefined;
  files: { path: string; stat?: string | null }[];
}): string {
  const s = parsePrBody(String(o.body ?? ''));
  const parts = [`# PR #${o.number}: ${o.title}`];
  if (!s.templated) {
    parts.push(String(o.body ?? '').slice(0, PR_BODY_FALLBACK_MAX));
  } else {
    if (s.why) parts.push(`## Alasan (dari penulis)\n${s.why}`);
    const changed = [s.behavior && `Perubahan perilaku:\n${s.behavior}`, s.affected && `Layar & alur:\n${s.affected}`];
    parts.push(
      `## Alur yang diubah PR (dari penulis; wajib dicoba semua)\n${changed.filter(Boolean).join('\n\n') || '(tidak diisi)'}`,
    );
    const h = s.howToTry;
    const how = h
      ? [
          h.text,
          h.account && `Akun: ${h.account}`,
          h.data && `Data: ${h.data}`,
          h.steps && `Langkah:\n${h.steps}`,
        ].filter(Boolean)
      : [];
    parts.push(`## Cara mencoba (dari penulis)\n${how.join('\n') || '(tidak diisi)'}`);
    if (s.outOfScope) parts.push(`## Di luar cakupan PR\n${s.outOfScope}`);
    if (s.risk) parts.push(`## Risiko menurut penulis\n${s.risk}`);
    if (s.verification) parts.push(`## Verifikasi oleh penulis\n${s.verification}`);
  }
  parts.push(
    `## File yang berubah (${o.files.length})`,
    ...o.files.slice(0, 300).map((f) => `- ${f.path}${f.stat ? ` (${f.stat})` : ''}`),
  );
  return parts.join('\n');
}

const NOT_APP_FILE = /(^|\/)(test|tests|__tests__|spec|e2e|docs?)\/|[._-](test|spec)\.[^/]+$|\.(md|txt|lock)$/i;

/**
 * File yang paling mungkin memuat alur yang diubah, untuk menempelkan temuan "alur rusak" uji aplikasi:
 * file kode (bukan test/dokumentasi) dengan baris berubah terbanyak; tanpa itu, file pertama.
 */
export function anchorFileFromBrief(prBrief: string): string {
  const list = prBrief.split('## File yang berubah').at(-1) ?? '';
  const files = [...list.matchAll(/^- (\S+)(?: \(\+(\d+) −(\d+)\))?/gm)].map((m) => ({
    path: m[1],
    lines: Number(m[2] ?? 0) + Number(m[3] ?? 0),
  }));
  const app = files.filter((f) => !NOT_APP_FILE.test(f.path));
  const best = app.reduce<(typeof app)[number] | null>((a, f) => (a && a.lines >= f.lines ? a : f), null);
  return best?.path ?? files[0]?.path ?? '';
}
