import {
  doc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  query,
  collection,
  where,
  runTransaction,
  Timestamp,
  getDoc,
  type DocumentData,
} from 'firebase/firestore';
import { cleanupOrphanAppRuns } from './jobs/app-verify.js';
import { withActivity } from './jobs/activity.js';
import { platform, arch } from 'node:os';
import type { AgentInfo, JobConfig } from '@chefjuno/shared';
import { connect, type FbSession } from './fb.js';
import type { Credentials } from './creds.js';
import { cfg, DAEMON_VERSION } from './env.js';
import type { AgentName, AgentRunner } from './agents/types.js';
import { ClaudeRunner } from './agents/claude.js';
import { CodexRunner } from './agents/codex.js';

export interface JobDoc extends DocumentData {
  type: string;
  status: string;
  attempts?: number;
  config?: JobConfig;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

/** Kapasitas job sekaligus per mesin: 1–4 (default 1). */
export const MAX_CONCURRENCY = 4;
export function clampConcurrency(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_CONCURRENCY, Math.max(1, n)) : 1;
}

export interface JobContext {
  id: string;
  job: JobDoc;
  agent: AgentRunner;
  session: FbSession;
  creds: Credentials;
  daemon: Daemon;
  /** aborted saat job dibatalkan (status `cancelled` di Firestore) */
  signal?: AbortSignal;
}

export interface DaemonOptions {
  creds: Credentials;
  /** Agent yang boleh dipakai (`--agents claude,codex`) */
  allowAgents?: AgentName[];
  /** `--no-app`: mesin tanpa emulator/profil uji — tidak mengambil job uji aplikasi (diambil mesin lain) */
  noApp?: boolean;
  runners?: AgentRunner[];
  handler?: JobHandler;
  log?: (msg: string) => void;
}

export class Daemon {
  session!: FbSession;
  agents: Partial<Record<AgentName, AgentInfo>> = {};
  runners: Partial<Record<AgentName, AgentRunner>> = {};
  private lastUsed: Record<AgentName, number> = { claude: 0, codex: 0 };
  private timer: NodeJS.Timeout | null = null;
  private unsub: (() => void) | null = null;
  private running = new Set<string>();
  private unsubMachine: (() => void) | null = null;
  private concurrency = 1;
  private stopped = false;
  /** Jeda sementara pengambilan job (dipakai demo untuk menahan job tetap antre). */
  paused = false;
  private lastQueued: { id: string; job: JobDoc }[] = [];
  readonly log: (msg: string) => void;

  constructor(private readonly opts: DaemonOptions) {
    this.log = opts.log ?? ((m) => console.log(m));
  }

  get machineId() {
    return this.opts.creds.machineId;
  }

  /** Deteksi agent (minimal satu wajib lolos), login, heartbeat, dengarkan job. */
  async start() {
    const runners = this.opts.runners ?? [new ClaudeRunner(), new CodexRunner()];
    for (const r of runners) {
      if (this.opts.allowAgents && !this.opts.allowAgents.includes(r.name)) continue;
      const info = await r.detect();
      if (!info) {
        this.log(`· ${r.name}: tidak ditemukan`);
        continue;
      }
      this.agents[r.name] = info;
      if (info.enabled) {
        this.runners[r.name] = r;
        this.log(`✓ ${r.name} ${info.version} (langganan, isolasi ${info.isolation})`);
      } else this.log(`⚠ ${r.name}: ${info.warning}`);
    }
    if (!Object.keys(this.runners).length)
      throw new Error('Tidak ada agent langganan yang siap (Claude Code claude.ai atau Codex ChatGPT).');
    this.session = await connect(this.opts.creds);
    const m = await getDoc(doc(this.session.db, `machines/${this.machineId}`));
    this.concurrency = clampConcurrency(m.get('concurrency'));
    // kapasitas bisa diubah admin dari dashboard kapan saja → berlaku tanpa restart
    this.unsubMachine = onSnapshot(
      doc(this.session.db, `machines/${this.machineId}`),
      (s) => {
        const next = clampConcurrency(s.get('concurrency'));
        if (next === this.concurrency) return;
        const more = next > this.concurrency;
        this.concurrency = next;
        this.log(`kapasitas mesin: ${next} job sekaligus`);
        if (more) this.rescan();
      },
      (err) => this.log(`listener mesin error: ${err.message}`),
    );
    await this.heartbeat();
    this.timer = setInterval(
      () => void this.heartbeat().catch((e) => this.log(`heartbeat gagal: ${e.message}`)),
      cfg.heartbeatMs(),
    );
    // app sisa job uji yang terputus (restart/crash) dimatikan sebelum menerima job baru
    await cleanupOrphanAppRuns((m) => this.log(m)).catch((e: Error) =>
      this.log(`pembersihan sisa uji gagal: ${e.message}`),
    );
    this.listen();
    this.log(`Mesin ${this.machineId} online${this.opts.noApp ? ' (tanpa uji aplikasi)' : ''}. Menunggu job…`);
  }

