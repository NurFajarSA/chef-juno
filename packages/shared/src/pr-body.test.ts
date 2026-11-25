import { describe, it, expect } from 'vitest';
import { anchorFileFromBrief, buildPrBrief, parsePrBody, PR_BODY_FALLBACK_MAX, PR_SECTION_MAX } from './pr-body.js';

const TEMPLATED = `## Why

<!-- intent and approach -->
Fixes #12. The quiz score card counted a partial answer as right.

## Behavior change

A partial answer shows as wrong on the score card.

## Affected screens and flows

- Kuis → Hasil: partial answer green → red
- Riwayat → Detail kuis: same rule

## How to try it

- Account: any paid account
- Data: a finished quiz with one partial answer (seed \`quiz-partial\`)
- Steps:
  1. Open Riwayat
  2. Open the finished quiz

## Out of scope

The statistics chart, #13.

## Risk

Only display code changes.

## Verification

- Tests and analyze: score_test 12/12
- Device or emulator: not run
`;

describe('parsePrBody', () => {
  it('membaca bagian template: alasan, alur terdampak, cara mencoba per label, risiko, verifikasi', () => {
    const s = parsePrBody(TEMPLATED);
    expect(s.templated).toBe(true);
    expect(s.why).toBe('Fixes #12. The quiz score card counted a partial answer as right.');
    expect(s.behavior).toBe('A partial answer shows as wrong on the score card.');
    expect(s.affected).toBe('- Kuis → Hasil: partial answer green → red\n- Riwayat → Detail kuis: same rule');
    expect(s.howToTry).toEqual({
      account: 'any paid account',
      data: 'a finished quiz with one partial answer (seed `quiz-partial`)',
      steps: '1. Open Riwayat\n2. Open the finished quiz',
      text: null,
    });
    expect(s.outOfScope).toBe('The statistics chart, #13.');
    expect(s.risk).toBe('Only display code changes.');
    expect(s.verification).toBe('- Tests and analyze: score_test 12/12\n- Device or emulator: not run');
  });

  it('deskripsi tanpa template → templated false, semua bagian null', () => {
    expect(parsePrBody('Menambah opsi cache.\n\n- satu\n- dua')).toEqual({
      templated: false,
      why: null,
      behavior: null,
      affected: null,
      howToTry: null,
      outOfScope: null,
      risk: null,
      verification: null,
    });
    expect(parsePrBody('').templated).toBe(false);
  });

  it('heading Indonesia, huruf besar/kecil & level berbeda dikenali; na: seluruh bagian masuk text', () => {
    const s = parsePrBody('### ALUR TERDAMPAK\nKeranjang\n\n# Cara mencoba\nna: hanya CI\n');
    expect(s.templated).toBe(true);
    expect(s.affected).toBe('Keranjang');
    expect(s.howToTry).toEqual({ account: null, data: null, steps: null, text: 'na: hanya CI' });
  });

  it('komentar HTML (petunjuk template) dibuang, kecuali di inline code; heading di dalam fence bukan bagian', () => {
    const s = parsePrBody(
      '## Why\n<!-- hint\nmulti-line -->\nUses `<!--` in a parser.\n\n```markdown\n## Risk\nfake\n```\n',
    );
    expect(s.why).toBe('Uses `<!--` in a parser.\n\n```markdown\n## Risk\nfake\n```');
    expect(s.risk).toBeNull();
    expect(s.templated).toBe(false);
  });

  it('bagian kosong (hanya petunjuk) → null; label tanpa nilai tidak diisi', () => {
    const s = parsePrBody(
      '## Affected screens and flows\n<!-- one line per screen -->\n\n## How to try it\n- Account:\n- Data:\n',
    );
    expect(s.affected).toBeNull();
    expect(s.howToTry).toBeNull();
    expect(s.templated).toBe(false);
  });

  it('bagian sangat panjang dipotong di batasnya', () => {
    const s = parsePrBody(`## Affected screens and flows\n${'x'.repeat(PR_SECTION_MAX + 500)}`);
    expect(s.affected).toHaveLength(PR_SECTION_MAX + 1);
    expect(s.affected!.endsWith('…')).toBe(true);
  });
});

