import { setCommitStatus } from './status.js';
import { saveFact } from './memory-facts.js';
import { onRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  BOT_HANDLE,
  QUEUED_NO_MACHINE_TEXT,
  REPO_DISABLED_TEXT,
  helpText,
  parseCommand,
  parseReviewMode,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET } from './params.js';
import { installationOctokit } from './github.js';
import { anyMachineOnline, createJob, findActiveReview, ACTIVE_STATUSES } from './jobs.js';
import { handlePullRequestClosed, handleReviewCommentReply } from './feedback.js';
import { enqueueIndex, indexBranchOf } from './indexing.js';
import { markReverts, recordPr } from './prs.js';

export function verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  // Secret dari file/clipboard sering membawa baris baru di ujung (mis. `openssl rand -hex 32 > file`);
  // GitHub memotongnya saat ditempel, jadi di sini juga dipotong supaya tanda tangan cocok.
  secret = secret.trim();
  if (!header || !header.startsWith('sha256=') || !secret) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const TRUSTED_ASSOC = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/* eslint-disable @typescript-eslint/no-explicit-any -- payload webhook GitHub sangat besar; hanya field yang dipakai yang dibaca */
type Payload = any;

export const githubWebhook = onRequest(
  { secrets: [GITHUB_WEBHOOK_SECRET, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY], timeoutSeconds: 30 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Gunakan POST');
      return;
    }
    const raw = req.rawBody;
    if (!raw || !verifySignature(raw, req.get('x-hub-signature-256'), GITHUB_WEBHOOK_SECRET.value())) {
      res.status(401).send('Signature tidak valid');
      return;
    }
    const event = req.get('x-github-event') ?? '';
    const delivery = req.get('x-github-delivery') ?? '';
    if (!delivery) {
      res.status(400).send('Tanpa X-GitHub-Delivery');
      return;
    }
    const now = Date.now();
    try {
      await db()
        .doc(`webhookDeliveries/${delivery}`)
        .create({
          receivedAt: FieldValue.serverTimestamp(),
          event,
          handled: false,
          expireAt: Timestamp.fromMillis(now + 7 * 86400_000),
        });
    } catch (e) {
      // Hanya ALREADY_EXISTS (gRPC code 6) yang berarti duplikat; error lain → 500 supaya GitHub mengirim ulang.
      if ((e as { code?: number | string }).code === 6 || (e as { code?: string }).code === 'already-exists') {
        res.status(200).send('duplikat');
      } else {
        logger.error('webhookDeliveries gagal dibuat', { delivery, err: String(e) });
        res.status(500).json({ ok: false });
      }
      return;
    }
    const payload = req.body as Payload;
    try {
      const result = await handleEvent(event, payload, delivery);
      await db().doc(`webhookDeliveries/${delivery}`).update({ handled: true, result });
      res.status(200).json({ ok: true, result });
    } catch (e) {
      logger.error('webhook gagal', { event, delivery, err: String(e) });
      // Hapus penanda supaya pengiriman ulang GitHub (delivery ID sama) diproses lagi, bukan dianggap duplikat.
      await db()
        .doc(`webhookDeliveries/${delivery}`)
        .delete()
        .catch(() => undefined);
      res.status(500).json({ ok: false });
    }
  },
);

export async function handleEvent(event: string, p: Payload, delivery: string): Promise<string> {
  switch (event) {
    case 'issue_comment':
      return p.action === 'created' ? handleIssueComment(p, delivery) : 'abaikan';
    case 'pull_request':
      // semua PR dicatat (juga yang tidak direview Chef Juno) untuk Analitik → Dampak
      if (['opened', 'reopened', 'closed', 'ready_for_review', 'edited', 'converted_to_draft'].includes(p.action))
        await recordPr(p).catch(() => undefined);
      if (p.action === 'closed') return handlePullRequestClosed(p);
      return 'abaikan';
    case 'pull_request_review_comment':
      return p.action === 'created' ? handleReviewCommentReply(p) : 'abaikan';
    case 'installation':
    case 'installation_repositories':
      return handleInstallation(p);
    case 'push':
      return handlePush(p);
    case 'ping':
      return 'pong';
    default:
      return 'abaikan';
  }
}

