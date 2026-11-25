import { containsSecret } from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { AgentError } from '../agents/types.js';

/** §12.9 — gagalkan job SEBELUM menulis result kalau output memuat rahasia mesin, token instalasi, atau refresh token. */
export function assertNoLeak(ctx: JobContext, data: unknown, extra: string[] = []) {
  const refresh = (ctx.session.auth.currentUser as unknown as { refreshToken?: string } | null)?.refreshToken ?? '';
  if (containsSecret(JSON.stringify(data), [ctx.creds.machineSecret, refresh, ...extra])) {
    throw new AgentError('Output agent memuat rahasia; job digagalkan', 'leak');
  }
}
