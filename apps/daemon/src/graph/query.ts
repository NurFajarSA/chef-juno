import type { GraphStore } from './store.js';

export interface SymbolRow {
  id: number;
  name: string;
  qualifiedName: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  exported: number;
  signature: string;
  doc: string;
}

export interface EdgeHit {
  symbol: SymbolRow | null;
  file: string;
  line: number;
  kind: string;
  depth: number;
  resolved: boolean;
}

/** Query read-only atas graph (dipakai konteks review & server MCP). */
export class GraphQuery {
  constructor(readonly store: GraphStore) {}

  private get db() {
    return this.store.db;
  }

  symbol(id: number): SymbolRow | null {
    return (this.db.prepare('SELECT * FROM symbols WHERE id = ?').get(id) as SymbolRow | undefined) ?? null;
  }

  findSymbol(name: string, file?: string): SymbolRow[] {
    const q = file
      ? this.db.prepare(
          'SELECT * FROM symbols WHERE (name = ? OR qualifiedName = ?) AND file = ? ORDER BY file, startLine',
        )
      : this.db.prepare('SELECT * FROM symbols WHERE name = ? OR qualifiedName = ? ORDER BY file, startLine');
    return (file ? q.all(name, name, file) : q.all(name, name)) as unknown as SymbolRow[];
  }

  /** Simbol terdalam yang memuat baris itu. */
  symbolAt(file: string, line: number): SymbolRow | null {
    return (
      (this.db
        .prepare(
          'SELECT * FROM symbols WHERE file = ? AND startLine <= ? AND endLine >= ? ORDER BY (endLine - startLine) ASC LIMIT 1',
        )
        .get(file, line, line) as SymbolRow | undefined) ?? null
    );
  }

  symbolsInRange(file: string, start: number, end: number): SymbolRow[] {
    return this.db
      .prepare('SELECT * FROM symbols WHERE file = ? AND startLine <= ? AND endLine >= ? ORDER BY startLine')
      .all(file, end, start) as unknown as SymbolRow[];
  }

