import { SEVERITY_EMOJI, SEVERITY_RANK, SUMMARY_MARKER, findingMarker, type Severity } from './constants.js';
import type { ReviewFinding, ReviewOutput } from './schemas.js';

export const MAX_FIELD_CHARS = 4000;
export const MAX_COMMENT_CHARS = 60_000;

/** Pola rahasia yang tidak boleh pernah diposting (§12.9). */
export const SECRET_PATTERNS: RegExp[] = [
  /ghs_[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*-----/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

export function containsSecret(text: string, extra: string[] = []): boolean {
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  return extra.some((s) => s && s.length >= 8 && text.includes(s));
}

/**
 * Sanitasi teks dari model sebelum diposting (§6.4.6):
 * netralkan @mention, buang HTML mentah & gambar, potong panjang, redaksi pola rahasia.
 */
export function sanitize(text: string, max = MAX_FIELD_CHARS): string {
  let t = String(text ?? '');
  // Ulangi sampai stabil: potongan bersarang (`<!<!-- -->-- …-->`, `<<b>img …>`) bisa menyusun ulang
  // marker/tag setelah satu kali buang.
  let prev: string;
  do {
    prev = t;
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // gambar markdown
    t = t.replace(/<!--[\s\S]*?-->/g, ''); // komentar HTML (marker palsu)
    t = t.replace(/<!--/g, ''); // pembuka komentar tanpa penutup (menyembunyikan sisa komentar)
    t = t.replace(/<\/?[a-zA-Z][^>]*>/g, ''); // tag HTML mentah
  } while (t !== prev);
  // Redaksi SETELAH HTML dibuang: rahasia yang dipecah tag/komentar (`ghs_ab<b></b>cd…`) tersusun lagi di sini.
  for (const re of SECRET_PATTERNS) t = t.replace(new RegExp(re.source, 'g'), '[DIHAPUS]');
  t = t.replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1@​$2'); // @mention → zero-width
  if (t.length > max) t = t.slice(0, max - 1) + '…';
  return t;
}

/** Kode suggestion: tidak dinetralkan mention-nya (di dalam blok kode), tapi tanpa rahasia & ``` penutup. */
function sanitizeCode(code: string): string {
  let t = code;
  for (const re of SECRET_PATTERNS) t = t.replace(new RegExp(re.source, 'g'), '[DIHAPUS]');
  t = t.replace(/```/g, '`​``');
  return t.slice(0, MAX_FIELD_CHARS);
}

/** `path:line` dari model sebagai code span: tanpa backtick/baris baru supaya tidak bisa keluar dari span. */
function codeLoc(path: string, line: number): string {
  return '`' + sanitize(`${path}:${line}`, 300).replace(/[`\r\n]/g, '') + '`';
}

export function sortFindings<T extends { severity: Severity }>(findings: T[]): T[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Gambar bukti inline (hanya URL tautan bukti bertanda tangan milik Chef Juno), lebar dibatasi. */
export function evidenceImages(urls: string[] | undefined, alt: string, max = 3): string {
  const ok = (urls ?? []).filter((u) =>
    /^https?:\/\/[^\s"'<>]+\/evidence\?j=[\w-]+&s=[\w-]+&sig=[0-9a-f]{32}$/.test(u),
  );
  return ok
    .slice(0, max)
    .map((u) => `<img src="${u}" width="260" alt="${sanitize(alt, 80).replace(/["<>]/g, '')}">`)
    .join(' ');
}

/** Baris bukti uji aplikasi di komentar PR: catatan, screenshot inline, tautan ke dashboard. */
export function evidenceLine(
  e: { status: 'reproduced' | 'not_reproduced' | 'inconclusive'; note: string; shots: string[] } | undefined,
  link: string | null,
  images: string[] = [],
): string | null {
  if (!e || e.status === 'inconclusive') return null;
  const head =
    e.status === 'reproduced'
      ? '🧪 **Terbukti saat dicoba di aplikasi**'
      : '🧪 **Tidak muncul saat dicoba di aplikasi**';
  const shot = e.shots.length && link ? ` · [detail di dashboard](${link})` : '';
  const img = evidenceImages(images, 'screenshot bukti');
  return `${head} — ${sanitize(e.note, 400)}${shot}${img ? `\n\n${img}` : ''}`;
}

const CATEGORY_ID: Record<string, string> = {
  bug: 'Bug',
  security: 'Keamanan',
  performance: 'Performa',
  maintainability: 'Perawatan',
  test: 'Test',
};

/**
 * Komentar inline gaya "judul = akibat": judul tebal, paragraf mekanisme, paragraf dampak, pemicu, perbaikan (+ test),
 * lalu catatan kecil kategori · keyakinan · skill dasar.
 */
export function formatInlineComment(
  f: ReviewFinding & {
    evidence?: { status: 'reproduced' | 'not_reproduced' | 'inconclusive'; note: string; shots: string[] };
  },
  findingId: string,
  evidenceLink: string | null = null,
  evidenceImageUrls: string[] = [],
): string {
  const parts = [
    `${SEVERITY_EMOJI[f.severity]} **${f.severity} · ${sanitize(f.title, 200)}**`,
    '',
    sanitize(f.what),
    '',
    sanitize(f.why),
    ...(f.trigger?.trim() ? ['', `**Muncul saat:** ${sanitize(f.trigger, 500)}`] : []),
    '',
    `**Perbaikan:** ${sanitize(f.fix)}`,
  ];
  const ev = evidenceLine(f.evidence, evidenceLink, evidenceImageUrls);
  if (ev) parts.push('', ev);
  if (f.suggestion) parts.push('', '```suggestion', sanitizeCode(f.suggestion), '```');
  const meta = [
    CATEGORY_ID[f.category] ?? f.category,
    typeof f.confidence === 'number' ? `keyakinan ${Math.round(f.confidence * 100)}%` : '',
    f.skill ? `dasar: skill \`${sanitize(f.skill, 80)}\`` : '',
  ].filter(Boolean);
  parts.push('', `<sub>${meta.join(' · ')}</sub>`, findingMarker(findingId));
  return parts.join('\n');
}

export interface SummaryFindingRow {
  finding: ReviewFinding;
  /** URL komentar inline, null kalau tidak diposting inline */
  url: string | null;
}

export interface SummaryContext {
  headSha: string;
  agent: 'claude' | 'codex';
  model: string | null;
  promptVersions: { persona: number; review: number };
  machineName: string;
  durationMs: number;
  handle?: string;
  /** Peringatan dampak dari code map (opsional) */
  impact?: string[];
  suppressedCount?: number;
  note?: string | null;
  /** temuan yang ditahan (keyakinan rendah / di bawah ambang prioritas) — hanya di dashboard */
  heldCount?: number;
  /** review sebagian: alasan singkat (null = lengkap) */
  incomplete?: string | null;
  /** status temuan review sebelumnya di PR yang sama (judul) */
  previous?: { fixed: string[]; open: string[] } | null;
  /** ringkasan uji aplikasi (meta job): hasil, atau alasan dilewati */
  appVerify?: {
    ran: boolean;
    reason?: string;
    backend?: string;
    repaired?: boolean;
    scenarios?: { status: string }[];
  } | null;
}

/** Alasan dilewati yang normal (tidak perlu ditampilkan di PR). */
const QUIET_APP_SKIPS = ['dimatikan di Pengaturan', 'tidak ada temuan P0/P1 yang bisa dicoba di aplikasi'];

/** Satu baris 🧪 di ringkasan: hasil uji aplikasi, atau alasan dilewati karena masalah lingkungan. */
export function appVerifyLine(a: SummaryContext['appVerify']): string | null {
  if (!a) return null;
  const where = a.backend === 'emulator' ? ' (emulator lokal)' : '';
  if (a.ran) {
    const sc = a.scenarios ?? [];
    const n = (s: string) => sc.filter((x) => x.status === s).length;
    const parts = [
      `${sc.length} temuan dicoba`,
      n('reproduced') && `${n('reproduced')} terbukti`,
      n('not_reproduced') && `${n('not_reproduced')} tidak muncul`,
    ]
      .filter(Boolean)
      .join(', ');
    return `🧪 Uji aplikasi${where}: ${parts || 'tidak ada skenario yang bisa dijalankan'}${a.repaired ? ' · lingkungan emulator dipulihkan otomatis' : ''}.`;
  }
  if (!a.reason || QUIET_APP_SKIPS.includes(a.reason)) return null;
  return `🧪 Uji aplikasi dilewati: ${a.reason}`;
}

/** Tambahan dari reviewer akhir (opsional untuk hasil lama). */
export interface SummaryExtras {
  impactLevel?: 'rendah' | 'sedang' | 'tinggi';
  diagram?: string;
  walkthrough?: { area: string; files: string[]; change: string }[];
  effortMinutes?: number | null;
}

const IMPACT_LABEL = { rendah: 'Dampak rendah', sedang: 'Dampak sedang', tinggi: 'Dampak tinggi' } as const;

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function agentLabel(agent: 'claude' | 'codex', model: string | null): string {
  const name = agent === 'claude' ? 'Claude Code' : 'Codex';
  return `${name} (${model ?? 'default'})`;
}

/** "Temuan review sebelumnya": berapa yang sudah beres dan yang masih ada. */
function previousLines(prev: SummaryContext['previous']): string[] {
  if (!prev || (!prev.fixed.length && !prev.open.length)) return [];
  const out = [`**Temuan review sebelumnya** — ✅ ${prev.fixed.length} sudah beres · ⏳ ${prev.open.length} masih ada`];
  for (const t of prev.open.slice(0, 5)) out.push(`- ⏳ ${sanitize(t, 200)}`);
  for (const t of prev.fixed.slice(0, 5)) out.push(`- ✅ ~~${sanitize(t, 200)}~~`);
  out.push('');
  return out;
}

export function formatSummaryComment(
  out: ReviewOutput & SummaryExtras,
  inline: SummaryFindingRow[],
  other: ReviewFinding[],
  ctx: SummaryContext,
): string {
  const handle = ctx.handle ?? 'chefjuno';
  const all = [...inline.map((r) => r.finding), ...other];
  const count = (s: Severity) => all.filter((f) => f.severity === s).length;
  const lines: string[] = [
    SUMMARY_MARKER,
    `## 👨‍🍳 Chef Juno — Skor ${effectiveScore(out.score, !!ctx.incomplete)}/5${out.impactLevel ? ` · ${IMPACT_LABEL[out.impactLevel]}` : ''}${ctx.incomplete ? ' · ⚠️ Review sebagian' : ''}`,
    `> ${sanitize(out.verdict, 300)}`,
    '',
    ...(ctx.incomplete
      ? [
          `> ⚠️ **Review sebagian** — ${sanitize(ctx.incomplete, 400)} Jangan anggap PR ini bersih hanya dari review ini.`,
          '',
        ]
      : []),
    '**Ringkasan**',
    sanitize(out.summary, 2000),
    '',
    ...previousLines(ctx.previous),
    `**Temuan** — 🔴 P0: ${count('P0')} · 🟠 P1: ${count('P1')} · 🟡 P2: ${count('P2')}`,
  ];
  if (inline.length) {
    lines.push('| | File | Masalah |', '|---|---|---|');
    for (const r of sortFindings(inline.map((x) => ({ ...x, severity: x.finding.severity })))) {
      const t = sanitize(r.finding.title, 200).replace(/\|/g, '\\|');
      const title = r.url ? `[${t}](${r.url})` : t;
      lines.push(
        `| ${SEVERITY_EMOJI[r.finding.severity]} | ${codeLoc(r.finding.path, r.finding.line).replace(/\|/g, '\\|')} | ${title} |`,
      );
    }
  } else if (!other.length) {
    const clean = ctx.incomplete ? 'Tidak ada temuan di bagian yang sempat dinilai.' : 'Bersih. Merge.';
    // verdict sudah "Bersih. Merge." → jangan diulang
    if (sanitize(out.verdict, 500).trim() !== clean) lines.push('', clean);
  }
  if (out.walkthrough?.length) {
    const effort = out.effortMinutes ? ` · perkiraan review ±${out.effortMinutes} menit` : '';
    lines.push(
      '',
      `<details><summary><b>Walkthrough</b>${effort}</summary>`,
      '',
      '| Area | File | Perubahan |',
      '|---|---|---|',
    );
    for (const w of out.walkthrough.slice(0, 8)) {
      const files = w.files
        .slice(0, 6)
        .map((x) => '`' + sanitize(x, 120).replace(/[`|]/g, '') + '`')
        .join(', ');
      const more = w.files.length > 6 ? ` +${w.files.length - 6}` : '';
      lines.push(
        `| ${sanitize(w.area, 80).replace(/\|/g, '\\|')} | ${files}${more} | ${sanitize(w.change, 300).replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('', '</details>');
  }
  if (out.diagram?.trim()) {
    lines.push(
      '',
      '<details open><summary><b>Diagram alur</b></summary>',
      '',
      '```mermaid',
      sanitizeCode(out.diagram),
      '```',
      '',
      '</details>',
    );
  }
  if (ctx.impact?.length) {
    lines.push('', '**Dampak (dari code map)**');
    for (const i of ctx.impact.slice(0, 10)) lines.push(`- ${sanitize(i, 300)}`);
  }
  if (out.lessons.length) {
    lines.push('', '**Yang perlu kamu pahami dari PR ini**');
    for (const l of out.lessons.slice(0, 3)) lines.push(`- ${sanitize(l, 500)}`);
  }
  if (other.length) {
    lines.push('', '<details><summary>Temuan lain (di luar diff)</summary>', '');
    for (const f of sortFindings(other)) {
      lines.push(
        `- ${SEVERITY_EMOJI[f.severity]} **${f.severity} · ${sanitize(f.title, 200)}** ${codeLoc(f.path, f.line)} — ${sanitize(f.what, 600)} **Perbaikan:** ${sanitize(f.fix, 600)}`,
      );
    }
    lines.push('', '</details>');
  }
  if (ctx.suppressedCount) {
    lines.push('', `<sub>${ctx.suppressedCount} temuan di-suppress oleh memory tim (lihat dashboard).</sub>`);
  }
  if (ctx.heldCount) {
    lines.push(
      '',
      `<sub>${ctx.heldCount} temuan dengan keyakinan rendah / di bawah ambang tidak diposting (lihat dashboard).</sub>`,
    );
  }
  const av = appVerifyLine(ctx.appVerify);
  if (av) lines.push('', `<sub>${sanitize(av, 400)}</sub>`);
  if (ctx.note) lines.push('', `<sub>${sanitize(ctx.note, 300)}</sub>`);
  lines.push(
    '',
    `<sub>Commit \`${ctx.headSha.slice(0, 7)}\` · ${agentLabel(ctx.agent, ctx.model)} · prompt persona v${ctx.promptVersions.persona} / review v${ctx.promptVersions.review} · mesin ${sanitize(ctx.machineName, 60)} · ${formatDuration(ctx.durationMs)} · Review ulang: \`lapor @${handle}\` · Balas temuan: \`chefjuno: diperbaiki\` / \`chefjuno: tidak diperbaiki — <alasan>\`</sub>`,
  );
  let body = lines.join('\n');
  if (body.length > MAX_COMMENT_CHARS) body = body.slice(0, MAX_COMMENT_CHARS - 40) + '\n\n…(dipotong)';
  return body;
}

export const REVIEW_FAILED_TEXT = (stage: string) =>
  `😕 Review gagal di tahap \`${stage}\`. Coba lagi dengan \`lapor @chefjuno\`. Detail ada di dashboard.`;
export const QUEUED_NO_MACHINE_TEXT =
  '⏳ Masuk antrean. Belum ada mesin reviewer yang online — review jalan begitu ada mesin yang nyala.';
export const REPO_DISABLED_TEXT = 'Repo ini dinonaktifkan di dashboard Chef Juno. Tidak ada review.';
export const STALE_TEXT = '⌛ Antrean kedaluwarsa (lebih dari 2 jam tanpa mesin). Panggil lagi: `lapor @chefjuno`.';

// ---------- Ambang posting & kelengkapan review ----------

export const DEFAULT_MIN_CONFIDENCE = 0.7;
export const DEFAULT_MAX_POST_PRIORITY: Severity = 'P2';

export type HeldReason = 'confidence' | 'priority';

/**
 * Pisahkan temuan yang diposting ke PR dari yang ditahan (tetap disimpan di dashboard).
 * P0 keamanan/data tidak pernah ditahan karena prioritas, hanya karena keyakinan.
 */
export function selectPostable<T extends Pick<ReviewFinding, 'severity' | 'confidence'>>(
  findings: T[],
  o: { minConfidence?: number; maxPriority?: Severity } = {},
): { post: T[]; held: { finding: T; reason: HeldReason }[] } {
  const minConfidence = o.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxRank = SEVERITY_RANK[o.maxPriority ?? DEFAULT_MAX_POST_PRIORITY];
  const post: T[] = [];
  const held: { finding: T; reason: HeldReason }[] = [];
  for (const f of findings) {
    if (f.confidence < minConfidence) held.push({ finding: f, reason: 'confidence' });
    else if (SEVERITY_RANK[f.severity] > maxRank) held.push({ finding: f, reason: 'priority' });
    else post.push(f);
  }
  return { post, held };
}

/** Review tidak lengkap (agent melapor incomplete atau diff terpotong) → skor maksimal 3 dan tidak pernah "siap merge". */
export const INCOMPLETE_SCORE_CAP = 3;
export function effectiveScore(score: number, incomplete: boolean): number {
  return incomplete ? Math.min(score, INCOMPLETE_SCORE_CAP) : score;
}

// ---------- Komentar hasil uji aplikasi (job lanjutan) ----------

export const APP_MARKER = '<!-- chefjuno-ai:app -->';

const TRIAL_LABEL: Record<string, string> = {
  reproduced: 'Terbukti saat dicoba',
  not_reproduced: 'Tidak muncul saat dicoba',
  inconclusive: 'Belum meyakinkan',
};

export interface AppCommentInput {
  headSha: string;
  ran: boolean;
  reason?: string;
  backend?: string;
  buildMs?: number;
  runMs?: number;
  change?: { status: string; note: string; shots: string[]; images?: string[] } | null;
  tried: { severity: string; title: string; status: string; note: string; link: string | null; images?: string[] }[];
  skipped: { title: string; reason: string }[];
  changeLink?: string | null;
}

/** Satu komentar sticky per PR: hasil mencoba alur yang diubah PR + temuan yang dicoba. Gambar hanya di dashboard. */
export function formatAppComment(a: AppCommentInput): string {
  const where = a.backend === 'emulator' ? ' · emulator lokal' : '';
  const head = `### 🧪 Uji aplikasi — Commit \`${a.headSha.slice(0, 7)}\`${where}`;
  if (!a.ran)
    return [
      APP_MARKER,
      head,
      '',
      `⚠️ **Belum teruji di aplikasi:** ${sanitize(a.reason ?? 'alasan tidak diketahui', 400)}`,
      '',
      '<sub>PR yang belum teruji tidak dianggap lulus. Review ulang: `lapor @chefjuno`.</sub>',
    ].join('\n');
  const lines = [APP_MARKER, head, ''];
  const c = a.change;
  const changeIcon = c?.status === 'not_reproduced' ? '✅' : c?.status === 'reproduced' ? '❌' : '⚠️';
  const changeText =
    c?.status === 'not_reproduced'
      ? 'berjalan normal'
      : c?.status === 'reproduced'
        ? 'bermasalah'
        : 'belum berhasil dicoba sampai layar yang diubah';
  lines.push(
    `${changeIcon} **Alur yang diubah PR:** ${changeText}${c?.note ? ` — ${sanitize(c.note, 500)}` : ''}${a.changeLink ? ` ([detail](${a.changeLink}))` : ''}`,
  );
  const changeImgs = evidenceImages(c?.images, 'alur yang diubah PR', 4);
  if (changeImgs) lines.push('', changeImgs);
  if (a.tried.length) {
    lines.push('', '| Temuan | Hasil | Catatan |', '|---|---|---|');
    for (const t of a.tried)
      lines.push(
        `| ${SEVERITY_EMOJI[t.severity as keyof typeof SEVERITY_EMOJI] ?? ''} ${sanitize(t.title, 120).replace(/\|/g, '\\|')} | ${TRIAL_LABEL[t.status] ?? t.status}${t.link ? ` ([bukti](${t.link}))` : ''} | ${sanitize(t.note, 300).replace(/\|/g, '\\|')} |`,
      );
  }
  const triedImgs = a.tried.map((t) => ({ t, img: evidenceImages(t.images, t.title, 2) })).filter((x) => x.img);
  if (triedImgs.length) {
    lines.push('', '<details open><summary>Screenshot temuan yang dicoba</summary>', '');
    for (const x of triedImgs) lines.push(`**${sanitize(x.t.title, 120)}**`, '', x.img, '');
    lines.push('</details>');
  }
  if (a.skipped.length) {
    lines.push('', '<details><summary>Tidak dicoba</summary>', '');
    for (const s of a.skipped) lines.push(`- ${sanitize(s.title, 160)} — ${sanitize(s.reason, 300)}`);
    lines.push('', '</details>');
  }
  const dur = [a.buildMs ? `build ${formatDuration(a.buildMs)}` : '', a.runMs ? `uji ${formatDuration(a.runMs)}` : '']
    .filter(Boolean)
    .join(' · ');
  lines.push('', `<sub>${[dur, 'detail langkah & error di dashboard Chef Juno'].filter(Boolean).join(' · ')}</sub>`);
  return lines.join('\n');
}

/**
 * Balasan untuk review ulang yang diminta lewat komentar. Ringkasan sticky hanya di-edit (GitHub tidak memberi
 * notifikasi untuk edit), jadi komentar peminta dibalas: hasilnya sudah diperbarui + inti perubahan dari review lalu.
 */
export function formatRereviewReply(o: {
  login?: string | null;
  /** komentar yang meminta review ulang */
  requestUrl?: string | null;
  headSha: string;
  verdict: string;
  score: number;
  incomplete: boolean;
  previousScore?: number | null;
  previous?: SummaryContext['previous'];
  /** judul temuan yang belum ada di review sebelumnya */
  added?: string[];
  summaryUrl?: string | null;
}): string {
  const who = o.login && /^[A-Za-z0-9-]{1,39}$/.test(o.login) ? `@${o.login}` : '';
  const req = o.requestUrl ? `[permintaan review ulang](${o.requestUrl})` : 'permintaan review ulang';
  const where = o.summaryUrl ? `[komentar ringkasan](${o.summaryUrl})` : 'komentar ringkasan Chef Juno di atas';
  const score = effectiveScore(o.score, o.incomplete);
  const list = (items: string[]) =>
    items
      .slice(0, 5)
      .map((t) => sanitize(t, 160))
      .join('; ') + (items.length > 5 ? `; +${items.length - 5} lainnya` : '');
  const lines = [
    `${who ? `${who} ` : ''}Menjawab ${req}: hasil review sudah diperbarui (edit) di ${where} untuk commit \`${o.headSha.slice(0, 7)}\`.`,
    '',
    '**Inti perubahan**',
    (o.previousScore == null
      ? `- Skor: ${score}/5`
      : o.previousScore !== score
        ? `- Skor: ${o.previousScore}/5 → ${score}/5`
        : `- Skor tetap ${score}/5`) + (o.incomplete ? ' (review sebagian)' : ''),
  ];
  const p = o.previous;
  if (p?.fixed.length) lines.push(`- ✅ Sudah beres (${p.fixed.length}): ${list(p.fixed)}`);
  if (p?.open.length) lines.push(`- ⏳ Masih ada (${p.open.length}): ${list(p.open)}`);
  if (o.added?.length) lines.push(`- 🆕 Temuan baru (${o.added.length}): ${list(o.added)}`);
  if (!p?.fixed.length && !p?.open.length && !o.added?.length) lines.push('- Tidak ada perubahan temuan.');
  lines.push('', `> ${sanitize(o.verdict, 300)}`);
  return lines.join('\n');
}
