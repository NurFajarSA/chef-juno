import { doc, getDoc } from 'firebase/firestore';
import { DEFAULT_PROMPTS, type PromptKey } from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';

const cache = new Map<string, string>();

/**
 * Prompt cara kerja agent untuk job ini: versi yang dipin server saat job dibuat (`job.promptVersions[key]`, diambil
 * dari registry prompt di Firestore), atau bawaan Chef Juno bila belum ada di registry. Dengan begini perubahan prompt
 * berlaku di semua mesin tanpa memperbarui daemon, dan setiap job tercatat memakai versi berapa.
 */
export async function promptFor(ctx: Pick<JobContext, 'job' | 'session'>, key: PromptKey): Promise<string> {
  const v = Number((ctx.job.promptVersions as Record<string, unknown> | undefined)?.[key] ?? 0);
  const fallback = DEFAULT_PROMPTS[key].content.trimEnd();
  if (!v) return fallback;
  const id = `${key}@${v}`;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const s = await getDoc(doc(ctx.session.db, `prompts/${key}/versions/${v}`));
  const c = s.exists() ? s.get('content') : null;
  // versi yang dipin hilang/kosong → bawaan (job tetap jalan; versi tidak dicache supaya bisa dicoba lagi)
  if (typeof c !== 'string' || !c.trim()) return fallback;
  const text = c.trimEnd();
  cache.set(id, text);
  return text;
}

/** Untuk test: kosongkan cache versi. */
export function clearPromptCache() {
  cache.clear();
}