async function upsertRepo(repo: Payload, installationId: number) {
  const ref = db().doc(`repos/${repo.id}`);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      fullName: repo.full_name,
      installationId,
      private: !!repo.private,
      enabled: true,
      defaultBranch: repo.default_branch ?? 'main',
      updatedAt: FieldValue.serverTimestamp(),
      index: { status: 'none' },
    });
  } else {
    // koreksi data lama: instalasi berpindah, atau branch utama tercatat salah (mis. tebakan `main` padahal `master`)
    const patch: Record<string, unknown> = {};
    if (snap.get('installationId') !== installationId) patch.installationId = installationId;
    if (repo.default_branch && snap.get('defaultBranch') !== repo.default_branch)
      patch.defaultBranch = repo.default_branch;
    if (Object.keys(patch).length) await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  }
  return (await ref.get()).data()!;
}

async function handleIssueComment(p: Payload, delivery: string): Promise<string> {
  const comment = p.comment;
  const issue = p.issue;
  if (!issue?.pull_request) return 'bukan PR';
  if (comment?.user?.type === 'Bot' || String(comment?.user?.login ?? '').endsWith('[bot]')) return 'dari bot';
  const cmd = parseCommand(String(comment?.body ?? ''), BOT_HANDLE);
  if (!cmd) return 'tanpa mention';
  // Hanya OWNER/MEMBER/COLLABORATOR atau anggota dashboard; selain itu diam (tanpa reaksi).
  const trusted =
    TRUSTED_ASSOC.has(String(comment.author_association)) ||
    (await db().doc(`members/${comment.user.id}`).get()).exists;
  if (!trusted) return 'pengirim tidak dipercaya';

  const installationId = Number(p.installation?.id);
  const repoData = await upsertRepo(p.repository, installationId);
  const [owner, name] = String(p.repository.full_name).split('/');
  const gh = await installationOctokit(installationId);
  const issueNumber = Number(issue.number);

  if (repoData.enabled === false) {
    await gh.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo: name,
      issue_number: issueNumber,
      body: REPO_DISABLED_TEXT,
    });
    return 'repo nonaktif';
  }
  if (cmd.kind === 'help') {
    await gh.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo: name,
      issue_number: issueNumber,
      body: helpText(BOT_HANDLE),
    });
    return 'bantuan';
  }
  // `@chefjuno ingat <fakta>` → memory Chef Juno (dipakai reviewer & penguji aplikasi berikutnya)
  if (cmd.kind === 'remember') {
    const text = cmd.instruction.trim();
    const saved = text
      ? await saveFact({ repoId: Number(p.repository.id), text, source: 'ingat', by: String(comment.user.login) })
      : null;
    await gh.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo: name,
      issue_number: issueNumber,
      body: !saved
        ? 'Tulis faktanya setelah perintah, mis. `@chefjuno ingat akun uji harus premium supaya kuis terbuka`.'
        : saved.duplicate
          ? '🧠 Sudah ada di memory Chef Juno.'
          : `🧠 Disimpan ke memory Chef Juno: “${text.slice(0, 300)}”. Dipakai di review & uji aplikasi berikutnya; bisa dinonaktifkan di dashboard (Memory tim).`,
    });
    return saved ? (saved.duplicate ? 'ingat: duplikat' : 'ingat') : 'ingat: kosong';
  }

  const reaction = await gh.request('POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions', {
    owner,
    repo: name,
    comment_id: comment.id,
    content: 'eyes',
  });
  const pr = (
    await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: name, pull_number: issueNumber })
  ).data as Payload;
  const repoRef = { id: Number(p.repository.id), fullName: String(p.repository.full_name), installationId };
  const existing = await findActiveReview(repoRef.id, issueNumber, pr.head.sha);
  if (existing) return `sudah ada job ${existing.id}`;
  const job = await createJob({
    type: 'review',
    repo: repoRef,
    pr: {
      number: issueNumber,
      title: String(pr.title ?? ''),
      body: String(pr.body ?? '').slice(0, 20_000),
      authorLogin: String(pr.user?.login ?? ''),
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      htmlUrl: pr.html_url,
      draft: !!pr.draft,
    },
    trigger: {
      commentId: comment.id,
      commentUrl: comment.html_url ?? null,
      userLogin: comment.user.login,
      userId: comment.user.id,
      command: cmd.word ?? 'review',
      instruction: parseReviewMode(cmd.instruction).instruction,
      rawText: String(comment.body).slice(0, 2000),
      deliveryId: delivery,
    },
    github: { eyesReactionId: (reaction.data as { id: number }).id },
    // `lapor @chefjuno dalam ...` → mode mendalam untuk job ini saja (default dari setting)
    // `lapor @chefjuno dalam|standar ...` → mode dipaksa untuk job ini; selain itu mengikuti setting (default: otomatis)
    ...(parseReviewMode(cmd.instruction).mode ? { reviewMode: parseReviewMode(cmd.instruction).mode } : {}),
  });
  if (!(await anyMachineOnline())) {
    await gh.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo: name,
      issue_number: issueNumber,
      body: QUEUED_NO_MACHINE_TEXT,
    });
  }
  // gate: status "Chef Juno" pending di head PR sampai review diposting
  const statusError = await setCommitStatus(gh, {
    fullName: repoRef.fullName,
    sha: pr.head.sha,
    state: 'pending',
    description: 'Sedang direview…',
    jobId: job.id,
  });
  if (statusError) await job.update({ 'github.statusError': statusError });
  return `job ${job.id}`;
}

