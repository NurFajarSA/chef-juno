import { OFFLINE_AFTER_MS } from './constants.js';

export type MachineStatus = 'online' | 'offline' | 'busy' | 'revoked';

export interface MachineLike {
  revoked?: boolean;
  /** epoch ms */
  lastSeenAtMs?: number | null;
  currentJobIds?: string[];
  concurrency?: number;
}

/** §12.7 — status mesin dihitung, tidak disimpan. */
export function machineStatus(m: MachineLike, nowMs: number, offlineAfterMs = OFFLINE_AFTER_MS): MachineStatus {
  if (m.revoked) return 'revoked';
  if (m.lastSeenAtMs == null || nowMs - m.lastSeenAtMs > offlineAfterMs) return 'offline';
  if ((m.currentJobIds?.length ?? 0) >= (m.concurrency ?? 1)) return 'busy';
  return 'online';
}

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  busy: 'Sibuk',
  revoked: 'Dicabut',
};

/** Normalisasi kode registrasi: huruf besar, tanpa spasi, format XXXX-XXXX. */
export function normalizeRegistrationCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export const REGISTRATION_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
