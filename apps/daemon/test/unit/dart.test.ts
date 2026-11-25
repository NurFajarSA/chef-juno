import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { langOf, parseFile } from '../../src/graph/parse.js';
import { GraphStore } from '../../src/graph/store.js';
import { Indexer, moduleOf } from '../../src/graph/indexer.js';

const SRC = `
import 'package:flutter/material.dart';
import 'package:app/widgets/widgets.dart';
import '../data/repo.dart' as repo;
import 'util.dart' show formatRp, kMax;
export 'src/public.dart';
part 'home.g.dart';

/// Ukuran maksimal keranjang.
const kLimit = 3;

typedef OnTap = void Function();
enum Mode { a, b }
mixin Logs on Object {}
extension RpX on int { String rp() => formatRp(this); }

/// Total harga semua item.
int total(List<int> xs) => xs.fold(0, (a, b) => a + b);

int _secret() => 1;

/// Layar keranjang.
class CartView extends StatelessWidget with Logs implements Tracked {
  const CartView({super.key});
  factory CartView.empty() => const CartView();
  int get count => 0;

  @override
  Widget build(BuildContext context) {
    final items = repo.load(context);
    final store = context.read<Store>().items.sum();
    return Column(children: [AppButton(label: formatRp(total(items))), _Row()]);
  }
}

class _Row extends StatelessWidget {
  @override
  Widget build(BuildContext context) => const Text('x');
}

class Store { void clear() { _secret(); } }
`;

