import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LENS_FOCUS,
  LENSES,
  REVIEW_OUTPUT_SCHEMA,
  ReviewOutputSchema,
  TRIAGE_SCHEMA,
  TriageOutputSchema,
  VALIDATE_SCHEMA,
  ValidateOutputSchema,
  mergeFindings,
  resolveEffort,
  resolveModel,
  type AgentRole,
  type JobConfig,
  type Lens,
  type MergedFinding,
  type ReviewFinding,
  type ReviewOutput,
  type TriageOutput,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { promptFor } from './prompt-source.js';
import { progress } from './progress.js';
import { runFinalReview, type FinalOutput } from './final-review.js';
import { AgentError } from '../agents/types.js';

/** Batas giliran agent yang dianggap "tidak menelusuri" (jawab langsung dari diff tanpa membuka file). */
export const SHALLOW_MAX_TURNS = 2;
export const SHALLOW_NUDGE = `PERHATIAN: percobaan sebelumnya menjawab tanpa membuka satu file pun. Itu tidak diterima.
Sebelum menjawab, WAJIB: Read setiap file kode yang berubah secara utuh, lalu Grep tempat lain yang membaca nilai/aturan
yang diubah PR (lihat "Cek wajib: telusuri"). Baru setelah itu tulis hasil review.`;

export interface PassMeta {
  role: AgentRole;
  label: string;
  model: string | null;
  ok: boolean;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** giliran agent (≤2 = tidak menelusuri kode) */
  numTurns?: number | null;
  error?: string;
}

/** Satu pemanggilan agent dengan model sesuai perannya; tiap putaran punya folder kerja sendiri (aman paralel). */
export async function runPass(
  ctx: JobContext,
  o: {
    role: AgentRole;
    label: string;
    cwd: string;
    jobDir: string;
    systemPrompt: string;
    userPrompt: string;
    schema: Record<string, unknown>;
  },
): Promise<{ output: unknown; raw: string; meta: PassMeta }> {
  const config = ctx.job.config as JobConfig;
  const dir = join(o.jobDir, `pass-${o.label}`);
  mkdirSync(dir, { recursive: true });
  const model = resolveModel(config, ctx.agent.name, o.role);
  const started = Date.now();
  const res = await progress(ctx).step(o.label, () =>
    ctx.agent.run({
      cwd: o.cwd,
      jobDir: dir,
      systemPrompt: o.systemPrompt,
      userPrompt: o.userPrompt,
      schema: o.schema,
      model,
      effort: resolveEffort(config, ctx.agent.name, o.role),
      maxTurns: config.agentMaxTurns,
      timeoutMs: config.reviewTimeoutMinutes * 60_000,
    }),
  );
  return {
    output: res.output,
    raw: res.raw,
    meta: {
      role: o.role,
      label: o.label,
      model: res.meta.model ?? model ?? null,
      ok: true,
      durationMs: Date.now() - started,
      inputTokens: res.meta.inputTokens,
      outputTokens: res.meta.outputTokens,
      numTurns: res.meta.numTurns,
    },
  };
}

export const failed = (role: AgentRole, label: string, e: unknown, started: number): PassMeta => ({
  role,
  label,
  model: null,
  ok: false,
  durationMs: Date.now() - started,
  inputTokens: null,
  outputTokens: null,
  error: (e as Error).message?.slice(0, 300) ?? String(e),
});

/** Triase (model cepat): dipakai mode otomatis untuk memilih kedalaman dan oleh mode mendalam untuk memilih putaran. */
export async function runTriage(
  ctx: JobContext,
  o: { cwd: string; jobDir: string; prBrief: string },
): Promise<{ triage: TriageOutput | null; meta: PassMeta }> {
  const t0 = Date.now();
  try {
    const t = await runPass(ctx, {
      ...o,
      role: 'triage',
      label: 'triage',
      systemPrompt: await promptFor(ctx, 'triage'),
      userPrompt: o.prBrief,
      schema: TRIAGE_SCHEMA,
    });
    const p = TriageOutputSchema.safeParse(t.output);
    return {
      triage: p.success ? p.data : null,
      meta: p.success ? t.meta : { ...t.meta, ok: false, error: 'output tidak sesuai schema' },
    };
  } catch (e) {
    return { triage: null, meta: failed('triage', 'triage', e, t0) };
  }
}

