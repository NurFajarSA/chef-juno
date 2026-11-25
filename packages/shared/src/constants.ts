export const DB_ID = 'chefjuno';
export const REGION = 'asia-southeast2';
export const DEMO_PROJECT_ID = 'demo-chefjuno';
export const BOT_HANDLE = 'chefjuno';

export const SEVERITIES = ['P0', 'P1', 'P2'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CATEGORIES = ['bug', 'security', 'performance', 'maintainability', 'test'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITY_EMOJI: Record<Severity, string> = { P0: '🔴', P1: '🟠', P2: '🟡' };
export const SEVERITY_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };

export const SUMMARY_MARKER = '<!-- chefjuno-ai:summary -->';
export const findingMarker = (findingId: string) => `<!-- chefjuno-ai:finding:${findingId} -->`;
export const FINDING_MARKER_RE = /<!-- chefjuno-ai:finding:([A-Za-z0-9_-]+) -->/;

/** Machine considered offline when lastSeenAt older than this (ms). Overridable in tests/demo. */
export const OFFLINE_AFTER_MS = 90_000;
export const LEASE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
export const REGISTRATION_TTL_MS = 10 * 60_000;
/** Huruf besar tanpa karakter ambigu (tanpa 0/O/1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const JOB_TYPES = ['review', 'index', 'learn', 'recap', 'ask', 'app-verify'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATUSES = ['queued', 'claimed', 'running', 'completed', 'posted', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DEFAULT_SETTINGS = {
  botHandle: BOT_HANDLE,
  maxInlineComments: 10,
  preferredAgent: 'any' as 'any' | 'claude' | 'codex',
  models: {} as { claude?: string; codex?: string },
  agentMaxTurns: 40,
  reviewTimeoutMinutes: 15,
  maxDiffBytes: 1_000_000,
  minConfidence: 0.7,
  maxPostPriority: 'P2' as 'P0' | 'P1' | 'P2',
  reviewMode: 'auto' as 'auto' | 'standard' | 'deep',
  verifyEnabled: false,
  appVerifyEnabled: false,
};
