import { collection, getDocs } from 'firebase/firestore';
import type { JobContext } from '../daemon.js';
import { ensureIndex } from '../graph/local.js';
import { buildGraphContext } from '../graph/context.js';
import { showFile } from './git.js';
import { memoryContext } from './memory-context.js';

export interface ReviewExtras {
  graphContext: string | null;
  impact: string[];
  indexBuildMs: number | null;
  teamRules: { id: string; text: string }[];
  authorProfile: string | null;
}

/** Konteks tambahan review: peta kode (§6.7.C) + ingatan tim & profil penulis (§6.8). */
export async function extraReviewContext(
  ctx: JobContext,
  o: { repoDir: string; worktree: string; diff: string; files: string[] },
): Promise<ReviewExtras> {
  const job = ctx.job;
  let graphContext: string | null = null;
  let impact: string[] = [];
  let indexBuildMs: number | null = null;
  try {
    const r = await ensureIndex(Number(job.repo.id), o.worktree, job.pr.headSha);
    indexBuildMs = r.mode === 'cached' ? 0 : r.buildMs;
    try {
      const summaries: Record<string, string> = {};
      try {
        const snap = await getDocs(collection(ctx.session.db, `repos/${job.repo.id}/modules`));
        for (const d of snap.docs) if (d.get('summary')) summaries[String(d.get('path'))] = String(d.get('summary'));
      } catch {
        // ringkasan modul opsional
      }
      const g = await buildGraphContext(r.store, {
        diff: o.diff,
        worktree: o.worktree,
        baseContent: (p) => showFile(o.repoDir, job.pr.baseSha, p),
        moduleSummaries: summaries,
      });
      graphContext = g.markdown;
      impact = g.impact;
    } finally {
      r.store.close();
    }
  } catch (e) {
    ctx.daemon.log(`⚠ peta kode tidak tersedia: ${(e as Error).message}`);
  }
  const mem = await memoryContext(ctx, o.files);
  return { graphContext, impact, indexBuildMs, ...mem };
}
