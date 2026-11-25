import { BOT_HANDLE } from './constants.js';

/**
 * Satu-satunya tempat daftar kata perintah & aliasnya (§6.2).
 * Tambah perintah baru (mis. `tanya`, `cek ulang`) cukup di sini.
 */
export const COMMANDS = {
  review: {
    words: ['lapor', 'cek', 'review'],
    description: 'Review PR ini (boleh ditambah instruksi, mis. `cek bagian auth`).',
  },
  remember: {
    words: ['ingat', 'catat', 'remember'],
    description: 'Simpan fakta ke memory Chef Juno, mis. `@chefjuno ingat akun uji harus premium supaya kuis terbuka`.',
  },
  help: { words: ['bantuan', 'help'], description: 'Tampilkan daftar perintah ini.' },
} as const;

export type CommandKind = keyof typeof COMMANDS;

export interface ParsedCommand {
  kind: CommandKind;
  /** Kata perintah yang dipakai (lowercase), null kalau hanya mention. */
  word: string | null;
  /** Instruksi tambahan (sisa kalimat), boleh kosong. */
  instruction: string;
}

/** Buang code span & blok kode supaya mention di dalam kode tidak terhitung. */
export function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(~~~|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

function findWord(word: string): CommandKind | null {
  const w = word.toLowerCase();
  for (const [kind, def] of Object.entries(COMMANDS) as [CommandKind, (typeof COMMANDS)[CommandKind]][]) {
    if ((def.words as readonly string[]).includes(w)) return kind;
  }
  return null;
}

export function mentionRegex(handle = BOT_HANDLE): RegExp {
  return new RegExp(`(^|\\s)@${handle}\\b`, 'i');
}

export function hasMention(text: string, handle = BOT_HANDLE): boolean {
  return mentionRegex(handle).test(stripCode(text));
}

/**
 * Parse komentar PR. Mengembalikan null kalau tidak ada mention di luar kode.
 * Kata perintah boleh sebelum (`lapor @chefjuno`) atau sesudah (`@chefjuno lapor`) mention.
 * Hanya kata yang menempel pada mention yang dianggap perintah; sisa = instruksi.
 */
export function parseCommand(text: string, handle = BOT_HANDLE): ParsedCommand | null {
  const clean = stripCode(text);
  const re = new RegExp(`(^|\\s)@${handle}\\b`, 'i');
  const m = re.exec(clean);
  if (!m) return null;
  const mentionStart = m.index + m[1].length;
  const mentionEnd = mentionStart + handle.length + 1;
  const before = clean.slice(0, mentionStart);
  const after = clean.slice(mentionEnd);

  // kata sesudah mention
  const afterMatch = /^[\s,:]*([\p{L}-]+)/u.exec(after);
  if (afterMatch) {
    const kind = findWord(afterMatch[1]);
    if (kind) {
      const rest = after.slice(afterMatch[0].length);
      return { kind, word: afterMatch[1].toLowerCase(), instruction: normalize(before + ' ' + rest) };
    }
  }
  // kata sebelum mention
  const beforeMatch = /([\p{L}-]+)[\s,:]*$/u.exec(before);
  if (beforeMatch) {
    const kind = findWord(beforeMatch[1]);
    if (kind) {
      const rest = before.slice(0, beforeMatch.index);
      return { kind, word: beforeMatch[1].toLowerCase(), instruction: normalize(rest + ' ' + after) };
    }
  }
  // mention saja / teks lain → review dengan teks sebagai instruksi tambahan
  return { kind: 'review', word: null, instruction: normalize(before + ' ' + after) };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function helpText(handle = BOT_HANDLE): string {
  return [
    `**Perintah Chef Juno**`,
    '',
    `| Perintah | Fungsi |`,
    `|---|---|`,
    `| \`lapor @${handle}\` atau \`@${handle}\` | Review PR ini. |`,
    `| \`@${handle} cek <fokus>\` | Review dengan fokus tambahan, mis. \`@${handle} cek bagian auth\`. |`,
    `| \`@${handle} bantuan\` | Tampilkan daftar ini. |`,
    '',
    'Balas temuan di thread-nya: `chefjuno: diperbaiki` atau `chefjuno: tidak diperbaiki — <alasan>`.',
  ].join('\n');
}
