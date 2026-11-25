import { buildView, groupOf, MAX_FLAT } from './system-map';

const mods = (ids: string[]) => ids.map((id) => ({ id, label: id }));

describe('peta sistem bertingkat', () => {
  it('area modul: induk folder fitur, dua tingkat pertama, atau level atas', () => {
    expect(groupOf('lib/app/modules/quiz')).toBe('lib/app/modules');
    expect(groupOf('lib/domain/entities')).toBe('lib/domain');
    expect(groupOf('src/features/cart')).toBe('src/features');
    expect(groupOf('src/api')).toBe('src');
    expect(groupOf('test')).toBe('test');
  });

  it(`repo kecil (≤ ${MAX_FLAT} modul): semua modul tampil apa adanya`, () => {
    const v = buildView(mods(['src/api', 'src/services', 'web']), [{ from: 'web', to: 'src/api' }], null);
    expect(v.grouped).toBe(false);
    expect(v.nodes.map((n) => n.id)).toEqual(['src/api', 'src/services', 'web']);
    expect(v.edges).toEqual([{ from: 'web', to: 'src/api', weight: 1 }]);
  });

  it('repo besar: area digabung, panah antar-area dijumlah; area dibuka menampilkan modulnya', () => {
    const features = Array.from({ length: 14 }, (_, i) => `lib/app/modules/f${i}`);
    const ids = [...features, 'lib/domain/entities', 'lib/domain/usecases', 'lib/data/repositories', 'test'];
    const edges = [
      ...features.map((f) => ({ from: f, to: 'lib/domain/entities' })),
      { from: 'lib/app/modules/f0', to: 'lib/domain/usecases' },
      { from: 'lib/domain/usecases', to: 'lib/domain/entities' }, // di dalam area yang sama → tidak digambar saat tertutup
      { from: 'lib/data/repositories', to: 'lib/domain/entities' },
      { from: 'test', to: 'lib/app/modules/f3' },
    ];
    const top = buildView(mods(ids), edges, null);
    expect(top.grouped).toBe(true);
    expect(top.nodes.map((n) => `${n.label}:${n.count ?? '-'}`).sort()).toEqual([
      'lib/app/modules:14',
      'lib/data/repositories:-', // area berisi satu modul tampil sebagai modulnya
      'lib/domain:2',
      'test:-',
    ]);
    expect(top.edges).toEqual(
      expect.arrayContaining([
        { from: 'area:lib/app/modules', to: 'area:lib/domain', weight: 15 },
        { from: 'lib/data/repositories', to: 'area:lib/domain', weight: 1 },
      ]),
    );
    // panah dari area test tidak digambar di peta bertingkat
    expect(top.edges.some((e) => e.from === 'test')).toBe(false);
    expect(top.edges.some((e) => e.from === e.to)).toBe(false);

    const open = buildView(mods(ids), edges, 'lib/app/modules');
    expect(open.nodes.filter((n) => n.count === null && n.id.startsWith('lib/app/modules/'))).toHaveLength(14);
    expect(open.nodes.find((n) => n.id === 'area:lib/domain')?.count).toBe(2);
    expect(open.edges).toEqual(expect.arrayContaining([{ from: 'lib/app/modules/f0', to: 'area:lib/domain', weight: 2 }]));
  });
});
