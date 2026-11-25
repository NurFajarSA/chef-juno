import type { DocumentData } from 'firebase/firestore';
import { toMs } from './format';

/** Satu pemanggilan agent dalam sebuah job (putaran review mendalam, triase, uji aplikasi, ringkasan modul, …). */
export interface PassRow {
  role: string;
  label: string;
  model: string | null;
  agent: string | null;
  ok: boolean;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface JobRow {
  id: string;
  type: string;
  status: string;
  repo: string;
  repoId: number | null;
  prNumber: number | null;
  prTitle: string;
  prUrl: string | null;
  author: string;
  trigger: string;
  score: number | null;
  /** review sebagian (agent incomplete / diff terpotong) */
  incomplete: boolean;
  findings: number;
  machineId: string | null;
  agent: string | null;
  model: string | null;
  promptVersions: string;
  durationMs: number | null;
  createdAtMs: number | null;
  error: string | null;
  /** status PR di GitHub: open | closed | merged (diisi saat PR ditutup) */
  prState: 'open' | 'closed' | 'merged';
  /** severity terparah di hasil review (null = tidak ada temuan) */
  maxSeverity: 'P0' | 'P1' | 'P2' | null;
  mode: 'standard' | 'deep' | null;
  /** semua pemanggilan agent di job ini (job lama tanpa rincian → satu putaran dari meta) */
  passes: PassRow[];
  inputTokens: number | null;
  outputTokens: number | null;
  /** antre: dibuat → diambil mesin */
  queueMs: number | null;
  /** total: dibuat (komentar pemicu) → diposting / selesai */
  totalMs: number | null;
  /** skill yang dimuat ke prompt / dilewati (paths tidak cocok) / terpotong batas ukuran */
  skillsLoaded: string[];
  skillsSkipped: string[];
  skillsDropped: string[];
}

const ROLE_OF_TYPE: Record<string, string> = { review: 'review', index: 'index', learn: 'learn', recap: 'recap' };
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function passesOf(d: DocumentData): PassRow[] {
  const meta = d['result']?.meta ?? {};
  const agent = meta.agent ?? null;
  // `passes` tercatat (boleh kosong = job tanpa panggilan model, mis. index tanpa modul baru)
  if (Array.isArray(meta.passes))
    return meta.passes.map((p: Record<string, unknown>) => ({
      role: String(p['role'] ?? 'review'),
      label: String(p['label'] ?? p['role'] ?? ''),
      model: (p['model'] as string | null) ?? null,
      agent,
      ok: p['ok'] !== false,
      durationMs: num(p['durationMs']),
      inputTokens: num(p['inputTokens']),
      outputTokens: num(p['outputTokens']),
    }));
  if (!d['result']?.meta) return [];
  return [
    {
      role: ROLE_OF_TYPE[d['type']] ?? String(d['type']),
      label: String(d['type']),
      model: meta.model ?? null,
      agent,
      ok: true,
      durationMs: num(meta.durationMs),
      inputTokens: num(meta.inputTokens),
      outputTokens: num(meta.outputTokens),
    },
  ];
}

export function jobRow(id: string, d: DocumentData): JobRow {
  const r = d['result'] ?? {};
  const pv = d['promptVersions'];
  return {
    id,
    type: d['type'],
    status: d['status'],
    repo: d['repo']?.fullName ?? '',
    repoId: d['repo']?.id ?? null,
    prNumber: d['pr']?.number ?? null,
    prTitle: d['pr']?.title ?? (d['type'] === 'index' ? 'Index code map' : d['type']),
    prUrl: d['pr']?.htmlUrl ?? null,
    author: d['pr']?.authorLogin ?? '',
    trigger: d['trigger']?.userLogin ?? '',
    score: typeof r.effectiveScore === 'number' ? r.effectiveScore : typeof r.score === 'number' ? r.score : null,
    incomplete: r.reviewCompletion === 'incomplete',
    findings: Array.isArray(r.findings) ? r.findings.length : 0,
    machineId: d['machineId'] ?? null,
    agent: r.meta?.agent ?? null,
    model: r.meta?.model ?? null,
    promptVersions: pv ? `p${pv.persona}/r${pv.review}` : '—',
    durationMs: r.meta?.durationMs ?? null,
    createdAtMs: toMs(d['createdAt']),
    error: d['error'] ? `${d['error'].stage}: ${d['error'].message}` : null,
    prState: d['pr']?.state ?? 'open',
    maxSeverity: Array.isArray(r.findings) && r.findings.length
      ? ([...r.findings].map((f: { severity: 'P0' | 'P1' | 'P2' }) => f.severity).sort()[0] ?? null)
      : null,
    mode: r.meta?.mode === 'deep' ? 'deep' : r.meta ? 'standard' : null,
    passes: passesOf(d),
    skillsLoaded: Array.isArray(r.meta?.skillsLoaded) ? r.meta.skillsLoaded : [],
    skillsSkipped: Array.isArray(r.meta?.skillsSkipped) ? r.meta.skillsSkipped : [],
    skillsDropped: Array.isArray(r.meta?.skillsDropped) ? r.meta.skillsDropped : [],
    inputTokens: num(r.meta?.inputTokens),
    outputTokens: num(r.meta?.outputTokens),
    queueMs: toMs(d['claimedAt']) != null && toMs(d['createdAt']) != null ? toMs(d['claimedAt'])! - toMs(d['createdAt'])! : null,
    totalMs: (() => {
      const end = toMs(d['github']?.postedAt) ?? toMs(d['finishedAt']);
      const start = toMs(d['createdAt']);
      return end != null && start != null ? end - start : null;
    })(),
  };
}

export interface FindingRow {
  id: string;
  jobId: string;
  severity: string;
  category: string;
  title: string;
  body: string;
  repo: string;
  prNumber: number;
  author: string;
  path: string;
  line: number;
  outcome: string;
  postedInline: boolean;
  url: string | null;
  createdAtMs: number | null;
  aiReply: string | null;
  /** hasil uji aplikasi */
  evidence: { status: 'reproduced' | 'not_reproduced' | 'inconclusive'; note: string; goal: string; shots: string[] } | null;
  /** 0–1; null untuk temuan lama sebelum kontrak v4 */
  confidence: number | null;
  trigger: string;
  /** slug skill tim yang menjadi dasar temuan ('' = tidak dari skill / temuan lama) */
  skill: string;
  /** ditahan (tidak diposting): 'confidence' | 'priority' */
  held: string | null;
}

export function findingRow(id: string, d: DocumentData): FindingRow {
  const ai = d['signals']?.aiCoderReply;
  return {
    id,
    jobId: d['jobId'],
    severity: d['severity'],
    category: d['category'],
    title: d['title'],
    body: d['body'] ?? '',
    repo: d['repoFullName'],
    prNumber: d['prNumber'],
    author: d['prAuthorLogin'],
    path: d['path'],
    line: d['line'],
    outcome: d['outcome'] ?? 'pending',
    postedInline: !!d['postedInline'],
    url: d['githubCommentUrl'] ?? null,
    createdAtMs: toMs(d['createdAt']),
    confidence: typeof d['confidence'] === 'number' ? d['confidence'] : null,
    trigger: String(d['trigger'] ?? ''),
    skill: String(d['skill'] ?? ''),
    held: d['held'] ?? null,
    evidence: d['evidence']?.status ? d['evidence'] : null,
    aiReply: ai?.verdict ? `${ai.verdict === 'fixed' ? 'diperbaiki' : 'tidak diperbaiki'}${ai.reason ? ' — ' + ai.reason : ''}` : null,
  };
}
