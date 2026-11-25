import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { ReviewFinding } from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { addWorktree, ensureRepo, removeWorktree } from './git.js';
import { assertNoLeak } from './leak.js';
import { getRepoToken, jobDirFor } from './review.js';
import { runAppVerification } from './app-verify.js';
import { progress } from './progress.js';

/**
 * Job lanjutan setelah review diposting: bangun aplikasi dari head PR, coba alur yang diubah PR + temuan yang bisa
 * terlihat di aplikasi, simpan bukti. Hasilnya diterapkan Functions ke review induk (komentar, status gate).
 */
export async function runAppVerifyJob(ctx: JobContext) {
  const started = Date.now();
  const job = ctx.job;
  const ref = doc(ctx.session.db, `jobs/${ctx.id}`);
  await updateDoc(ref, { status: 'running', updatedAt: serverTimestamp() });
  const token = await getRepoToken(ctx);
  const pr = job.pr as { number: number; baseSha: string; headSha: string };
  const repoDir = await ensureRepo(job.repo.fullName, token, [
    `+refs/heads/*:refs/remotes/origin/*`,
    `+refs/pull/${pr.number}/head:refs/pull/${pr.number}/head`,
  ]);
  const jobDir = jobDirFor(ctx.id);
  try {
    const wt = await addWorktree(repoDir, jobDir, pr.headSha);
    const app = await runAppVerification(ctx, {
      repoDir,
      jobDir,
      headWorktree: wt,
      baseSha: pr.baseSha,
      findings: (job.findings ?? []) as ReviewFinding[],
      prBrief: String(job.prBrief ?? ''),
    });
    assertNoLeak(ctx, app, [token]);
    await progress(ctx).done();
    await updateDoc(ref, {
      status: 'completed',
      result: {
        appVerification: { ...app.meta, jobId: ctx.id },
        findings: app.findings,
        meta: { agent: ctx.agent.name, passes: app.passes, durationMs: Date.now() - started },
      },
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    ctx.daemon.log(
      `✓ uji aplikasi ${ctx.id} selesai (${app.meta.ran ? `${app.meta.scenarios?.length ?? 0} skenario` : `dilewati: ${app.meta.reason}`})`,
    );
  } finally {
    await removeWorktree(repoDir, jobDir);
  }
}