/** Branch utama repo menurut GitHub; `main` hanya bila API gagal. */
async function realDefaultBranch(installationId: number, fullName: string): Promise<string> {
  try {
    const [owner, repo] = fullName.split('/');
    const gh = await installationOctokit(installationId);
    const r = await gh.request('GET /repos/{owner}/{repo}', { owner, repo });
    return String((r.data as { default_branch?: string }).default_branch || 'main');
  } catch {
    return 'main';
  }
}

async function handleInstallation(p: Payload): Promise<string> {
  const installationId = Number(p.installation?.id);
  const added: Payload[] = p.repositories_added ?? (p.action === 'created' ? (p.repositories ?? []) : []);
  const removed: Payload[] = p.repositories_removed ?? (p.action === 'deleted' ? (p.repositories ?? []) : []);
  for (const r of added) {
    // event instalasi tidak menyertakan default_branch → tanyakan ke GitHub (repo bisa memakai `master`, `develop`, …)
    const branch = r.default_branch ?? (await realDefaultBranch(installationId, String(r.full_name)));
    const data = await upsertRepo({ ...r, default_branch: branch }, installationId);
    await enqueueIndex(
      { id: Number(r.id), fullName: r.full_name, installationId },
      { mode: 'full', targetSha: null, ref: indexBranchOf(data) },
    );
  }
  for (const r of removed) {
    await db().doc(`repos/${r.id}`).set({ enabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return `repo +${added.length} -${removed.length}`;
}

async function handlePush(p: Payload): Promise<string> {
  const repo = p.repository;
  const branch = String(p.ref ?? '').replace('refs/heads/', '');
  const installationId = Number(p.installation?.id);
  // upsert juga mengoreksi defaultBranch dari payload push; index hanya untuk branch knowledge base repo ini
  const data = await upsertRepo(repo, installationId);
  // revert di branch utama → tandai PR yang di-revert (Analitik → Dampak)
  if (branch === (repo.default_branch ?? data.defaultBranch) && Array.isArray(p.commits))
    await markReverts(Number(repo.id), p.commits).catch(() => undefined);
  if (branch !== indexBranchOf(data)) return 'bukan branch knowledge base';
  if (data.enabled === false) return 'repo nonaktif';
  const mode = data.index?.indexedSha ? 'incremental' : 'full';
  const id = await enqueueIndex(
    { id: Number(repo.id), fullName: repo.full_name, installationId },
    { mode, targetSha: p.after, ref: branch },
  );
  return `index ${id}`;
}

export { ACTIVE_STATUSES };
