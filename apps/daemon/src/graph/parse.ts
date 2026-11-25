import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

export type Lang = 'ts' | 'tsx' | 'js' | 'vue' | 'py' | 'go' | 'dart' | 'other';
export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'variable' | 'component' | 'route';
export type EdgeKind = 'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'renders' | 'tests';

export interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number; // 1-based
  endLine: number;
  exported: boolean;
  signature: string;
  doc: string;
}

export interface ParsedRef {
  /** qualifiedName simbol pemanggil di file ini, null = level file */
  from: string | null;
  toName: string;
  kind: EdgeKind;
  line: number;
  /** objek pada member call (`obj.method`) */
  receiver?: string | null;
}

export interface ParsedImport {
  source: string;
  /** nama lokal → nama yang diekspor di sumber ('*' = namespace, 'default') */
  names: { local: string; imported: string }[];
  line: number;
  reexport: boolean;
}

export interface ParsedFile {
  lang: Lang;
  loc: number;
  symbols: ParsedSymbol[];
  refs: ParsedRef[];
  imports: ParsedImport[];
}

export function langOf(path: string): Lang {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return ext === 'jsx' ? 'tsx' : 'js';
  if (ext === 'vue') return 'vue';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'dart') return 'dart';
  return 'other';
}

const GRAMMAR: Record<string, string> = {
  ts: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
};

let ready: Promise<void> | null = null;
const parsers = new Map<string, Parser>();

