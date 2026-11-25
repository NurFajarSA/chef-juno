import { z } from 'zod';
import { toStrictJsonSchema, type ReviewFinding } from './schemas.js';
import { SEVERITY_RANK } from './constants.js';

/**
 * Uji aplikasi (verifikasi empiris tahap 2): reviewer membangun versi web PR, mencobanya di browser headless
 * dengan langkah terbatas (bukan kode bebas), lalu memutuskan apakah temuan terbukti — dengan screenshot sebagai bukti.
 */
export const APP_CONFIG_PATH = '.chefjuno/app.json';

/** Placeholder kredensial akun testing; hanya boleh dipakai di langkah `login` milik repo, tidak pernah dari agent. */
export const CREDENTIAL_PLACEHOLDERS = ['{{email}}', '{{password}}'] as const;

export const STEP_KINDS = [
  'goto',
  'click',
  'fill',
  'press',
  'scroll',
  'wait',
  'screenshot',
  'expectText',
  'expectNoText',
] as const;
export const TARGET_ROLES = [
  'button',
  'link',
  'textbox',
  'checkbox',
  'switch',
  'radio',
  'tab',
  'menuitem',
  'heading',
  'combobox',
  'img',
] as const;
export const PRESS_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
] as const;

/**
 * Satu langkah, bentuk datar dengan field nullable supaya bisa jadi JSON schema strict untuk agent.
 * Field yang dipakai bergantung `do` (dicek `stepProblem`).
 */
export const AppStepSchema = z.object({
  do: z.enum(STEP_KINDS),
  /** goto: path dalam aplikasi, mis. "/profil" */
  path: z.string().max(500).nullable(),
  /** click/fill: elemen sasaran — teks terlihat, label aksesibilitas, atau role (+ name) */
  text: z.string().max(200).nullable(),
  label: z.string().max(200).nullable(),
  role: z.enum(TARGET_ROLES).nullable(),
  name: z.string().max(200).nullable(),
  /** urutan bila ada beberapa elemen cocok (0 = pertama) */
  nth: z.number().int().min(0).max(20).nullable(),
  /** fill: isi; press: tombol; scroll: piksel (dy); wait: ms; screenshot: nama file */
  value: z.string().max(500).nullable(),
  key: z.enum(PRESS_KEYS).nullable(),
  dy: z.number().int().min(-5000).max(5000).nullable(),
  ms: z.number().int().min(0).max(10_000).nullable(),
  shot: z.string().nullable(),
});
export type AppStep = z.infer<typeof AppStepSchema>;

/** Langkah dari file config boleh menghilangkan field null. */
const ConfigStepSchema = z
  .object({
    do: z.enum(STEP_KINDS),
    path: z.string().max(500).optional(),
    text: z.string().max(200).optional(),
    label: z.string().max(200).optional(),
    role: z.enum(TARGET_ROLES).optional(),
    name: z.string().max(200).optional(),
    nth: z.number().int().min(0).max(20).optional(),
    value: z.string().max(500).optional(),
    key: z.enum(PRESS_KEYS).optional(),
    dy: z.number().int().min(-5000).max(5000).optional(),
    ms: z.number().int().min(0).max(10_000).optional(),
    shot: z.string().optional(),
  })
  .transform((s): AppStep => ({
    do: s.do,
    path: s.path ?? null,
    text: s.text ?? null,
    label: s.label ?? null,
    role: s.role ?? null,
    name: s.name ?? null,
    nth: s.nth ?? null,
    value: s.value ?? null,
    key: s.key ?? null,
    dy: s.dy ?? null,
    ms: s.ms ?? null,
    shot: s.shot ?? null,
  }));

