/* eslint-disable @typescript-eslint/no-explicit-any -- payload webhook GitHub & respons API dibaca bebas */
import { FieldValue } from 'firebase-admin/firestore';
import {
  classifyOutcome,
  emptySignals,
  parseAiCoderReply,
  parseUnifiedDiff,
  type FindingSignals,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { installationOctokit, type GH } from './github.js';
import { createJob } from './jobs.js';

/** Balasan di thread komentar bot (manusia atau AI coder) → findings.signals (§6.8). */
export async function handleReviewCommentReply(p: any): Promise<string> {
  const c = p.comment;
  if (!c?.in_reply_to_id) return 'bukan balasan';
  if (c.user?.type === 'Bot' || String(c.user?.login ?? '').endsWith('[bot]')) return 'dari bot';
  const snap = await db()
    .collection('findings')
    .where('githubCommentId', '==', Number(c.in_reply_to_id))
    .limit(1)
    .get();
  if (snap.empty) return 'bukan thread bot';
  const ref = snap.docs[0].ref;
  const ai = parseAiCoderReply(String(c.body ?? ''));
  if (ai) {
    await ref.update({
      'signals.aiCoderReply': {
        verdict: ai.verdict,
        reason: ai.reason,
        sha: ai.sha,
        login: c.user?.login ?? null,
        at: new Date().toISOString(),
      },
    });
    return `balasan AI coder: ${ai.verdict}`;
  }
  await ref.update({
    'signals.humanReplies': FieldValue.arrayUnion({
      login: c.user?.login ?? '',
      text: String(c.body ?? '').slice(0, 2000),
      at: new Date().toISOString(),
    }),
  });
  return 'balasan manusia';
}

/** Kode di sekitar temuan (±3 baris) berubah antara commit yang direview dan commit akhir. */
export function codeChangedNear(diff: string, path: string, line: number, radius = 3): boolean {
  const f = parseUnifiedDiff(diff).get(path);
  if (!f) return false;
  for (const h of f.hunks) {
    const oldEnd = h.oldStart + Math.max(h.oldLines, 1) - 1;
    if (h.oldStart <= line + radius && oldEnd >= line - radius) return true;
  }
  return false;
}

const REVERT_FIX = /^(revert|fix|hotfix|bugfix)\b|^revert "/i;

/** pull_request.closed → batalkan job antre + collectFeedback (§6.8). */
export async function handlePullRequestClosed(p: any): Promise<string> {
  const repoId = Number(p.repository.id);
  const prNumber = Number(p.pull_request.number);
  const q = await db()
    .collection('jobs')
    .where('repo.id', '==', repoId)
    .where('pr.number', '==', prNumber)
    .where('status', '==', 'queued')
    .get();
  for (const d of q.docs)
    await d.ref.update({
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
      error: { stage: 'cancelled', message: 'PR ditutup' },
    });
  // catat status PR di semua job PR itu (halaman Review Kode: Terbuka / Ditutup / Sudah di-merge)
  const state = p.pull_request.merged ? 'merged' : 'closed';
  const all = await db().collection('jobs').where('repo.id', '==', repoId).where('pr.number', '==', prNumber).get();
  for (const d of all.docs) await d.ref.update({ 'pr.state': state });
  const n = await collectFeedback(p);
  return `dibatalkan ${q.size}; feedback ${n}`;
}

export async function collectFeedback(p: any, gh?: GH): Promise<number> {
  const fullName = String(p.repository.full_name);
  const [owner, repo] = fullName.split('/');
  const prNumber = Number(p.pull_request.number);
  const merged = !!p.pull_request.merged;
  const finalSha = String(p.pull_request.head?.sha ?? '');
  const octo = gh ?? (await installationOctokit(Number(p.installation.id)));
  const findings = await db()
    .collection('findings')
    .where('repoFullName', '==', fullName)
    .where('prNumber', '==', prNumber)
    .get();

  // Revert/fix susulan: PR ini menyentuh file temuan lama yang diabaikan → sinyal sangat kuat
  if (REVERT_FIX.test(String(p.pull_request.title ?? '')) && p.pull_request.base?.sha && finalSha) {
    try {
      const diff = String(
        (
          await octo.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
            owner,
            repo,
            basehead: `${p.pull_request.base.sha}...${finalSha}`,
            mediaType: { format: 'diff' },
          })
        ).data,
      );
      const touched = new Set(parseUnifiedDiff(diff).keys());
      const old = await db()
        .collection('findings')
        .where('repoFullName', '==', fullName)
        .where('outcome', 'in', ['ignored', 'accepted_by_merge'])
        .get();
      for (const d of old.docs) {
        if (d.get('prNumber') !== prNumber && touched.has(d.get('path')))
          await d.ref.update({ 'signals.laterRevertOrFix': { prNumber } });
      }
    } catch {
      // abaikan; sinyal opsional
    }
  }
  if (findings.empty) return 0;

  // Thread resolved via GraphQL
  const resolved = new Set<number>();
  try {
    const r: any = await octo.graphql(
      `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}`,
      { owner, repo, pr: prNumber },
    );
    for (const t of r.repository.pullRequest.reviewThreads.nodes)
      if (t.isResolved) for (const c of t.comments.nodes) resolved.add(Number(c.databaseId));
  } catch {
    // tanpa GraphQL → anggap belum resolved
  }

  const diffs = new Map<string, string>();
  const diffFor = async (from: string) => {
    if (!from || !finalSha || from === finalSha) return '';
    if (!diffs.has(from)) {
      try {
        diffs.set(
          from,
          String(
            (
              await octo.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
                owner,
                repo,
                basehead: `${from}...${finalSha}`,
                mediaType: { format: 'diff' },
              })
            ).data,
          ),
        );
      } catch {
        diffs.set(from, '');
      }
    }
    return diffs.get(from)!;
  };

  const learnItems: any[] = [];
  for (const d of findings.docs) {
    const f = d.data();
    const s: FindingSignals = { ...emptySignals(), ...(f.signals ?? {}) };
    if (f.githubCommentId) {
      try {
        const rs = (
          await octo.request('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions', {
            owner,
            repo,
            comment_id: f.githubCommentId,
          })
        ).data as { content: string }[];
        s.thumbsUp = rs.filter((x) => x.content === '+1').length;
        s.thumbsDown = rs.filter((x) => x.content === '-1').length;
      } catch {
        // abaikan
      }
      s.threadResolved = resolved.has(Number(f.githubCommentId));
    }
    s.codeChangedAfter = codeChangedNear(await diffFor(f.reviewedSha), f.path, Number(f.line));
    const outcome = classifyOutcome(s, merged);
    await d.ref.update({ signals: s, outcome, outcomeAt: FieldValue.serverTimestamp() });
    learnItems.push({
      id: d.id,
      title: f.title,
      category: f.category,
      severity: f.severity,
      path: f.path,
      outcome,
      reason: s.aiCoderReply?.reason ?? s.humanReplies.at(-1)?.text ?? null,
      authorLogin: f.prAuthorLogin,
    });
  }
  const first = findings.docs[0].data();
  await createJob({
    type: 'learn',
    repo: { id: Number(p.repository.id), fullName, installationId: Number(p.installation.id) },
    pr: { number: prNumber, authorLogin: first.prAuthorLogin, title: String(p.pull_request.title ?? '') },
    learn: { prNumber, findingIds: learnItems.map((x) => x.id), items: learnItems, merged },
  });
  return findings.size;
}
