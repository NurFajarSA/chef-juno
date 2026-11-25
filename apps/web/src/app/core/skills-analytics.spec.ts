import { skillStats, type SkillInfo } from './skills-analytics';
import type { FindingRow, JobRow } from './rows';

const job = (loaded: string[], skipped: string[] = [], dropped: string[] = []): JobRow =>
  ({ type: 'review', status: 'posted', skillsLoaded: loaded, skillsSkipped: skipped, skillsDropped: dropped }) as JobRow;
const finding = (skill: string, outcome: string, title = 't'): FindingRow =>
  ({ skill, outcome, title, jobId: 'j', aiReply: outcome === 'disputed' ? 'tidak diperbaiki — sengaja' : null }) as FindingRow;
const info = (slug: string, o: Partial<SkillInfo> = {}): SkillInfo => ({ slug, name: slug, enabled: true, source: 'default', paths: [], sizeBytes: 2000, ...o });

describe('analitik skills', () => {
  it('menghitung dimuat/dilewati/terpotong, temuan, diperbaiki & dibantah per skill', () => {
    const jobs = [job(['a', 'b'], ['c']), job(['a'], ['c']), job(['a'], [], ['b'])];
    const fs = [finding('a', 'addressed'), finding('a', 'disputed'), finding('a', 'pending'), finding('', 'addressed')];
    const st = skillStats(jobs, fs, [info('a'), info('b'), info('c')]);
    const a = st.find((s) => s.slug === 'a')!;
    expect(a).toMatchObject({ loaded: 3, skipped: 0, findings: 3, decided: 2, addressed: 1, disputed: 1, approxTokens: 500 });
    expect(a.per10).toBeCloseTo(10);
    expect(a.disputedExamples).toEqual([{ title: 't', jobId: 'j', reason: 'tidak diperbaiki — sengaja' }]);
    expect(st.find((s) => s.slug === 'b')).toMatchObject({ loaded: 1, dropped: 1 });
    expect(st.find((s) => s.slug === 'c')).toMatchObject({ loaded: 0, skipped: 2 });
  });

  it('saran: sering dibantah, tanpa hasil, besar & selalu dimuat, tidak pernah dimuat, terpotong, efektif — dengan sampel minimum', () => {
    const many = (n: number, loaded: string[], skipped: string[] = []) => Array.from({ length: n }, () => job(loaded, skipped));
    const jobs = [...many(12, ['dibantah', 'diam', 'besar', 'bagus'], ['sempit'])];
    const fs = [
      ...['disputed', 'disputed', 'addressed'].map((o) => finding('dibantah', o)),
      ...['addressed', 'addressed', 'addressed', 'disputed'].map((o) => finding('bagus', o)),
      finding('besar', 'addressed'),
      finding('sedikit', 'disputed'), // 1 kasus: belum cukup untuk menyimpulkan
    ];
    const st = skillStats(jobs, fs, [
      info('dibantah'),
      info('diam'),
      info('besar', { sizeBytes: 12_000 }),
      info('bagus'),
      info('sempit', { paths: ['lib/payments/**'] }),
      info('sedikit'),
    ]);
    const flags = (slug: string) => st.find((s) => s.slug === slug)!.flags.map((f) => `${f.kind}:${f.text.split(' ')[0]}`);
    expect(flags('dibantah')).toEqual(['warn:Sering']);
    expect(flags('diam')).toEqual(['warn:Dimuat']);
    expect(flags('besar')).toEqual(['warn:Besar']);
    expect(flags('sempit')).toEqual(['warn:Tidak']);
    expect(flags('bagus')).toEqual(['good:Efektif:']);
    expect(flags('sedikit')).toEqual([]);
    // yang perlu perhatian di atas
    expect(st[0].flags.some((f) => f.kind === 'warn')).toBe(true);
    expect(st.at(-1)!.flags.some((f) => f.kind === 'warn')).toBe(false);
  });

  it('skill yang terpotong batas ukuran diberi saran ringkas', () => {
    const st = skillStats([job([], [], ['x'])], [], [info('x')]);
    expect(st[0].flags[0].text).toContain('Terpotong batas ukuran prompt di 1 review');
  });
});
