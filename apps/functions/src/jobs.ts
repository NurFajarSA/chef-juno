import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { DEFAULT_SETTINGS, machineStatus, type JobConfig } from '@chefjuno/shared';
import { db } from './admin.js';
import { offlineAfterMs } from './params.js';
import { activeSkillVersions } from './skills.js';

export async function jobConfig(): Promise<JobConfig> {
  const s = (await db().doc('settings/global').get()).data() ?? {};
  return {
    preferredAgent: s.preferredAgent ?? DEFAULT_SETTINGS.preferredAgent,
    models: s.models ?? {},
    agentMaxTurns: s.agentMaxTurns ?? DEFAULT_SETTINGS.agentMaxTurns,
    maxDiffBytes: s.maxDiffBytes ?? DEFAULT_SETTINGS.maxDiffBytes,
    reviewTimeoutMinutes: s.reviewTimeoutMinutes ?? DEFAULT_SETTINGS.reviewTimeoutMinutes,
    maxInlineComments: Math.min(30, s.maxInlineComments ?? DEFAULT_SETTINGS.maxInlineComments),
    minConfidence: typeof s.minConfidence === 'number' ? s.minConfidence : DEFAULT_SETTINGS.minConfidence,
    // semua temuan (P0–P2) selalu diposting (keputusan pemilik 25 Nov 2026); setting lama diabaikan
    maxPostPriority: 'P2',
    reviewMode: ['auto', 'standard', 'deep'].includes(s.reviewMode) ? s.reviewMode : DEFAULT_SETTINGS.reviewMode,
    // tingkat model per peran tidak lagi diatur (default: Sonnet kerja, Opus validasi & reviewer akhir)
    ...(s.tierModels && typeof s.tierModels === 'object' ? { tierModels: s.tierModels } : {}),
    ...(s.tierEffort && typeof s.tierEffort === 'object' ? { tierEffort: s.tierEffort } : {}),
    verifyEnabled: s.verifyEnabled === true,
    appVerifyEnabled: s.appVerifyEnabled === true,
  };
}

export async function activePromptVersions(): Promise<{ persona: number; review: number }> {
  const [p, r] = await Promise.all([db().doc('prompts/persona').get(), db().doc('prompts/review').get()]);
  return { persona: Number(p.get('activeVersion') ?? 1), review: Number(r.get('activeVersion') ?? 1) };
}

export async function anyMachineOnline(nowMs = Date.now()): Promise<boolean> {
  const snap = await db().collection('machines').where('revoked', '==', false).get();
  return snap.docs.some((d) => {
    const m = d.data();
    const st = machineStatus(
      {
        revoked: m.revoked,
        lastSeenAtMs: m.lastSeenAt?.toMillis?.() ?? null,
        currentJobIds: [],
        concurrency: m.concurrency,
      },
      nowMs,
      offlineAfterMs(),
    );
    return st === 'online' || st === 'busy';
  });
}

export interface RepoRef {
  id: number;
  fullName: string;
  installationId: number;
}

/** Buat job baru (status queued) dengan versi prompt & config yang dipin (§12.4). */
export async function createJob(
  data: Record<string, unknown> & { type: string; repo: RepoRef },
): Promise<DocumentReference> {
  const ref = db().collection('jobs').doc();
  await ref.set({
    status: 'queued',
    attempts: 0,
    machineId: null,
    promptVersions: await activePromptVersions(),
    skillVersions: await activeSkillVersions(),
    config: await jobConfig(),
    github: {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...data,
  });
  return ref;
}

export const ACTIVE_STATUSES = ['queued', 'claimed', 'running'];

export async function findActiveReview(repoId: number, prNumber: number, headSha: string) {
  const snap = await db()
    .collection('jobs')
    .where('repo.id', '==', repoId)
    .where('pr.number', '==', prNumber)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();
  return snap.docs.find((d) => d.get('type') === 'review' && d.get('pr.headSha') === headSha) ?? null;
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);
