import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { machineStatus } from '@chefjuno/shared';
import { admin, callFn, clearFirestore, FN_BASE, idTokenFor } from '../../../functions/test/helpers.js';
import { exchangeCode, mintToken } from '../../src/api.js';
import { Daemon } from '../../src/daemon.js';
import { ClaudeRunner } from '../../src/agents/claude.js';
import { CodexRunner } from '../../src/agents/codex.js';
import type { Credentials } from '../../src/creds.js';

const FAKE_CLAUDE = fileURLToPath(new URL('../fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('../fake-codex.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const { db } = admin();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const daemons: Daemon[] = [];

async function memberIdToken() {
  await db.doc('members/2002').set({ githubLogin: 'dev2', role: 'member', level: 'mid' });
  return idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
}

async function newCode(name = 'Laptop Dev'): Promise<string> {
  const r = await callFn<{ code: string }>('createMachineRegistration', { name }, await memberIdToken());
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.result!.code;
}

async function register(): Promise<Credentials> {
  const code = await newCode();
  const r = await exchangeCode(FN_BASE, code);
  return { server: FN_BASE, machineId: r.machineId, machineSecret: r.machineSecret, firebaseConfig: r.firebaseConfig };
}

const runners = (claudeAuth = 'claude.ai', codexAuth = 'chatgpt') => [
  new ClaudeRunner({ bin: FAKE_CLAUDE, env: { FAKE_CLAUDE_AUTH: claudeAuth } }),
  new CodexRunner({ bin: FAKE_CODEX, env: { FAKE_CODEX_AUTH: codexAuth } }),
];

beforeEach(clearFirestore);
afterAll(async () => {
  for (const d of daemons) await d.stop();
});

describe('registrasi mesin', () => {
  it('kode berformat XXXX-XXXX, hanya hash yang disimpan', async () => {
    const code = await newCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const reg = await db.doc(`machineRegistrations/${sha(code)}`).get();
    expect(reg.exists).toBe(true);
    expect(JSON.stringify(reg.data())).not.toContain(code);
  });

  it('non-anggota tidak bisa membuat kode', async () => {
    const t = await idTokenFor('uid-luar');
    const r = await callFn('createMachineRegistration', { name: 'x' }, t);
    expect(r.ok).toBe(false);
  });

  it('tukar kode → mesin dibuat, secret hanya di machineSecrets (hash)', async () => {
    const c = await register();
    const m = await db.doc(`machines/${c.machineId}`).get();
    expect(m.get('name')).toBe('Laptop Dev');
    expect(m.get('revoked')).toBe(false);
    expect(JSON.stringify(m.data())).not.toContain(c.machineSecret);
    const s = await db.doc(`machineSecrets/${c.machineId}`).get();
    expect(s.get('secretHash')).toBe(sha(c.machineSecret));
  });

  it('kode yang sudah dipakai ditolak', async () => {
    const code = await newCode();
    await exchangeCode(FN_BASE, code);
    await expect(exchangeCode(FN_BASE, code)).rejects.toThrow(/sudah dipakai/);
  });

  it('kode kedaluwarsa ditolak', async () => {
    const code = 'ABCD-EFGH';
    await db
      .doc(`machineRegistrations/${sha(code)}`)
      .set({ createdBy: 'uid-dev2', name: 'lama', expiresAt: Timestamp.fromMillis(Date.now() - 1000), usedAt: null });
    await expect(exchangeCode(FN_BASE, code)).rejects.toThrow(/kedaluwarsa/);
  });

  it('kode tidak dikenal / format salah ditolak', async () => {
    await expect(exchangeCode(FN_BASE, 'ZZZZ-ZZZZ')).rejects.toThrow(/tidak dikenal/);
    await expect(exchangeCode(FN_BASE, 'abc')).rejects.toThrow(/Format/);
  });

  it('mint token: secret salah 401; setelah revoke ditolak', async () => {
    const c = await register();
    await expect(mintToken({ ...c, machineSecret: 'salah' })).rejects.toThrow(/salah/);
    expect(await mintToken(c)).toBeTruthy();
    await db.doc('members/1001').set({ githubLogin: 'admin1', role: 'admin', level: 'senior' });
    const adminTok = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const r = await callFn('revokeMachine', { machineId: c.machineId }, adminTok);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    await expect(mintToken(c)).rejects.toThrow(/dicabut/);
  });

  it('member biasa tidak bisa revoke', async () => {
    const c = await register();
    const r = await callFn('revokeMachine', { machineId: c.machineId }, await memberIdToken());
    expect(r.ok).toBe(false);
  });
});

describe('daemon', () => {
  it('login → start → online; dihentikan → offline setelah 90 detik (clock di-mock)', async () => {
    const c = await register();
    const d = new Daemon({ creds: c, runners: runners(), log: () => undefined });
    daemons.push(d);
    await d.start();
    const m = (await db.doc(`machines/${c.machineId}`).get()).data()!;
    const seen = (m.lastSeenAt as Timestamp).toMillis();
    const st = (now: number) =>
      machineStatus(
        { revoked: m.revoked, lastSeenAtMs: seen, currentJobIds: m.currentJobIds, concurrency: m.concurrency },
        now,
      );
    expect(st(seen + 1000)).toBe('online');
    expect(m.agents.claude.enabled).toBe(true);
    expect(m.agents.claude.version).toBe('2.1.323');
    expect(m.agents.codex.enabled).toBe(true);
    expect(m.daemonVersion).toBe('0.1.0');
    await d.stop();
    const after = (await db.doc(`machines/${c.machineId}`).get()).get('lastSeenAt') as Timestamp;
    expect(after.toMillis()).toBe(seen);
    expect(st(seen + 89_000)).toBe('online');
    expect(st(seen + 91_000)).toBe('offline');
  });

  it('agent yang login dengan API key ditandai tidak dipakai; minimal satu agent wajib', async () => {
    const c = await register();
    const d = new Daemon({ creds: c, runners: runners('api-key', 'chatgpt'), log: () => undefined });
    daemons.push(d);
    await d.start();
    const m = (await db.doc(`machines/${c.machineId}`).get()).data()!;
    expect(m.agents.claude.enabled).toBe(false);
    expect(m.agents.claude.subscription).toBe(false);
    expect(m.agents.claude.warning).toMatch(/bukan langganan/);
    expect(Object.keys(d.runners)).toEqual(['codex']);
    await d.stop();

    const c2 = await register();
    const d2 = new Daemon({ creds: c2, runners: runners('api-key', 'api-key'), log: () => undefined });
    await expect(d2.start()).rejects.toThrow(/Tidak ada agent langganan/);
  });

  it('CLI: login menyimpan kredensial 0600, status & logout', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cj-home-'));
    const code = await newCode('Mesin CLI');
    const env = { ...process.env, CHEFJUNO_HOME: home };
    const out = execFileSync('node', [CLI, 'login', '--server', FN_BASE, '--code', code], { env, encoding: 'utf8' });
    expect(out).toContain('Mesin terdaftar');
    const file = join(home, 'credentials.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).machineSecret).toBeTruthy();
    const st = execFileSync('node', [CLI, 'status'], { env, encoding: 'utf8' });
    expect(st).toContain('Mesin CLI');
    expect(st).toContain('Status: Offline');
    expect(execFileSync('node', [CLI, 'logout'], { env, encoding: 'utf8' })).toContain('dihapus');
  });
});

describe('kapasitas job sekaligus per mesin', () => {
  const queued = (id: string) =>
    db.doc(`jobs/${id}`).set({
      type: 'review',
      status: 'queued',
      attempts: 0,
      config: { preferredAgent: 'any' },
      repo: { id: 1, fullName: 'tim/a', installationId: 1 },
      createdAt: Timestamp.now(),
    });
  const status = async (id: string) => (await db.doc(`jobs/${id}`).get()).get('status') as string;
  const waitUntil = async (fn: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('waktu habis');
  };

  it('kapasitas 1 → satu job; admin menaikkan ke 2 → job kedua langsung diambil tanpa restart, keduanya paralel', async () => {
    const c = await register();
    const started: string[] = [];
    const releases: (() => void)[] = [];
    let concurrentPeak = 0;
    let active = 0;
    const d = new Daemon({
      creds: c,
      runners: runners(),
      log: () => undefined,
      // handler palsu: job "bekerja" sampai dilepas test, supaya paralelnya bisa diamati
      handler: async (ctx) => {
        started.push(ctx.id);
        active++;
        concurrentPeak = Math.max(concurrentPeak, active);
        await new Promise<void>((r) => releases.push(r));
        active--;
        await db.doc(`jobs/${ctx.id}`).update({ status: 'completed' });
      },
    });
    daemons.push(d);
    expect((await db.doc(`machines/${c.machineId}`).get()).get('concurrency')).toBe(1);
    await d.start();
    await queued('j1');
    await queued('j2');
    await waitUntil(async () => started.length === 1);
    await new Promise((r) => setTimeout(r, 800));
    expect(started).toHaveLength(1); // kapasitas 1: job lain tetap antre
    const waiting = started[0] === 'j1' ? 'j2' : 'j1';
    expect(await status(waiting)).toBe('queued');

    await db.doc(`machines/${c.machineId}`).update({ concurrency: 2 });
    await waitUntil(async () => started.length === 2);
    expect(concurrentPeak).toBe(2);
    expect(await status(waiting)).toBe('claimed');
    const m = (await db.doc(`machines/${c.machineId}`).get()).data()!;
    expect([...m.currentJobIds].sort()).toEqual(['j1', 'j2']);

    for (const r of releases) r();
    // setelah kedua job selesai, mesin melepas kapasitasnya (heartbeat tanpa job berjalan)
    await waitUntil(
      async () => ((await db.doc(`machines/${c.machineId}`).get()).get('currentJobIds') ?? []).length === 0,
    );
    await d.stop();
  });
});
