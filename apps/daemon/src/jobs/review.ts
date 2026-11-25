import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCS_CHECK,
  TRACE_CHECK,
  buildPrBrief,
  parseSkillMd,
  renderSkillsForPrompt,
  skillAppliesTo,
  REVIEW_OUTPUT_SCHEMA,
  ReviewOutputSchema,
  isTrivialChange,
  resolveEffort,
  resolveModel,
  type ReviewMode,
  type JobConfig,
  type SkillForPrompt,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { progress } from './progress.js';
import { callFunction } from '../api.js';
import { cfg } from '../env.js';
import { AgentError } from '../agents/types.js';
import { addWorktree, ensureRepo, git, removeWorktree, showFile } from './git.js';
import { buildReviewPrompt, truncateDiff } from './context.js';
import { extraReviewContext } from './extras.js';
import { SHALLOW_MAX_TURNS, SHALLOW_NUDGE, deepReview, failed, type PassMeta } from './deep-review.js';
import { runFinalReview, type FinalOutput } from './final-review.js';
import { runVerification, verificationSection } from './verify.js';
import { assertNoLeak } from './leak.js';

const RULE_FILES = ['.chefjuno/rules.md', 'CLAUDE.md', 'AGENTS.md'];

export async function getRepoToken(ctx: JobContext): Promise<string> {
  const r = await callFunction<{ token: string }>(
    ctx.creds.server,
    'getJobRepoAccess',
    { jobId: ctx.id },
    await ctx.session.idToken(),
  );
  return r.token;
}

export async function loadPrompt(ctx: JobContext, key: 'persona' | 'review', version: number): Promise<string> {
  const s = await getDoc(doc(ctx.session.db, `prompts/${key}/versions/${version}`));
  if (!s.exists()) throw new AgentError(`Prompt ${key} v${version} tidak ditemukan`, 'agent');
  return String(s.get('content'));
}

/**
 * Skill tim yang dipin ke job → bagian system prompt (agent memakai --safe-mode, jadi skill bawaan agent tidak dimuat).
 * Skill dengan `paths:` di frontmatter hanya dimuat bila ada file berubah yang cocok (mis. skill Flutter untuk *.dart).
 */
export async function loadSkillsSection(
  ctx: JobContext,
  pinned: { slug: string; version: number }[],
  changedFiles: string[],
): Promise<{ text: string; coreText: string; loaded: string[]; skipped: string[]; dropped: string[] }> {
  const skills: SkillForPrompt[] = [];
  const skipped: string[] = [];
  const core: string[] = [];
  for (const p of pinned) {
    try {
      const [meta, ver] = await Promise.all([
        getDoc(doc(ctx.session.db, `skills/${p.slug}`)),
        getDoc(doc(ctx.session.db, `skills/${p.slug}/versions/${p.version}`)),
      ]);
      if (!ver.exists()) {
        ctx.daemon.log(`⚠ skill ${p.slug} v${p.version} tidak ditemukan — dilewati`);
        continue;
      }
      const files = (ver.get('files') ?? {}) as Record<string, string>;
      const parsed = parseSkillMd(files['SKILL.md'] ?? '');
      if (!skillAppliesTo('error' in parsed ? [] : parsed.paths, changedFiles)) {
        skipped.push(p.slug);
        continue;
      }
      skills.push({
        slug: p.slug,
        name: String(meta.get('name') ?? p.slug),
        description: String(meta.get('description') ?? ''),
        files,
      });
      if (!('error' in parsed) && parsed.category === 'inti') core.push(p.slug);
    } catch (e) {
      ctx.daemon.log(`⚠ skill ${p.slug} tidak terbaca: ${(e as Error).message}`);
    }
  }
  const text = renderSkillsForPrompt(skills);
  // skill yang terpotong batas ukuran prompt tidak dihitung "dimuat"
  const loaded = skills.filter((s) => text.includes(`(\`${s.slug}\`)`)).map((s) => s.slug);
  const dropped = skills.map((s) => s.slug).filter((s) => !loaded.includes(s));
  // skill inti (prinsip) juga dipakai validator, reviewer akhir, dan penguji aplikasi
  const coreText = renderSkillsForPrompt(skills.filter((s) => core.includes(s.slug)));
  return { text, coreText, loaded, skipped, dropped };
}

