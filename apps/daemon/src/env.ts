import { homedir } from 'node:os';
import { join } from 'node:path';

/** Semua interval bisa dioverride lewat env supaya test/demo memakai detik (§12.2). */
export const cfg = {
  home: () => process.env.CHEFJUNO_HOME || join(homedir(), '.chefjuno'),
  heartbeatMs: () => Number(process.env.CHEFJUNO_HEARTBEAT_MS || 30_000),
  leaseMs: () => Number(process.env.CHEFJUNO_LEASE_MS || 10 * 60_000),
  leaseRenewMs: () => Number(process.env.CHEFJUNO_LEASE_RENEW_MS || 60_000),
  gitUrlTemplate: () => process.env.CHEFJUNO_GIT_URL_TEMPLATE || 'https://github.com/{fullName}.git',
  claudeBin: () => process.env.CHEFJUNO_CLAUDE_BIN || 'claude',
  codexBin: () => process.env.CHEFJUNO_CODEX_BIN || 'codex',
};

export const DAEMON_VERSION = '0.1.0';