  /** Siapa memanggil simbol ini (BFS sampai `depth`). */
  callers(id: number, depth = 2): EdgeHit[] {
    const out: EdgeHit[] = [];
    const seen = new Set<string>();
    let frontier = [id];
    const q = this.db.prepare(
      "SELECT fromSymbol, file, line, kind, resolved FROM edges WHERE toSymbol = ? AND kind IN ('calls','renders','extends','implements','references')",
    );
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: number[] = [];
      for (const sid of frontier) {
        for (const e of q.all(sid) as {
          fromSymbol: number | null;
          file: string;
          line: number;
          kind: string;
          resolved: number;
        }[]) {
          const key = `${e.file}:${e.line}:${e.fromSymbol}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            symbol: e.fromSymbol ? this.symbol(e.fromSymbol) : null,
            file: e.file,
            line: e.line,
            kind: e.kind,
            depth: d,
            resolved: !!e.resolved,
          });
          if (e.fromSymbol && e.fromSymbol !== id) next.push(e.fromSymbol);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Apa yang dipanggil simbol ini. */
  callees(id: number, depth = 1): EdgeHit[] {
    const out: EdgeHit[] = [];
    let frontier = [id];
    const seen = new Set<number>();
    const q = this.db.prepare(
      "SELECT toSymbol, toName, file, line, kind, resolved FROM edges WHERE fromSymbol = ? AND kind IN ('calls','renders','extends','implements')",
    );
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: number[] = [];
      for (const sid of frontier) {
        for (const e of q.all(sid) as {
          toSymbol: number | null;
          toName: string;
          file: string;
          line: number;
          kind: string;
          resolved: number;
        }[]) {
          if (!e.toSymbol) continue;
          if (seen.has(e.toSymbol)) continue;
          seen.add(e.toSymbol);
          out.push({
            symbol: this.symbol(e.toSymbol),
            file: e.file,
            line: e.line,
            kind: e.kind,
            depth: d,
            resolved: !!e.resolved,
          });
          next.push(e.toSymbol);
        }
      }
      frontier = next;
    }
    return out;
  }

  references(id: number): EdgeHit[] {
    return (
      this.db.prepare('SELECT fromSymbol, file, line, kind, resolved FROM edges WHERE toSymbol = ?').all(id) as {
        fromSymbol: number | null;
        file: string;
        line: number;
        kind: string;
        resolved: number;
      }[]
    ).map((e) => ({
      symbol: e.fromSymbol ? this.symbol(e.fromSymbol) : null,
      file: e.file,
      line: e.line,
      kind: e.kind,
      depth: 1,
      resolved: !!e.resolved,
    }));
  }

  /** File test yang menyentuh simbol (edge `tests` atau nama file test). */
  tests(id: number): { file: string; line: number }[] {
    return this.db.prepare("SELECT DISTINCT file, line FROM edges WHERE toSymbol = ? AND kind = 'tests'").all(id) as {
      file: string;
      line: number;
    }[];
  }

  outline(file: string): SymbolRow[] {
    return this.db
      .prepare('SELECT * FROM symbols WHERE file = ? ORDER BY startLine')
      .all(file) as unknown as SymbolRow[];
  }

  search(text: string, limit = 10): SymbolRow[] {
    const terms = text
      .replace(/[^\p{L}\p{N}_ ]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"*`)
      .join(' OR ');
    if (!terms) return [];
    return this.db
      .prepare(
        'SELECT s.* FROM symbols_fts f JOIN symbols s ON s.id = f.rowid WHERE symbols_fts MATCH ? ORDER BY rank LIMIT ?',
      )
      .all(terms, limit) as unknown as SymbolRow[];
  }

  moduleOfFile(file: string): string | null {
    return (
      (this.db.prepare('SELECT module FROM files WHERE path = ?').get(file) as { module: string } | undefined)
        ?.module ?? null
    );
  }

  moduleSummary(id: string): { id: string; summary: string | null; files: string[]; exports: string[] } {
    const m = this.db.prepare('SELECT summary FROM modules WHERE id = ?').get(id) as { summary: string } | undefined;
    const files = (
      this.db.prepare('SELECT path FROM files WHERE module = ? ORDER BY path').all(id) as { path: string }[]
    ).map((r) => r.path);
    const exports = (
      this.db
        .prepare(
          'SELECT DISTINCT s.name FROM symbols s JOIN files f ON f.path = s.file WHERE f.module = ? AND s.exported = 1 ORDER BY s.name LIMIT 50',
        )
        .all(id) as { name: string }[]
    ).map((r) => r.name);
    return { id, summary: m?.summary ?? null, files, exports };
  }

  /** Dampak perubahan pada file:line → simbol + caller. */
  impact(file: string, line: number) {
    const s = this.symbolAt(file, line);
    if (!s) return { symbol: null, callers: [], tests: [] };
    return { symbol: s, callers: this.callers(s.id, 2), tests: this.tests(s.id) };
  }

  /** Dependensi antar modul (dari edge yang ter-resolve lintas modul + import). */
  moduleGraph(): {
    modules: { id: string; files: number; symbols: number }[];
    edges: { from: string; to: string; weight: number }[];
  } {
    const modules = this.db
      .prepare(
        'SELECT f.module id, COUNT(DISTINCT f.path) files, COUNT(s.id) symbols FROM files f LEFT JOIN symbols s ON s.file = f.path GROUP BY f.module ORDER BY f.module',
      )
      .all() as { id: string; files: number; symbols: number }[];
    const edges = this.db
      .prepare(
        `SELECT fa.module "from", fb.module "to", COUNT(*) weight FROM edges e
         JOIN files fa ON fa.path = e.file JOIN symbols t ON t.id = e.toSymbol JOIN files fb ON fb.path = t.file
         WHERE e.resolved = 1 AND fa.module != fb.module GROUP BY fa.module, fb.module
         UNION
         SELECT fa.module "from", fb.module "to", COUNT(*) weight FROM imports i
         JOIN files fa ON fa.path = i.file JOIN files fb ON (fb.path = i.target OR fb.path LIKE i.target || '/%')
         WHERE i.target IS NOT NULL AND fa.module != fb.module GROUP BY fa.module, fb.module`,
      )
      .all() as { from: string; to: string; weight: number }[];
    const merged = new Map<string, { from: string; to: string; weight: number }>();
    for (const e of edges) {
      const k = `${e.from}→${e.to}`;
      const prev = merged.get(k);
      merged.set(k, { ...e, weight: Math.max(prev?.weight ?? 0, e.weight) });
    }
    return { modules, edges: [...merged.values()] };
  }
}