/** Alasan langkah tidak sah (null = sah). `allowCredentials` hanya untuk langkah login dari repo. */
export function stepProblem(s: AppStep, allowCredentials = false): string | null {
  const hasTarget = !!(s.text || s.label || s.role);
  const strings = [s.path, s.text, s.label, s.name, s.value].filter((x): x is string => typeof x === 'string');
  if (!allowCredentials && strings.some((x) => x.includes('{{')))
    return 'placeholder kredensial hanya boleh di langkah login';
  switch (s.do) {
    case 'goto':
      return s.path && /^\/[^\s]*$/.test(s.path) && !s.path.startsWith('//') ? null : 'goto butuh path diawali "/"';
    case 'click':
      return hasTarget ? null : 'click butuh text, label, atau role';
    case 'fill':
      return hasTarget && s.value !== null ? null : 'fill butuh sasaran dan value';
    case 'press':
      return s.key ? null : 'press butuh key';
    case 'scroll':
      return s.dy !== null ? null : 'scroll butuh dy';
    case 'wait':
      return s.ms !== null || s.text ? null : 'wait butuh ms atau text';
    case 'screenshot':
      return s.shot && /^[a-z0-9-]{1,40}$/.test(s.shot) ? null : 'screenshot butuh shot berupa huruf kecil/angka/strip';
    case 'expectText':
    case 'expectNoText':
      return s.text ? null : `${s.do} butuh text`;
  }
}

const RelPath = z
  .string()
  .regex(/^[\w./-]+$/)
  .refine((p) => !p.split('/').includes('..') && !p.startsWith('/'), 'path relatif di dalam repo');

/** Versi playwright-core yang dibundel daemon; image runner harus sama supaya browser cocok. */
export const RUNNER_PLAYWRIGHT_VERSION = '1.65.1';
export const DEFAULT_RUNNER_IMAGE = `mcr.microsoft.com/playwright:v${RUNNER_PLAYWRIGHT_VERSION}-noble`;

export const AppConfigSchema = z.object({
  build: z.object({
    image: z.string().min(1),
    /** boleh berjaringan (unduh dependensi), maks 5 perintah */
    setup: z.array(z.string().min(1)).max(5).default([]),
    commands: z.array(z.string().min(1)).min(1).max(5),
    /** folder hasil build web, relatif ke root repo */
    outDir: RelPath,
    timeoutSec: z.number().int().min(60).max(3600).default(1200),
  }),
  runner: z.object({ image: z.string().min(1).default(DEFAULT_RUNNER_IMAGE) }).default({ image: DEFAULT_RUNNER_IMAGE }),
  /** default ukuran ponsel; aplikasi Flutter umumnya dipakai di ponsel */
  viewport: z
    .object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(480).max(1400) })
    .default({ width: 412, height: 915 }),
  /** aktifkan pohon semantics Flutter web supaya elemen bisa dicari lewat teks/label */
  flutterSemantics: z.boolean().default(true),
  /** langkah login akun testing; `{{email}}` / `{{password}}` diisi dari mesin (tidak pernah dilihat agent) */
  login: z.array(ConfigStepSchema).max(20).default([]),
  /**
   * Firebase App Check di web lokal memakai debug token. true = runner memasang token tetap dari mesin
   * (`appCheckDebugToken` di ~/.chefjuno/app-accounts.json) sebelum aplikasi dimuat; token harus sudah didaftarkan
   * di Firebase Console → App Check → Manage debug tokens.
   */
  appCheckDebugToken: z.boolean().default(false),
  /** host yang diblokir saat uji (analitik, pembayaran, notifikasi, dll) */
  blockHosts: z
    .array(z.string().regex(/^[a-z0-9.*-]+$/i))
    .max(50)
    .default([]),
  maxScenarios: z.number().int().min(1).max(5).default(3),
  /** batas waktu uji di browser (semua skenario) */
  timeoutSec: z.number().int().min(60).max(900).default(300),
  /** catatan untuk agent: rute penting, kondisi akun testing, hal yang tidak boleh diklik */
  notes: z.string().max(4000).default(''),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------- Profil lokal mesin: emulator ----------

