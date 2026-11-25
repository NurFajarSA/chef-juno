import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedDiff, rangeTouchesHunks } from '@chefjuno/shared';
import { parseFile } from './parse.js';
import { GraphQuery, type SymbolRow } from './query.js';
import type { GraphStore } from './store.js';

export interface GraphContext {
  markdown: string;
  impact: string[];
  changedSymbols: { qualifiedName: string; file: string; signatureChanged: boolean; callers: number }[];
}

const KIND_ID: Record<string, string> = {
  function: 'fungsi',
  method: 'method',
  class: 'class',
  interface: 'interface',
  type: 'type',
  variable: 'variabel',
  component: 'komponen',
  route: 'route',
};

/**
 * §6.7.C — "Konteks dari peta kode" untuk prompt review, dibatasi ±40 KB dan diprioritaskan:
 * simbol berubah (+signature lama vs baru), caller (kedalaman 2) & callee (1), test, simbol mirip (FTS),
 * ringkasan modul, dan peringatan dampak.
 */
export async function buildGraphContext(
  store: GraphStore,
  o: {
    diff: string;
    worktree: string;
    baseContent: (path: string) => Promise<string | null>;
    maxBytes?: number;
    moduleSummaries?: Record<string, string>;
  },
): Promise<GraphContext> {
  const q = new GraphQuery(store);
  const max = o.maxBytes ?? 40_000;
  const files = parseUnifiedDiff(o.diff);
  const snippets = new Map<string, string[]>();
  const lineOf = (file: string, line: number) => {
    if (!snippets.has(file)) {
      const p = join(o.worktree, file);
      snippets.set(file, existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []);
    }
    return (snippets.get(file)![line - 1] ?? '').trim().slice(0, 160);
  };

  const changed: { s: SymbolRow; oldSig: string | null }[] = [];
  for (const [path, f] of files) {
    if (f.deleted) continue;
    const syms = q.outline(path).filter((s) => rangeTouchesHunks(f, s.startLine, s.endLine));
    if (!syms.length) continue;
    let old: Map<string, string> | null = null;
    const base = await o.baseContent(f.oldPath ?? path);
    if (base != null) {
      const parsed = await parseFile(path, base);
      old = new Map(parsed.symbols.map((x) => [x.qualifiedName, x.signature]));
    }
    // ambil simbol terdalam saja (method, bukan class induknya) kalau dua-duanya kena
    for (const s of syms) {
      const inner = syms.some(
        (o2) =>
          o2.id !== s.id &&
          o2.startLine >= s.startLine &&
          o2.endLine <= s.endLine &&
          o2.endLine - o2.startLine < s.endLine - s.startLine,
      );
      if (inner && s.kind === 'class') continue;
      changed.push({ s, oldSig: old ? (old.get(s.qualifiedName) ?? null) : null });
    }
  }

  const sections: string[] = [];
  const impact: string[] = [];
  const summary: GraphContext['changedSymbols'] = [];
  const touchedModules = new Set<string>();

  for (const { s, oldSig } of changed) {
    const callers = q.callers(s.id, 2);
    const callees = q.callees(s.id, 1);
    const tests = q.tests(s.id);
    const sigChanged = oldSig !== null && oldSig !== s.signature;
    const isNew = oldSig === null;
    const kind = KIND_ID[s.kind] ?? s.kind;
    touchedModules.add(q.moduleOfFile(s.file) ?? '.');
    summary.push({
      qualifiedName: s.qualifiedName,
      file: s.file,
      signatureChanged: sigChanged,
      callers: callers.length,
    });
    const lines = [`### ${kind} \`${s.qualifiedName}\` — ${s.file}:${s.startLine}${s.exported ? ' (diekspor)' : ''}`];
    if (sigChanged) lines.push(`- Signature lama: \`${oldSig}\``, `- Signature baru: \`${s.signature}\``);
    else lines.push(`- Signature: \`${s.signature}\`${isNew ? ' (baru)' : ''}`);
    if (callers.length) {
      lines.push(`- Dipanggil oleh (${callers.length}):`);
      for (const c of callers.slice(0, 15))
        lines.push(
          `  - ${c.depth === 2 ? '↳ ' : ''}\`${c.symbol?.qualifiedName ?? '(level file)'}\` di ${c.file}:${c.line}${c.resolved ? '' : ' (belum pasti)'} — \`${lineOf(c.file, c.line)}\``,
        );
    } else lines.push('- Dipanggil oleh: tidak ada di repo ini.');
    if (callees.length)
      lines.push(
        `- Memanggil: ${callees
          .slice(0, 10)
          .map((c) => `\`${c.symbol?.qualifiedName}\` (${c.symbol?.file}:${c.symbol?.startLine})`)
          .join(', ')}`,
      );
    lines.push(
      tests.length
        ? `- Test: ${tests.map((t) => `${t.file}:${t.line}`).join(', ')}`
        : '- Test: tidak ada test yang menyentuh simbol ini.',
    );
    const similar = q
      .search(s.name, 6)
      .filter((x) => x.id !== s.id && x.file !== s.file)
      .slice(0, 3);
    if (similar.length)
      lines.push(
        `- Simbol mirip (cek konsistensi pola): ${similar.map((x) => `\`${x.qualifiedName}\` ${x.file}:${x.startLine}`).join(', ')}`,
      );
    sections.push(lines.join('\n'));
    const direct = callers.filter((c) => c.depth === 1).length;
    if (sigChanged && direct > 0)
      impact.push(
        `${kind} \`${s.qualifiedName}\` dipakai di ${direct} tempat; signature berubah — cek semua pemanggil.`,
      );
    else if (sigChanged && s.exported)
      impact.push(`${kind} \`${s.qualifiedName}\` diekspor dan signature berubah (perubahan kontrak publik).`);
  }

  const mods: string[] = [];
  const graph = q.moduleGraph();
  for (const m of touchedModules) {
    const dependents = graph.edges.filter((e) => e.to === m).map((e) => e.from);
    const sum = o.moduleSummaries?.[m] ?? q.moduleSummary(m).summary;
    mods.push(
      `- **${m}**${sum ? `: ${sum.replace(/\s+/g, ' ').slice(0, 600)}` : ''}${dependents.length ? ` · dipakai oleh modul: ${dependents.join(', ')}` : ''}`,
    );
  }

  const out: string[] = [
    '## Konteks dari peta kode',
    'Dihitung lokal dari graph seluruh repo (tree-sitter). Gunakan untuk menilai dampak ke bagian lain.',
    '',
  ];
  if (impact.length) out.push('**Peringatan dampak**', ...impact.map((i) => `- ${i}`), '');
  out.push(
    '**Simbol yang berubah**',
    ...(sections.length ? sections : ['(tidak ada simbol yang terdeteksi berubah)']),
    '',
  );
  if (mods.length) out.push('**Modul yang tersentuh**', ...mods, '');
  let md = out.join('\n');
  if (Buffer.byteLength(md) > max)
    md = Buffer.from(md).subarray(0, max).toString('utf8') + '\n…(konteks peta kode dipotong)';
  return { markdown: md, impact, changedSymbols: summary };
}
