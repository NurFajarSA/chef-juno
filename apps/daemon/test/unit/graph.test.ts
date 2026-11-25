import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFixtureRepo, type FixtureRepo } from '../../../../scripts/lib/fixture-repo.mjs';
import { GraphStore } from '../../src/graph/store.js';
import { Indexer } from '../../src/graph/indexer.js';
import { GraphQuery } from '../../src/graph/query.js';
import { buildGraphContext } from '../../src/graph/context.js';
import { graphTools } from '../../src/graph/mcp.js';

let repo: FixtureRepo;
let store: GraphStore;
let q: GraphQuery;
const dbFile = () => join(repo.root, 'graph.db');

const callersOf = (name: string, depth = 1) => {
  const s = q.findSymbol(name)[0];
  return q
    .callers(s.id, depth)
    .map((c) => `${c.symbol?.qualifiedName ?? '-'}@${c.file}`)
    .sort();
};
const calleesOf = (name: string) => {
  const s = q.findSymbol(name)[0];
  return q
    .callees(s.id, 1)
    .map((c) => `${c.symbol!.qualifiedName}@${c.symbol!.file}`)
    .sort();
};

beforeAll(async () => {
  repo = createFixtureRepo();
  store = new GraphStore(dbFile());
  await new Indexer(store, repo.work).full(repo.baseSha);
  q = new GraphQuery(store);
});
afterAll(() => store?.close());

describe('(a) simbol & edge fixture sesuai jawaban', () => {
  it('simbol per bahasa', () => {
    const outline = (f: string) => q.outline(f).map((s) => `${s.qualifiedName}:${s.kind}${s.exported ? ':exp' : ''}`);
    expect(outline('src/api/user.ts')).toEqual([
      'User:interface:exp',
      'fetchUser:function:exp',
      'parseUser:function:exp',
    ]);
    expect(outline('src/services/profile.ts')).toEqual([
      'loadProfile:function:exp',
      'formatName:function',
      'ProfileService:class:exp',
      'ProfileService.display:method',
    ]);
    expect(outline('src/components/ProfileCard.tsx')).toEqual(['ProfileCard:component:exp']);
    expect(outline('src/components/Avatar.tsx')).toEqual(['Avatar:component:exp']);
    expect(outline('web/UserBadge.vue')).toEqual(
      expect.arrayContaining(['UserBadge:component:exp', 'refresh:function']),
    );
    expect(outline('py/app/users.py')).toEqual([
      'UserRepo:class:exp',
      'UserRepo.get:method:exp',
      'get_user:function:exp',
      'greet:function:exp',
    ]);
    expect(outline('go/users/users.go')).toEqual(['User:class:exp', 'GetUser:function:exp', 'Greet:function:exp']);
  });

  it('caller fetchUser lintas file via import (TS, JS require, Vue, test), lewat re-export index', () => {
    expect(callersOf('fetchUser')).toEqual([
      '-@src/api/user.test.ts',
      'loadProfile@src/services/profile.ts',
      'refresh@web/UserBadge.vue',
      'userSlug@src/legacy/helpers.js',
    ]);
    expect(callersOf('fetchUser', 2)).toEqual(
      expect.arrayContaining([
        'ProfileCard@src/components/ProfileCard.tsx',
        'ProfileService.display@src/services/profile.ts',
      ]),
    );
  });

  it('caller lintas file via import untuk Python (from app.users import) dan Go (paket users)', () => {
    expect(callersOf('get_user')).toEqual(['greet@py/app/users.py', 'profile_name@py/app/service.py']);
    expect(callersOf('GetUser')).toEqual(['Greet@go/users/users.go', 'ProfileName@go/handlers/profile.go']);
    const resolved = (n: string) => q.callers(q.findSymbol(n)[0].id, 1).every((c) => c.resolved);
    expect(resolved('get_user') && resolved('GetUser')).toBe(true);
  });

  it('callee per fungsi', () => {
    expect(calleesOf('fetchUser')).toEqual(['parseUser@src/api/user.ts']);
    expect(calleesOf('loadProfile')).toEqual(['fetchUser@src/api/user.ts', 'formatName@src/services/profile.ts']);
    expect(calleesOf('ProfileCard')).toEqual([
      'Avatar@src/components/Avatar.tsx',
      'loadProfile@src/services/profile.ts',
    ]);
    expect(calleesOf('greet')).toEqual(['get_user@py/app/users.py']);
    expect(calleesOf('Greet')).toEqual(['GetUser@go/users/users.go']);
    expect(calleesOf('userSlug')).toEqual(['fetchUser@src/api/user.ts', 'slugify@src/legacy/helpers.js']);
  });

  it('komponen: renders edge ProfileCard → Avatar; test edge ke fetchUser', () => {
    const av = q.findSymbol('Avatar')[0];
    expect(q.references(av.id).map((r) => r.kind)).toContain('renders');
    expect(q.tests(q.findSymbol('fetchUser')[0].id)).toEqual([{ file: 'src/api/user.test.ts', line: 4 }]);
  });

  it('edge tidak pasti tetap disimpan dengan resolved=false (tidak dibuang)', () => {
    const n = (
      store.db.prepare("SELECT COUNT(*) n FROM edges WHERE resolved = 0 AND kind = 'calls'").get() as { n: number }
    ).n;
    expect(n).toBeGreaterThan(0);
    const st = new Indexer(store, repo.work).stats(0, 0);
    expect(st.resolvedEdgePct).toBeGreaterThan(0);
    expect(st.resolvedEdgePct).toBeLessThan(1);
    expect(st.languages).toEqual({ go: 2, js: 1, py: 2, ts: 4, tsx: 2, vue: 1 });
  });

  it('modul & dependensi antar modul', () => {
    const g = q.moduleGraph();
    expect(g.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining(['src/api', 'src/services', 'src/components', 'src/legacy', 'web', 'py', 'go']),
    );
    const e = g.edges.map((x) => `${x.from}→${x.to}`);
    expect(e).toEqual(
      expect.arrayContaining([
        'src/services→src/api',
        'src/components→src/services',
        'src/legacy→src/api',
        'web→src/api',
      ]),
    );
  });
});

