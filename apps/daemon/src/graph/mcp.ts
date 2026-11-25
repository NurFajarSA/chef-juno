import { parseArgs } from 'node:util';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GraphStore } from './store.js';
import { GraphQuery, type EdgeHit, type SymbolRow } from './query.js';

const sym = (s: SymbolRow | null) =>
  s
    ? {
        name: s.qualifiedName,
        kind: s.kind,
        file: s.file,
        startLine: s.startLine,
        endLine: s.endLine,
        exported: !!s.exported,
        signature: s.signature,
      }
    : null;
const hit = (h: EdgeHit) => ({
  symbol: h.symbol?.qualifiedName ?? null,
  file: h.file,
  line: h.line,
  kind: h.kind,
  depth: h.depth,
  resolved: h.resolved,
});

/** Tool graph read-only (§6.7.D). Dipisah dari transport supaya bisa dites langsung. */
export function graphTools(store: GraphStore) {
  const q = new GraphQuery(store);
  const pick = (name: string, file?: string) => q.findSymbol(name, file)[0] ?? null;
  return {
    find_symbol: {
      description: 'Cari simbol (fungsi/class/komponen) berdasarkan nama atau qualifiedName.',
      input: { name: z.string(), file: z.string().optional() },
      run: (a: { name: string; file?: string }) => q.findSymbol(a.name, a.file).map(sym),
    },
    get_callers: {
      description: 'Daftar pemanggil simbol (kedalaman default 2).',
      input: { name: z.string(), file: z.string().optional(), depth: z.number().int().min(1).max(4).optional() },
      run: (a: { name: string; file?: string; depth?: number }) => {
        const s = pick(a.name, a.file);
        return s ? q.callers(s.id, a.depth ?? 2).map(hit) : [];
      },
    },
    get_callees: {
      description: 'Daftar simbol yang dipanggil simbol ini (kedalaman default 1).',
      input: { name: z.string(), file: z.string().optional(), depth: z.number().int().min(1).max(3).optional() },
      run: (a: { name: string; file?: string; depth?: number }) => {
        const s = pick(a.name, a.file);
        return s ? q.callees(s.id, a.depth ?? 1).map((h) => ({ ...hit(h), target: sym(h.symbol) })) : [];
      },
    },
    get_references: {
      description: 'Semua referensi ke simbol (panggilan, render, extends, test).',
      input: { name: z.string(), file: z.string().optional() },
      run: (a: { name: string; file?: string }) => {
        const s = pick(a.name, a.file);
        return s ? q.references(s.id).map(hit) : [];
      },
    },
    get_file_outline: {
      description: 'Outline simbol dalam satu file.',
      input: { path: z.string() },
      run: (a: { path: string }) => q.outline(a.path).map(sym),
    },
    search_code_symbols: {
      description: 'Pencarian teks (FTS5) atas nama, signature, dan doc simbol.',
      input: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
      run: (a: { query: string; limit?: number }) => q.search(a.query, a.limit ?? 10).map(sym),
    },
    get_module_summary: {
      description: 'Ringkasan modul (wiki), file, dan simbol yang diekspor.',
      input: { module: z.string() },
      run: (a: { module: string }) => q.moduleSummary(a.module),
    },
    get_impact: {
      description: 'Dampak perubahan pada path:line → simbol, pemanggil (kedalaman 2), dan test.',
      input: { path: z.string(), line: z.number().int() },
      run: (a: { path: string; line: number }) => {
        const r = q.impact(a.path, a.line);
        return { symbol: sym(r.symbol), callers: r.callers.map(hit), tests: r.tests };
      },
    },
  };
}

export async function runGraphMcp(args: string[]) {
  const { values } = parseArgs({ args, options: { db: { type: 'string' }, root: { type: 'string' } } });
  if (!values.db) throw new Error('Pakai: chefjuno graph-mcp --db <graph.db> --root <worktree>');
  const store = new GraphStore(values.db);
  const server = new McpServer({ name: 'chefjuno_graph', version: '0.1.0' });
  for (const [name, t] of Object.entries(graphTools(store))) {
    server.registerTool(
      name,
      { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true } },
      async (a: unknown) => ({
        content: [{ type: 'text' as const, text: JSON.stringify((t.run as (x: unknown) => unknown)(a), null, 1) }],
      }),
    );
  }
  await server.connect(new StdioServerTransport());
}
