import { AsyncLocalStorage } from 'node:async_hooks';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import type { AgentRunner, RunOptions } from '../agents/types.js';
import type { AgentEvent } from '../agents/events.js';
import type { JobContext } from '../daemon.js';

/** langkah timeline yang sedang berjalan (diisi progress().step) — aktivitas agent dikelompokkan per langkah */
export const currentStep = new AsyncLocalStorage<string>();

const FLUSH_MS = 2000;
const MAX_PER_DOC = 40;
/** batas jumlah dokumen aktivitas per job (agent yang sangat panjang tidak membanjiri Firestore) */
const MAX_DOCS = 400;

interface Buffered extends AgentEvent {
  at: number;
}

/**
 * Aktivitas agent langsung ("intip kerja agent") → `jobs/{id}/activity` (satu dokumen = potongan event satu langkah).
 * Tulisan berurutan & tidak pernah menggagalkan job.
 */
class ActivityLog {
  private buf = new Map<string, Buffered[]>();
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly ctx: JobContext) {}
  push(step: string, e: AgentEvent) {
    const xs = this.buf.get(step) ?? [];
    xs.push({ ...e, at: Date.now() });
    this.buf.set(step, xs);
    if (xs.length >= MAX_PER_DOC) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), FLUSH_MS);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batches = [...this.buf.entries()];
    this.buf.clear();
    for (const [step, events] of batches) {
      if (this.seq >= MAX_DOCS) break;
      const seq = this.seq++;
      this.chain = this.chain
        .then(() =>
          addDoc(collection(this.ctx.session.db, `jobs/${this.ctx.id}/activity`), {
            step,
            seq,
            events,
            createdAt: serverTimestamp(),
          }),
        )
        .catch(() => undefined);
    }
    return this.chain;
  }
}

const logs = new WeakMap<JobContext, ActivityLog>();
export function activity(ctx: JobContext): ActivityLog {
  let l = logs.get(ctx);
  if (!l) logs.set(ctx, (l = new ActivityLog(ctx)));
  return l;
}

/** Bungkus agent: setiap run mengirim aktivitasnya ke log job, dikelompokkan menurut langkah yang sedang berjalan. */
export function withActivity(agent: AgentRunner, ctx: () => JobContext): AgentRunner {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      if (prop === 'run')
        return (o: RunOptions) =>
          target.run({
            ...o,
            // job dibatalkan dari dashboard / digantikan commit baru → agent dihentikan
            signal: o.signal ?? ctx().signal,
            onEvent: (e) => {
              o.onEvent?.(e);
              activity(ctx()).push(currentStep.getStore() ?? 'agent', e);
            },
          });
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
