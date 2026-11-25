import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LEARN_OUTPUT_SCHEMA,
  LEARN_PROMPT,
  LearnOutputSchema,
  RECAP_OUTPUT_SCHEMA,
  RECAP_PROMPT,
  RecapOutputSchema,
  resolveEffort,
  resolveModel,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { AgentError } from '../agents/types.js';
import { loadPrompt } from './review.js';
import { assertNoLeak } from './leak.js';

/** Job learn/recap: tanpa kode repo — hanya data temuan/agregat sebagai input (§6.8, §6.9). */
export async function runTextJob(ctx: JobContext, kind: 'learn' | 'recap') {
  const started = Date.now();
  const job = ctx.job;
  const ref = doc(ctx.session.db, `jobs/${ctx.id}`);
  await updateDoc(ref, { status: 'running', updatedAt: serverTimestamp() });
  const persona = await loadPrompt(ctx, 'persona', job.promptVersions?.persona ?? 1);
  const dir = mkdtempSync(join(tmpdir(), `cj-${kind}-`));
  try {
    const userPrompt =
      kind === 'learn'
        ? [
            `# Hasil review PR #${job.learn?.prNumber} di ${job.repo?.fullName} (${job.learn?.merged ? 'di-merge' : 'ditutup tanpa merge'})`,
            '',
            'Temuan beserta hasil & alasannya:',
            '```json',
            JSON.stringify(job.learn?.items ?? [], null, 1),
            '```',
          ].join('\n')
        : ['# Agregat rekap mingguan', '```json', JSON.stringify(job.recap?.data ?? {}, null, 1), '```'].join('\n');
    const model = resolveModel(job.config, ctx.agent.name, kind);
    const t0 = Date.now();
    const res = await ctx.agent.run({
      cwd: dir,
      jobDir: dir,
      systemPrompt: `${persona}\n\n---\n\n${kind === 'learn' ? LEARN_PROMPT : RECAP_PROMPT}`,
      userPrompt,
      schema: kind === 'learn' ? LEARN_OUTPUT_SCHEMA : RECAP_OUTPUT_SCHEMA,
      model,
      effort: resolveEffort(job.config, ctx.agent.name, kind),
      maxTurns: job.config?.agentMaxTurns ?? 40,
      timeoutMs: (job.config?.reviewTimeoutMinutes ?? 15) * 60_000,
    });
    const parsed = (kind === 'learn' ? LearnOutputSchema : RecapOutputSchema).safeParse(res.output);
    if (!parsed.success) throw new AgentError(`Output ${kind} tidak sesuai schema`, 'parse');
    assertNoLeak(ctx, parsed.data);
    await updateDoc(ref, {
      status: 'completed',
      result: {
        ...parsed.data,
        // model yang dilaporkan CLI (atau yang diminta) + token → Analitik biaya & waktu
        meta: {
          agent: ctx.agent.name,
          model: res.meta.model ?? model ?? null,
          durationMs: Date.now() - started,
          inputTokens: res.meta.inputTokens,
          outputTokens: res.meta.outputTokens,
          passes: [
            {
              role: kind,
              label: kind,
              model: res.meta.model ?? model ?? null,
              ok: true,
              durationMs: Date.now() - t0,
              inputTokens: res.meta.inputTokens,
              outputTokens: res.meta.outputTokens,
            },
          ],
        },
      },
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
