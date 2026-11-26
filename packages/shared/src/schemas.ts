import { PROMPT_KEYS } from './prompts/defaults.js';
import { z } from 'zod';
import { CATEGORIES, JOB_STATUSES, JOB_TYPES, SEVERITIES } from './constants.js';

// ---------- Output agent (strict, semua field wajib, opsional = nullable) ----------

export const ReviewFindingSchema = z.object({
  path: z.string(),
  line: z.number().int(),
  startLine: z.number().int().nullable(),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  title: z.string(),
  what: z.string(),
  why: z.string(),
  fix: z.string(),
  suggestion: z.string().nullable(),
  /** keyakinan bahwa temuan ini nyata & diperkenalkan PR ini (0–1) */
  confidence: z.number().min(0).max(1),
  /** kondisi/input yang membuat masalah muncul; kosong bila berlaku untuk semua input */
  trigger: z.string(),
  /** slug skill tim yang menjadi dasar temuan (dari bagian "# Skill tim"); kosong bila tidak berasal dari skill */
  skill: z.string(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const REVIEW_COMPLETIONS = ['complete', 'incomplete'] as const;

export const ReviewOutputSchema = z.object({
  score: z.number().int().min(0).max(5),
  verdict: z.string(),
  summary: z.string(),
  lessons: z.array(z.string()),
  findings: z.array(ReviewFindingSchema),
  /** incomplete = ada bagian yang tidak bisa dinilai (konteks kurang, diff terpotong, belum selesai) — tidak pernah dianggap bersih */
  reviewCompletion: z.enum(REVIEW_COMPLETIONS),
  /** ketidakpastian material / alasan incomplete; kosong bila tidak ada */
  uncertainty: z.string(),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/**
 * Varian longgar untuk hasil yang SUDAH tersimpan (job lama sebelum field confidence/trigger/reviewCompletion ada).
 * Output agent baru tetap divalidasi dengan ReviewOutputSchema yang ketat.
 */
export const StoredReviewOutputSchema = ReviewOutputSchema.extend({
  findings: z.array(
    ReviewFindingSchema.extend({
      confidence: z.number().min(0).max(1).default(1),
      trigger: z.string().default(''),
      skill: z.string().default(''),
      /** hasil uji aplikasi (diisi daemon, bukan agent) */
      evidence: z
        .object({
          status: z.enum(['reproduced', 'not_reproduced', 'inconclusive']),
          note: z.string(),
          goal: z.string(),
          shots: z.array(z.string()),
        })
        .optional(),
    }),
  ),
  reviewCompletion: z.enum(REVIEW_COMPLETIONS).default('complete'),
  uncertainty: z.string().default(''),
  /** dari reviewer akhir: tingkat dampak, diagram alur, walkthrough, perkiraan usaha review */
  impactLevel: z.enum(['rendah', 'sedang', 'tinggi']).optional(),
  diagram: z.string().default(''),
  walkthrough: z.array(z.object({ area: z.string(), files: z.array(z.string()), change: z.string() })).default([]),
  effortMinutes: z.number().int().min(0).nullable().default(null),
});

export const ModuleSummaryOutputSchema = z.object({
  modules: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      patterns: z.array(z.string()),
    }),
  ),
});
export type ModuleSummaryOutput = z.infer<typeof ModuleSummaryOutputSchema>;

export const LearnOutputSchema = z.object({
  rules: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['rule', 'suppression', 'fact']),
      category: z.enum(CATEGORIES),
      paths: z.array(z.string()),
      matchTitle: z.string().nullable(),
      evidence: z.array(z.string()),
    }),
  ),
  personalLessons: z.array(
    z.object({
      login: z.string(),
      key: z.string(),
      title: z.string(),
      category: z.enum(CATEGORIES),
      lesson: z.string(),
    }),
  ),
});
export type LearnOutput = z.infer<typeof LearnOutputSchema>;

export const RecapOutputSchema = z.object({ narrative: z.string() });
export type RecapOutput = z.infer<typeof RecapOutputSchema>;

type JsonObj = { [k: string]: unknown };

/** Paksa aturan strict OpenAI/Codex: additionalProperties:false, required lengkap, tanpa format/oneOf. */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const o: JsonObj = {};
  for (const [k, v] of Object.entries(node as JsonObj)) {
    if (k === 'format' || k === '$schema' || k === 'pattern') continue;
    if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue;
    o[k] = strictify(v);
  }
  if (o.oneOf) {
    o.anyOf = o.oneOf;
    delete o.oneOf;
  }
  if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
    o.additionalProperties = false;
    o.required = Object.keys(o.properties as JsonObj);
  }
  return o;
}

export function toStrictJsonSchema(schema: z.ZodType): JsonObj {
  const raw = z.toJSONSchema(schema, { target: 'draft-7' }) as JsonObj;
  const out = strictify(raw) as JsonObj;
  return { $schema: 'http://json-schema.org/draft-07/schema#', ...out };
}