describe('buildPrBrief', () => {
  const files = [
    { path: 'lib/score.dart', stat: '+10 −2' },
    { path: 'test/score_test.dart', stat: '+40 −0' },
  ];

  it('bertemplate → bagian "Alur yang diubah PR" & "Cara mencoba" terstruktur, daftar file tetap terakhir', () => {
    const brief = buildPrBrief({ number: 7, title: 'fix(score): partial answers', body: TEMPLATED, files });
    expect(brief).toContain('# PR #7: fix(score): partial answers');
    expect(brief).toContain(
      '## Alur yang diubah PR (dari penulis; wajib dicoba semua)\nPerubahan perilaku:\nA partial answer shows as ' +
        'wrong on the score card.\n\nLayar & alur:\n- Kuis → Hasil: partial answer green → red',
    );
    expect(brief).toContain(
      '## Cara mencoba (dari penulis)\nAkun: any paid account\nData: a finished quiz with one partial answer ' +
        '(seed `quiz-partial`)\nLangkah:\n1. Open Riwayat\n2. Open the finished quiz',
    );
    expect(brief).toContain('## Di luar cakupan PR\nThe statistics chart, #13.');
    expect(brief).toContain('## Verifikasi oleh penulis\n- Tests and analyze: score_test 12/12');
    expect(brief).not.toContain('<!--');
    expect(brief.endsWith('## File yang berubah (2)\n- lib/score.dart (+10 −2)\n- test/score_test.dart (+40 −0)')).toBe(
      true,
    );
  });

  it('tanpa template → deskripsi apa adanya, dipotong seperti sebelumnya', () => {
    const body = `Menambah opsi cache. ${'y'.repeat(PR_BODY_FALLBACK_MAX)}`;
    const brief = buildPrBrief({ number: 1, title: 't', body, files: [{ path: 'src/a.ts' }] });
    expect(brief).toBe(`# PR #1: t\n${body.slice(0, PR_BODY_FALLBACK_MAX)}\n## File yang berubah (1)\n- src/a.ts`);
    expect(brief).not.toContain('## Alur yang diubah PR');
    expect(buildPrBrief({ number: 2, title: 't', body: null, files: [] })).toBe(
      '# PR #2: t\n\n## File yang berubah (0)',
    );
  });

  it('bagian alur terisi tapi cara mencoba kosong → ditandai "(tidak diisi)", bukan dihilangkan', () => {
    const brief = buildPrBrief({ number: 3, title: 't', body: '## Affected screens and flows\nKeranjang', files: [] });
    expect(brief).toContain('## Cara mencoba (dari penulis)\n(tidak diisi)');
  });
});

describe('anchorFileFromBrief', () => {
  it('memilih file kode dengan perubahan terbanyak, melewati test & dokumentasi', () => {
    const brief = buildPrBrief({
      number: 1,
      title: 't',
      body: '',
      files: [
        { path: 'docs/guide.md', stat: '+300 −0' },
        { path: 'lib/a.dart', stat: '+3 −1' },
        { path: 'test/b_test.dart', stat: '+200 −0' },
        { path: 'lib/view/b.dart', stat: '+20 −5' },
        { path: 'src/c.spec.ts', stat: '+90 −0' },
      ],
    });
    expect(anchorFileFromBrief(brief)).toBe('lib/view/b.dart');
  });

  it('hanya test/dokumentasi → file pertama; tanpa file → kosong', () => {
    const only = buildPrBrief({ number: 1, title: 't', body: '', files: [{ path: 'README.md', stat: '+1 −0' }] });
    expect(anchorFileFromBrief(only)).toBe('README.md');
    expect(anchorFileFromBrief(buildPrBrief({ number: 1, title: 't', body: '', files: [] }))).toBe('');
  });

  it('daftar file yang dibaca adalah yang terakhir, bukan baris "- …" di deskripsi', () => {
    const brief = buildPrBrief({
      number: 1,
      title: 't',
      body: '## Affected screens and flows\n- lib/fake.dart (+999 −0)\n## File yang berubah palsu',
      files: [{ path: 'lib/real.dart', stat: '+1 −0' }],
    });
    expect(anchorFileFromBrief(brief)).toBe('lib/real.dart');
  });
});
