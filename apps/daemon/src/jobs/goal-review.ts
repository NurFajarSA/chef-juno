import {
  DEFAULT_PROMPTS,
  GOAL_SCHEMA,
  GoalOutputSchema,
  resolveEffort,
  resolveModel,
  type JobConfig,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { promptFor } from './prompt-source.js';
import { AgentError } from '../agents/types.js';
import { progress } from './progress.js';
import type { PassMeta } from './deep-review.js';
import { cleanDiagram, type FinalOutput } from './final-review.js';

/**
 * Mode tujuan: agent diberi tujuan, konteks, dan batas — bukan resep. Dia memutuskan sendiri cara kerjanya:
 * seberapa dalam menelusuri, perintah apa yang dijalankan (test, analyzer, build), dan apakah memecah kerja ke subagent.
 */
export const GOAL_PROMPT = DEFAULT_PROMPTS['method'].content.trimEnd();

/** Batas waktu minimal mode tujuan: agent yang menjalankan test/build butuh lebih lama dari reviewer baca-saja. */
export const GOAL_MIN_TIMEOUT_MIN = 45;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function runGoalReview(
  ctx: JobContext,
  o: {
    cwd: string;
    jobDir: string;
    persona: string;
    /** prompt review yang bisa diedit tim (versi yang dipin ke job) → arahan tambahan */
    guidance: string;
    userPrompt: string;
    skills: string;
  },
): Promise<{ output: FinalOutput; raw: string; meta: PassMeta & { isolation: string } }> {
  const config = ctx.job.config as JobConfig;
  // satu agent memegang seluruh review → model terkuat (tingkat yang sama dengan reviewer akhir)
  const model = resolveModel(config, ctx.agent.name, 'lead');
  const method = await promptFor(ctx, 'method');
  const t0 = Date.now();
  const res = await progress(ctx).step('review', () =>
    ctx.agent.run({
      trusted: true,
      cwd: o.cwd,
      jobDir: o.jobDir,
      systemPrompt: [
        o.persona,
        method,
        o.guidance.trim() ? `# Arahan tim\n\n${o.guidance.trim()}` : '',
        o.skills ? `# Pegangan tim (pakai bila relevan)\n\n${o.skills}` : '',
      ]
        .filter(Boolean)
        .join('\n\n---\n\n'),
      userPrompt: o.userPrompt,
      schema: GOAL_SCHEMA,
      model,
      effort: resolveEffort(config, ctx.agent.name, 'lead'),
      maxTurns: 500,
      timeoutMs: Math.max(config.reviewTimeoutMinutes, GOAL_MIN_TIMEOUT_MIN) * 60_000,
    }),
  );
  const p = GoalOutputSchema.safeParse(res.output);
  if (!p.success) throw new AgentError('Output agent tidak sesuai schema', 'parse');
  const d = p.data;
  const hasP0 = d.findings.some((f) => f.severity === 'P0');
  return {
    output: {
      score: hasP0 ? Math.min(d.score, 2) : d.score,
      verdict: d.verdict,
      summary: d.summary,
      lessons: d.lessons.slice(0, 3),
      findings: d.findings,
      reviewCompletion: d.reviewCompletion,
      uncertainty: d.uncertainty,
      impactLevel: d.impact,
      diagram: cleanDiagram(d.diagram),
      walkthrough: d.walkthrough.slice(0, 8).map((w) => ({
        area: clip(w.area, 80),
        files: w.files.slice(0, 12).map((x) => clip(x, 200)),
        change: clip(w.change, 300),
      })),
      effortMinutes: Math.min(600, d.effortMinutes),
    },
    raw: res.raw,
    meta: {
      role: 'review',
      label: 'review',
      model: res.meta.model ?? model ?? null,
      ok: true,
      durationMs: Date.now() - t0,
      inputTokens: res.meta.inputTokens,
      outputTokens: res.meta.outputTokens,
      numTurns: res.meta.numTurns,
      isolation: res.meta.isolation,
    },
  };
}
