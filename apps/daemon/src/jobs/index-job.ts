import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  MODULE_SUMMARY_PROMPT,
  MODULE_SUMMARY_SCHEMA,
  ModuleSummaryOutputSchema,
  resolveEffort,
  resolveModel,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';

/** Jumlah modul per panggilan ringkasan (model cepat). */
const SUMMARY_BATCH = 25;
import { AgentError } from '../agents/types.js';
import { addWorktree, ensureRepo, git, removeWorktree } from './git.js';
import { getRepoToken, jobDirFor, loadPrompt } from './review.js';
import { ensureIndex, moduleInfos } from '../graph/local.js';
import { assertNoLeak } from './leak.js';

/** Job index: bangun/perbarui graph lokal, ringkas modul yang berubah dengan agent langganan (§6.7.B). */
export async function runIndexJob(ctx: JobContext) {
  const started = Date.now();
  const job = ctx.job;
  const ref = doc(ctx.session.db, `jobs/${ctx.id}`);
  await updateDoc(ref, { status: 'running', updatedAt: serverTimestamp() });
  const token = await getRepoToken(ctx);
  const repoDir = await ensureRepo(job.repo.fullName, token, ['+refs/heads/*:refs/remotes/origin/*']);
  const branch = String(job.index?.ref ?? 'main');
  const targetSha = String(
    job.index?.targetSha || (await git(repoDir, ['rev-parse', `refs/remotes/origin/${branch}`])).trim(),
  );
  const jobDir = jobDirFor(ctx.id);
  try {
    const wt = await addWorktree(repoDir, jobDir, targetSha);
    const r = await ensureIndex(
      Number(job.repo.id),
      wt,
      targetSha,
      job.index?.mode === 'full' ? 'full' : 'incremental',
    );
    try {
      const mods = moduleInfos(r.store);
      const known = new Map(
        (
          r.store.db.prepare('SELECT id, summary, summarySha FROM modules').all() as {
            id: string;
            summary: string;
            summarySha: string;
          }[]
        ).map((m) => [m.id, m]),
      );
      const stale = mods.filter((m) => known.get(m.id)?.summarySha !== m.summarySha);
      const summaries = new Map<string, string>();
      // tiap panggilan model (satu per batch ringkasan) dicatat untuk Analitik biaya & waktu
      const indexModel = resolveModel(job.config, ctx.agent.name, 'index');
      const passes: {
        role: 'index';
        label: string;
        model: string | null;
        ok: boolean;
        durationMs: number;
        inputTokens: number | null;
        outputTokens: number | null;
      }[] = [];
      if (stale.length) {
        const persona = await loadPrompt(ctx, 'persona', job.promptVersions?.persona ?? 1);
        const up = r.store.db.prepare(
          'INSERT INTO modules(id, path, name, summary, summarySha) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, summarySha = excluded.summarySha',
        );
        const cap = (xs: string[], n: number) => (xs.length > n ? [...xs.slice(0, n), `… +${xs.length - n} lagi`] : xs);
        // repo besar (mis. Flutter dengan puluhan modul fitur): ringkas per batch supaya prompt & jawaban tidak terpotong
        for (let start = 0; start < stale.length; start += SUMMARY_BATCH) {
          const batch = stale.slice(start, start + SUMMARY_BATCH);
          const t0 = Date.now();
          const prompt = [
            `# Repo ${job.repo.fullName} @ ${targetSha.slice(0, 7)}`,
            'Ringkas modul berikut.',
            '',
            ...batch.map((m) =>
              [
                `MODULE_ID: ${m.id}`,
                `File kunci: ${cap(m.keyFiles, 12).join(', ')}`,
                `Simbol diekspor: ${cap(m.exports, 40).join(', ') || '-'}`,
                `Bergantung pada: ${cap(m.dependsOn, 20).join(', ') || '-'}`,
                `Dipakai oleh: ${cap(m.dependents, 20).join(', ') || '-'}`,
                '',
              ].join('\n'),
            ),
          ].join('\n');
          const res = await ctx.agent.run({
            cwd: wt,
            jobDir,
            systemPrompt: `${persona}\n\n---\n\n${MODULE_SUMMARY_PROMPT}`,
            userPrompt: prompt,
            schema: MODULE_SUMMARY_SCHEMA,
            model: indexModel,
            effort: resolveEffort(job.config, ctx.agent.name, 'index'),
            maxTurns: job.config?.agentMaxTurns ?? 40,
            timeoutMs: (job.config?.reviewTimeoutMinutes ?? 15) * 60_000,
          });
          passes.push({
            role: 'index',
            label: `index-${start / SUMMARY_BATCH + 1}`,
            model: res.meta.model ?? indexModel ?? null,
            ok: true,
            durationMs: Date.now() - t0,
            inputTokens: res.meta.inputTokens,
            outputTokens: res.meta.outputTokens,
          });
          const parsed = ModuleSummaryOutputSchema.safeParse(res.output);
          if (!parsed.success) throw new AgentError('Ringkasan modul tidak sesuai schema', 'parse');
          assertNoLeak(ctx, parsed.data, [token]);
          for (const s of parsed.data.modules) {
            const m = batch.find((x) => x.id === s.id);
            if (!m) continue;
            const text = s.patterns.length ? `${s.summary}\n\n**Pola penting:** ${s.patterns.join('; ')}` : s.summary;
            summaries.set(s.id, text);
            up.run(m.id, m.path, m.name, text, m.summarySha);
          }
        }
      }
      await updateDoc(ref, {
        status: 'completed',
        result: {
          indexedSha: targetSha,
          mode: r.mode,
          stats: { ...r.stats, durationMs: r.buildMs },
          modules: mods.map((m) => ({ ...m, ...(summaries.has(m.id) ? { summary: summaries.get(m.id) } : {}) })),
          summarized: [...summaries.keys()],
          meta: {
            agent: ctx.agent.name,
            model: passes[0]?.model ?? null,
            durationMs: Date.now() - started,
            inputTokens: passes.length ? passes.reduce((a, p) => a + (p.inputTokens ?? 0), 0) : null,
            outputTokens: passes.length ? passes.reduce((a, p) => a + (p.outputTokens ?? 0), 0) : null,
            passes,
          },
        },
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ctx.daemon.log(
        `✓ index ${job.repo.fullName} @ ${targetSha.slice(0, 7)} (${r.mode}, ${r.stats.files} file, ${summaries.size} modul diringkas)`,
      );
    } finally {
      r.store.close();
    }
  } finally {
    await removeWorktree(repoDir, jobDir);
  }
}