export interface DeepReviewInput {
  cwd: string;
  jobDir: string;
  persona: string;
  /** persona + instruksi review + skill (dipakai putaran spesialis) */
  systemPrompt: string;
  /** konteks lengkap PR (diff, code map, memory, verifikasi) */
  userPrompt: string;
  /** judul/deskripsi/daftar file (tanpa diff) untuk triase & lead */
  prBrief: string;
  /** skill inti (prinsip) untuk validator & reviewer akhir */
  coreSkills?: string;
}

/** Mode mendalam: triase → putaran spesialis paralel → gabung → validasi P0/P1 → lead. */
export async function deepReview(
  ctx: JobContext,
  i: DeepReviewInput,
  pre?: { triage: TriageOutput | null; meta: PassMeta },
): Promise<{ output: FinalOutput; passes: PassMeta[]; raw: string; dropped: { title: string; reason: string }[] }> {
  const passes: PassMeta[] = [];
  const base = { cwd: i.cwd, jobDir: i.jobDir };

  // 1) triase (model cepat) — dipakai ulang bila mode otomatis sudah menjalankannya
  const tr = pre ?? (await runTriage(ctx, { ...base, prBrief: i.prBrief }));
  passes.push(tr.meta);
  // triase sah → correctness + putaran yang diminta saja (lenses kosong = cukup correctness); gagal → semua putaran
  // correctness & docs selalu jalan (docs: dokumen usang & klaim deskripsi PR — tidak terlihat dari diff saja)
  const lenses: Lens[] = tr.triage ? [...new Set<Lens>(['correctness', 'docs', ...tr.triage.lenses])] : [...LENSES];

  // 2) putaran spesialis paralel (model standar)
  let t0 = Date.now();
  const lensRuns = await Promise.allSettled(
    lenses.map((l) =>
      runPass(ctx, {
        ...base,
        role: 'lens',
        label: `lens-${l}`,
        systemPrompt: `${i.systemPrompt}\n\n---\n\n# Fokus putaran ini: ${l}\n${LENS_FOCUS[l]}\nLaporkan hanya temuan dalam fokus ini; putaran lain menangani fokus lain. Isi verdict/summary/lessons seadanya.`,
        userPrompt: i.userPrompt,
        schema: REVIEW_OUTPUT_SCHEMA,
      }),
    ),
  );
  // putaran correctness yang tidak membuka file sama sekali → ulangi sekali dengan teguran; tetap dangkal → sebagian
  let shallowNote = '';
  const ci = lenses.indexOf('correctness');
  const cr = lensRuns[ci];
  const turns = (x: typeof cr) => (x?.status === 'fulfilled' ? x.value.meta.numTurns : null);
  const isShallow = (n: number | null | undefined) => typeof n === 'number' && n <= SHALLOW_MAX_TURNS;
  if (ci >= 0 && isShallow(turns(cr))) {
    const again = await Promise.allSettled([
      runPass(ctx, {
        ...base,
        role: 'lens',
        label: 'lens-correctness',
        systemPrompt: `${i.systemPrompt}\n\n---\n\n# Fokus putaran ini: correctness\n${LENS_FOCUS.correctness}\n\n---\n\n${SHALLOW_NUDGE}`,
        userPrompt: i.userPrompt,
        schema: REVIEW_OUTPUT_SCHEMA,
      }),
    ]);
    if (again[0].status === 'fulfilled') lensRuns[ci] = again[0];
    if (isShallow(turns(lensRuns[ci])))
      shallowNote = 'Reviewer tidak menelusuri kode (tidak membuka file yang berubah); hasil hanya dari membaca diff.';
  }
  const lensOut: { lens: Lens; out: ReviewOutput }[] = [];
  const raws: string[] = [];
  lensRuns.forEach((r, k) => {
    if (r.status === 'rejected') return void passes.push(failed('lens', `lens-${lenses[k]}`, r.reason, t0));
    const p = ReviewOutputSchema.safeParse(r.value.output);
    passes.push(p.success ? r.value.meta : { ...r.value.meta, ok: false, error: 'output tidak sesuai schema' });
    if (p.success) {
      lensOut.push({ lens: lenses[k], out: p.data });
      raws.push(`## ${lenses[k]}\n${r.value.raw}`);
    }
  });
  if (!lensOut.length) throw new AgentError('Semua putaran spesialis gagal', 'agent');
  const lensFailed = lensOut.length < lenses.length;

  // 3) gabung deterministik (tanpa LLM)
  let merged: MergedFinding[] = mergeFindings(lensOut.map((x) => ({ lens: x.lens, findings: x.out.findings })));

  // 4) validasi P0/P1 (model kuat), maksimal 8 temuan paling parah, paralel
  const dropped: { title: string; reason: string }[] = [];
  const candidates = merged.filter((f) => f.severity !== 'P2').slice(0, 8);
  t0 = Date.now();
  const validatePrompt = await promptFor(ctx, 'validate');
  const vRuns = await Promise.allSettled(
    candidates.map((f, k) =>
      runPass(ctx, {
        ...base,
        role: 'validate',
        label: `validate-${k}`,
        systemPrompt: i.coreSkills ? `${validatePrompt}\n\n---\n\n${i.coreSkills}` : validatePrompt,
        userPrompt: `${i.userPrompt}\n\n# Temuan yang divalidasi\n${JSON.stringify(stripMerge(f), null, 1)}`,
        schema: VALIDATE_SCHEMA,
      }),
    ),
  );
  vRuns.forEach((r, k) => {
    const f = candidates[k];
    if (r.status === 'rejected') return void passes.push(failed('validate', `validate-${k}`, r.reason, t0));
    passes.push(r.value.meta);
    const v = ValidateOutputSchema.safeParse(r.value.output);
    if (!v.success) return;
    if (!v.data.valid) {
      dropped.push({ title: f.title, reason: v.data.reason });
      merged = merged.filter((m) => m !== f);
    } else f.confidence = Math.max(f.confidence, v.data.confidence);
  });

  // 5) reviewer akhir (peran lead, default Opus): saring, tulis ulang temuan, skor, ringkasan, dampak, walkthrough, diagram
  const correctness = lensOut.find((x) => x.lens === 'correctness')?.out ?? lensOut[0].out;
  const draft: ReviewOutput = {
    score: Math.min(...lensOut.map((x) => x.out.score)),
    verdict: correctness.verdict,
    summary: correctness.summary,
    lessons: correctness.lessons,
    findings: merged.map(stripMerge),
    reviewCompletion:
      lensFailed || shallowNote || lensOut.some((x) => x.out.reviewCompletion === 'incomplete')
        ? 'incomplete'
        : 'complete',
    uncertainty: [
      shallowNote,
      lensFailed ? 'Sebagian putaran spesialis gagal.' : '',
      ...lensOut.map((x) => x.out.uncertainty),
    ]
      .filter(Boolean)
      .join(' '),
  };
  let final: FinalOutput = { ...draft, diagram: '', walkthrough: [], effortMinutes: null };
  t0 = Date.now();
  const fr = await runFinalReview(ctx, {
    cwd: i.cwd,
    jobDir: i.jobDir,
    persona: i.persona,
    prBrief: i.prBrief,
    coreSkills: i.coreSkills,
    draft,
    notes: merged.map((f) => `disepakati ${f.agreement} putaran (${f.lenses.join(', ')})`),
  });
  if ('output' in fr) {
    passes.push(fr.meta);
    final = fr.output;
  } else passes.push(failed('lead', 'final', fr.error, t0)); // tanpa reviewer akhir: semua temuan tervalidasi dipakai
  if (final.findings.some((f) => f.severity === 'P0')) final.score = Math.min(final.score, 2);
  return { output: final, passes, raw: raws.join('\n\n').slice(0, 200_000), dropped };
}

function stripMerge(f: MergedFinding): ReviewFinding {
  const { agreement: _a, lenses: _l, ...rest } = f;
  return rest;
}
