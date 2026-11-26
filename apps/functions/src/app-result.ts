import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  APP_MARKER,
  applyAppOutcomeToSummary,
  formatAppComment,
  formatInlineComment,
  type ReviewFinding,
} from '@chefjuno/shared';
import { db } from './admin.js';
import { installationOctokit, type GH } from './github.js';
import { evidenceLink } from './post.js';
import { evidenceImageUrl } from './evidence.js';
import { saveFact } from './memory-facts.js';
import { appGate, setCommitStatus, type GateVerdict } from './status.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- data dokumen job dibaca bebas */
type Job = any;
type TrialFinding = ReviewFinding & {
  findingId?: string;
  commentId?: number | null;
  evidence?: { status: 'reproduced' | 'not_reproduced' | 'inconclusive'; note: string; goal: string; shots: string[] };
};

/** Pasang/perbarui komentar sticky "🧪 Uji aplikasi" di PR. */
async function upsertAppComment(octo: GH, fullName: string, prNumber: number, body: string) {
  const [owner, repo] = fullName.split('/');
  const list = (
    await octo.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    })
  ).data as { id: number; body?: string; user?: { type?: string }; performed_via_github_app?: unknown }[];
  const sticky = list.find(
    (c) => (c.body ?? '').includes(APP_MARKER) && (c.performed_via_github_app || c.user?.type === 'Bot'),
  );
  if (sticky)
    await octo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner,
      repo,
      comment_id: sticky.id,
      body,
    });
  else
    await octo.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
}

/**
 * Hasil job uji aplikasi → review induk: bukti di temuan (dokumen + komentar inline), temuan baru bila alur yang
 * diubah rusak, komentar 🧪, dan status gate akhir.
 */