/** Nama file profil lokal di folder Chef Juno mesin (~/.chefjuno). Milik pemilik mesin, tidak dibaca dari repo/PR. */
export const LOCAL_APP_PROFILE_FILE = 'app-local.json';

const Port = z.number().int().min(1).max(65535);
const Command = z.array(z.string().min(1)).min(1).max(20);
const StepCommand = z.object({
  command: Command,
  env: z.record(z.string(), z.string()).default({}),
  timeoutSec: z.number().int().min(5).max(1800).default(300),
});

/**
 * Uji aplikasi terhadap emulator lokal di mesin ini (bukan backend produksi): patch emulator dipasang ke salinan kode PR,
 * `--dart-define` diambil dari perintah stack, dan port emulator di laptop diteruskan ke 127.0.0.1 di container runner.
 */
export const LocalEmulatorSchema = z.object({
  /** patch (path absolut) dicoba berurutan; yang pertama lolos `git apply --check` dipakai */
  patches: z.array(z.string().min(1)).max(5).default([]),
  /** perintah yang mencetak `--dart-define=…`; hasilnya mengganti `{{defines}}` di perintah build */
  definesCommand: Command.optional(),
  /** port emulator di mesin yang diteruskan ke 127.0.0.1 di container runner */
  forwardPorts: z.array(Port).max(20).default([]),
  forwardHost: z
    .string()
    .regex(/^[a-z0-9.:-]+$/i)
    .default('host.docker.internal'),
  /** port yang harus menyala di mesin sebelum uji dimulai (emulator hidup) */
  requirePorts: z.array(Port).max(20).default([]),
  /** akun emulator dari tabel TSV: kolom 1 = nama baris, 2 = uid, 3 = email, 4 = kata sandi */
  account: z.object({ tsv: z.string().min(1), row: z.string().min(1) }).optional(),
  /** kunci stack/akun bersama; `{{pid}}` = proses penahan yang hidup selama uji */
  locks: z
    .array(
      z.object({
        acquire: Command,
        release: Command.optional(),
        env: z.record(z.string(), z.string()).default({}),
        timeoutSec: z.number().int().min(5).max(1800).default(600),
      }),
    )
    .max(5)
    .default([]),
  /** perintah setelah kunci didapat, sebelum build (mis. kembalikan data akun emulator ke seed awal) */
  prepare: z.array(StepCommand).max(5).default([]),
  /** pemulihan otomatis bila `prepare` gagal (mis. bangun ulang salinan stack yang rusak), lalu `prepare` dicoba sekali lagi */
  repair: z.array(StepCommand).max(5).default([]),
  /** menyalakan stack emulator bila port `requirePorts` tidak menjawab (mis. `emu-stack.sh up`), lalu dicek ulang */
  start: z.array(StepCommand).max(5).default([]),
});
export type LocalEmulator = z.infer<typeof LocalEmulatorSchema>;

/**
 * Uji aplikasi oleh agent (disarankan): satu agent tepercaya menyetir app lewat skill verify tim (seperti lane
 * functional reviewer-agent), interaktif, lalu melapor hasil + screenshot + pelajaran. Menggantikan build container,
 * runner, dan perencana/penilai terpisah.
 */
export const AgentTestSchema = z.object({
  /** instruksi tambahan untuk penguji (cara launch, akun, hal yang tidak boleh diklik) */
  instructions: z.string().max(6000).default(''),
  /** berkas yang wajib dibaca dulu (path absolut, mis. skill verify workspace); skill verify repo dibaca otomatis */
  readFirst: z.array(z.string().min(1)).max(10).default([]),
  /** batas waktu agent penguji */
  timeoutMin: z.number().int().min(5).max(90).default(40),
  /**
   * Mematikan app yang dijalankan penguji (mis. `app.sh stop web chefjuno`). Dijalankan di worktree PR setelah uji
   * selesai/gagal, dan saat mesin menyala untuk sisa job yang terputus — app yatim tidak boleh mengganggu uji berikutnya.
   */
  cleanup: z.array(StepCommand).max(5).default([]),
});
export type AgentTest = z.infer<typeof AgentTestSchema>;

