import type { Category, Severity } from './constants.js';

// ---------- Suppression deterministik (§12.10) ----------

export function trigrams(text: string): string[] {
  const t = ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
  return [...set];
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface SuppressionRule {
  id: string;
  match: { category: Category; titleTrigrams: string[] };
}

export interface SuppressibleFinding {
  title: string;
  category: Category;
  severity: Severity;
}

export const SUPPRESSION_THRESHOLD = 0.5;

/** Kategori sama dan Jaccard trigram judul ≥ 0,5. Tidak pernah untuk security atau P0. */
export function isSuppressed(f: SuppressibleFinding, rules: SuppressionRule[]): SuppressionRule | null {
  if (f.category === 'security' || f.severity === 'P0') return null;
  const tg = trigrams(f.title);
  for (const r of rules) {
    if (r.match.category !== f.category) continue;
    if (jaccard(tg, r.match.titleTrigrams) >= SUPPRESSION_THRESHOLD) return r;
  }
  return null;
}

// ---------- Balasan AI coder (§6.8) ----------

export interface AiCoderReply {
  verdict: 'fixed' | 'wont_fix';
  reason: string | null;
  sha: string | null;
}

/**
 * Format baku: `chefjuno: diperbaiki [di <sha>]` atau `chefjuno: tidak diperbaiki — <alasan>`.
 * Juga menerima variasi: "fixed", "won't fix: …", "wont fix - …", case-insensitive, awalan @chefjuno.
 */
export function parseAiCoderReply(text: string): AiCoderReply | null {
  const t = text.trim();
  const m = /^@?chefjuno\s*[:：-]\s*(.+)$/is.exec(t.split('\n')[0].trim());
  if (!m) return null;
  const body = m[1].trim();
  const neg =
    /^(tidak\s+diperbaiki|tdk\s+diperbaiki|ga(k)?\s+diperbaiki|won'?t\s*fix|will\s+not\s+fix|not\s+fixed|wontfix)\b\s*[—–:\-,]*\s*(.*)$/is.exec(
      body,
    );
  if (neg) {
    const reason = neg[3]?.trim() || null;
    return { verdict: 'wont_fix', reason, sha: null };
  }
  const pos = /^(diperbaiki|sudah\s+diperbaiki|fixed|fix(ed)?\s+in|done)\b\s*(?:(?:di|in)\s+([0-9a-f]{7,40}))?/i.exec(
    body,
  );
  if (pos) {
    const sha = pos[3] ?? /\b([0-9a-f]{7,40})\b/i.exec(body.slice(pos[0].length))?.[1] ?? null;
    return { verdict: 'fixed', reason: null, sha };
  }
  return null;
}

// ---------- Klasifikasi outcome (§6.8) ----------

export type Outcome = 'pending' | 'addressed' | 'ignored' | 'disputed' | 'accepted_by_merge';

export interface FindingSignals {
  thumbsUp: number;
  thumbsDown: number;
  threadResolved: boolean;
  codeChangedAfter: boolean;
  humanReplies: { login: string; text: string; at?: unknown }[];
  aiCoderReply: { verdict: 'fixed' | 'wont_fix' | null; reason: string | null; at?: unknown } | null;
  laterRevertOrFix: { prNumber: number } | null;
}

export const DISPUTE_RE =
  /\b(false positive|salah|keliru|tidak relevan|bukan masalah|sengaja|by design|intended|not an issue|nggak|gak perlu|tidak perlu)\b/i;

/**
 * Urutan bobot: kode berubah/diperbaiki → addressed; bantahan (👎, balasan membantah,
 * AI coder wont_fix) → disputed; merged tanpa perubahan & tanpa balasan → accepted_by_merge;
 * tidak di-merge & tanpa sinyal → ignored.
 */
export function classifyOutcome(s: FindingSignals, merged: boolean): Outcome {
  const aiFixed = s.aiCoderReply?.verdict === 'fixed';
  const aiWont = s.aiCoderReply?.verdict === 'wont_fix';
  if (s.codeChangedAfter || aiFixed) return 'addressed';
  const humanDisputes = s.humanReplies.some((r) => DISPUTE_RE.test(r.text));
  if (s.thumbsDown > s.thumbsUp || humanDisputes || aiWont) return 'disputed';
  if (s.threadResolved) return 'addressed';
  if (merged) return 'accepted_by_merge';
  return 'ignored';
}

export function emptySignals(): FindingSignals {
  return {
    thumbsUp: 0,
    thumbsDown: 0,
    threadResolved: false,
    codeChangedAfter: false,
    humanReplies: [],
    aiCoderReply: null,
    laterRevertOrFix: null,
  };
}
