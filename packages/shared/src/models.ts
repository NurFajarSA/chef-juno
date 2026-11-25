import { z } from 'zod';
import { ReviewOutputSchema, toStrictJsonSchema, type ReviewFinding } from './schemas.js';
import { SEVERITY_RANK } from './constants.js';

// ---------- Model per peran (biaya minimal, hasil tetap bagus) ----------

/** Tingkat model: cepat (murah) → standar → kuat (mahal). */
export const MODEL_TIERS = ['fast', 'standard', 'strong'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** Peran agent di Chef Juno. */
export const AGENT_ROLES = ['review', 'triage', 'lens', 'validate', 'lead', 'app', 'index', 'learn', 'recap'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const ROLE_LABEL: Record<AgentRole, string> = {
  review: 'Review standar (satu agent)',
  triage: 'Triase PR (mode mendalam)',
  lens: 'Putaran spesialis (mode mendalam)',
  validate: 'Validasi temuan P0/P1 (mode mendalam)',
  lead: 'Reviewer akhir: periksa & tulis ulang temuan, skor, ringkasan (setiap review)',
  app: 'Rencana uji aplikasi (langkah di browser)',
  index: 'Ringkasan modul (knowledge base)',
  learn: 'Belajar dari PR yang ditutup (memory)',
  recap: 'Narasi rapor mingguan',
};

/**
 * Default "seimbang": model kuat hanya untuk keputusan berisiko tinggi (validasi P0/P1);
 * pekerjaan ringan (triase, ringkasan modul, belajar, rapor) memakai model cepat.
 */
export const DEFAULT_ROLE_TIERS: Record<AgentRole, ModelTier> = {
  review: 'standard',
  triage: 'fast',
  lens: 'standard',
  validate: 'strong',
  lead: 'strong', // reviewer akhir Opus di setiap review
  app: 'standard',
  index: 'fast',
  learn: 'fast',
  recap: 'fast',
};

export const MODEL_PROFILES: Record<'hemat' | 'seimbang' | 'maksimal', Record<AgentRole, ModelTier>> = {
  hemat: {
    review: 'standard',
    triage: 'fast',
    lens: 'fast',
    validate: 'standard',
    lead: 'fast',
    app: 'standard',
    index: 'fast',
    learn: 'fast',
    recap: 'fast',
  },
  seimbang: DEFAULT_ROLE_TIERS,
  maksimal: {
    review: 'strong',
    triage: 'fast',
    lens: 'strong',
    validate: 'strong',
    lead: 'strong',
    app: 'strong',
    index: 'standard',
    learn: 'standard',
    recap: 'fast',
  },
};

/**
 * Nama model per tingkat. Claude Code menerima alias. Codex (login ChatGPT): Luna = paling hemat, Sol = default harian,
 * Astra = paling mampu (daftar model Codex di learn.chatgpt.com/docs/models, Nov 2026). Kosong = default CLI.
 */
export const DEFAULT_TIER_MODELS: Record<'claude' | 'codex', Record<ModelTier, string>> = {
  // Haiku tidak dipakai (keputusan pemilik, 24 Nov): pekerjaan ringan memakai Sonnet dengan effort rendah
  claude: { fast: 'sonnet', standard: 'sonnet', strong: 'opus' },
  codex: { fast: 'gpt-6.2-sol', standard: 'gpt-6.2-sol', strong: 'gpt-6.2-astra' },
};

/** Reasoning effort per tingkat (Codex: `model_reasoning_effort`; level tersedia bergantung model). Kosong = default model. */
export const DEFAULT_TIER_EFFORT: Record<'claude' | 'codex', Record<ModelTier, string>> = {
  // standar = high: dengan medium, reviewer cenderung menjawab langsung dari diff tanpa membuka file (kasus #1926)
  claude: { fast: 'low', standard: 'high', strong: 'high' },
  codex: { fast: 'low', standard: 'high', strong: 'high' },
};

export interface ModelConfig {
  /** lama: satu model untuk semua peran (dipakai bila tierModels agent itu belum diatur) */
  models?: { claude?: string; codex?: string };
  roleTiers?: Partial<Record<AgentRole, ModelTier>>;
  tierModels?: { claude?: Partial<Record<ModelTier, string>>; codex?: Partial<Record<ModelTier, string>> };
  tierEffort?: { claude?: Partial<Record<ModelTier, string>>; codex?: Partial<Record<ModelTier, string>> };
}

/** Reasoning effort untuk sebuah peran; undefined = default model. */
export function resolveEffort(
  config: ModelConfig | undefined,
  agent: 'claude' | 'codex',
  role: AgentRole,
): string | undefined {
  const tier = config?.roleTiers?.[role] ?? DEFAULT_ROLE_TIERS[role];
  const e = (config?.tierEffort?.[agent]?.[tier] ?? DEFAULT_TIER_EFFORT[agent][tier] ?? '').trim();
  return /^[a-z]{2,10}$/.test(e) ? e : undefined;
}

/** Model untuk sebuah peran; undefined = biarkan CLI memakai default langganannya. */
export function resolveModel(
  config: ModelConfig | undefined,
  agent: 'claude' | 'codex',
  role: AgentRole,
): string | undefined {
  const tier = config?.roleTiers?.[role] ?? DEFAULT_ROLE_TIERS[role];
  const own = config?.tierModels?.[agent];
  if (!own && config?.models?.[agent]) return config.models[agent] || undefined;
  const m = own?.[tier] ?? DEFAULT_TIER_MODELS[agent][tier];
  return m?.trim() || undefined;
}

// ---------- Mode review ----------

/** auto = Chef Juno memilih sendiri (heuristik, lalu triase model cepat); standard = satu agent; deep = putaran paralel + validasi. */
export const REVIEW_MODES = ['auto', 'standard', 'deep'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/**
 * Kata pertama instruksi memaksa mode untuk PR ini: `dalam` / `mendalam` / `deep` → mendalam;
 * `standar` / `cepat` / `standard` → standar. Sisa kalimat tetap jadi instruksi.
 */
export function parseReviewMode(instruction: string): {
  mode: Exclude<ReviewMode, 'auto'> | null;
  instruction: string;
} {
  const m = /^\s*(dalam|mendalam|deep|standar|standard|cepat)\b[\s,:-]*/i.exec(instruction ?? '');
  if (!m) return { mode: null, instruction: (instruction ?? '').trim() };
  const mode = /^(dalam|mendalam|deep)$/i.test(m[1]) ? 'deep' : 'standard';
  return { mode, instruction: instruction.slice(m[0].length).trim() };
}

/** Area yang perubahannya berisiko tinggi: tidak pernah langsung diputuskan "standar" oleh heuristik. */
export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(auth|login|session|security|crypto|payments?|billing|checkout|wallet|permissions?|acl|admin)[^/]*(\/|\.)/i,
  /(^|\/)(firestore|storage|database)\.rules(\.json)?$/i,
  /(^|\/)(migrations?|schema)(\/|\.)/i,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)(Dockerfile|docker-compose[^/]*)$/i,
  /(^|\/)(AndroidManifest\.xml|Info\.plist|build\.gradle(\.kts)?|Podfile)$/,
  /(^|\/)(pubspec\.yaml|package\.json|go\.mod|requirements\.txt|pyproject\.toml)$/,
  /(^|\/)\.env(\.|$)/i,
];

export const AUTO_SMALL_PR = { maxChangedLines: 150, maxFiles: 8 } as const;

/** Jumlah baris yang ditambah/dihapus di unified diff. */
export function changedLineCount(diff: string): number {
  let n = 0;
  for (const l of diff.split('\n'))
    if ((l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))) n++;
  return n;
}

