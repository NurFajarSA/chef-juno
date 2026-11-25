import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { GraphStore } from './store.js';
import { langOf, parseFile, type Lang } from './parse.js';

// `__brick__` = template Mason (pembuat kode Flutter), bukan kode aplikasi
const SKIP_DIRS = /(^|\/)(node_modules|dist|build|out|vendor|\.git|\.next|\.angular|coverage|__brick__)(\/|$)/;
const GENERATED =
  /(\.min\.(js|css)$|\.generated\.|\.pb\.go$|_pb2\.py$|\.d\.ts$|package-lock\.json$|\.(g|freezed|gr|mocks|config)\.dart$|(^|\/)lib\/gen\/)/;
const MAX_BYTES = 1_000_000;
const TEST_FILE = /(\.|_)(test|spec)\.[a-z]+$|(^|\/)(test|tests|__tests__)\/|_test\.go$|(^|\/)test_[^/]+\.py$/;

export interface IndexStats {
  files: number;
  symbols: number;
  edges: number;
  resolvedEdgePct: number;
  languages: Record<string, number>;
  durationMs: number;
  parsedFiles: number;
}

export interface RepoConfig {
  ignore?: string[];
  /** override pembagian modul: daftar prefix folder yang dianggap modul */
  modules?: string[];
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

export function readRepoConfig(root: string): RepoConfig {
  const p = join(root, '.chefjuno', 'config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RepoConfig;
  } catch {
    return {};
  }
}

function globToRe(g: string): RegExp {
  const re = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§')
    .replace(/\*/g, '[^/]*')
    .replace(/§/g, '.*');
  return new RegExp(`^${re}(/|$)`);
}

const FEATURE_DIRS = new Set(['modules', 'features', 'feature', 'screens', 'pages']);
const TEST_ROOTS = new Set(['test', 'tests', 'integration_test', '__tests__', 'spec', 'e2e']);

/** Modul = folder level-2 di bawah src/apps/packages, selain itu folder level-1 (§6.7.A); bisa dioverride config. */
export function moduleOf(path: string, cfg: RepoConfig = {}): string {
  for (const m of cfg.modules ?? [])
    if (path === m || path.startsWith(m.replace(/\/$/, '') + '/')) return m.replace(/\/$/, '');
  const parts = path.split('/');
  if (parts.length === 1) return '.';
  // folder test level atas = satu modul (test bergantung ke banyak modul; dipecah per fitur hanya menambah noise)
  if (TEST_ROOTS.has(parts[0])) return parts[0];
  // struktur feature-first (Flutter `lib/app/modules/<fitur>/`, `src/features/<fitur>/`): satu modul per fitur
  const feat = parts.findIndex((p, i) => i < parts.length - 2 && FEATURE_DIRS.has(p));
  if (feat >= 0) return parts.slice(0, feat + 2).join('/');
  // Dart: seluruh aplikasi ada di lib/, jadi satu tingkat lebih dalam (lib/app/widgets, lib/domain/models, …)
  if (path.endsWith('.dart') && parts[0] === 'lib' && parts.length > 3) return parts.slice(0, 3).join('/');
  if (['src', 'apps', 'packages', 'lib'].includes(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

export function listFiles(root: string, cfg: RepoConfig): string[] {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  const ign = (cfg.ignore ?? []).map(globToRe);
  return out.filter((p) => !SKIP_DIRS.test(p) && !GENERATED.test(p) && !ign.some((r) => r.test(p)));
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '/index.ts', '/index.tsx', '/index.js'];

export class Indexer {
  readonly cfg: RepoConfig;
  private fileSet = new Set<string>();

  constructor(
    readonly store: GraphStore,
    readonly root: string,
  ) {
    this.cfg = readRepoConfig(root);
  }

  private async indexFile(path: string): Promise<boolean> {
    const db = this.store.db;
    db.prepare('DELETE FROM symbols_fts WHERE rowid IN (SELECT id FROM symbols WHERE file = ?)').run(path);
    db.prepare('DELETE FROM symbols WHERE file = ?').run(path);
    db.prepare('DELETE FROM edges WHERE file = ?').run(path);
    db.prepare('DELETE FROM imports WHERE file = ?').run(path);
    db.prepare('DELETE FROM files WHERE path = ?').run(path);
    const full = join(this.root, path);
    if (!existsSync(full)) return false;
    const st = statSync(full);
    if (!st.isFile() || st.size > MAX_BYTES) return false;
    const src = readFileSync(full, 'utf8');
    if (/\.(js|css)$/.test(path) && src.length > 5000 && src.split('\n').length < 5) return false; // minified
    const lang: Lang = langOf(path);
    db.prepare('INSERT INTO files(path, lang, sha, loc, module) VALUES(?, ?, ?, ?, ?)').run(
      path,
      lang,
      sha1(src),
      src.split('\n').length,
      moduleOf(path, this.cfg),
    );
    if (lang === 'other') return true;
    let parsed;
    try {
      parsed = await parseFile(path, src);
    } catch {
      return true; // jangan gagal karena satu file
    }
    const insSym = db.prepare(
      'INSERT INTO symbols(name, qualifiedName, kind, file, startLine, endLine, exported, signature, doc) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    );
    const insFts = db.prepare(
      'INSERT INTO symbols_fts(rowid, name, qualifiedName, signature, doc) VALUES(?, ?, ?, ?, ?)',
    );
    const ids = new Map<string, number>();
    for (const s of parsed.symbols) {
      const r = insSym.get(
        s.name,
        s.qualifiedName,
        s.kind,
        path,
        s.startLine,
        s.endLine,
        s.exported ? 1 : 0,
        s.signature,
        s.doc,
      ) as { id: number };
      ids.set(s.qualifiedName, r.id);
      insFts.run(r.id, s.name, s.qualifiedName, s.signature, s.doc);
    }
    const insImp = db.prepare(
      'INSERT INTO imports(file, source, local, imported, line, reexport, target) VALUES(?, ?, ?, ?, ?, ?, ?)',
    );
    for (const im of parsed.imports) {
      const target = this.resolveSource(path, im.source, lang);
      for (const n of im.names) insImp.run(path, im.source, n.local, n.imported, im.line, im.reexport ? 1 : 0, target);
    }
    const insEdge = db.prepare(
      'INSERT INTO edges(fromSymbol, toSymbol, toName, kind, file, line, resolved, receiver) VALUES(?, NULL, ?, ?, ?, ?, 0, ?)',
    );
    const isTest = TEST_FILE.test(path);
    for (const r of parsed.refs) {
      const from = r.from ? (ids.get(r.from) ?? null) : null;
      insEdge.run(from, r.toName, r.kind, path, r.line, r.receiver ?? null);
      if (isTest && r.kind === 'calls') insEdge.run(from, r.toName, 'tests', path, r.line, r.receiver ?? null);
    }
    return true;
  }

  private dartPackages: Map<string, string> | null = null;

  /** Nama paket Dart (`name:` di tiap pubspec.yaml) → folder `lib/` paket itu. */
  private dartPackageDirs(): Map<string, string> {
    if (this.dartPackages) return this.dartPackages;
    const m = new Map<string, string>();
    for (const f of this.fileSet) {
      if (f !== 'pubspec.yaml' && !f.endsWith('/pubspec.yaml')) continue;
      try {
        const name = /^name:\s*([A-Za-z0-9_]+)/m.exec(readFileSync(join(this.root, f), 'utf8'))?.[1];
        if (name) m.set(name, posix.join(posix.dirname(f), 'lib'));
      } catch {
        // pubspec tidak terbaca → lewati
      }
    }
    return (this.dartPackages = m);
  }

  /** Path sumber import → file di repo (relatif JS/TS, modul Python, paket Go, package:/relatif Dart). */
  resolveSource(fromFile: string, source: string, lang: Lang): string | null {
    if (lang === 'dart') {
      let file: string;
      const pkg = /^package:([A-Za-z0-9_]+)\/(.+)$/.exec(source);
      if (pkg) {
        const dir = this.dartPackageDirs().get(pkg[1]);
        if (!dir) return null; // paket pihak ketiga (pub.dev)
        file = posix.normalize(posix.join(dir, pkg[2]));
      } else if (/^[a-z]+:/.test(source)) return null;
      else file = posix.normalize(posix.join(posix.dirname(fromFile), source));
      return this.fileSet.has(file) ? file : null;
    }
    if (lang === 'py') {
      const rel = source.startsWith('.');
      const mod = source.replace(/^\.+/, '').replace(/\./g, '/');
      const baseDir = rel ? posix.dirname(fromFile) : '';
      const cands = [posix.join(baseDir, `${mod}.py`), posix.join(baseDir, mod, '__init__.py')];
      for (const f of this.fileSet) for (const c of cands) if (f === c || f.endsWith('/' + c)) return f;
      return null;
    }
    if (lang === 'go') {
      const dir = [...this.fileSet].find(
        (f) => f.endsWith('.go') && posix.dirname(f).endsWith(source.split('/').slice(-2).join('/')),
      );
      return dir ? posix.dirname(dir) : null;
    }
    if (!source.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromFile), source));
    for (const e of RESOLVE_EXT) if (this.fileSet.has(base + e)) return base + e;
    return null;
  }

  /** Selesaikan edge lewat import/scope; yang tidak pasti tetap disimpan resolved=false. */
  resolveEdges(onlyFiles?: Set<string>) {
    const db = this.store.db;
    const findExported = db.prepare(
      "SELECT id FROM symbols WHERE file = ? AND name = ? AND exported = 1 ORDER BY kind = 'method' LIMIT 1",
    );
    const findInFile = db.prepare(
      "SELECT id FROM symbols WHERE file = ? AND name = ? ORDER BY kind = 'method' LIMIT 1",
    );
    const findInDir = db.prepare('SELECT id FROM symbols WHERE file LIKE ? AND name = ? AND exported = 1 LIMIT 1');
    const findByName = db.prepare('SELECT id FROM symbols WHERE name = ? LIMIT 2');
    const reexportOf = db.prepare(
      'SELECT target, imported, local FROM imports WHERE file = ? AND reexport = 1 AND (local = ? OR local = ?)',
    );
    const importOf = db.prepare('SELECT target, imported FROM imports WHERE file = ? AND local = ?');
    // Dart: `import 'x.dart';` membawa semua nama publik library x ke scope
    const starImports = db.prepare(
      "SELECT target FROM imports WHERE file = ? AND local = '*' AND imported = '*' AND target IS NOT NULL",
    );
    const update = db.prepare('UPDATE edges SET toSymbol = ?, resolved = ? WHERE id = ?');
    const rows = (
      onlyFiles
        ? db.prepare('SELECT id, file, toName, kind, receiver FROM edges').all()
        : db.prepare('SELECT id, file, toName, kind, receiver FROM edges').all()
    ) as { id: number; file: string; toName: string; kind: string; receiver: string | null }[];

    // memo: barrel Dart/TS membuat pencarian (file, nama) yang sama diulang ribuan kali
    const memo = new Map<string, number | null>();
    const lookupInFile = (file: string, name: string, depth = 0): number | null => {
      const key = `${file}\0${name}`;
      if (memo.has(key)) return memo.get(key)!;
      const found = lookupUncached(file, name, depth);
      if (depth === 0 || found) memo.set(key, found);
      return found;
    };
    const starCache = new Map<string, { target: string }[]>();
    const starOf = (file: string) => {
      let v = starCache.get(file);
      if (!v) starCache.set(file, (v = starImports.all(file) as { target: string }[]));
      return v;
    };
    const byNameCache = new Map<string, { id: number }[]>();
    const byName = (name: string) => {
      let v = byNameCache.get(name);
      if (!v) byNameCache.set(name, (v = findByName.all(name) as { id: number }[]));
      return v;
    };
    const lookupUncached = (file: string, name: string, depth: number): number | null => {
      if (file.endsWith('.go') || !file.includes('.')) {
        const r = findInDir.get(`${file}/%`, name) as { id: number } | undefined;
        if (r) return r.id;
      }
      const r = findExported.get(file, name) as { id: number } | undefined;
      if (r) return r.id;
      if (depth > (file.endsWith('.dart') ? 8 : 3)) return null; // barrel Dart sering berlapis
      for (const re of reexportOf.all(file, name, '*') as {
        target: string | null;
        imported: string;
        local: string;
      }[]) {
        if (!re.target) continue;
        const id = lookupInFile(re.target, re.local === '*' ? name : re.imported, depth + 1);
        if (id) return id;
      }
      return null;
    };

    for (const e of rows) {
      if (e.kind === 'imports') continue;
      let to: number | null = null;
      let resolved = 0;
      const lang = langOf(e.file);
      if (e.receiver && lang !== 'go') {
        // obj.method(): kalau obj adalah namespace import → cari di file target
        const ns = importOf.get(e.file, e.receiver) as { target: string | null; imported: string } | undefined;
        if (ns?.target && ns.imported === '*') {
          to = lookupInFile(ns.target, e.toName);
          resolved = to ? 1 : 0;
        }
      } else if (e.receiver && lang === 'go') {
        const ns = importOf.get(e.file, e.receiver) as { target: string | null } | undefined;
        if (ns?.target) {
          to = lookupInFile(ns.target, e.toName);
          resolved = to ? 1 : 0;
        }
      } else {
        const im = importOf.get(e.file, e.toName) as { target: string | null; imported: string } | undefined;
        if (im?.target) {
          to = lookupInFile(im.target, im.imported === 'default' ? e.toName : im.imported);
          resolved = to ? 1 : 0;
        }
        if (!to && !im) {
          const local = findInFile.get(e.file, e.toName) as { id: number } | undefined;
          if (local) {
            to = local.id;
            resolved = 1;
          } else if (lang === 'go') {
            const r = findInDir.get(`${posix.dirname(e.file)}/%`, e.toName) as { id: number } | undefined;
            if (r) {
              to = r.id;
              resolved = 1;
            }
          }
        }
      }
      if (!to && !e.receiver && lang === 'dart') {
        for (const im of starOf(e.file)) {
          to = lookupInFile(im.target, e.toName);
          if (to) {
            resolved = 1;
            break;
          }
        }
      }
      if (!to && !e.receiver) {
        // tebakan global: nama unik di seluruh repo → disimpan tapi resolved=false
        const cands = byName(e.toName);
        if (cands.length === 1) to = cands[0].id;
      }
      update.run(to, resolved, e.id);
    }
  }

  private loadFileSet(files: string[]) {
    this.fileSet = new Set(files);
  }

  async full(sha: string): Promise<IndexStats> {
    const t0 = Date.now();
    const files = listFiles(this.root, this.cfg);
    this.loadFileSet(files);
    const db = this.store.db;
    this.store.tx(() =>
      db.exec(
        'DELETE FROM symbols; DELETE FROM edges; DELETE FROM imports; DELETE FROM files; DELETE FROM symbols_fts;',
      ),
    );
    db.exec('BEGIN');
    try {
      for (const f of files) await this.indexFile(f);
      this.resolveEdges();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    this.store.setMeta('indexedSha', sha);
    return this.stats(Date.now() - t0, files.length);
  }

  /** Parse ulang hanya file yang berubah sejak indexedSha, lalu resolve ulang edge. */
  async incremental(fromSha: string, toSha: string): Promise<IndexStats & { changed: string[] }> {
    const t0 = Date.now();
    const out = git(this.root, ['diff', '--name-status', '--no-renames', `${fromSha}..${toSha}`]);
    const changed = out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t').pop()!)
      .filter((p) => !SKIP_DIRS.test(p) && !GENERATED.test(p));
    this.loadFileSet(listFiles(this.root, this.cfg));
    const db = this.store.db;
    db.exec('BEGIN');
    try {
      for (const f of changed) await this.indexFile(f);
      this.resolveEdges(new Set(changed));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    this.store.setMeta('indexedSha', toSha);
    return { ...this.stats(Date.now() - t0, changed.length), changed };
  }

  stats(durationMs: number, parsedFiles: number): IndexStats {
    const db = this.store.db;
    const one = (q: string) => (db.prepare(q).get() as { n: number }).n;
    const edges = one("SELECT COUNT(*) n FROM edges WHERE kind != 'imports'");
    const resolved = one("SELECT COUNT(*) n FROM edges WHERE kind != 'imports' AND resolved = 1");
    const languages: Record<string, number> = {};
    for (const r of db.prepare("SELECT lang, COUNT(*) n FROM files WHERE lang != 'other' GROUP BY lang").all() as {
      lang: string;
      n: number;
    }[])
      languages[r.lang] = r.n;
    return {
      files: one('SELECT COUNT(*) n FROM files'),
      symbols: one('SELECT COUNT(*) n FROM symbols'),
      edges,
      resolvedEdgePct: edges ? Math.round((resolved / edges) * 1000) / 1000 : 0,
      languages,
      durationMs,
      parsedFiles,
    };
  }
}