// laporan agent dipotong (bukan ditolak) bila lebih panjang dari batas — hasil uji yang nyata tidak boleh hilang
const clipStr = (n: number) => z.string().transform((x) => x.slice(0, n));
const clipArr = <T extends z.ZodTypeAny>(t: T, n: number) => z.array(t).transform((xs) => xs.slice(0, n));
const status = z.enum(['reproduced', 'not_reproduced', 'inconclusive']);
export const AppAgentOutputSchema = z.object({
  change: z.object({ status, note: clipStr(1500), shots: clipArr(clipStr(200), 8) }),
  findings: clipArr(
    z.object({ item: z.number().int().min(1), status, note: clipStr(1500), shots: clipArr(clipStr(200), 6) }),
    10,
  ),
  skipped: clipArr(z.object({ item: z.number().int().min(1), reason: clipStr(500) }), 10),
  /** fakta penting tentang cara menguji app ini yang perlu diingat Chef Juno (mis. akun harus premium) */
  lessons: clipArr(clipStr(400), 6),
});
export type AppAgentOutput = z.infer<typeof AppAgentOutputSchema>;

const shotList = (max: number) => ({ type: 'array', items: { type: 'string' }, maxItems: max });
const statusEnum = { type: 'string', enum: ['reproduced', 'not_reproduced', 'inconclusive'] };
export const APP_AGENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['change', 'findings', 'skipped', 'lessons'],
  properties: {
    change: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'note', 'shots'],
      properties: { status: statusEnum, note: { type: 'string' }, shots: shotList(8) },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'status', 'note', 'shots'],
        properties: { item: { type: 'integer' }, status: statusEnum, note: { type: 'string' }, shots: shotList(6) },
      },
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'reason'],
        properties: { item: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
    lessons: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const LocalAppProfileSchema = z.object({
  /** uji oleh agent tepercaya lewat skill verify tim (disarankan); bila ada, build container & runner tidak dipakai */
  agentTest: AgentTestSchema.optional(),
  /** konfigurasi uji yang dipakai di mesin ini (menggantikan .chefjuno/app.json repo) */
  config: AppConfigSchema.optional(),
  /** volume Docker bernama yang dipasang saat build (mis. cache pub) supaya build berikutnya tidak mengunduh ulang */
  buildCache: z
    .array(
      z.object({
        volume: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/i),
        path: z.string().regex(/^\/[A-Za-z0-9_./-]+$/),
      }),
    )
    .max(3)
    .default([]),
  emulator: LocalEmulatorSchema.optional(),
});
export type LocalAppProfile = z.infer<typeof LocalAppProfileSchema>;

/** Hasil `definesCommand` hanya boleh berisi `--dart-define=NAMA=nilai` tanpa karakter shell. */
export function safeDefines(out: string): string | null {
  const t = out.trim().split(/\s+/).filter(Boolean);
  return t.every((x) => /^--dart-define=[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_.:/@%+,-]*$/.test(x)) ? t.join(' ') : null;
}

/**
 * Placeholder di perintah build mode emulator. Kredensial menjadi referensi variabel env (nilainya tidak pernah masuk
 * argumen proses), `{{defines}}` diganti hasil `definesCommand` yang sudah disaring.
 */
export function expandBuildCommand(cmd: string, defines: string): string {
  return cmd
    .replaceAll('{{defines}}', defines)
    .replaceAll('{{email}}', '"$CHEFJUNO_APP_EMAIL"')
    .replaceAll('{{password}}', '"$CHEFJUNO_APP_PASSWORD"')
    .replaceAll('{{uid}}', '"$CHEFJUNO_APP_UID"');
}

