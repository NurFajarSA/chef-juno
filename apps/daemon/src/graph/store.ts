import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Penyimpanan graph: SQLite bawaan Node 24 + FTS5 (§6.7.A). */
export class GraphStore {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, lang TEXT, sha TEXT, loc INTEGER, module TEXT);
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY, name TEXT, qualifiedName TEXT, kind TEXT, file TEXT, startLine INTEGER, endLine INTEGER,
        exported INTEGER, signature TEXT, doc TEXT);
      CREATE INDEX IF NOT EXISTS symbols_file ON symbols(file);
      CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY, fromSymbol INTEGER, toSymbol INTEGER NULL, toName TEXT, kind TEXT, file TEXT, line INTEGER,
        resolved INTEGER, receiver TEXT);
      CREATE INDEX IF NOT EXISTS edges_from ON edges(fromSymbol);
      CREATE INDEX IF NOT EXISTS edges_to ON edges(toSymbol);
      CREATE INDEX IF NOT EXISTS edges_file ON edges(file);
      CREATE INDEX IF NOT EXISTS edges_name ON edges(toName);
      CREATE TABLE IF NOT EXISTS imports (file TEXT, source TEXT, local TEXT, imported TEXT, line INTEGER, reexport INTEGER, target TEXT);
      CREATE INDEX IF NOT EXISTS imports_file ON imports(file);
      CREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, path TEXT, name TEXT, summary TEXT, summarySha TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(name, qualifiedName, signature, doc);
    `);
  }

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.db.close();
  }
}
