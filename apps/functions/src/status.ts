import type { GH } from './github.js';
import { DASHBOARD_URL } from './params.js';

/** Nama commit status di PR — dipakai sebagai required check di branch protection. */
export const STATUS_CONTEXT = 'Chef Juno';

export type GateVerdict = 'PASS' | 'PASS+NOTES' | 'FAIL';
export type StatusState = 'pending' | 'success' | 'failure' | 'error';

/**
 * Verdict gate dari temuan yang benar-benar diposting (sesudah ambang & suppression):
 * ada P0/P1 atau review sebagian → FAIL; hanya P2 → PASS+NOTES; tidak ada → PASS.
 */
export function gateVerdict(
  posted: { severity: string }[],
  o: { incomplete: boolean; score: number },
): { verdict: GateVerdict; state: StatusState; description: string } {
  const n = (s: string) => posted.filter((f) => f.severity === s).length;
  const counts = (['P0', 'P1', 'P2'] as const)
    .map((s) => [s, n(s)] as const)
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${c} ${s}`)
    .join(', ');
  const tail = [counts, `skor ${o.score}/5`].filter(Boolean).join(' · ');
  if (o.incomplete) return { verdict: 'FAIL', state: 'failure', description: `FAIL · review sebagian · ${tail}` };
  if (n('P0') + n('P1') > 0) return { verdict: 'FAIL', state: 'failure', description: `FAIL · ${tail}` };
  if (n('P2') > 0) return { verdict: 'PASS+NOTES', state: 'success', description: `PASS+NOTES · ${tail}` };
  return { verdict: 'PASS', state: 'success', description: `PASS · ${tail}` };
}

export function reviewUrl(jobId: string): string | null {
  const base = DASHBOARD_URL.value().replace(/\/+$/, '');
  return base ? `${base}/reviews/${jobId}` : null;
}

/**
 * Pasang commit status di head PR. Tidak pernah menggagalkan posting: GitHub App tanpa izin "Commit statuses"
 * (403) atau error lain dikembalikan sebagai pesan untuk dicatat di job.
 */
export async function setCommitStatus(
  octo: GH,
  o: { fullName: string; sha: string; state: StatusState; description: string; jobId?: string },
): Promise<string | null> {
  const [owner, repo] = o.fullName.split('/');
  if (!owner || !repo || !/^[0-9a-f]{40}$/.test(o.sha)) return 'repo/sha tidak sah';
  try {
    await octo.request('POST /repos/{owner}/{repo}/statuses/{sha}', {
      owner,
      repo,
      sha: o.sha,
      state: o.state,
      context: STATUS_CONTEXT,
      description: o.description.slice(0, 140),
      ...(o.jobId && reviewUrl(o.jobId) ? { target_url: reviewUrl(o.jobId)! } : {}),
    });
    return null;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return status === 403
      ? 'GitHub App belum punya izin "Commit statuses: Read and write"'
      : `commit status gagal: ${String((e as Error).message).slice(0, 200)}`;
  }
}

/**
 * Gate akhir setelah uji aplikasi (satu standar: tidak teruji = tidak lulus).
 * - uji tidak jalan / alur yang diubah belum berhasil dicoba → error "belum teruji"
 * - alur yang diubah rusak, atau verdict kode FAIL → failure
 * - selain itu → success, verdict kode + "teruji di aplikasi"
 */
export function appGate(
  code: { verdict: GateVerdict; description: string },
  app: {
    ran: boolean;
    reason?: string;
    notApplicable?: boolean;
    change?: { status: string; shots?: string[] } | null;
  },
): { verdict: GateVerdict | 'UNTESTED'; state: StatusState; description: string } {
  // repo tanpa uji aplikasi (tidak dikonfigurasi) → gate = hasil review kode
  if (!app.ran && app.notApplicable)
    return {
      verdict: code.verdict,
      state: code.verdict === 'FAIL' ? 'failure' : 'success',
      description: `${code.description} · tanpa uji aplikasi`,
    };
  if (!app.ran)
    return { verdict: 'UNTESTED', state: 'error', description: `Belum teruji di aplikasi: ${app.reason ?? '-'}` };
  const ch = app.change?.status;
  if (ch === 'reproduced')
    return { verdict: 'FAIL', state: 'failure', description: 'FAIL · alur yang diubah rusak saat dicoba di aplikasi' };
  if (code.verdict === 'FAIL')
    return { verdict: 'FAIL', state: 'failure', description: `${code.description} · diuji di aplikasi` };
  if (ch !== 'not_reproduced')
    return { verdict: 'UNTESTED', state: 'error', description: 'Belum teruji: alur yang diubah belum berhasil dicoba' };
  // bukti, bukan pendapat: "berjalan normal" tanpa screenshot tidak dianggap teruji
  if (!app.change?.shots?.length)
    return {
      verdict: 'UNTESTED',
      state: 'error',
      description: 'Belum teruji: tidak ada screenshot bukti alur yang diubah',
    };
  return { verdict: code.verdict, state: 'success', description: `${code.description} · teruji di aplikasi` };
}