export function jobDirFor(id: string) {
  const base = join(cfg.home(), 'jobs');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${id}-`));
}

export async function runReviewJob(ctx: JobContext) {
  const started = Date.now();
  const job = ctx.job;
  const config = job.config as JobConfig;
  const ref = doc(ctx.session.db, `jobs/${ctx.id}`);
  await updateDoc(ref, { status: 'running', updatedAt: serverTimestamp() });

  const token = await getRepoToken(ctx);
  const pr = job.pr as {
    number: number;
    baseSha: string;
    headSha: string;
    title: string;
    body: string;
    authorLogin: string;
    baseRef: string;
    headRef: string;
  };
  const repoDir = await ensureRepo(job.repo.fullName, token, [
    `+refs/heads/*:refs/remotes/origin/*`,
    `+refs/pull/${pr.number}/head:refs/pull/${pr.number}/head`,
  ]);
  const jobDir = jobDirFor(ctx.id);
  try {
    const prepStep = progress(ctx).start('prepare');
    const wt = await addWorktree(repoDir, jobDir, pr.headSha);
    const rawDiff = await git(repoDir, ['diff', `${pr.baseSha}...${pr.headSha}`]);
    const { diff, truncated } = truncateDiff(rawDiff, config.maxDiffBytes);
    const files = (await git(repoDir, ['diff', '--name-only', `${pr.baseSha}...${pr.headSha}`]))
      .split('\n')
      .filter(Boolean);
    const log = await git(repoDir, ['log', '--oneline', '-n', '30', `${pr.baseSha}..${pr.headSha}`]);
    const repoRules: { path: string; content: string }[] = [];
    for (const p of RULE_FILES) {
      const c = await showFile(repoDir, pr.baseSha, p);
      if (c) repoRules.push({ path: p, content: c });
    }
    const [persona, review] = await Promise.all([
      loadPrompt(ctx, 'persona', job.promptVersions.persona),
      loadPrompt(ctx, 'review', job.promptVersions.review),
    ]);
    const extras = await extraReviewContext(ctx, { repoDir, worktree: wt, diff: rawDiff, files });
    // Verifikasi empiris tahap 1 (opsional): analisis statis base vs head di container → bukti untuk reviewer
    const verification = await runVerification(ctx, { repoDir, jobDir, headWorktree: wt, baseSha: pr.baseSha });
    const verifyText = verificationSection(verification);
    const userPrompt =
      buildReviewPrompt({
        pr,
        files,
        diff,
        diffTruncated: truncated,
        log,
        instruction: String(job.trigger?.instruction ?? ''),
        repoRules,
        graphContext: extras.graphContext,
        teamRules: extras.teamRules.map((r) => r.text),
        authorProfile: extras.authorProfile,
      }) + (verifyText ? `\n\n${verifyText}` : '');
    const skillSel = await loadSkillsSection(
      ctx,
      (job.skillVersions ?? []) as { slug: string; version: number }[],
      files,
    );
    const skillsSection = skillSel.text;
    progress(ctx).end(prepStep, true);
    const systemPrompt = `${persona}\n\n---\n\n${review}${skillsSection ? `\n\n---\n\n${skillsSection}` : ''}`;
    // jumlah baris +/− per file (bahan walkthrough & tingkat dampak untuk reviewer akhir)
    const numstat = new Map<string, string>();
    for (const l of (await git(repoDir, ['diff', '--numstat', `${pr.baseSha}...${pr.headSha}`])).split('\n')) {
      const [a, d, f] = l.split('\t');
      if (f) numstat.set(f, a === '-' ? 'biner' : `+${a} −${d}`);
    }
    // deskripsi bertemplate → bagian terstruktur (alur yang diubah, cara mencoba) untuk reviewer & penguji
    const prBrief = buildPrBrief({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      files: files.map((f) => ({ path: f, stat: numstat.get(f) ?? null })),
    });

    // Satu standar: semua PR direview penuh (putaran spesialis + validasi + reviewer akhir) dan diuji di aplikasi;
    // hanya perubahan remeh (dokumentasi saja, aturan path) yang direview ringan tanpa uji aplikasi.
    const trivial = isTrivialChange(files);
    const mode: 'standard' | 'deep' = trivial ? 'standard' : 'deep';
    const decision = {
      requested: 'auto' as ReviewMode,
      chosen: mode,
      by: 'aturan',
      reason: trivial
        ? 'hanya dokumentasi: review ringan tanpa uji aplikasi'
        : 'satu standar: review penuh + uji aplikasi',
    };

    let output: FinalOutput;
    let raw: string;
    let passes: PassMeta[];
    let dropped: { title: string; reason: string }[] = [];
    let agentMeta: {
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      numTurns: number | null;
      isolation: string;
    };
    if (mode === 'deep') {
      const d = await deepReview(ctx, {
        cwd: wt,
        jobDir,
        persona,
        systemPrompt,
        userPrompt,
        prBrief,
        coreSkills: skillSel.coreText,
      });
      output = d.output;
      raw = d.raw;
      passes = d.passes;
      dropped = d.dropped;
      const sum = (k: 'inputTokens' | 'outputTokens') => passes.reduce((a, p) => a + (p[k] ?? 0), 0) || null;
      agentMeta = {
        model: null,
        inputTokens: sum('inputTokens'),
        outputTokens: sum('outputTokens'),
        numTurns: null,
        isolation: 'safe',
      };
    } else {
      const model = resolveModel(config, ctx.agent.name, 'review');
      const t0 = Date.now();
      const standardSystem = `${systemPrompt}\n\n---\n\n${TRACE_CHECK}\n\n${DOCS_CHECK}`;
      const runReview = (system: string) =>
        progress(ctx).step('review', () =>
          ctx.agent.run({
            cwd: wt,
            jobDir,
            systemPrompt: system,
            userPrompt,
            schema: REVIEW_OUTPUT_SCHEMA,
            model,
            effort: resolveEffort(config, ctx.agent.name, 'review'),
            maxTurns: config.agentMaxTurns,
            timeoutMs: config.reviewTimeoutMinutes * 60_000,
          }),
        );
      let res = await runReview(standardSystem);
      // Review dangkal (tidak membuka file sama sekali) → ulangi sekali dengan teguran; tetap dangkal → review sebagian
      const shallow = (n: number | null) => n !== null && n <= SHALLOW_MAX_TURNS;
      let shallowNote = '';
      if (shallow(res.meta.numTurns) && files.length) {
        res = await runReview(`${standardSystem}\n\n---\n\n${SHALLOW_NUDGE}`);
        if (shallow(res.meta.numTurns))
          shallowNote =
            'Reviewer tidak menelusuri kode (tidak membuka file yang berubah); hasil hanya dari membaca diff.';
      }
      const parsed = ReviewOutputSchema.safeParse(res.output);
      if (!parsed.success) throw new AgentError('Output agent tidak sesuai schema review', 'parse');
      output = { ...parsed.data, diagram: '', walkthrough: [], effortMinutes: null };
      if (shallowNote)
        output = {
          ...output,
          reviewCompletion: 'incomplete',
          uncertainty: [shallowNote, output.uncertainty].filter(Boolean).join(' '),
        };
      raw = res.raw;
      agentMeta = res.meta;
      passes = [
        {
          role: 'review',
          label: 'review',
          model: res.meta.model ?? model ?? null,
          ok: true,
          durationMs: Date.now() - t0,
          inputTokens: res.meta.inputTokens,
          outputTokens: res.meta.outputTokens,
          numTurns: res.meta.numTurns,
        },
      ];
      // reviewer akhir (peran lead, default Opus) di setiap review: saring, tulis ulang, skor, dampak, walkthrough, diagram
      const t1 = Date.now();
      const fr = await runFinalReview(ctx, {
        cwd: wt,
        jobDir,
        persona,
        prBrief,
        draft: output,
        coreSkills: skillSel.coreText,
      });
      if ('output' in fr) {
        passes.push(fr.meta);
        output = fr.output;
      } else passes.push(failed('lead', 'final', fr.error, t1));
    }
    // atribusi skill: hanya slug yang benar-benar dimuat ke prompt (agent tidak bisa mengarang skill)
    output = {
      ...output,
      findings: output.findings.map((f) => ({ ...f, skill: skillSel.loaded.includes(f.skill) ? f.skill : '' })),
    };
    // Uji aplikasi berjalan sebagai job lanjutan (app-verify) setelah review diposting — review tidak menunggu build
    const appVerification = trivial
      ? { ran: false, reason: 'perubahan dokumentasi saja' }
      : config.appVerifyEnabled
        ? { ran: false, pending: true, reason: 'menyusul setelah review diposting' }
        : { ran: false, reason: 'dimatikan di Pengaturan' };
    // Anti-bocor: gagalkan job kalau output memuat secret mesin / token instalasi / refresh token (§12.9)
    // output mentah semua putaran juga diperiksa: rahasia di draf reviewer tetap menggagalkan job walau reviewer akhir
    // menulis ulang ringkasannya
    assertNoLeak(ctx, { output, raw }, [token]);
    await progress(ctx).done();
    await updateDoc(ref, {
      status: 'completed',
      result: {
        ...output,
        impact: extras.impact,
        appliedRuleIds: extras.teamRules.map((r) => r.id),
        suppressed: [],
        rawOutput: raw.slice(0, 200_000),
        // bahan job uji aplikasi lanjutan (judul, deskripsi, daftar file)
        prBrief: prBrief.slice(0, 12_000),
        ...(dropped.length ? { droppedByValidation: dropped } : {}),
        meta: {
          agent: ctx.agent.name,
          model: agentMeta.model,
          mode,
          modeDecision: decision,
          passes,
          durationMs: Date.now() - started,
          inputTokens: agentMeta.inputTokens,
          outputTokens: agentMeta.outputTokens,
          numTurns: agentMeta.numTurns,
          isolation: agentMeta.isolation,
          graphMcp: false,
          indexBuildMs: extras.indexBuildMs,
          diffTruncated: truncated,
          skillsLoaded: skillSel.loaded,
          skillsSkipped: skillSel.skipped,
          skillsDropped: skillSel.dropped,
          verification,
          appVerification,
        },
      },
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    ctx.daemon.log(
      `✓ job ${ctx.id} selesai (${mode}, ${passes.length} putaran, ${output.findings.length} temuan, skor ${output.score})`,
    );
  } finally {
    await removeWorktree(repoDir, jobDir);
  }
}
