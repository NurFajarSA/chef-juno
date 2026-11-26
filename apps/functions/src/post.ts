import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import {
  FINDING_MARKER_RE,
  REVIEW_FAILED_TEXT,
  StoredReviewOutputSchema,
  SUMMARY_MARKER,
  STALE_TEXT,
  containsSecret,
  effectiveScore,
  formatInlineComment,
  formatRereviewReply,
  formatSummaryComment,
  isSuppressed,
  mapToDiff,
  parseUnifiedDiff,
  selectPostable,
  sortFindings,
  type ReviewFinding,
  type SuppressionRule,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { DASHBOARD_URL } from './params.js';
import { gateVerdict, setCommitStatus } from './status.js';
import { createJob } from './jobs.js';

/**
 * Status temuan review sebelumnya di PR yang sama: "masih ada" bila review ini menemukan masalah di file yang sama dan baris
 * berdekatan (±10) atau judul sama; selain itu "sudah beres" (diperbaiki, atau penulis sudah menandai diperbaiki).
 */
export async function previousFindingsStatus(
  jobId: string,
  repoId: number,
  prNumber: number,
  current: { path: string; line: number; title: string }[],
): Promise<{ fixed: string[]; open: string[]; added: string[]; previousJobId: string } | null> {
  const snap = await db().collection('findings').where('repoId', '==', repoId).where('prNumber', '==', prNumber).get();
  const prev = snap.docs.map((d) => d.data()).filter((f) => f.jobId !== jobId && !f.held);
  if (!prev.length) return null;
  // hanya review terakhir sebelum ini
  const lastJob = prev.reduce((a, f) =>
    (f.createdAt?.toMillis?.() ?? 0) > (a.createdAt?.toMillis?.() ?? 0) ? f : a,
  ).jobId;
  const norm = (t: string) => String(t).toLowerCase().replace(/\W+/g, ' ').trim();
  const fixed: string[] = [];
  const open: string[] = [];
  const near = (c: { path: string; line: number; title: string }, f: Record<string, unknown>) =>
    c.path === f.path && (Math.abs(c.line - Number(f.line)) <= 10 || norm(c.title) === norm(String(f.title)));
  const last = prev.filter((x) => x.jobId === lastJob);
  for (const f of last) {
    const still = f.outcome !== 'addressed' && current.some((c) => near(c, f));
    (still ? open : fixed).push(String(f.title));
  }
  const added = current.filter((c) => !last.some((f) => near(c, f))).map((c) => c.title);
  return { fixed, open, added, previousJobId: String(lastJob) };
}

/** Tautan ke screenshot bukti di dashboard (perlu login); null bila DASHBOARD_URL belum diisi. */
export function evidenceLink(jobId: string, f: object): string | null {
  const base = DASHBOARD_URL.value().replace(/\/+$/, '');
  const shot = (f as { evidence?: { shots?: string[] } }).evidence?.shots?.[0];
  return base && shot ? `${base}/reviews/${jobId}#bukti-${shot}` : null;
}
import { installationOctokit, type GH } from './github.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- data dokumen job dibaca bebas lalu divalidasi zod */
type Job = any;

function repoParts(job: Job) {
  const [owner, repo] = String(job.repo.fullName).split('/');
  return { owner, repo };
}

export async function loadSuppressions(repoId: number): Promise<SuppressionRule[]> {
  const snap = await db().collection('rules').where('status', '==', 'active').where('kind', '==', 'suppression').get();
  return snap.docs
    .filter((d) => {
      const r = d.get('scope.repoId');
      return r == null || String(r) === String(repoId);
    })
    .map((d) => ({ id: d.id, match: d.get('match') }));
}

/** §6.4 — posting review: inline dulu, lalu ringkasan sticky, simpan findings, ganti reaksi. */
export async function postReview(ref: DocumentReference, job: Job, gh?: GH) {
  const parsed = StoredReviewOutputSchema.safeParse(job.result);
  if (!parsed.success) {
    await ref.update({
      status: 'failed',
      error: { stage: 'parse', message: 'Hasil review tidak sesuai schema' },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }
  const out = parsed.data;
  const { owner, repo } = repoParts(job);
  const octo = gh ?? (await installationOctokit(Number(job.repo.installationId)));
  const prNumber = Number(job.pr.number);
  const maxInline = Math.min(30, Number(job.config?.maxInlineComments ?? 10));
  const notes: string[] = [];

  // Anti-bocor sebelum posting (§12.9)
  if (containsSecret(JSON.stringify(out))) {
    await ref.update({
      status: 'failed',
      error: { stage: 'leak', message: 'Output memuat pola rahasia; tidak diposting.' },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  // Kelengkapan: agent melapor incomplete atau diff terpotong → review sebagian (tidak pernah "siap merge")
  const diffTruncated = job.result?.meta?.diffTruncated === true;
  const incompleteReason =
    out.reviewCompletion === 'incomplete'
      ? out.uncertainty.trim() || 'Agent melaporkan ada bagian yang tidak bisa dinilai.'
      : diffTruncated
        ? `Diff melebihi batas ${Math.round(Number(job.config?.maxDiffBytes ?? 0) / 1000)} KB dan dipotong.`
        : null;

  // Ambang posting: keyakinan & prioritas (yang ditahan tetap disimpan di dashboard)
  const { post: postable, held } = selectPostable(out.findings, {
    minConfidence: job.config?.minConfidence,
    maxPriority: job.config?.maxPostPriority,
  });

  // Suppression deterministik (§12.10)
  const rules = await loadSuppressions(Number(job.repo.id));
  const kept: ReviewFinding[] = [];
  const suppressed: { finding: ReviewFinding; ruleId: string }[] = [];
  for (const f of postable) {
    const r = isSuppressed(f, rules);
    if (r) suppressed.push({ finding: f, ruleId: r.id });
    else kept.push(f);
  }

  // Petakan ke baris diff (RIGHT)
  const diff = (
    await octo.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    })
  ).data as unknown as string;
  const files = parseUnifiedDiff(String(diff));
  const sorted = sortFindings(kept);
  const inline: { f: ReviewFinding; id: string; loc: { path: string; line: number; startLine: number | null } }[] = [];
  const other: ReviewFinding[] = [];
  for (const f of sorted) {
    const loc = mapToDiff(f, files);
    if (loc && inline.length < maxInline) inline.push({ f, id: db().collection('findings').doc().id, loc });
    else other.push(f);
  }

  // Review inline (satu review event COMMENT, commit_id = headSha, line+side; tanpa position)
  let reviewId: number | null = null;
  // review ulang menggantikan yang lama: komentar inline Chef Juno sebelumnya di PR ini dihapus, kecuali yang sudah
  // dibalas atau diberi reaksi (diskusi & bahan belajar tim)
  const replacedInline = await removeStaleInline(octo, owner, repo, prNumber);
  const urls = new Map<string, { id: number; url: string }>();
  if (inline.length) {
    const comments = inline.map(({ f, id, loc }) => ({
      path: loc.path,
      line: loc.line,
      side: 'RIGHT' as const,
      ...(loc.startLine ? { start_line: loc.startLine, start_side: 'RIGHT' as const } : {}),
      body: formatInlineComment(f, id, evidenceLink(ref.id, f)),
    }));
    try {
      const rv = await octo.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: prNumber,
        commit_id: job.pr.headSha,
        event: 'COMMENT',
        body: '',
        comments,
      });
      reviewId = (rv.data as { id: number }).id;
      const listed = await octo.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments', {
        owner,
        repo,
        pull_number: prNumber,
        review_id: reviewId,
        per_page: 100,
      });
      for (const c of listed.data as { id: number; body: string; html_url: string }[]) {
        const m = FINDING_MARKER_RE.exec(c.body);
        if (m) urls.set(m[1], { id: c.id, url: c.html_url });
      }
    } catch (e) {
      if ((e as { status?: number }).status !== 422) throw e;
      // Satu baris di luar diff → seluruh review ditolak → semua pindah ke "Temuan lain"
      notes.push('Review inline ditolak GitHub (422); semua temuan dipindah ke ringkasan.');
      other.unshift(...inline.map((x) => x.f));
      inline.length = 0;
    }
  }

  const machine = job.machineId ? (await db().doc(`machines/${job.machineId}`).get()).get('name') : null;
  const impact: string[] = Array.isArray(job.result?.impact) ? job.result.impact : [];
  const previous = await previousFindingsStatus(ref.id, Number(job.repo.id), prNumber, [
    ...kept,
    ...held.map((h) => h.finding),
  ]);
  const body = formatSummaryComment(
    out,
    inline.map((x) => ({ finding: x.f, url: urls.get(x.id)?.url ?? null })),
    sortFindings(other),
    {
      headSha: job.pr.headSha,
      agent: job.result?.meta?.agent ?? 'claude',
      model: footerModel(job.result?.meta),
      promptVersions: job.promptVersions ?? { persona: 1, review: 1 },
      machineName: machine ?? job.machineId ?? '-',
      durationMs: Number(job.result?.meta?.durationMs ?? 0),
      appVerify: job.result?.meta?.appVerification ?? null,
      impact,
      suppressedCount: suppressed.length,
      note: notes[0] ?? null,
      heldCount: held.length,
      incomplete: incompleteReason,
      previous,
    },
  );

  // Ringkasan sticky: cari komentar bot dengan marker → PATCH; kalau belum ada → buat
  const existing = (
    await octo.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    })
  ).data as {
    id: number;
    body?: string;
    html_url?: string;
    user?: { type?: string };
    performed_via_github_app?: unknown;
  }[];
  const sticky = existing.find(
    (c) => (c.body ?? '').includes(SUMMARY_MARKER) && (c.performed_via_github_app || c.user?.type === 'Bot'),
  );
  let summaryCommentId: number;
  if (sticky) {
    await octo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner,
      repo,
      comment_id: sticky.id,
      body,
    });
    summaryCommentId = sticky.id;
    // edit tidak memicu notifikasi GitHub → komentar peminta review ulang dibalas: sudah diperbarui + inti perubahannya
    if (job.trigger?.commentId) {
      const prevScore = previous ? (await db().doc(`jobs/${previous.previousJobId}`).get()).get('result.score') : null;
      await octo.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        body: formatRereviewReply({
          login: job.trigger.userLogin ?? null,
          requestUrl: job.trigger.commentUrl ?? null,
          headSha: job.pr.headSha,
          verdict: out.verdict,
          score: out.score,
          incomplete: !!incompleteReason,
          previousScore: typeof prevScore === 'number' ? prevScore : null,
          previous,
          added: previous ? previous.added : [...inline.map((x) => x.f), ...other].map((f) => f.title),
          summaryUrl: sticky.html_url ?? null,
        }),
      });
    }
  } else {
    const c = await octo.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    summaryCommentId = (c.data as { id: number }).id;
  }

  // Simpan findings (denormalisasi)
  const batch = db().batch();
  const base = {
    jobId: ref.id,
    repoId: job.repo.id,
    repoFullName: job.repo.fullName,
    prNumber,
    prAuthorLogin: job.pr.authorLogin,
    promptVersions: job.promptVersions ?? null,
    agent: job.result?.meta?.agent ?? null,
    reviewedSha: job.pr.headSha,
    createdAt: FieldValue.serverTimestamp(),
    outcome: 'pending',
    outcomeAt: null,
    signals: {
      thumbsUp: 0,
      thumbsDown: 0,
      threadResolved: false,
      codeChangedAfter: false,
      humanReplies: [],
      aiCoderReply: null,
      laterRevertOrFix: null,
    },
  };
  const findingDoc = (f: ReviewFinding, postedInline: boolean, ghc: { id: number; url: string } | null) => ({
    ...base,
    path: f.path,
    line: f.line,
    startLine: f.startLine,
    severity: f.severity,
    category: f.category,
    title: f.title,
    body: `${f.what}\n\n${f.why}\n\n**Perbaikan:** ${f.fix}`,
    suggestion: f.suggestion,
    confidence: f.confidence,
    trigger: f.trigger,
    // skill tim yang menjadi dasar temuan (sudah divalidasi mesin: hanya skill yang dimuat)
    skill: (f as { skill?: string }).skill ?? '',
    // hasil uji aplikasi (status, catatan, id screenshot di jobs/{jobId}/evidence)
    evidence: (f as { evidence?: unknown }).evidence ?? null,
    postedInline,
    githubCommentId: ghc?.id ?? null,
    githubCommentUrl: ghc?.url ?? null,
  });
  for (const x of inline) batch.set(db().doc(`findings/${x.id}`), findingDoc(x.f, true, urls.get(x.id) ?? null));
  const otherRefs = other.map(() => db().collection('findings').doc());
  other.forEach((f, i) => batch.set(otherRefs[i], findingDoc(f, false, null)));
  // temuan yang ditahan: tidak diposting, tapi tercatat supaya tim bisa menilai & Chef Juno bisa belajar
  for (const h of held)
    batch.set(db().collection('findings').doc(), { ...findingDoc(h.finding, false, null), held: h.reason });
  // rules.usageCount untuk aturan yang dipakai di prompt (§12.3)
  for (const rid of (job.result?.appliedRuleIds ?? []) as string[]) {
    batch.update(db().doc(`rules/${rid}`), {
      usageCount: FieldValue.increment(1),
      lastUsedAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(ref, {
    status: 'posted',
    'result.suppressed': suppressed.map((s) => ({ ...s.finding, ruleId: s.ruleId })),
    'result.postedInline': inline.length,
    'result.held': held.map((h) => ({ ...h.finding, heldReason: h.reason })),
    'result.reviewCompletion': incompleteReason ? 'incomplete' : 'complete',
    'result.incompleteReason': incompleteReason,
    'result.effectiveScore': effectiveScore(out.score, !!incompleteReason),
    'result.postedOther': other.length,
    'result.replacedInline': replacedInline,
    'result.notes': notes,
    'github.summaryCommentId': summaryCommentId,
    'github.reviewId': reviewId,
    'github.postedAt': FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  // gate: PASS / PASS+NOTES / FAIL dari temuan yang benar-benar diposting
  const gate = gateVerdict([...inline.map((x) => x.f), ...other], {
    incomplete: !!incompleteReason,
    score: effectiveScore(out.score, !!incompleteReason),
  });
  // satu standar: PR non-remeh diuji di aplikasi lewat job lanjutan; status menunggu hasilnya (kecuali sudah FAIL)
  const appPending = job.result?.meta?.appVerification?.pending === true;
  let appJobId: string | null = null;
  if (appPending) {
    const appJob = await createJob({
      type: 'app-verify',
      repo: job.repo,
      pr: job.pr,
      parentJobId: ref.id,
      prBrief: String(job.result?.prBrief ?? '').slice(0, 12_000),
      // temuan yang diposting + id dokumen/komentar supaya bukti bisa ditempel kembali
      findings: [
        ...inline.map((x) => ({ ...x.f, findingId: x.id, commentId: urls.get(x.id)?.id ?? null })),
        ...other.map((f, i) => ({ ...f, findingId: otherRefs[i].id, commentId: null })),
      ],
    });
    appJobId = appJob.id;
  }
  const waiting = appPending && gate.state === 'success';
  const statusError = await setCommitStatus(octo, {
    fullName: String(job.repo.fullName),
    sha: String(job.pr.headSha),
    state: waiting ? 'pending' : gate.state,
    description: waiting ? `${gate.description} · menunggu uji aplikasi` : gate.description,
    jobId: ref.id,
  });
  await ref.update({ 'result.gate': gate, 'github.statusError': statusError, 'github.appJobId': appJobId });

  await swapReaction(octo, job, '+1');
}

/** Hapus komentar inline Chef Juno lama di PR yang belum dibalas & belum diberi reaksi. Kembalikan jumlahnya. */
export async function removeStaleInline(octo: GH, owner: string, repo: string, prNumber: number): Promise<number> {
  const list = (
    await octo.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    })
  ).data as {
    id: number;
    body?: string;
    user?: { type?: string };
    in_reply_to_id?: number;
    reactions?: { total_count?: number };
  }[];
  const replied = new Set(list.map((c) => c.in_reply_to_id).filter(Boolean));
  const stale = list.filter(
    (c) =>
      (c.body ?? '').includes('chefjuno-ai:finding:') &&
      c.user?.type === 'Bot' &&
      !c.in_reply_to_id &&
      !replied.has(c.id) &&
      !c.reactions?.total_count,
  );
  let n = 0;
  for (const c of stale) {
    const ok = await octo
      .request('DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}', { owner, repo, comment_id: c.id })
      .then(() => true)
      .catch(() => false);
    if (ok) n++;
  }
  return n;
}

async function swapReaction(octo: GH, job: Job, content: '+1' | 'confused') {
  const { owner, repo } = repoParts(job);
  const commentId = job.trigger?.commentId;
  if (!commentId) return;
  const eyes = job.github?.eyesReactionId;
  if (eyes) {
    await octo
      .request('DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}', {
        owner,
        repo,
        comment_id: commentId,
        reaction_id: eyes,
      })
      .catch(() => undefined);
  }
  await octo.request('POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions', {
    owner,
    repo,
    comment_id: commentId,
    content,
  });
}

/** Job review gagal → reaksi 😕 + balasan singkat berisi tahap (tanpa stack trace/rahasia). */
export async function notifyReviewFailed(ref: DocumentReference, job: Job, gh?: GH) {
  if (job.github?.failureNotifiedAt || !job.pr?.number) return;
  const octo = gh ?? (await installationOctokit(Number(job.repo.installationId)));
  const { owner, repo } = repoParts(job);
  const stage = String(job.error?.stage ?? 'unknown')
    .replace(/[^a-z_-]/gi, '')
    .slice(0, 30);
  await swapReaction(octo, job, 'confused');
  // gate: review gagal → status error (PR tidak dianggap lulus)
  await setCommitStatus(octo, {
    fullName: String(job.repo.fullName),
    sha: String(job.pr.headSha ?? ''),
    state: 'error',
    description: `Review gagal (tahap ${stage}) — ulangi: lapor @chefjuno`,
    jobId: ref.id,
  });
  await octo.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner,
    repo,
    issue_number: Number(job.pr.number),
    body: stage === 'stale' ? STALE_TEXT : REVIEW_FAILED_TEXT(stage),
  });
  await ref.update({ 'github.failureNotifiedAt': FieldValue.serverTimestamp() });
}

/** Model di footer ringkasan: model unik dari semua langkah berhasil (mis. "sonnet + opus"), urut kemunculan. */
export function footerModel(
  meta: { model?: string | null; passes?: { model: string | null; ok: boolean }[] } | undefined,
) {
  const models = [...new Set((meta?.passes ?? []).filter((p) => p.ok && p.model).map((p) => p.model as string))];
  return models.length ? models.join(' + ') : (meta?.model ?? null);
}
