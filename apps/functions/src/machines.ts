import { onCall, onRequest, HttpsError } from 'firebase-functions/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'node:crypto';
import {
  MachineRegistrationInputSchema,
  REGISTRATION_CODE_RE,
  REGISTRATION_TTL_MS,
  normalizeRegistrationCode,
} from '@chefjuno/shared';
import { auth, db } from './admin.js';
import { audit, parseInput, randomCode, randomSecret, requireMember, sha256 } from './util.js';
import { WEB_API_KEY } from './params.js';

export async function createRegistration(uid: string, name: string, nowMs = Date.now()) {
  const code = randomCode();
  await db()
    .doc(`machineRegistrations/${sha256(code)}`)
    .set({
      createdBy: uid,
      name,
      expiresAt: Timestamp.fromMillis(nowMs + REGISTRATION_TTL_MS),
      usedAt: null,
      machineId: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  return { code, expiresAt: new Date(nowMs + REGISTRATION_TTL_MS).toISOString() };
}

export const createMachineRegistration = onCall(async (req) => {
  const me = await requireMember(req);
  const { name } = parseInput(MachineRegistrationInputSchema, req.data);
  return createRegistration(me.uid, name);
});

/**
 * Config Firebase web yang dikirim ke daemon. Di emulator memakai nilai demo; di produksi `WEB_API_KEY` WAJIB diisi
 * (param Functions, lihat docs/SETUP.md) — tanpa itu registrasi mesin ditolak dengan pesan jelas,
 * bukan diam-diam mengirim 'demo-key'.
 */
export function webConfig(): { apiKey: string; authDomain: string; projectId: string } | null {
  const projectId = process.env.GCLOUD_PROJECT ?? 'demo-chefjuno';
  const emulator = process.env.FUNCTIONS_EMULATOR === 'true' || projectId.startsWith('demo-');
  const apiKey = WEB_API_KEY.value() || (emulator ? 'demo-key' : '');
  if (!apiKey) return null;
  return { apiKey, authDomain: `${projectId}.firebaseapp.com`, projectId };
}

type ExchangeResult =
  { ok: true; machineId: string; machineSecret: string } | { ok: false; status: number; error: string };

export async function exchangeCode(
  rawCode: string,
  info: { platform?: string; daemonVersion?: string },
  nowMs = Date.now(),
): Promise<ExchangeResult> {
  const code = normalizeRegistrationCode(String(rawCode ?? ''));
  if (!REGISTRATION_CODE_RE.test(code)) return { ok: false, status: 400, error: 'Format kode salah (XXXX-XXXX).' };
  const regRef = db().doc(`machineRegistrations/${sha256(code)}`);
  const machineRef = db().collection('machines').doc();
  const secret = randomSecret();
  return db().runTransaction(async (tx): Promise<ExchangeResult> => {
    const reg = await tx.get(regRef);
    if (!reg.exists) return { ok: false, status: 404, error: 'Kode tidak dikenal.' };
    if (reg.get('usedAt')) return { ok: false, status: 409, error: 'Kode sudah dipakai.' };
    if ((reg.get('expiresAt') as Timestamp).toMillis() < nowMs)
      return { ok: false, status: 410, error: 'Kode kedaluwarsa. Buat kode baru di dashboard.' };
    const owner = await auth()
      .getUser(reg.get('createdBy'))
      .catch(() => null);
    const ownerLogin =
      owner?.providerData.find((p) => p.providerId === 'github.com')?.displayName ?? owner?.displayName ?? '';
    tx.set(machineRef, {
      name: reg.get('name'),
      ownerUid: reg.get('createdBy'),
      ownerLogin,
      lastSeenAt: null,
      platform: String(info.platform ?? '').slice(0, 60),
      daemonVersion: String(info.daemonVersion ?? '').slice(0, 30),
      agents: {},
      concurrency: 1,
      currentJobIds: [],
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db().doc(`machineSecrets/${machineRef.id}`), {
      secretHash: sha256(secret),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(regRef, { usedAt: FieldValue.serverTimestamp(), machineId: machineRef.id });
    return { ok: true, machineId: machineRef.id, machineSecret: secret };
  });
}

/** HTTPS: daemon menukar kode registrasi → machineSecret + config Firebase web. */
export const exchangeMachineCode = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Gunakan POST.' });
    return;
  }
  const config = webConfig();
  if (!config) {
    res.status(500).json({ error: 'Server belum dikonfigurasi: param WEB_API_KEY kosong. Hubungi admin.' });
    return;
  }
  const body = (req.body ?? {}) as { code?: string; platform?: string; daemonVersion?: string };
  const r = await exchangeCode(String(body.code ?? ''), body);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  await audit('machine.register', 'machine:' + r.machineId, r.machineId);
  res.json({ machineId: r.machineId, machineSecret: r.machineSecret, firebaseConfig: config });
});

export async function mintToken(
  machineId: string,
  secret: string,
): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(machineId) || !secret)
    return { ok: false, status: 400, error: 'Kredensial tidak lengkap.' };
  const [m, s] = await Promise.all([
    db().doc(`machines/${machineId}`).get(),
    db().doc(`machineSecrets/${machineId}`).get(),
  ]);
  if (!m.exists || !s.exists) return { ok: false, status: 401, error: 'Mesin tidak dikenal.' };
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(String(s.get('secretHash')));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Secret mesin salah.' };
  if (m.get('revoked')) return { ok: false, status: 403, error: 'Mesin sudah dicabut.' };
  const token = await auth().createCustomToken(`machine:${machineId}`, { machine: true, machineId });
  return { ok: true, token };
}

/** HTTPS: secret mesin → custom token (uid machine:{id}). Dipanggil daemon setiap start. */
export const mintMachineToken = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Gunakan POST.' });
    return;
  }
  const body = (req.body ?? {}) as { machineId?: string; secret?: string };
  const r = await mintToken(String(body.machineId ?? ''), String(body.secret ?? ''));
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  res.json({ token: r.token });
});

export const revokeMachine = onCall(async (req) => {
  const me = await requireMember(req, true);
  const id = String((req.data as { machineId?: unknown })?.machineId ?? '');
  const ref = db().doc(`machines/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Mesin tidak ditemukan.');
  await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedBy: me.uid });
  await auth()
    .revokeRefreshTokens(`machine:${id}`)
    .catch(() => undefined);
  await audit('machine.revoke', me.uid, id);
  return { ok: true };
});
