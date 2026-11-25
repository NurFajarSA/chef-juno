import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/https';
import { db } from './admin.js';
import { installationOctokit, type GH } from './github.js';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } from './params.js';
import { audit, requireMember } from './util.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- payload/response GitHub besar; hanya field yang dipakai yang dibaca */

/**
 * Catatan semua PR di repo terpasang (termasuk yang tidak direview Chef Juno) untuk Analitik → Dampak:
 * waktu dibuat/merge, review manusia pertama, dan apakah PR itu kemudian di-revert.
 */
export const prDocId = (repoId: number, number: number) => `${repoId}_${number}`;

const ts = (iso: unknown) => (typeof iso === 'string' && iso ? Timestamp.fromDate(new Date(iso)) : null);

export function prFields(repo: { id: number; full_name: string }, pr: any) {
  return {
    repoId: Number(repo.id),
    repoFullName: String(repo.full_name),
    number: Number(pr.number),
    title: String(pr.title ?? '').slice(0, 300),
    author: String(pr.user?.login ?? ''),
    authorIsBot: pr.user?.type === 'Bot' || String(pr.user?.login ?? '').endsWith('[bot]'),
    draft: !!pr.draft,
    baseRef: String(pr.base?.ref ?? ''),
    state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    createdAt: ts(pr.created_at),
    closedAt: ts(pr.closed_at),
    mergedAt: ts(pr.merged_at),
    mergeCommitSha: pr.merged_at ? String(pr.merge_commit_sha ?? '') : null,
    additions: typeof pr.additions === 'number' ? pr.additions : null,
    deletions: typeof pr.deletions === 'number' ? pr.deletions : null,
    changedFiles: typeof pr.changed_files === 'number' ? pr.changed_files : null,
  };
}

/** Review manusia pertama (bukan bot, bukan penulis PR) — submitted_at tertua. */
export function firstHumanReview(reviews: any[], author: string): string | null {
  const human = reviews
    .filter((r) => r?.submitted_at && r.user && r.user.type !== 'Bot' && !String(r.user.login).endsWith('[bot]'))
    .filter((r) => String(r.user.login) !== author && r.state !== 'PENDING')
    .map((r) => String(r.submitted_at))
    .sort();
  return human[0] ?? null;
}

async function reviewsOf(gh: GH, fullName: string, number: number): Promise<any[]> {
  const [owner, repo] = fullName.split('/');
  const r = await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });
  return (r.data as any[]) ?? [];
}

/** Simpan/perbarui catatan PR dari payload webhook `pull_request`; saat ditutup, ambil review manusia pertama. */
export async function recordPr(p: any, gh?: GH): Promise<void> {
  const repo = p.repository;
  const pr = p.pull_request;
  if (!repo || !pr) return;
  const data: Record<string, unknown> = { ...prFields(repo, pr), updatedAt: FieldValue.serverTimestamp() };
  if (p.action === 'closed') {
    try {
      const client = gh ?? (await installationOctokit(Number(p.installation?.id)));
      const first = firstHumanReview(
        await reviewsOf(client, repo.full_name, Number(pr.number)),
        String(pr.user?.login ?? ''),
      );
      data.firstHumanReviewAt = ts(first);
    } catch {
      // review tidak bisa diambil → biarkan kosong, jangan gagalkan webhook
    }
  }
  await db()
    .doc(`prs/${prDocId(Number(repo.id), Number(pr.number))}`)
    .set(data, { merge: true });
}