describe('(b) incremental', () => {
  it('ubah 1 file → hanya file itu di-parse ulang; edge terkait diperbarui', async () => {
    const s2 = new GraphStore(join(repo.root, 'inc.db'));
    const ix = new Indexer(s2, repo.work);
    await ix.full(repo.baseSha);
    const before = new GraphQuery(s2).callers(new GraphQuery(s2).findSymbol('slugify')[0].id, 1).length;
    const sha = repo.commit(
      {
        'src/legacy/helpers.js':
          "const { fetchUser } = require('../api/user');\n\nfunction slugify(text) {\n  return text.toLowerCase();\n}\n\nasync function userSlug(id) {\n  const u = await fetchUser(id);\n  return u ? slugify(u.name) + slugify(u.id) : '';\n}\n\nfunction kebab(t) {\n  return slugify(t);\n}\n\nmodule.exports = { slugify, userSlug, kebab };\n",
      },
      'feat: kebab',
    );
    const r = await ix.incremental(repo.baseSha, sha);
    expect(r.changed).toEqual(['src/legacy/helpers.js']);
    expect(r.parsedFiles).toBe(1);
    const q2 = new GraphQuery(s2);
    // userSlug memanggil slugify dua kali di baris yang sama (dihitung satu), kebab menambah satu caller
    expect(q2.callers(q2.findSymbol('slugify')[0].id, 1).length).toBe(before + 1);
    expect(callersOfStore(q2, 'slugify')).toContain('kebab@src/legacy/helpers.js');
    expect(q2.findSymbol('kebab')).toHaveLength(1);
    // edge lintas file ke fetchUser tetap ter-resolve ke simbol baru
    expect(callersOfStore(q2, 'fetchUser')).toContain('userSlug@src/legacy/helpers.js');
    expect(s2.getMeta('indexedSha')).toBe(sha);
    s2.close();
  });
});

function callersOfStore(qq: GraphQuery, name: string) {
  return qq.callers(qq.findSymbol(name)[0].id, 1).map((c) => `${c.symbol?.qualifiedName ?? '-'}@${c.file}`);
}

describe('(c) konteks review untuk diff fixture', () => {
  it('memuat caller yang benar & peringatan perubahan signature fetchUser', async () => {
    const s3 = new GraphStore(join(repo.root, 'ctx.db'));
    const wt = mkdtempSync(join(tmpdir(), 'cj-wt-'));
    execFileSync('git', ['clone', '-q', repo.bare, wt]);
    execFileSync('git', ['checkout', '-q', repo.headSha], { cwd: wt });
    await new Indexer(s3, wt).full(repo.headSha);
    const diff = execFileSync('git', ['diff', `${repo.baseSha}...${repo.headSha}`], { cwd: wt, encoding: 'utf8' });
    const g = await buildGraphContext(s3, {
      diff,
      worktree: wt,
      baseContent: async (p) => {
        try {
          return execFileSync('git', ['show', `${repo.baseSha}:${p}`], { cwd: wt, encoding: 'utf8' });
        } catch {
          return null;
        }
      },
    });
    expect(g.markdown).toContain('## Konteks dari peta kode');
    expect(g.markdown).toContain('Signature lama: `async function fetchUser(id: string): Promise<User | null>`');
    expect(g.markdown).toContain(
      'Signature baru: `async function fetchUser(id: string, opts: FetchOptions = {}): Promise<User | null>`',
    );
    for (const c of [
      '`loadProfile` di src/services/profile.ts:4',
      '`userSlug` di src/legacy/helpers.js:8',
      '`refresh` di web/UserBadge.vue:13',
    ])
      expect(g.markdown).toContain(c);
    expect(g.impact).toContain('fungsi `fetchUser` dipakai di 4 tempat; signature berubah — cek semua pemanggil.');
    expect(g.markdown).toContain('Test: src/api/user.test.ts:4');
    expect(Buffer.byteLength(g.markdown)).toBeLessThanOrEqual(40_000 + 100);
    s3.close();
  });
});