describe('parser Dart (tree-sitter)', () => {
  it('mengenali file .dart', () => {
    expect(langOf('lib/main.dart')).toBe('dart');
  });

  it('simbol: widget, kelas, method/getter/factory, fungsi, enum, typedef, mixin, extension, konstanta; privat = awalan _', async () => {
    const f = await parseFile('lib/app/modules/cart/view/cart_view.dart', SRC);
    const by = Object.fromEntries(f.symbols.map((s) => [s.qualifiedName, s]));
    expect(by['CartView']).toMatchObject({ kind: 'component', exported: true, doc: 'Layar keranjang.' });
    expect(by['CartView'].signature).toBe('class CartView extends StatelessWidget');
    expect(by['_Row']).toMatchObject({ kind: 'component', exported: false });
    expect(by['Store']).toMatchObject({ kind: 'class' });
    expect(by['CartView.build']).toMatchObject({ kind: 'method' });
    expect(by['CartView.count']).toMatchObject({ kind: 'method' });
    expect(by['CartView.CartView.empty']).toMatchObject({ kind: 'method', name: 'empty' });
    expect(by['total']).toMatchObject({ kind: 'function', exported: true, doc: 'Total harga semua item.' });
    expect(by['_secret']).toMatchObject({ kind: 'function', exported: false });
    expect(by['kLimit']).toMatchObject({ kind: 'variable', doc: 'Ukuran maksimal keranjang.' });
    expect(by['Mode'].kind).toBe('type');
    expect(by['OnTap'].kind).toBe('type');
    expect(by['Logs'].kind).toBe('class');
    expect(by['RpX.rp']).toMatchObject({ kind: 'method' });
    // rentang baris method mencakup badannya
    expect(by['CartView.build'].endLine).toBeGreaterThan(by['CartView.build'].startLine);
  });

  it('import: package:, relatif, prefiks as, show, export (barrel), part; dart:/flutter tetap dicatat sebagai sumber', async () => {
    const f = await parseFile('lib/app/x.dart', SRC);
    const im = Object.fromEntries(f.imports.map((i) => [i.source, i]));
    expect(im['package:app/widgets/widgets.dart'].names).toEqual([{ local: '*', imported: '*' }]);
    expect(im['../data/repo.dart'].names).toEqual([{ local: 'repo', imported: '*' }]);
    expect(im['util.dart'].names).toEqual([
      { local: 'formatRp', imported: 'formatRp' },
      { local: 'kMax', imported: 'kMax' },
    ]);
    expect(im['src/public.dart']).toMatchObject({ reexport: true });
    expect(im['home.g.dart']).toMatchObject({ reexport: true });
  });

  it('relasi: widget di build() = renders, panggilan dengan rantai penerima, extends/implements/with', async () => {
    const f = await parseFile('lib/app/x.dart', SRC);
    const refs = f.refs.map((r) => `${r.from}|${r.kind}|${r.toName}|${r.receiver ?? ''}`);
    expect(refs).toContain('CartView.build|renders|AppButton|');
    expect(refs).toContain('CartView.build|renders|Column|');
    expect(refs).toContain('CartView.build|calls|formatRp|');
    expect(refs).toContain('CartView.build|calls|total|');
    expect(refs).toContain('CartView.build|calls|load|repo');
    expect(refs).toContain('CartView.build|calls|read|context');
    expect(refs).toContain('CartView.build|calls|sum|context.read.items');
    expect(refs).toContain('Store.clear|calls|_secret|');
    expect(refs).toContain('CartView|extends|StatelessWidget|');
    expect(refs).toContain('CartView|implements|Tracked|');
    expect(refs).toContain('CartView|references|Logs|');
    // `const X()` juga dikenali: di build() = renders, di luar build() = calls
    expect(refs).toContain('_Row.build|renders|Text|');
    expect(refs).toContain('CartView.CartView.empty|calls|CartView|');
  });
});

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function flutterRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'cj-dart-'));
  const files: Record<string, string> = {
    'pubspec.yaml': 'name: app\nenvironment:\n  sdk: ">=3.8.0 <4.0.0"\n',
    'packages/ui_kit/pubspec.yaml': 'name: ui_kit\n',
    'packages/ui_kit/lib/ui_kit.dart': "export 'src/badge.dart';\n",
    'packages/ui_kit/lib/src/badge.dart':
      'class Badge extends StatelessWidget { Widget build(BuildContext c) => const SizedBox(); }\n',
    'lib/widgets/widgets.dart': "export 'button.dart';\nexport 'inner/inner.dart';\n",
    'lib/widgets/button.dart':
      '/// Tombol utama.\nclass AppButton extends StatelessWidget { const AppButton(); Widget build(BuildContext c) => const SizedBox(); }\n',
    'lib/widgets/inner/inner.dart': "export 'chip.dart';\n",
    'lib/widgets/inner/chip.dart':
      'class AppChip extends StatelessWidget { Widget build(BuildContext c) => const SizedBox(); }\n',
    'lib/app/modules/home/view/home_view.dart': [
      "import 'package:app/widgets/widgets.dart';",
      "import 'package:ui_kit/ui_kit.dart';",
      "import '../logic/home_logic.dart' as logic;",
      'class HomeView extends StatelessWidget {',
      '  Widget build(BuildContext context) => Column(children: [AppButton(), AppChip(), Badge(), Text(logic.title())]);',
      '}',
    ].join('\n'),
    'lib/app/modules/home/logic/home_logic.dart': "String title() => 'Beranda';\n",
    'lib/app/modules/home/model/home.g.dart': 'class GeneratedThing {}\n',
    'lib/gen/assets.gen.dart': 'class Assets {}\n',
    'bricks/feature/__brick__/lib/{{name}}.dart': 'class {{name.pascalCase()}} {}\n',
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, dirname(p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  sh(root, 'init', '-q');
  return root;
}

describe('indexer untuk repo Flutter', () => {
  it('package: lewat pubspec (termasuk paket lokal), barrel berlapis, prefiks as, modul per fitur, file generator dilewati', async () => {
    const root = flutterRepo();
    const store = new GraphStore(join(root, '..', `${root.split('/').pop()}.db`));
    const st = await new Indexer(store, root).full('abc');
    expect(st.languages.dart).toBeGreaterThan(0);
    const q = <T>(sql: string, ...a: (string | number)[]) => store.db.prepare(sql).all(...a) as T[];
    const usedIn = (name: string) =>
      q<{ file: string; kind: string; resolved: number }>(
        'SELECT e.file, e.kind, e.resolved FROM edges e JOIN symbols s ON s.id = e.toSymbol WHERE s.name = ?',
        name,
      );
    const home = 'lib/app/modules/home/view/home_view.dart';
    // barrel 1 lapis (widgets.dart → button.dart) dan 2 lapis (→ inner/inner.dart → chip.dart)
    expect(usedIn('AppButton')).toEqual([{ file: home, kind: 'renders', resolved: 1 }]);
    expect(usedIn('AppChip')).toEqual([{ file: home, kind: 'renders', resolved: 1 }]);
    // paket lokal di packages/ui_kit (package:ui_kit/...)
    expect(usedIn('Badge')).toEqual([{ file: home, kind: 'renders', resolved: 1 }]);
    // prefiks `as logic` → logic.title()
    expect(usedIn('title')).toEqual([{ file: home, kind: 'calls', resolved: 1 }]);
    // import package: ter-resolve ke file
    const targets = q<{ target: string | null }>('SELECT target FROM imports WHERE file = ?', home).map(
      (x) => x.target,
    );
    expect(targets).toEqual(expect.arrayContaining(['lib/widgets/widgets.dart', 'packages/ui_kit/lib/ui_kit.dart']));
    // file hasil generator tidak di-index
    const files = q<{ path: string }>('SELECT path FROM files').map((x) => x.path);
    expect(files).not.toContain('lib/app/modules/home/model/home.g.dart');
    expect(files).not.toContain('lib/gen/assets.gen.dart');
    // template Mason bukan kode aplikasi
    expect(files.some((f) => f.includes('__brick__'))).toBe(false);
  });

  it('pembagian modul: fitur (modules/features/screens) dan lib/ Dart satu tingkat lebih dalam', () => {
    expect(moduleOf('lib/app/modules/quiz/view/quiz_view.dart')).toBe('lib/app/modules/quiz');
    expect(moduleOf('lib/app/widgets/shared/button.dart')).toBe('lib/app/widgets');
    expect(moduleOf('lib/domain/entities/user.dart')).toBe('lib/domain/entities');
    expect(moduleOf('lib/main.dart')).toBe('lib');
    // test: satu modul per folder test level atas (tidak dipecah per fitur)
    expect(moduleOf('test/screens/home/home_test.dart')).toBe('test');
    expect(moduleOf('integration_test/app/modules/quiz/flow_test.dart')).toBe('integration_test');
    expect(moduleOf('src/features/cart/api.ts')).toBe('src/features/cart');
    // TypeScript di luar struktur fitur tetap seperti sebelumnya
    expect(moduleOf('src/api/user.ts')).toBe('src/api');
  });
});