/** Nomor PR / SHA yang di-revert oleh pesan commit (`Revert "judul (#123)"`, `This reverts commit <sha>`). */
export function revertTargets(message: string): { numbers: number[]; shas: string[] } {
  if (!/^revert\b/i.test(message.trim())) return { numbers: [], shas: [] };
  const numbers = [...message.matchAll(/\(#(\d+)\)/g)].map((m) => Number(m[1]));
  const shas = [...message.matchAll(/reverts commit ([0-9a-f]{7,40})/gi)].map((m) => m[1]);
  return { numbers: [...new Set(numbers)], shas: [...new Set(shas)] };
}

/** Tandai PR yang di-revert oleh commit di branch utama. Mengembalikan jumlah PR yang ditandai. */
export async function markReverts(
  repoId: number,
  commits: { id?: string; sha?: string; message: string; timestamp?: string; date?: string }[],
): Promise<number> {
  let n = 0;
  for (const c of commits) {
    const { numbers, shas } = revertTargets(String(c.message ?? ''));
    if (!numbers.length && !shas.length) continue;
    const at = ts(c.timestamp ?? c.date) ?? Timestamp.now();
    const sha = String(c.id ?? c.sha ?? '');
    const refs = new Set<string>(numbers.map((num) => prDocId(repoId, num)));
    // GitHub menulis SHA lengkap di "This reverts commit <sha>" → cocok persis (tanpa index komposit)
    for (const s of shas.filter((x) => x.length === 40)) {
      const q = await db()
        .collection('prs')
        .where('repoId', '==', repoId)
        .where('mergeCommitSha', '==', s)
        .limit(1)
        .get();
      for (const d of q.docs) refs.add(d.id);
    }
    for (const id of refs) {
      const ref = db().doc(`prs/${id}`);
      const snap = await ref.get();
      if (!snap.exists || snap.get('revertedAt')) continue;
      await ref.update({ revertedAt: at, revertSha: sha, updatedAt: FieldValue.serverTimestamp() });
      n++;
    }
  }
  return n;
}

/**
 * Ambil riwayat PR (baseline sebelum pilot) dari GitHub: PR tertutup N hari terakhir + review manusia pertama
 * PR yang di-merge + revert di branch utama. Hanya admin.
 */
export const backfillPrs = onCall(
  { secrets: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY], timeoutSeconds: 300 },
  async (req) => {
    const me = await requireMember(req, true);
    const repoId = Number((req.data as { repoId?: unknown })?.repoId);
    const days = Math.min(120, Math.max(7, Number((req.data as { days?: unknown })?.days ?? 60)));
    const snap = await db().doc(`repos/${repoId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Repo tidak ditemukan.');
    const fullName = String(snap.get('fullName'));
    const [owner, repo] = fullName.split('/');
    const gh = await installationOctokit(Number(snap.get('installationId')));
    const since = Date.now() - days * 86400_000;
    const repoMeta = { id: repoId, full_name: fullName };
    let prs = 0;
    let reviews = 0;
    for (let page = 1; page <= 5; page++) {
      const r = await gh.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        page,
      });
      const list = (r.data as any[]) ?? [];
      const recent = list.filter((p) => Date.parse(p.closed_at ?? p.updated_at ?? 0) >= since);
      for (const p of recent) {
        const data: Record<string, unknown> = {
          ...prFields(repoMeta, p),
          updatedAt: FieldValue.serverTimestamp(),
          backfilled: true,
        };
        if (p.merged_at) {
          try {
            data.firstHumanReviewAt = ts(
              firstHumanReview(await reviewsOf(gh, fullName, Number(p.number)), String(p.user?.login ?? '')),
            );
            reviews++;
          } catch {
            // lewati review yang tidak bisa diambil
          }
        }
        await db()
          .doc(`prs/${prDocId(repoId, Number(p.number))}`)
          .set(data, { merge: true });
        prs++;
      }
      if (list.length < 100 || recent.length < list.length) break;
    }
    // revert di branch utama sejak periode itu
    const branch = String(snap.get('defaultBranch') ?? 'main');
    const commits: { sha: string; message: string; date: string }[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await gh.request('GET /repos/{owner}/{repo}/commits', {
        owner,
        repo,
        sha: branch,
        since: new Date(since).toISOString(),
        per_page: 100,
        page,
      });
      const list = (r.data as any[]) ?? [];
      for (const c of list)
        commits.push({
          sha: c.sha,
          message: String(c.commit?.message ?? ''),
          date: String(c.commit?.committer?.date ?? ''),
        });
      if (list.length < 100) break;
    }
    const reverts = await markReverts(repoId, commits);
    await audit('repo.backfillPrs', me.uid, String(repoId), { days, prs, reverts });
    return { prs, reviews, reverts, days };
  },
);