describe('(d) server MCP graph', () => {
  it('setiap tool menjawab benar (langsung)', () => {
    const t = graphTools(store);
    expect(t.find_symbol.run({ name: 'fetchUser' })[0]).toMatchObject({
      name: 'fetchUser',
      file: 'src/api/user.ts',
      kind: 'function',
    });
    expect(
      t.get_callers
        .run({ name: 'fetchUser', depth: 1 })
        .map((x) => String(x.symbol))
        .sort(),
    ).toEqual(['loadProfile', 'null', 'refresh', 'userSlug']);
    expect(
      t.get_callees
        .run({ name: 'loadProfile' })
        .map((x) => x.symbol)
        .sort(),
    ).toEqual(['fetchUser', 'formatName']);
    expect(t.get_references.run({ name: 'Avatar' }).map((x) => x.kind)).toContain('renders');
    expect(t.get_file_outline.run({ path: 'go/users/users.go' }).map((x) => x!.name)).toEqual([
      'User',
      'GetUser',
      'Greet',
    ]);
    expect(t.search_code_symbols.run({ query: 'slugify' }).map((x) => x!.name)).toContain('slugify');
    expect(t.get_module_summary.run({ module: 'src/api' }).exports).toEqual(
      expect.arrayContaining(['fetchUser', 'parseUser', 'User']),
    );
    const imp = t.get_impact.run({ path: 'src/api/user.ts', line: 10 });
    expect(imp.symbol!.name).toBe('fetchUser');
    expect(imp.callers.length).toBeGreaterThanOrEqual(4);
    expect(imp.tests).toEqual([{ file: 'src/api/user.test.ts', line: 4 }]);
  });

  it('server stdio `chefjuno graph-mcp` menjawab lewat protokol MCP', async () => {
    const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, 'graph-mcp', '--db', dbFile(), '--root', repo.work],
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'find_symbol',
      'get_callees',
      'get_callers',
      'get_file_outline',
      'get_impact',
      'get_module_summary',
      'get_references',
      'search_code_symbols',
    ]);
    const r = await client.callTool({ name: 'get_callers', arguments: { name: 'get_user' } });
    const text = (r.content as { type: string; text: string }[])[0].text;
    expect(
      JSON.parse(text)
        .map((x: { symbol: string; file: string }) => `${x.symbol}@${x.file}`)
        .sort(),
    ).toEqual(['greet@py/app/users.py', 'profile_name@py/app/service.py']);
    await client.close();
  });
});

describe('(e) target performa (fixture sintetis)', () => {
  it('index penuh ±2.000 file < 2 menit; incremental 20 file < 10 detik', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cj-perf-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const dir = join(root, 'src', `mod${i % 40}`);
      mkdirSync(dir, { recursive: true });
      const prev = i > 0 ? `import { fn${i - 1} } from '../mod${(i - 1) % 40}/f${i - 1}';\n` : '';
      writeFileSync(
        join(dir, `f${i}.ts`),
        `${prev}export interface T${i} { a: number }\nexport function fn${i}(x: number): number {\n  ${i > 0 ? `return fn${i - 1}(x) + 1;` : 'return x;'}\n}\nexport class C${i} {\n  m(): number { return fn${i}(1); }\n}\n`,
      );
    }
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    const base = g('rev-parse', 'HEAD');
    const s = new GraphStore(join(mkdtempSync(join(tmpdir(), 'cj-perfdb-')), 'perf.db'));
    const ix = new Indexer(s, root);
    const t0 = Date.now();
    const full = await ix.full(base);
    const fullMs = Date.now() - t0;
    expect(full.files).toBe(N);
    expect(full.symbols).toBe(N * 4);
    expect(fullMs).toBeLessThan(120_000);
    for (let i = 0; i < 20; i++) {
      const p = join(root, 'src', `mod${i % 40}`, `f${i}.ts`);
      writeFileSync(p, `export function fn${i}(x: number, y = 0): number {\n  return x + y;\n}\n`);
    }
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'ubah 20');
    const head = g('rev-parse', 'HEAD');
    const t1 = Date.now();
    const inc = await ix.incremental(base, head);
    const incMs = Date.now() - t1;
    expect(inc.parsedFiles).toBe(20);
    expect(incMs).toBeLessThan(10_000);
    console.log(`perf: full ${N} file ${fullMs} ms · incremental 20 file ${incMs} ms`);
    s.close();
  }, 180_000);
});