export async function applyAppVerifyResult(ref: DocumentReference, job: Job, gh?: GH) {
  const parentRef = db().doc(`jobs/${job.parentJobId}`);
  const parent = (await parentRef.get()).data();
  if (!parent) throw new Error('review induk tidak ada');
  const av = job.result?.appVerification ?? { ran: false, reason: 'hasil uji tidak ada' };
  const findings = (job.result?.findings ?? []) as TrialFinding[];
  const octo = gh ?? (await installationOctokit(Number(job.repo.installationId)));
  const [owner, repo] = String(job.repo.fullName).split('/');
  const prNumber = Number(job.pr.number);

  // screenshot disimpan di job uji ini (jobs/{ref.id}/evidence) → URL bertanda tangan untuk tampil inline di GitHub
  const imgs = (shots: string[] | undefined) =>
    (shots ?? []).map((sid) => evidenceImageUrl(ref.id, sid)).filter((u): u is string => !!u);
  // bukti → dokumen temuan & komentar inline yang sudah ada
  const batch = db().batch();
  for (const f of findings) {
    if (!f.evidence) continue;
    if (f.findingId) {
      batch.update(db().doc(`findings/${f.findingId}`), { evidence: f.evidence, confidence: f.confidence });
      if (f.commentId)
        await octo
          .request('PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}', {
            owner,
            repo,
            comment_id: f.commentId,
            body: formatInlineComment(f, f.findingId, evidenceLink(parentRef.id, f), imgs(f.evidence.shots)),
          })
          .catch((e) => logger.warn('gagal menempel bukti di komentar', { err: String(e) }));
    } else {
      // temuan baru dari uji: alur yang diubah rusak
      batch.set(db().collection('findings').doc(), {
        jobId: parent ? parentRef.id : ref.id,
        repoId: job.repo.id,
        repoFullName: job.repo.fullName,
        prNumber,
        prAuthorLogin: job.pr.authorLogin ?? null,
        path: f.path,
        line: f.line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        body: `${f.what}\n\n${f.why}\n\n**Perbaikan:** ${f.fix}`,
        confidence: f.confidence,
        evidence: f.evidence,
        evidenceJobId: ref.id,
        postedInline: false,
        outcome: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();

  // komentar 🧪
  // tautan bukti ke halaman review induk (dashboard memuat bukti dari job uji lewat github.appJobId)
  const link = (f: TrialFinding) => evidenceLink(parentRef.id, f);
  const tried = findings
    .filter((f) => f.evidence && f.findingId)
    .map((f) => ({
      severity: f.severity,
      title: f.title,
      status: f.evidence!.status,
      note: f.evidence!.note,
      link: link(f),
      images: imgs(f.evidence!.shots),
    }));
  // repo tanpa uji aplikasi: tidak ada yang perlu dilaporkan → tanpa komentar 🧪 (tidak menambah notifikasi)
  if (!av.notApplicable)
    await upsertAppComment(
      octo,
      String(job.repo.fullName),
      prNumber,
      formatAppComment({
        headSha: String(job.pr.headSha),
        ran: !!av.ran,
        reason: av.reason,
        backend: av.backend,
        buildMs: av.buildMs,
        runMs: av.runMs,
        change: av.change ? { ...av.change, images: imgs(av.change.shots) } : null,
        changeLink: av.change?.shots?.[0] ? evidenceLink(parentRef.id, { evidence: av.change }) : null,
        tried,
        skipped: (av.skipped ?? []) as { title: string; reason: string }[],
      }),
    );

  // alur rusak / temuan baru dari uji → ringkasan ikut: skor dibatasi + alasannya di bawah verdict (bukan hanya status)
  const broken = av.ran && av.change?.status === 'reproduced';
  const fresh = findings.filter((f) => !f.findingId && f.evidence?.status === 'reproduced');
  const summaryId = Number(parent.github?.summaryCommentId ?? 0);
  if ((broken || fresh.length) && summaryId) {
    try {
      const cur = (
        await octo.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner,
          repo,
          comment_id: summaryId,
        })
      ).data as { body?: string };
      const next = applyAppOutcomeToSummary(String(cur.body ?? ''), {
        reviewScore: Number(parent.result?.score ?? 5),
        broken: !!broken,
        findings: fresh.map((f) => ({ severity: f.severity, title: f.title })),
        note: broken ? (av.change?.note ?? null) : null,
        link: av.change?.shots?.[0] ? evidenceLink(parentRef.id, { evidence: av.change }) : null,
      });
      if (next !== cur.body)
        await octo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner,
          repo,
          comment_id: summaryId,
          body: next,
        });
    } catch (e) {
      logger.warn('gagal memperbarui ringkasan dengan hasil uji', { err: String(e) });
    }
  }

  // gate akhir
  const code = (parent.result?.gate ?? { verdict: 'PASS', description: 'PASS' }) as {
    verdict: GateVerdict;
    description: string;
  };
  const gate = appGate(code, av);
  const statusError = await setCommitStatus(octo, {
    fullName: String(job.repo.fullName),
    sha: String(job.pr.headSha),
    state: gate.state,
    description: gate.description,
    jobId: parentRef.id,
  });
  await parentRef.update({
    'result.meta.appVerification': av,
    'result.appGate': gate,
    'github.statusError': statusError,
    updatedAt: FieldValue.serverTimestamp(),
  });
  // pelajaran penguji tentang cara menguji app ini → memory Chef Juno (mis. "akun uji harus premium")
  const lessons = (av.lessons ?? []) as string[];
  const remembered: string[] = [];
  for (const l of lessons.slice(0, 6)) {
    if (typeof l !== 'string' || l.trim().length < 12) continue;
    const r = await saveFact({ repoId: Number(job.repo.id), text: l, source: 'uji-aplikasi', by: 'chefjuno' }).catch(
      () => null,
    );
    if (r && !r.duplicate) remembered.push(r.id);
  }
  await ref.update({
    status: 'posted',
    'result.gate': gate,
    'result.remembered': remembered,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Job uji aplikasi gagal → PR belum teruji (tidak lulus), alasan di komentar 🧪. */
export async function applyAppVerifyFailed(ref: DocumentReference, job: Job, gh?: GH) {
  const stage = String(job.error?.stage ?? 'unknown')
    .replace(/[^a-z_-]/gi, '')
    .slice(0, 30);
  await applyAppVerifyResult(
    ref,
    {
      ...job,
      result: {
        appVerification: { ran: false, reason: `uji aplikasi gagal dijalankan (tahap ${stage})` },
        findings: [],
      },
    },
    gh,
  ).catch((e) => logger.error('gagal mencatat uji aplikasi yang gagal', { err: String(e) }));
}