  async heartbeat() {
    await updateDoc(doc(this.session.db, `machines/${this.machineId}`), {
      lastSeenAt: serverTimestamp(),
      agents: this.agents,
      currentJobIds: [...this.running],
      daemonVersion: DAEMON_VERSION,
      platform: `${platform()}-${arch()}`,
    });
  }

  private listen() {
    const q = query(collection(this.session.db, 'jobs'), where('status', '==', 'queued'));
    this.unsub = onSnapshot(
      q,
      (snap) => {
        this.lastQueued = snap.docs.map((d) => ({ id: d.id, job: d.data() as JobDoc }));
        for (const d of this.lastQueued) void this.tryClaim(d.id, d.job);
      },
      (err) => this.log(`listener error: ${err.message}`),
    );
  }

  /** Pilih agent untuk job: hormati config.preferredAgent; 'any' → yang paling lama tidak dipakai. */
  pickAgent(job: JobDoc): AgentRunner | null {
    const pref = job.config?.preferredAgent ?? 'any';
    if (pref !== 'any') return this.runners[pref] ?? null;
    const avail = (Object.keys(this.runners) as AgentName[]).sort((a, b) => this.lastUsed[a] - this.lastUsed[b]);
    return avail.length ? this.runners[avail[0]]! : null;
  }

  async tryClaim(id: string, job: JobDoc) {
    if (this.stopped || this.paused || this.running.has(id) || this.running.size >= this.concurrency) return;
    if (this.opts.noApp && job.type === 'app-verify') return; // uji aplikasi untuk mesin yang punya emulator
    const agent = this.pickAgent(job);
    if (!agent) return; // mesin hanya meng-claim job yang bisa ia kerjakan
    const ref = doc(this.session.db, `jobs/${id}`);
    this.running.add(id);
    let claimed: JobDoc | null;
    try {
      claimed = await runTransaction(this.session.db, async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists() || s.get('status') !== 'queued') return null;
        const data = s.data() as JobDoc;
        tx.update(ref, {
          status: 'claimed',
          machineId: this.machineId,
          attempts: (data.attempts ?? 0) + 1,
          claimedAt: serverTimestamp(),
          leaseExpiresAt: Timestamp.fromMillis(Date.now() + cfg.leaseMs()),
          updatedAt: serverTimestamp(),
        });
        return data;
      });
    } catch {
      claimed = null; // kalah balapan dengan mesin lain
    }
    if (!claimed) {
      this.running.delete(id);
      return;
    }
    this.lastUsed[agent.name] = Date.now();
    this.log(`→ job ${id} (${claimed.type}) diambil, agent ${agent.name}`);
    await this.heartbeat().catch(() => undefined);
    const renew = setInterval(
      () =>
        void updateDoc(ref, {
          leaseExpiresAt: Timestamp.fromMillis(Date.now() + cfg.leaseMs()),
          updatedAt: serverTimestamp(),
        }).catch(() => undefined),
      cfg.leaseRenewMs(),
    );
    // pembatalan: status `cancelled` (tombol Batalkan / digantikan commit baru) → hentikan agent job ini
    const abort = new AbortController();
    const unsubJob = onSnapshot(
      ref,
      (s) => {
        if (s.get('status') === 'cancelled' && !abort.signal.aborted) {
          this.log(`⏹ job ${id} dibatalkan — agent dihentikan`);
          abort.abort();
        }
      },
      () => undefined,
    );
    try {
      if (!this.opts.handler) throw new Error('Handler job belum dipasang.');
      const ctx: JobContext = {
        id,
        job: claimed,
        agent,
        session: this.session,
        creds: this.opts.creds,
        daemon: this,
        signal: abort.signal,
      };
      // aktivitas agent (berpikir, alat, keputusan) dicatat per langkah untuk dashboard
      ctx.agent = withActivity(agent, () => ctx);
      await this.opts.handler(ctx);
    } catch (e) {
      // job dibatalkan: statusnya sudah `cancelled`, jangan ditimpa "gagal"
      if (abort.signal.aborted) return;
      this.log(`✗ job ${id} gagal: ${(e as Error).message}`);
      const stage = (e as { stage?: string }).stage ?? 'daemon';
      await updateDoc(ref, {
        status: 'failed',
        error: { stage, message: String((e as Error).message).slice(0, 500) },
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => this.log(`tidak bisa menandai gagal: ${err.message}`));
    } finally {
      unsubJob();
      clearInterval(renew);
      this.running.delete(id);
      await this.heartbeat().catch(() => undefined);
      // job lain yang antre selama mesin sibuk tidak memicu snapshot baru → coba lagi
      this.rescan();
    }
  }

  /** Coba ambil lagi job antre yang terakhir terlihat. */
  rescan() {
    for (const d of this.lastQueued) void this.tryClaim(d.id, d.job);
  }

  async stop() {
    this.stopped = true;
    this.unsubMachine?.();
    this.unsubMachine = null;
    if (this.timer) clearInterval(this.timer);
    this.unsub?.();
    await this.session?.close().catch(() => undefined);
  }
}