export async function initParsers() {
  if (!ready) {
    ready = (async () => {
      await Parser.init();
      for (const [k, f] of Object.entries(GRAMMAR)) {
        const lang = await Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/${f}`));
        const p = new Parser();
        p.setLanguage(lang);
        parsers.set(k, p);
      }
      // Dart (Flutter): grammar dari @repomix/tree-sitter-wasms (ABI cocok dengan web-tree-sitter 0.27)
      const dart = await Language.load(require.resolve('@repomix/tree-sitter-wasms/out/tree-sitter-dart.wasm'));
      const dp = new Parser();
      dp.setLanguage(dart);
      parsers.set('dart', dp);
    })();
  }
  return ready;
}

const firstLine = (s: string) => s.split('\n')[0].trim().slice(0, 200);
const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

function signatureOf(n: Node): string {
  const body = n.childForFieldName('body');
  const text = body ? n.text.slice(0, body.startIndex - n.startIndex) : n.text;
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[{:]\s*$/, '')
    .trim()
    .slice(0, 300);
}

function docOf(n: Node): string {
  let p = n.previousSibling;
  if (n.parent?.type === 'export_statement') p = n.parent.previousSibling;
  if (p && p.type === 'comment')
    return p.text
      .replace(/^\/\*\*?|\*\/$|^\s*\*\s?|^\/\/\s?|^#\s?/gm, '')
      .trim()
      .slice(0, 300);
  return '';
}

/** Ekstrak blok <script> dari Vue SFC; baris dihitung relatif ke file asli. */
export function vueScript(src: string): { code: string; lineOffset: number; lang: 'ts' | 'js' } | null {
  const m = /<script\b([^>]*)>([\s\S]*?)<\/script>/i.exec(src);
  if (!m) return null;
  const before = src.slice(0, m.index + m[0].indexOf('>') + 1);
  const lineOffset = before.split('\n').length - 1;
  return { code: m[2], lineOffset, lang: /lang=["']ts["']/.test(m[1]) ? 'ts' : 'js' };
}

export async function parseFile(path: string, source: string): Promise<ParsedFile> {
  await initParsers();
  const lang = langOf(path);
  const loc = source.split('\n').length;
  const out: ParsedFile = { lang, loc, symbols: [], refs: [], imports: [] };
  if (lang === 'other') return out;
  let code = source;
  let offset = 0;
  let grammar: string = lang;
  if (lang === 'vue') {
    const s = vueScript(source);
    const base = path
      .split('/')
      .pop()!
      .replace(/\.vue$/, '');
    out.symbols.push({
      name: base,
      qualifiedName: base,
      kind: 'component',
      startLine: 1,
      endLine: loc,
      exported: true,
      signature: `<${base}>`,
      doc: '',
    });
    if (!s) return out;
    code = s.code;
    offset = s.lineOffset;
    grammar = s.lang;
  }
  const parser = parsers.get(grammar)!;
  const tree = parser.parse(code);
  if (!tree) return out;
  const ctx: WalkCtx = {
    out,
    offset,
    lang,
    isTsx: lang === 'tsx',
    vueComponent: lang === 'vue' ? out.symbols[0].qualifiedName : null,
  };
  if (lang === 'py') walkPy(tree.rootNode, ctx, null, null);
  else if (lang === 'go') walkGo(tree.rootNode, ctx);
  else if (lang === 'dart') walkDart(tree.rootNode, ctx);
  else walkJs(tree.rootNode, ctx, null, null, false);
  tree.delete();
  return out;
}

interface WalkCtx {
  out: ParsedFile;
  offset: number;
  lang: Lang;
  isTsx: boolean;
  vueComponent: string | null;
}

function addSym(ctx: WalkCtx, n: Node, name: string, qualifiedName: string, kind: SymbolKind, exported: boolean) {
  ctx.out.symbols.push({
    name,
    qualifiedName,
    kind,
    startLine: line(n) + ctx.offset,
    endLine: endLine(n) + ctx.offset,
    exported,
    signature: signatureOf(n) || firstLine(n.text),
    doc: docOf(n),
  });
}

function addRef(
  ctx: WalkCtx,
  from: string | null,
  toName: string,
  kind: EdgeKind,
  n: Node,
  receiver: string | null = null,
) {
  if (!toName) return;
  ctx.out.refs.push({ from: from ?? ctx.vueComponent, toName, kind, line: line(n) + ctx.offset, receiver });
}

const isUpper = (s: string) => /^[A-Z]/.test(s);
const strip = (s: string) => s.replace(/^['"`]|['"`]$/g, '');

// ---------------- JS / TS / TSX ----------------

function walkJs(n: Node, ctx: WalkCtx, scope: string | null, cls: string | null, exported: boolean) {
  const t = n.type;
  if (t === 'export_statement') {
    const src = n.childForFieldName('source');
    if (src) {
      // export { a, b as c } from './x'  /  export * from './x'
      const names: ParsedImport['names'] = [];
      for (const spec of n.descendantsOfType('export_specifier')) {
        if (!spec) continue;
        const name = spec.childForFieldName('name')?.text ?? '';
        const alias = spec.childForFieldName('alias')?.text ?? name;
        names.push({ local: alias, imported: name });
      }
      if (!names.length) names.push({ local: '*', imported: '*' });
      ctx.out.imports.push({ source: strip(src.text), names, line: line(n) + ctx.offset, reexport: true });
      return;
    }
    for (const c of n.namedChildren) if (c) walkJs(c, ctx, scope, cls, true);
    return;
  }
  if (t === 'import_statement') {
    const src = n.childForFieldName('source');
    const names: ParsedImport['names'] = [];
    const clause = n.namedChildren.find((c) => c?.type === 'import_clause');
    if (clause) {
      for (const c of clause.namedChildren) {
        if (!c) continue;
        if (c.type === 'identifier') names.push({ local: c.text, imported: 'default' });
        else if (c.type === 'namespace_import') names.push({ local: c.namedChildren[0]?.text ?? '', imported: '*' });
        else if (c.type === 'named_imports')
          for (const s of c.namedChildren) {
            if (s?.type !== 'import_specifier') continue;
            const name = s.childForFieldName('name')?.text ?? '';
            names.push({ local: s.childForFieldName('alias')?.text ?? name, imported: name });
          }
      }
    }
    if (src) {
      ctx.out.imports.push({ source: strip(src.text), names, line: line(n) + ctx.offset, reexport: false });
      addRef(ctx, null, strip(src.text), 'imports', n);
    }
    return;
  }
  if (t === 'function_declaration' || t === 'generator_function_declaration') {
    const name = n.childForFieldName('name')?.text ?? '';
    const kind: SymbolKind = (ctx.isTsx || ctx.lang === 'tsx') && isUpper(name) ? 'component' : 'function';
    addSym(ctx, n, name, name, kind, exported);
    for (const c of n.namedChildren) if (c) walkJs(c, ctx, name, null, false);
    return;
  }
  if (t === 'class_declaration' || t === 'abstract_class_declaration') {
    const name = n.childForFieldName('name')?.text ?? '';
    addSym(ctx, n, name, name, 'class', exported);
    for (const h of n.descendantsOfType(['extends_clause', 'class_heritage'])) {
      if (!h) continue;
      const v = h.childForFieldName('value') ?? h.namedChildren[0];
      if (v && h.type === 'extends_clause') addRef(ctx, name, v.text.split('<')[0], 'extends', h);
      if (h.type === 'class_heritage' && ctx.lang === 'js')
        addRef(ctx, name, h.namedChildren[0]?.text ?? '', 'extends', h);
    }
    for (const h of n.descendantsOfType('implements_clause'))
      for (const c of h?.namedChildren ?? []) if (c) addRef(ctx, name, c.text.split('<')[0], 'implements', h!);
    const body = n.childForFieldName('body');
    if (body) for (const c of body.namedChildren) if (c) walkJs(c, ctx, name, name, false);
    return;
  }
  if (t === 'method_definition' && cls) {
    const name = n.childForFieldName('name')?.text ?? '';
    const q = `${cls}.${name}`;
    addSym(ctx, n, name, q, 'method', false);
    for (const c of n.namedChildren) if (c) walkJs(c, ctx, q, null, false);
    return;
  }
  if (t === 'interface_declaration') {
    const name = n.childForFieldName('name')?.text ?? '';
    addSym(ctx, n, name, name, 'interface', exported);
    return;
  }
  if (t === 'type_alias_declaration') {
    const name = n.childForFieldName('name')?.text ?? '';
    addSym(ctx, n, name, name, 'type', exported);
    return;
  }
  if ((t === 'lexical_declaration' || t === 'variable_declaration') && scope === null) {
    for (const d of n.namedChildren) {
      if (d?.type !== 'variable_declarator') continue;
      const nameNode = d.childForFieldName('name');
      const value = d.childForFieldName('value');
      // const { a } = require('x')
      if (value?.type === 'call_expression' && value.childForFieldName('function')?.text === 'require') {
        const arg = value.childForFieldName('arguments')?.namedChildren[0];
        if (arg) {
          const names: ParsedImport['names'] = [];
          if (nameNode?.type === 'identifier') names.push({ local: nameNode.text, imported: 'default' });
          else if (nameNode)
            for (const p of nameNode.namedChildren) {
              if (!p) continue;
              if (p.type === 'shorthand_property_identifier_pattern') names.push({ local: p.text, imported: p.text });
              else if (p.type === 'pair_pattern')
                names.push({
                  local: p.childForFieldName('value')?.text ?? '',
                  imported: p.childForFieldName('key')?.text ?? '',
                });
            }
          ctx.out.imports.push({ source: strip(arg.text), names, line: line(n) + ctx.offset, reexport: false });
          addRef(ctx, null, strip(arg.text), 'imports', n);
        }
        continue;
      }
      if (nameNode?.type !== 'identifier') {
        if (value) walkJs(value, ctx, scope, cls, false);
        continue;
      }
      const name = nameNode.text;
      const isFn = value && ['arrow_function', 'function_expression', 'function'].includes(value.type);
      const kind: SymbolKind = isFn
        ? (ctx.isTsx || ctx.lang === 'tsx') && isUpper(name)
          ? 'component'
          : 'function'
        : 'variable';
      addSym(ctx, isFn ? d : n, name, name, kind, exported);
      if (value) walkJs(value, ctx, isFn ? name : scope, cls, false);
    }
    return;
  }
  if (t === 'call_expression' || t === 'new_expression') {
    const fn = n.childForFieldName(t === 'call_expression' ? 'function' : 'constructor');
    if (fn) {
      if (fn.type === 'identifier') {
        if (fn.text !== 'require') addRef(ctx, scope, fn.text, 'calls', n);
      } else if (fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')?.text ?? '';
        const obj = fn.childForFieldName('object')?.text ?? null;
        addRef(ctx, scope, prop, 'calls', n, obj);
      }
    }
  }
  if (t === 'jsx_opening_element' || t === 'jsx_self_closing_element') {
    const name = n.childForFieldName('name')?.text ?? '';
    if (isUpper(name)) addRef(ctx, scope, name, 'renders', n);
  }
  for (const c of n.namedChildren) if (c) walkJs(c, ctx, scope, cls, false);
}

// ---------------- Python ----------------

function walkPy(n: Node, ctx: WalkCtx, scope: string | null, cls: string | null) {
  const t = n.type;
  if (t === 'function_definition') {
    const name = n.childForFieldName('name')?.text ?? '';
    const q = cls ? `${cls}.${name}` : name;
    addSym(ctx, n, name, q, cls ? 'method' : 'function', !name.startsWith('_'));
    const body = n.childForFieldName('body');
    if (body) walkPy(body, ctx, q, null);
    return;
  }
  if (t === 'class_definition') {
    const name = n.childForFieldName('name')?.text ?? '';
    addSym(ctx, n, name, name, 'class', !name.startsWith('_'));
    const sup = n.childForFieldName('superclasses');
    for (const s of sup?.namedChildren ?? []) if (s && s.type === 'identifier') addRef(ctx, name, s.text, 'extends', s);
    const body = n.childForFieldName('body');
    if (body) walkPy(body, ctx, name, name);
    return;
  }
  if (t === 'import_from_statement') {
    const mod = n.childForFieldName('module_name')?.text ?? '';
    const names: ParsedImport['names'] = [];
    for (const c of n.childrenForFieldName('name')) {
      if (!c) continue;
      if (c.type === 'aliased_import')
        names.push({
          local: c.childForFieldName('alias')?.text ?? '',
          imported: c.childForFieldName('name')?.text ?? '',
        });
      else names.push({ local: c.text, imported: c.text });
    }
    ctx.out.imports.push({ source: mod, names, line: line(n) + ctx.offset, reexport: false });
    addRef(ctx, null, mod, 'imports', n);
    return;
  }
  if (t === 'import_statement') {
    for (const c of n.namedChildren) {
      if (!c) continue;
      const mod = c.type === 'aliased_import' ? (c.childForFieldName('name')?.text ?? '') : c.text;
      const local = c.type === 'aliased_import' ? (c.childForFieldName('alias')?.text ?? mod) : mod.split('.').pop()!;
      ctx.out.imports.push({
        source: mod,
        names: [{ local, imported: '*' }],
        line: line(n) + ctx.offset,
        reexport: false,
      });
      addRef(ctx, null, mod, 'imports', n);
    }
    return;
  }
  if (t === 'call') {
    const fn = n.childForFieldName('function');
    if (fn?.type === 'identifier') addRef(ctx, scope, fn.text, 'calls', n);
    else if (fn?.type === 'attribute')
      addRef(
        ctx,
        scope,
        fn.childForFieldName('attribute')?.text ?? '',
        'calls',
        n,
        fn.childForFieldName('object')?.text ?? null,
      );
  }
  for (const c of n.namedChildren) if (c) walkPy(c, ctx, scope, cls);
}

// ---------------- Go ----------------

function walkGo(root: Node, ctx: WalkCtx) {
  const visit = (n: Node, scope: string | null) => {
    const t = n.type;
    if (t === 'function_declaration') {
      const name = n.childForFieldName('name')?.text ?? '';
      addSym(ctx, n, name, name, 'function', isUpper(name));
      const body = n.childForFieldName('body');
      if (body) visit(body, name);
      return;
    }
    if (t === 'method_declaration') {
      const name = n.childForFieldName('name')?.text ?? '';
      const recv = n.childForFieldName('receiver')?.text ?? '';
      const typ = /\*?\s*([A-Za-z_]\w*)\s*\)$/.exec(recv)?.[1] ?? '';
      const q = typ ? `${typ}.${name}` : name;
      addSym(ctx, n, name, q, 'method', isUpper(name));
      const body = n.childForFieldName('body');
      if (body) visit(body, q);
      return;
    }
    if (t === 'type_spec') {
      const name = n.childForFieldName('name')?.text ?? '';
      const ty = n.childForFieldName('type');
      const kind: SymbolKind =
        ty?.type === 'interface_type' ? 'interface' : ty?.type === 'struct_type' ? 'class' : 'type';
      addSym(ctx, n, name, name, kind, isUpper(name));
      return;
    }
    if (t === 'import_spec') {
      const p = strip(n.childForFieldName('path')?.text ?? '');
      const alias = n.childForFieldName('name')?.text ?? p.split('/').pop()!;
      ctx.out.imports.push({
        source: p,
        names: [{ local: alias, imported: '*' }],
        line: line(n) + ctx.offset,
        reexport: false,
      });
      addRef(ctx, null, p, 'imports', n);
      return;
    }
    if (t === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') addRef(ctx, scope, fn.text, 'calls', n);
      else if (fn?.type === 'selector_expression')
        addRef(
          ctx,
          scope,
          fn.childForFieldName('field')?.text ?? '',
          'calls',
          n,
          fn.childForFieldName('operand')?.text ?? null,
        );
    }
    for (const c of n.namedChildren) if (c) visit(c, scope);
  };
  visit(root, null);
}

// ---------------- Dart (Flutter) ----------------

/** Kelas dasar widget Flutter (dan turunan umum Riverpod/Hooks/Bloc) → simbol berjenis `component`. */
const DART_WIDGET_BASES = new Set([
  'StatelessWidget',
  'StatefulWidget',
  'ConsumerWidget',
  'ConsumerStatefulWidget',
  'HookWidget',
  'HookConsumerWidget',
  'InheritedWidget',
  'InheritedNotifier',
  'InheritedModel',
  'RenderObjectWidget',
  'LeafRenderObjectWidget',
  'SingleChildRenderObjectWidget',
  'MultiChildRenderObjectWidget',
  'ProxyWidget',
  'ImplicitlyAnimatedWidget',
  'AnimatedWidget',
]);

const dartPublic = (name: string) => !!name && !name.startsWith('_');
const kid = (n: Node, type: string) => n.namedChildren.find((c) => c?.type === type) ?? null;
const kids = (n: Node, type: string) => n.namedChildren.filter((c): c is Node => !!c && c.type === type);
const dartUri = (n: Node) => strip(kid(n, 'configurable_uri')?.text ?? kid(n, 'uri')?.text ?? '');

/** Doc comment `///` tepat di atas deklarasi (anotasi seperti @override dilewati). */
function dartDoc(n: Node): string {
  const lines: string[] = [];
  // konstanta top-level: komentar menempel di atas `const`/`final` milik daftar deklarasinya
  let p = n.previousSibling ?? (n.parent && /declaration_list$/.test(n.parent.type) ? n.parent.previousSibling : null);
  while (p && ['annotation', 'documentation_comment', 'comment', 'const_builtin', 'final_builtin'].includes(p.type)) {
    if (p.type === 'documentation_comment')
      lines.unshift(p.text.replace(/^\s*\/\/\/\s?/gm, '').replace(/^\/\*\*|\*\/$/g, ''));
    else if (p.type === 'comment' && lines.length) break;
    p = p.previousSibling;
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function addDartSym(
  ctx: WalkCtx,
  start: Node,
  end: Node,
  name: string,
  qualifiedName: string,
  kind: SymbolKind,
  signature?: string,
) {
  if (!name) return;
  ctx.out.symbols.push({
    name,
    qualifiedName,
    kind,
    startLine: line(start) + ctx.offset,
    endLine: endLine(end) + ctx.offset,
    exported: dartPublic(name),
    signature: (signature ?? firstLine(start.text))
      .replace(/\s+/g, ' ')
      .replace(/[{=]>?\s*$/, '')
      .trim()
      .slice(0, 300),
    doc: dartDoc(start),
  });
}

/** Nama yang dideklarasikan sebuah signature method/fungsi (null = konstruktor biasa / tidak dikenal). */
function dartSigName(sig: Node): { name: string; kind: 'method' | 'getter' | 'factory' | 'operator' } | null {
  const inner =
    sig.type === 'method_signature' || sig.type === 'declaration'
      ? (sig.namedChildren.find((c) => c && /signature$/.test(c.type)) ?? sig)
      : sig;
  switch (inner.type) {
    case 'function_signature':
      return { name: kid(inner, 'identifier')?.text ?? '', kind: 'method' };
    case 'getter_signature':
    case 'setter_signature':
      return { name: kid(inner, 'identifier')?.text ?? '', kind: 'getter' };
    case 'factory_constructor_signature': {
      const ids = kids(inner, 'identifier');
      return { name: ids.map((i) => i.text).join('.'), kind: 'factory' };
    }
    case 'operator_signature':
      return { name: 'operator', kind: 'operator' };
    default:
      return null;
  }
}

/**
 * Pemanggilan di dalam badan fungsi: `identifier` diikuti rangkaian `selector`. Selector `.nama` menambah rantai,
 * selector berisi `argument_part` adalah panggilan ke nama terakhir (penerima = rantai sebelumnya).
 */
function dartRefs(n: Node, ctx: WalkCtx, scope: string | null, inBuild: boolean) {
  const cs = n.namedChildren.filter((c): c is Node => !!c);
  let chain: string[] = [];
  for (const c of cs) {
    // `const Text('x')` / `new Foo.named()` — bentuk paling umum untuk widget Flutter
    if (c.type === 'const_object_expression' || c.type === 'new_expression') {
      const type = kid(c, 'type_identifier')?.text;
      if (type) addRef(ctx, scope, type, inBuild ? 'renders' : 'calls', c);
      chain = [];
      dartRefs(c, ctx, scope, inBuild);
      continue;
    }
    if (c.type === 'identifier' || c.type === 'this' || c.type === 'super') {
      chain = [c.text];
      continue;
    }
    if (c.type === 'selector' && chain.length) {
      const member = c.namedChildren.find((x) => x && /assignable_selector$/.test(x.type));
      const memberName = member ? kid(member, 'identifier')?.text : null;
      if (memberName) {
        chain.push(memberName);
        continue;
      }
      if (kid(c, 'argument_part')) {
        const callee = chain[chain.length - 1];
        const receiver = chain.length > 1 ? chain.slice(0, -1).join('.') : null;
        if (callee && callee !== 'this' && callee !== 'super') {
          const kind: EdgeKind = !receiver && inBuild && isUpper(callee) ? 'renders' : 'calls';
          addRef(ctx, scope, callee, kind, c, receiver);
        }
        dartRefs(c, ctx, scope, inBuild); // argumen bisa berisi panggilan lain
        continue;
      }
    }
    if (c.type !== 'selector') chain = [];
    dartRefs(c, ctx, scope, inBuild);
  }
}

function dartTypeRefs(ctx: WalkCtx, owner: string, n: Node | null, kind: EdgeKind) {
  if (!n) return;
  for (const t of kids(n, 'type_identifier')) addRef(ctx, owner, t.text, kind, t);
}

/** Anggota kelas/mixin/extension: method, getter/setter, factory, operator; badan method dipindai untuk pemanggilan. */
function walkDartMembers(body: Node | null, ctx: WalkCtx, owner: string) {
  if (!body) return;
  const cs = body.namedChildren.filter((c): c is Node => !!c);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.type !== 'method_signature' && c.type !== 'declaration') continue;
    const next = cs[i + 1]?.type === 'function_body' ? cs[i + 1] : null;
    const sig = dartSigName(c);
    if (!sig?.name) {
      // konstruktor biasa / field: badan initializer tetap dipindai di bawah
      if (next) dartRefs(next, ctx, owner, false);
      continue;
    }
    const q = `${owner}.${sig.name}`;
    addDartSym(ctx, c, next ?? c, sig.name.split('.').pop()!, q, 'method');
    if (next) dartRefs(next, ctx, q, sig.name === 'build');
  }
}

function dartImport(ctx: WalkCtx, n: Node, reexport: boolean) {
  const spec = reexport ? n : (kid(n, 'import_specification') ?? n);
  const source = dartUri(spec);
  if (!source || source.startsWith('dart:')) return;
  const prefix = kids(spec, 'identifier')[0]?.text ?? null; // `as prefix`
  const show = spec.namedChildren.find((c) => c?.type === 'combinator' && c.text.startsWith('show'));
  const names: ParsedImport['names'] = prefix
    ? [{ local: prefix, imported: '*' }]
    : show
      ? kids(show, 'identifier').map((i) => ({ local: i.text, imported: i.text }))
      : [{ local: '*', imported: '*' }];
  ctx.out.imports.push({ source, names, line: line(n) + ctx.offset, reexport });
  addRef(ctx, null, source, 'imports', n);
}

function walkDart(root: Node, ctx: WalkCtx) {
  const cs = root.namedChildren.filter((c): c is Node => !!c);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    switch (c.type) {
      case 'import_or_export': {
        const imp = kid(c, 'library_import');
        const exp = kid(c, 'library_export');
        if (imp) dartImport(ctx, imp, false);
        if (exp) dartImport(ctx, exp, true);
        break;
      }
      case 'part_directive': {
        // file `part` adalah bagian library ini: simbolnya terlihat dari sini (diperlakukan seperti export *)
        const src = strip(kid(c, 'uri')?.text ?? '');
        if (src)
          ctx.out.imports.push({
            source: src,
            names: [{ local: '*', imported: '*' }],
            line: line(c) + ctx.offset,
            reexport: true,
          });
        break;
      }
      case 'class_definition': {
        const name = kid(c, 'identifier')?.text ?? '';
        const sup = kid(c, 'superclass');
        const base = sup ? kid(sup, 'type_identifier')?.text : null;
        const kind: SymbolKind = base && DART_WIDGET_BASES.has(base) ? 'component' : 'class';
        addDartSym(ctx, c, c, name, name, kind, `class ${name}${base ? ` extends ${base}` : ''}`);
        if (base) addRef(ctx, name, base, 'extends', sup!);
        if (sup) dartTypeRefs(ctx, name, kid(sup, 'mixins'), 'references');
        dartTypeRefs(ctx, name, kid(c, 'interfaces'), 'implements');
        walkDartMembers(kid(c, 'class_body'), ctx, name);
        break;
      }
      case 'mixin_declaration':
      case 'extension_declaration': {
        const name = kid(c, 'identifier')?.text ?? '';
        addDartSym(ctx, c, c, name, name, 'class');
        walkDartMembers(kid(c, 'class_body') ?? kid(c, 'extension_body'), ctx, name);
        break;
      }
      case 'enum_declaration':
        addDartSym(ctx, c, c, kid(c, 'identifier')?.text ?? '', kid(c, 'identifier')?.text ?? '', 'type');
        walkDartMembers(kid(c, 'enum_body'), ctx, kid(c, 'identifier')?.text ?? '');
        break;
      case 'type_alias': {
        const name = kid(c, 'type_identifier')?.text ?? '';
        addDartSym(ctx, c, c, name, name, 'type');
        break;
      }
      case 'function_signature':
      case 'getter_signature':
      case 'setter_signature': {
        const name = kid(c, 'identifier')?.text ?? '';
        const body = cs[i + 1]?.type === 'function_body' ? cs[i + 1] : null;
        addDartSym(ctx, c, body ?? c, name, name, 'function');
        if (body) dartRefs(body, ctx, name, false);
        break;
      }
      case 'static_final_declaration_list':
      case 'initialized_identifier_list':
        for (const d of c.namedChildren) {
          const id = d ? kid(d, 'identifier') : null;
          if (d && id) {
            addDartSym(ctx, d, d, id.text, id.text, 'variable');
            dartRefs(d, ctx, id.text, false);
          }
        }
        break;
      default:
        break;
    }
  }
}
