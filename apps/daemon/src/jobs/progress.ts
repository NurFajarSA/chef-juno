import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { JobContext } from '../daemon.js';
import { activity, currentStep } from './activity.js';

export interface ProgressStep {
  key: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  endedAt: number | null;
}

/** Nama langkah yang mudah dibaca di dashboard. */
export function stepLabel(key: string): string {
  if (key === 'prepare') return 'Menyiapkan kode & konteks';
  if (key === 'triage') return 'Triase PR';
  if (key === 'review') return 'Review';
  if (key.startsWith('lens-')) return `Putaran spesialis: ${key.slice(5)}`;
  if (key.startsWith('validate')) return 'Validasi temuan (Opus)';
  if (key === 'final') return 'Reviewer akhir (Opus)';
  if (key === 'app-agent') return 'Uji aplikasi (agent mencoba app)';
  if (key === 'app-agent-retry') return 'Uji aplikasi diulang (alur yang diubah belum terbukti)';
  if (key === 'app-plan') return 'Rencana uji aplikasi';
  if (key === 'app-judge') return 'Penilai uji aplikasi';
  return key;
}

/**
 * Timeline langsung per langkah agent → field `progress` di dokumen job (dashboard menampilkannya real-time).
 * Tulisan berurutan & tidak pernah menggagalkan job (mis. ditolak rules setelah job selesai).
 */
class Tracker {
  private steps: ProgressStep[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly ctx: JobContext) {}
  private flush() {
    const steps = this.steps.map((s) => ({ ...s }));
    this.chain = this.chain
      .then(() =>
        updateDoc(doc(this.ctx.session.db, `jobs/${this.ctx.id}`), { progress: steps, updatedAt: serverTimestamp() }),
      )
      .catch(() => undefined);
    return this.chain;
  }
  start(key: string) {
    // kunci sama dipakai ulang (mis. putaran diulang) → langkah baru dengan akhiran
    const n = this.steps.filter((s) => s.key === key || s.key.startsWith(`${key}#`)).length;
    const k = n ? `${key}#${n + 1}` : key;
    this.steps.push({ key: k, label: stepLabel(key), status: 'running', startedAt: Date.now(), endedAt: null });
    void this.flush();
    return k;
  }
  end(key: string, ok: boolean) {
    const s = this.steps.find((x) => x.key === key);
    if (!s) return;
    s.status = ok ? 'done' : 'failed';
    s.endedAt = Date.now();
    void this.flush();
  }
  /** jalankan fn sebagai satu langkah */
  async step<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = this.start(key);
    try {
      const r = await currentStep.run(k, fn);
      this.end(k, true);
      return r;
    } catch (e) {
      this.end(k, false);
      throw e;
    }
  }
  /** tunggu semua tulisan timeline & aktivitas agent selesai */
  async done() {
    await activity(this.ctx).flush();
    return this.chain;
  }
}

const trackers = new WeakMap<JobContext, Tracker>();
export function progress(ctx: JobContext): Tracker {
  let t = trackers.get(ctx);
  if (!t) trackers.set(ctx, (t = new Tracker(ctx)));
  return t;
}