/**
 * Mode otomatis tanpa memanggil model: PR kecil yang tidak menyentuh area sensitif → standar.
 * Selain itu null → triase (model cepat) yang memutuskan.
 */
export function heuristicReviewMode(
  files: string[],
  changedLines: number,
): { mode: 'standard' | 'deep'; reason: string } | null {
  const small = changedLines <= AUTO_SMALL_PR.maxChangedLines && files.length <= AUTO_SMALL_PR.maxFiles;
  // PR besar selalu mendalam: satu reviewer cenderung membaca diff saja dan melewatkan inkonsistensi antar file
  if (!small) return { mode: 'deep', reason: `PR besar (${changedLines} baris, ${files.length} file)` };
  if (files.some((f) => SENSITIVE_PATH_PATTERNS.some((r) => r.test(f)))) return null;
  return { mode: 'standard', reason: `PR kecil (${changedLines} baris, ${files.length} file) tanpa area sensitif` };
}

/**
 * Cek dokumen & klaim: tipe temuan yang lolos dari pembacaan diff (dokumen jadi usang, deskripsi PR menjanjikan hal
 * yang tidak dilakukan kode). Mode mendalam: putaran `docs`; mode standar: ditempel ke instruksi review.
 */
/** File yang perubahannya dianggap remeh (dokumentasi): review ringan, tanpa uji aplikasi. */
export const TRIVIAL_PATH_PATTERNS: RegExp[] = [
  /\.(md|mdx|markdown|rst|adoc|txt)$/i,
  /(^|\/)docs?\//i,
  /(^|\/)(LICENSE|LICENCE|NOTICE|AUTHORS|CODEOWNERS)(\.[a-z]+)?$/i,
  /^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/i,
  /\.(png|jpe?g|gif|svg|webp)$/i,
];

