import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cfg } from '../env.js';
import { GraphStore } from './store.js';
import { Indexer, type IndexStats } from './indexer.js';
import { GraphQuery } from './query.js';

export const graphDbPath = (repoId: number | string) => join(cfg.home(), 'index', String(repoId), 'graph.db');

export interface EnsureResult {
  store: GraphStore;
  mode: 'full' | 'incremental' | 'cached';
  stats: IndexStats;
  buildMs: number;
}

/** Pastikan index lokal repo berada di `sha` (incremental kalau sudah ada index sebelumnya). */
export async function ensureIndex(
  repoId: number,
  root: string,
  sha: string,
  prefer: 'full' | 'incremental' = 'incremental',
): Promise<EnsureResult> {
  const store = new GraphStore(graphDbPath(repoId));
  const ix = new Indexer(store, root);
  const t0 = Date.now();
  const have = store.getMeta('indexedSha');
  if (have === sha && prefer !== 'full') return { store, mode: 'cached', stats: ix.stats(0, 0), buildMs: 0 };
  if (have && prefer === 'incremental') {
    try {
      const stats = await ix.incremental(have, sha);
      return { store, mode: 'incremental', stats, buildMs: Date.now() - t0 };
    } catch {
      // sha lama tidak ada di repo → index penuh
    }
  }
  const stats = await ix.full(sha);
  return { store, mode: 'full', stats, buildMs: Date.now() - t0 };
}

export interface ModuleInfo {
  id: string;
  path: string;
  name: string;
  keyFiles: string[];
  exports: string[];
  dependsOn: string[];
  dependents: string[];
  stats: { files: number; symbols: number };
  summarySha: string;
}

/** Daftar modul berkode + sha isi (untuk menentukan modul mana yang perlu diringkas ulang). */
export function moduleInfos(store: GraphStore): ModuleInfo[] {
  const q = new GraphQuery(store);
  const g = q.moduleGraph();
  const out: ModuleInfo[] = [];
  for (const m of g.modules) {
    if (!m.symbols) continue;
    const files = store.db.prepare('SELECT path, sha FROM files WHERE module = ? ORDER BY path').all(m.id) as {
      path: string;
      sha: string;
    }[];
    const keyFiles = (
      store.db
        .prepare(
          'SELECT s.file, COUNT(*) n FROM symbols s JOIN files f ON f.path = s.file WHERE f.module = ? GROUP BY s.file ORDER BY n DESC, s.file LIMIT 8',
        )
        .all(m.id) as { file: string }[]
    ).map((r) => r.file);
    out.push({
      id: m.id,
      path: m.id,
      name: m.id.split('/').pop() || m.id,
      keyFiles,
      exports: q.moduleSummary(m.id).exports,
      dependsOn: g.edges.filter((e) => e.from === m.id).map((e) => e.to),
      dependents: g.edges.filter((e) => e.to === m.id).map((e) => e.from),
      stats: { files: m.files, symbols: m.symbols },
      summarySha: createHash('sha1')
        .update(files.map((f) => `${f.path}:${f.sha}`).join('\n'))
        .digest('hex'),
    });
  }
  return out;
}