// ---------- Agent: perencana & penilai ----------

export const AppPlanOutputSchema = z.object({
  scenarios: z.array(
    z.object({
      /** nomor temuan di daftar yang diberikan (mulai 1) */
      finding: z.number().int().min(1),
      goal: z.string().max(500),
      steps: z.array(AppStepSchema).max(25),
    }),
  ),
  /** temuan yang tidak bisa dicoba lewat UI, beserta alasan */
  skipped: z.array(z.object({ finding: z.number().int().min(1), reason: z.string().max(300) })),
});
export type AppPlanOutput = z.infer<typeof AppPlanOutputSchema>;

export const EVIDENCE_STATUSES = ['reproduced', 'not_reproduced', 'inconclusive'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const AppJudgeOutputSchema = z.object({
  verdicts: z.array(
    z.object({
      finding: z.number().int().min(1),
      status: z.enum(EVIDENCE_STATUSES),
      /** penjelasan singkat apa yang terlihat saat dicoba */
      note: z.string().max(600),
      /** nama screenshot yang paling menunjukkan masalah (kosong bila tidak ada) */
      shot: z.string(),
    }),
  ),
});
export type AppJudgeOutput = z.infer<typeof AppJudgeOutputSchema>;

export const APP_PLAN_SCHEMA = toStrictJsonSchema(AppPlanOutputSchema);
export const APP_JUDGE_SCHEMA = toStrictJsonSchema(AppJudgeOutputSchema);

// ---------- Hasil runner (ditulis script runner di container) ----------

export const RunnerResultSchema = z.object({
  loginOk: z.boolean(),
  error: z.string().nullable().default(null),
  scenarios: z.array(
    z.object({
      index: z.number().int(),
      steps: z.array(
        z.object({ i: z.number().int(), do: z.string(), ok: z.boolean(), error: z.string().nullable().default(null) }),
      ),
      shots: z.array(z.object({ name: z.string(), file: z.string() })),
      console: z.array(z.string()),
      pageErrors: z.array(z.string()),
      failedRequests: z.array(z.string()),
      aria: z.string(),
      url: z.string(),
      durationMs: z.number(),
    }),
  ),
});
export type RunnerResult = z.infer<typeof RunnerResultSchema>;

// ---------- Bukti per temuan ----------

export interface FindingEvidence {
  status: EvidenceStatus;
  note: string;
  goal: string;
  /** id dokumen jobs/{jobId}/evidence/{id}; pertama = bukti utama */
  shots: string[];
}

/** Temuan yang layak dicoba di aplikasi: P0/P1 lebih dulu, lalu keyakinan tertinggi. */
export function pickAppCandidates(findings: ReviewFinding[], max: number): number[] {
  return (
    findings
      .map((f, i) => ({ f, i }))
      // satu standar: semua temuan yang bisa terlihat di aplikasi dicoba (P0–P2), bukan hanya P0/P1
      .filter(({ f }) => f.category !== 'test' && f.category !== 'maintainability')
      .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || b.f.confidence - a.f.confidence)
      .slice(0, max)
      .map(({ i }) => i)
  );
}

/**
 * Keyakinan setelah dicoba: terbukti → minimal 0.95; tidak terbukti → dikali 0.6 (bisa jatuh di bawah ambang
 * posting dan jadi "ditahan"); tidak meyakinkan → tetap.
 */
export function confidenceAfterTrial(confidence: number, status: EvidenceStatus): number {
  if (status === 'reproduced') return Math.max(confidence, 0.95);
  if (status === 'not_reproduced') return Math.round(confidence * 0.6 * 100) / 100;
  return confidence;
}

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  reproduced: 'Terbukti saat dicoba di aplikasi',
  not_reproduced: 'Tidak muncul saat dicoba di aplikasi',
  inconclusive: 'Sudah dicoba di aplikasi, hasil belum meyakinkan',
};