/**
 * Satu standar review: semua PR direview penuh dan diuji di aplikasi, kecuali perubahan remeh (hanya dokumentasi).
 * Diputuskan aturan path, bukan model.
 */
export function isTrivialChange(files: string[]): boolean {
  return files.length > 0 && files.every((f) => TRIVIAL_PATH_PATTERNS.some((r) => r.test(f)));
}

/**
 * Cek wajib penelusuran: reviewer harus membuka kode, bukan menilai dari diff saja. Contoh yang terlewat: baris baru
 * membaca tabel skor induk padahal di file yang sama sudah ada helper per segmen yang dipakai bagian lain.
 */
export const TRACE_CHECK = `## Cek wajib: telusuri, jangan menilai dari diff saja
1. Buka (Read) setiap file kode yang berubah secara utuh, bukan hanya potongan diff.
2. Untuk setiap nilai, aturan, atau sumber data yang dipakai/diubah PR, cari tempat lain yang membaca hal sejenis —
   mulai dari file yang sama (helper yang sudah ada, cabang lain), lalu fitur & pemanggilnya (Grep/code map).
   Bagian yang masih memakai sumber/aturan lama, atau baris baru yang tidak memakai helper yang sudah ada untuk kasus
   khusus (mis. segmen, varian, mode lain), adalah temuan inkonsistensi.
3. Bandingkan perilaku base vs head untuk kasus khusus yang disentuh PR (nilai kosong/nol, seri, varian data lain).
Kalau kamu tidak sempat membuka file yang berubah, reviewCompletion = incomplete dan jelaskan di uncertainty.
Jangan menyatakan review lengkap sambil mengakui tidak membaca kodenya.`;