export const REVIEW_OUTPUT_SCHEMA = toStrictJsonSchema(ReviewOutputSchema);
export const MODULE_SUMMARY_SCHEMA = toStrictJsonSchema(ModuleSummaryOutputSchema);
export const LEARN_OUTPUT_SCHEMA = toStrictJsonSchema(LearnOutputSchema);
export const RECAP_OUTPUT_SCHEMA = toStrictJsonSchema(RecapOutputSchema);

// ---------- Dokumen Firestore (bentuk yang dipakai lintas paket) ----------

export const RoleSchema = z.enum(['admin', 'member']);
export const LevelSchema = z.enum(['junior', 'mid', 'senior']);
export type Level = z.infer<typeof LevelSchema>;

export const UpsertMemberInputSchema = z.object({
  githubLogin: z.string().min(1, 'Login GitHub wajib diisi').max(39),
  githubUserId: z.string().regex(/^\d+$/, 'ID GitHub harus angka').optional(),
  name: z.string().max(100).optional(),
  role: RoleSchema,
  /** @deprecated level penulis dihapus atas keputusan pemilik (24 Nov 2026): semua anggota diperlakukan sama. Diterima tapi diabaikan. */
  level: LevelSchema.optional(),
});

export const MachineRegistrationInputSchema = z.object({
  name: z.string().trim().min(2, 'Nama mesin minimal 2 karakter').max(60, 'Nama mesin maksimal 60 karakter'),
});

export const PromptKeySchema = z.enum(PROMPT_KEYS);
export type PromptKey = z.infer<typeof PromptKeySchema>;

export const SavePromptVersionInputSchema = z.object({
  key: PromptKeySchema,
  content: z.string().min(1, 'Isi prompt tidak boleh kosong').max(100_000),
  message: z.string().trim().min(3, 'Pesan perubahan minimal 3 karakter').max(300),
  activate: z.boolean().optional(),
});

export const ManualRuleInputSchema = z.object({
  text: z.string().trim().min(5, 'Aturan minimal 5 karakter').max(1000),
  category: z.enum(CATEGORIES),
  repoId: z.string().nullable(),
  paths: z.array(z.string()),
});

export const AgentInfoSchema = z.object({
  version: z.string(),
  subscription: z.boolean(),
  isolation: z.string(),
  enabled: z.boolean(),
  authMethod: z.string().nullable(),
  warning: z.string().nullable(),
});
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export const JobConfigSchema = z.object({
  preferredAgent: z.enum(['any', 'claude', 'codex']),
  models: z.object({ claude: z.string().optional(), codex: z.string().optional() }),
  agentMaxTurns: z.number().int(),
  maxDiffBytes: z.number().int(),
  reviewTimeoutMinutes: z.number(),
  maxInlineComments: z.number().int().min(0).max(30),
  /** temuan dengan confidence di bawah ini tidak diposting ke PR (tetap di dashboard) */
  minConfidence: z.number().min(0).max(1).optional(),
  /** prioritas terendah yang diposting ke PR: P0 = hanya P0, P2 = semua */
  maxPostPriority: z.enum(SEVERITIES).optional(),
  /** standard = satu agent; deep = triase → putaran spesialis paralel → validasi P0/P1 → lead */
  reviewMode: z.enum(['auto', 'standard', 'deep']).optional(),
  /** tingkat model per peran (lihat models.ts) */
  roleTiers: z.record(z.string(), z.enum(['fast', 'standard', 'strong'])).optional(),
  /** nama model per tingkat untuk tiap agent */
  tierModels: z
    .object({ claude: z.record(z.string(), z.string()).optional(), codex: z.record(z.string(), z.string()).optional() })
    .optional(),
  /** reasoning effort per tingkat untuk tiap agent */
  tierEffort: z
    .object({ claude: z.record(z.string(), z.string()).optional(), codex: z.record(z.string(), z.string()).optional() })
    .optional(),
  /** jalankan analisis statis dari .chefjuno/verify.json di container (butuh Docker/Podman di mesin) */
  verifyEnabled: z.boolean().optional(),
  /** uji aplikasi: build web PR dari .chefjuno/app.json dan coba temuan di browser (butuh Docker/Podman + akun testing) */
  appVerifyEnabled: z.boolean().optional(),
});
export type JobConfig = z.infer<typeof JobConfigSchema>;

export const JobTypeSchema = z.enum(JOB_TYPES);
export const JobStatusSchema = z.enum(JOB_STATUSES);

export const ResultMetaSchema = z.object({
  agent: z.enum(['claude', 'codex']),
  model: z.string().nullable(),
  durationMs: z.number(),
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  numTurns: z.number().nullable().optional(),
  isolation: z.string().optional(),
  graphMcp: z.boolean().optional(),
  indexBuildMs: z.number().nullable().optional(),
  diffTruncated: z.boolean().optional(),
});
export type ResultMeta = z.infer<typeof ResultMetaSchema>;