export const DOCS_CHECK = `## Cek wajib: dokumen & klaim PR
1. Dokumen yang jadi usang: untuk setiap perilaku/nama/konfigurasi yang diubah PR, Grep dokumen repo (docs/, README,
   CLAUDE.md/AGENTS.md, komentar dokumentasi di kode, changelog) yang menyebutnya. Dokumen yang kini menyatakan hal
   yang salah = temuan di file dokumen itu (path & baris dokumen), kategori maintainability. Kalau aturan repo mewajibkan
   dokumen/changelog diperbarui untuk perubahan seperti ini dan PR tidak melakukannya, laporkan (kutip aturannya).
2. Klaim di deskripsi PR: cocokkan setiap klaim yang bisa diperiksa (angka, ukuran, perilaku, "sudah dites di …",
   "tidak mengubah …") dengan kode & test di PR. Klaim yang tidak didukung kode = temuan di baris kode/test terkait,
   kategori bug kalau menyesatkan perilaku, maintainability kalau hanya dokumentasi. Sebut klaimnya apa adanya.
Severity: dokumen/klaim yang menyesatkan perilaku penting (keamanan, data, alur utama) → P1; lainnya P2.
Jangan melaporkan dokumen yang memang tidak menyebut area yang berubah, atau selera penulisan.`;
export const LENSES = ['correctness', 'docs', 'security', 'platform', 'rules'] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_FOCUS: Record<Lens, string> = {
  correctness: `Kebenaran logika & dampak: bug, null, race, error handling, pemanggil yang rusak (pakai sapu samping & code map). Abaikan gaya.\n\n${TRACE_CHECK}`,
  security:
    'Keamanan saja: jalur data dari input ke titik berbahaya, auth/otorisasi, rahasia, security rules, batas kepercayaan LLM.',
  platform:
    'Stack & platform: jebakan bahasa/framework dari skill yang dimuat (mis. Flutter/Dart, Angular, Firebase), performa nyata, test yang hilang, dependensi & build.',
  rules:
    'Kepatuhan memory tim & aturan repo: pelanggaran aturan tim (kutip aturannya), pola modul di knowledge base, kontrak API & kompatibilitas.',
  docs: `Dokumen & klaim PR saja (bukan bug kode): lakukan cek di bawah sampai tuntas.\n\n${DOCS_CHECK}`,
};

// ---------- Skema output putaran mode mendalam ----------

export const TriageOutputSchema = z.object({
  prType: z.enum(['docs', 'code', 'config', 'mixed']),
  /** mode otomatis: standard = satu agent cukup; deep = perlu putaran paralel + validasi */
  depth: z.enum(['standard', 'deep']),
  lenses: z.array(z.enum(LENSES)),
  reason: z.string(),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const ValidateOutputSchema = z.object({
  valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type ValidateOutput = z.infer<typeof ValidateOutputSchema>;

/** Tingkat dampak perubahan PR terhadap aplikasi (bukan jumlah temuan). */
export const IMPACT_LEVELS = ['rendah', 'sedang', 'tinggi'] as const;

export const LeadOutputSchema = z.object({
  keep: z.array(z.number().int().min(0)),
  /** tulisan ulang temuan yang dipertahankan (gaya: judul = akibat, mekanisme konkret, perbaikan + test) */
  rewrites: z.array(
    z.object({ index: z.number().int().min(0), title: z.string(), what: z.string(), why: z.string(), fix: z.string() }),
  ),
  impact: z.enum(IMPACT_LEVELS),
  /** diagram mermaid kecil alur yang diubah PR; kosong untuk PR sepele */
  diagram: z.string(),
  /** walkthrough perubahan per area */
  walkthrough: z.array(z.object({ area: z.string(), files: z.array(z.string()), change: z.string() })),
  /** perkiraan menit yang dibutuhkan manusia untuk mereview PR ini */
  effortMinutes: z.number().int().min(0),
  score: z.number().int().min(0).max(5),
  verdict: z.string(),
  summary: z.string(),
  lessons: z.array(z.string()),
  reviewCompletion: z.enum(['complete', 'incomplete']),
  uncertainty: z.string(),
});
export type LeadOutput = z.infer<typeof LeadOutputSchema>;

export const TRIAGE_SCHEMA = toStrictJsonSchema(TriageOutputSchema);
export const VALIDATE_SCHEMA = toStrictJsonSchema(ValidateOutputSchema);
export const LEAD_SCHEMA = toStrictJsonSchema(LeadOutputSchema);

/**
 * Mode tujuan: satu agent (boleh memecah kerja ke subagent) menerima tujuan + konteks dan mengembalikan hasil akhir
 * langsung — temuan, skor, dampak, walkthrough, diagram. Cara kerjanya diserahkan ke agent.
 */
export const GoalOutputSchema = ReviewOutputSchema.extend({
  impact: z.enum(IMPACT_LEVELS),
  diagram: z.string(),
  walkthrough: z.array(z.object({ area: z.string(), files: z.array(z.string()), change: z.string() })),
  effortMinutes: z.number().int().min(0),
});
export type GoalOutput = z.infer<typeof GoalOutputSchema>;
export const GOAL_SCHEMA = toStrictJsonSchema(GoalOutputSchema);

// ---------- Penggabungan temuan dari beberapa putaran ----------

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
function similar(a: string, b: string): boolean {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.6;
}

export type MergedFinding = ReviewFinding & { agreement: number; lenses: string[] };

/**
 * Gabungkan temuan dari beberapa putaran (deterministik, tanpa LLM): temuan di file yang sama, baris berdekatan (±3)
 * dan judul mirip dianggap satu. Ambil keparahan tertinggi; kesepakatan ≥ 2 putaran menaikkan keyakinan (+0.1, maks 1).
 */
export function mergeFindings(passes: { lens: string; findings: ReviewFinding[] }[]): MergedFinding[] {
  const out: MergedFinding[] = [];
  for (const p of passes) {
    for (const f of p.findings) {
      // temuan keamanan tidak digabung dengan non-keamanan: kategori security punya perlakuan khusus (tidak di-suppress)
      const same = out.find(
        (m) =>
          m.path === f.path &&
          Math.abs(m.line - f.line) <= 3 &&
          (m.category === 'security') === (f.category === 'security') &&
          similar(m.title, f.title),
      );
      if (!same) {
        out.push({ ...f, agreement: 1, lenses: [p.lens] });
        continue;
      }
      if (!same.lenses.includes(p.lens)) {
        same.lenses.push(p.lens);
        same.agreement++;
      }
      const skill = same.skill || f.skill; // putaran mana pun yang menyebut skill dasar temuan
      if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[same.severity])
        Object.assign(same, { ...f, agreement: same.agreement, lenses: same.lenses });
      same.skill = same.skill || skill;
      same.confidence = Math.max(same.confidence, f.confidence);
    }
  }
  for (const m of out) if (m.agreement >= 2) m.confidence = Math.min(1, Math.round((m.confidence + 0.1) * 100) / 100);
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence);
}

// ---------- Verifikasi empiris: analisis statis di container ----------

/** `.chefjuno/verify.json` di branch tujuan (bukan dari PR, supaya PR tidak bisa mengganti perintahnya). */
export const VerifyConfigSchema = z.object({
  image: z.string().min(1).max(200),
  /** butuh jaringan (mis. `flutter pub get`, `npm ci --ignore-scripts`); berjalan tanpa secret */
  setup: z.array(z.string().min(1).max(500)).max(5).default([]),
  /** tanpa jaringan (mis. `flutter analyze --no-pub`, `npx tsc --noEmit`) */
  analyze: z.array(z.string().min(1).max(500)).min(1).max(5),
  timeoutSec: z.number().int().min(30).max(1800).default(600),
});
export type VerifyConfig = z.infer<typeof VerifyConfigSchema>;

/** Baris diagnostik dinormalkan (tanpa nomor kolom, durasi, path absolut) supaya base vs head bisa dibandingkan. */
export function normalizeDiagnostic(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\/src\//g, '')
    .replace(/:(\d+):(\d+)/g, ':$1')
    .replace(/\(\d+(\.\d+)?m?s\)/g, '')
    .trim();
}

const DIAG_RE = /(error|warning|warn|info|lint|•|✖|✗)\b|\.(dart|ts|tsx|js|py|go|kt|swift):\d+/i;

/** Diagnostik yang ada di head tapi tidak ada di base (multiset). Ringkasan & baris progres diabaikan. */
export function newDiagnostics(baseOut: string, headOut: string, max = 50): string[] {
  const lines = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && DIAG_RE.test(l) && !/^(analyzing|\d+ issues? found|no issues found)/i.test(l));
  const base = new Map<string, number>();
  for (const l of lines(baseOut)) {
    const k = normalizeDiagnostic(l).replace(/:\d+/g, '');
    base.set(k, (base.get(k) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const l of lines(headOut)) {
    const k = normalizeDiagnostic(l).replace(/:\d+/g, '');
    const n = base.get(k) ?? 0;
    if (n > 0) base.set(k, n - 1);
    else out.push(normalizeDiagnostic(l));
    if (out.length >= max) break;
  }
  return out;
}
