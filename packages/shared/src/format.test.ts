import { describe, it, expect } from 'vitest';
import { FINDING_MARKER_RE, SUMMARY_MARKER } from './constants.js';
import {
  MAX_COMMENT_CHARS,
  evidenceImages,
  appVerifyLine,
  effectiveScore,
  selectPostable,
  MAX_FIELD_CHARS,
  agentLabel,
  containsSecret,
  formatDuration,
  formatInlineComment,
  formatRereviewReply,
  formatSummaryComment,
  sanitize,
  sortFindings,
  type SummaryContext,
} from './format.js';
import type { ReviewFinding, ReviewOutput } from './schemas.js';

const ZW = '​';

const finding = (o: Partial<ReviewFinding> = {}): ReviewFinding => ({
  path: 'src/auth.ts',
  line: 42,
  startLine: null,
  severity: 'P0',
  category: 'bug',
  title: 'Token tidak dicek',
  what: 'Fungsi `login` mengembalikan token tanpa verifikasi.',
  why: 'Penyerang bisa memakai token kedaluwarsa.',
  fix: 'Panggil `verify(token)` sebelum return.',
  suggestion: null,
  confidence: 0.9,
  trigger: '',
  skill: '',
  ...o,
});

const out = (o: Partial<ReviewOutput> = {}): ReviewOutput => ({
  score: 2,
  verdict: 'Masakan ini belum matang.',
  summary: 'PR menambah alur login baru.',
  lessons: ['Selalu verifikasi token sebelum dipakai.'],
  findings: [],
  reviewCompletion: 'complete',
  uncertainty: '',
  ...o,
});

const ctx = (o: Partial<SummaryContext> = {}): SummaryContext => ({
  headSha: 'abc1234def5678',
  agent: 'claude',
  model: 'claude-sonnet',
  promptVersions: { persona: 1, review: 3 },
  machineName: 'laptop-dev',
  durationMs: 151_000,
  ...o,
});

// Dibangun dari potongan supaya file test tidak memuat pola token utuh.
const GHS = 'ghs_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
const GHP = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8';
const AIZA = 'AIza' + 'SyB-abcdefghijklmnopqrstuv_12';
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----';

describe('formatInlineComment (§7.3)', () => {
  it('snapshot tanpa suggestion', () => {
    expect(formatInlineComment(finding(), 'f_1')).toMatchInlineSnapshot(`
      "🔴 **P0 · Token tidak dicek**

      Fungsi \`login\` mengembalikan token tanpa verifikasi.

      Penyerang bisa memakai token kedaluwarsa.

      **Perbaikan:** Panggil \`verify(token)\` sebelum return.

      <sub>Bug · keyakinan 90%</sub>
      <!-- chefjuno-ai:finding:f_1 -->"
    `);
  });

  it('snapshot dengan suggestion', () => {
    const body = formatInlineComment(
      finding({
        severity: 'P2',
        category: 'performance',
        title: 'Loop lambat',
        suggestion: 'for (const x of xs) use(x);',
      }),
      'f_2',
    );
    expect(body).toMatchInlineSnapshot(`
      "🟡 **P2 · Loop lambat**

      Fungsi \`login\` mengembalikan token tanpa verifikasi.

      Penyerang bisa memakai token kedaluwarsa.

      **Perbaikan:** Panggil \`verify(token)\` sebelum return.

      \`\`\`suggestion
      for (const x of xs) use(x);
      \`\`\`

      <sub>Performa · keyakinan 90%</sub>
      <!-- chefjuno-ai:finding:f_2 -->"
    `);
  });

  it('marker finding bisa dibaca kembali dengan FINDING_MARKER_RE', () => {
    expect(FINDING_MARKER_RE.exec(formatInlineComment(finding(), 'abc_DEF-9'))?.[1]).toBe('abc_DEF-9');
  });

  it('suggestion: ``` di dalam kode tidak bisa menutup blok, rahasia diredaksi', () => {
    const body = formatInlineComment(finding({ suggestion: `const t = "${GHS}";\n\`\`\`\n@admin` }), 'f');
    expect(body).not.toContain(GHS);
    expect(body).toContain('[DIHAPUS]');
    expect(body.match(/^```/gm)).toEqual(['```', '```']);
  });

  it('field teks disanitasi (mention, HTML, marker palsu)', () => {
    const body = formatInlineComment(
      finding({ title: 'cc @octocat', what: '<!-- chefjuno-ai:summary --><img src=x>teks' }),
      'f',
    );
    expect(body).toContain(`@${ZW}octocat`);
    expect(body).not.toContain(SUMMARY_MARKER);
    expect(body).not.toContain('<img');
    expect(body).toContain('teks');
  });
});

describe('formatSummaryComment (§7.2)', () => {
  const inlineRows = [
    {
      finding: finding({ severity: 'P1', title: 'Query N+1', path: 'src/db.ts', line: 7 }),
      url: 'https://github.com/o/r/pull/1#discussion_r2',
    },
    { finding: finding(), url: 'https://github.com/o/r/pull/1#discussion_r1' },
    { finding: finding({ severity: 'P2', title: 'Nama | variabel', path: 'src/x.ts', line: 3 }), url: null },
  ];
  const others = [
    finding({
      severity: 'P2',
      category: 'test',
      title: 'Tes hilang',
      path: 'src/y.ts',
      line: 99,
      what: 'Tidak ada tes.',
      fix: 'Tambah tes.',
    }),
    finding({
      severity: 'P1',
      category: 'security',
      title: 'Secret di log',
      path: 'src/z.ts',
      line: 5,
      what: 'Log mencetak token.',
      fix: 'Hapus log.',
    }),
  ];

  it('snapshot lengkap', () => {
    const body = formatSummaryComment(
      out(),
      inlineRows,
      others,
      ctx({ impact: ['`login` dipanggil oleh 4 modul'], suppressedCount: 2, note: 'Diff dipotong.' }),
    );
    expect(body).toMatchInlineSnapshot(`
      "<!-- chefjuno-ai:summary -->
      ## 👨‍🍳 Chef Juno — Skor 2/5
      > Masakan ini belum matang.

      **Ringkasan**
      PR menambah alur login baru.

      **Temuan** — 🔴 P0: 1 · 🟠 P1: 2 · 🟡 P2: 2
      | | File | Masalah |
      |---|---|---|
      | 🔴 | \`src/auth.ts:42\` | [Token tidak dicek](https://github.com/o/r/pull/1#discussion_r1) |
      | 🟠 | \`src/db.ts:7\` | [Query N+1](https://github.com/o/r/pull/1#discussion_r2) |
      | 🟡 | \`src/x.ts:3\` | Nama \\| variabel |

      **Dampak (dari code map)**
      - \`login\` dipanggil oleh 4 modul

      **Yang perlu kamu pahami dari PR ini**
      - Selalu verifikasi token sebelum dipakai.

      <details><summary>Temuan lain (di luar diff)</summary>

      - 🟠 **P1 · Secret di log** \`src/z.ts:5\` — Log mencetak token. **Perbaikan:** Hapus log.
      - 🟡 **P2 · Tes hilang** \`src/y.ts:99\` — Tidak ada tes. **Perbaikan:** Tambah tes.

      </details>

      <sub>2 temuan di-suppress oleh memory tim (lihat dashboard).</sub>

      <sub>Diff dipotong.</sub>

      <sub>Commit \`abc1234\` · Claude Code (claude-sonnet) · prompt persona v1 / review v3 · mesin laptop-dev · 2m 31s · Review ulang: \`lapor @chefjuno\` · Balas temuan: \`chefjuno: diperbaiki\` / \`chefjuno: tidak diperbaiki — <alasan>\`</sub>"
    `);
  });

  it('diawali marker sticky summary', () => {
    const body = formatSummaryComment(out(), inlineRows, others, ctx());
    expect(body.startsWith(SUMMARY_MARKER + '\n')).toBe(true);
    expect(body).toContain('<!-- chefjuno-ai:summary -->');
    expect(body.split(SUMMARY_MARKER).length).toBe(2);
  });

  it('hitungan severity mencakup inline + temuan lain', () => {
    const body = formatSummaryComment(out(), inlineRows, others, ctx());
    expect(body).toContain('**Temuan** — 🔴 P0: 1 · 🟠 P1: 2 · 🟡 P2: 2');
  });

  it('judul inline di-link ke URL komentar inline, urut P0 → P1 → P2', () => {
    const body = formatSummaryComment(out(), inlineRows, [], ctx());
    expect(body).toContain('[Token tidak dicek](https://github.com/o/r/pull/1#discussion_r1)');
    expect(body).toContain('[Query N+1](https://github.com/o/r/pull/1#discussion_r2)');
    const rows = body.split('\n').filter((l) => /^\| (🔴|🟠|🟡) /.test(l));
    expect(rows.map((r) => r.slice(2, 4))).toEqual(['🔴', '🟠', '🟡']);
    expect(body).not.toContain('Temuan lain');
  });

  it('"Temuan lain" di <details>, urut severity', () => {
    const body = formatSummaryComment(out(), [], others, ctx());
    expect(body).toContain('<details><summary>Temuan lain (di luar diff)</summary>');
    expect(body).toContain('</details>');
    expect(body.indexOf('Secret di log')).toBeLessThan(body.indexOf('Tes hilang'));
    expect(body).toContain('**Perbaikan:** Tambah tes.');
    expect(body).not.toContain('| | File | Masalah |');
    expect(body).not.toContain('Bersih. Merge.');
  });

  it('footer menyebut Codex kalau agent codex', () => {
    const body = formatSummaryComment(out(), [], [], ctx({ agent: 'codex', model: 'gpt-5-codex' }));
    expect(body).toContain('Codex (gpt-5-codex)');
    expect(body).not.toContain('Claude Code');
  });

  it('footer: sha 7 karakter, versi prompt, mesin, durasi, perintah', () => {
    const body = formatSummaryComment(out(), [], [], ctx({ model: null, durationMs: 9_400 }));
    const footer = body.split('\n').at(-1)!;
    expect(footer).toContain('Commit `abc1234`');
    expect(footer).not.toContain('abc1234d');
    expect(footer).toContain('Claude Code (default)');
    expect(footer).toContain('prompt persona v1 / review v3');
    expect(footer).toContain('mesin laptop-dev');
    expect(footer).toContain('· 9s ·');
    expect(footer).toContain('`lapor @chefjuno`');
    expect(footer).toContain('`chefjuno: tidak diperbaiki — <alasan>`');
  });

  it('handle kustom di footer', () => {
    expect(formatSummaryComment(out(), [], [], ctx({ handle: 'juru' }))).toContain('`lapor @juru`');
  });

  it('verdict sudah "Bersih. Merge." → tidak diulang di bawah tabel temuan', () => {
    const body = formatSummaryComment(out({ score: 5, lessons: [], verdict: 'Bersih. Merge.' }), [], [], ctx());
    expect(body.split('Bersih. Merge.').length - 1).toBe(1);
  });

  it('"Bersih. Merge." kalau tidak ada temuan', () => {
    const body = formatSummaryComment(out({ score: 5, lessons: [] }), [], [], ctx());
    expect(body).toContain('Bersih. Merge.');
    expect(body).toContain('🔴 P0: 0 · 🟠 P1: 0 · 🟡 P2: 0');
    expect(body).toContain('Skor 5/5');
    expect(body).not.toContain('Yang perlu kamu pahami');
    expect(body).not.toContain('<details>');
    expect(body).not.toContain('di-suppress');
  });

  it('lessons maksimal 3, impact maksimal 10', () => {
    const body = formatSummaryComment(
      out({ lessons: ['l1', 'l2', 'l3', 'l4'] }),
      [],
      [],
      ctx({ impact: Array.from({ length: 12 }, (_, i) => `imp${i}`) }),
    );
    expect(body).toContain('- l3');
    expect(body).not.toContain('- l4');
    expect(body).toContain('- imp9');
    expect(body).not.toContain('- imp10');
  });

  it('verdict/summary dari model disanitasi', () => {
    const body = formatSummaryComment(
      out({ verdict: 'hai @everyone', summary: `token ${GHP} <!-- chefjuno-ai:finding:x -->` }),
      [],
      [],
      ctx(),
    );
    expect(body).toContain(`hai @${ZW}everyone`);
    expect(body).not.toContain(GHP);
    expect(FINDING_MARKER_RE.test(body)).toBe(false);
  });

  it('path temuan lain dari model tidak bisa keluar dari code span / menyisipkan marker', () => {
    const body = formatSummaryComment(
      out(),
      [],
      [finding({ path: 'a.ts` <!-- chefjuno-ai:finding:evil --> @admin `b' })],
      ctx(),
    );
    expect(FINDING_MARKER_RE.test(body)).toBe(false);
    expect(body).not.toMatch(/(^|\s)@admin/);
  });

  it('total dibatasi < 60.000 karakter', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      finding({ title: `t${i}`, what: 'w'.repeat(600), fix: 'f'.repeat(600) }),
    );
    const body = formatSummaryComment(out({ summary: 's'.repeat(5000) }), [], many, ctx());
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(body.endsWith('…(dipotong)')).toBe(true);
    expect(body.startsWith(SUMMARY_MARKER)).toBe(true);
  });
});

describe('sanitize (§6.4.6)', () => {
  it('menetralkan @mention dengan zero-width space', () => {
    expect(sanitize('hai @octocat dan @org/team')).toBe(`hai @${ZW}octocat dan @${ZW}org/team`);
    expect(sanitize('@chefjuno lapor')).toBe(`@${ZW}chefjuno lapor`);
    expect(sanitize('(@dev)')).toBe(`(@${ZW}dev)`);
  });

  it('email & mention di dalam backtick tidak diubah', () => {
    expect(sanitize('mail me@example.com')).toBe('mail me@example.com');
    expect(sanitize('pakai `@decorator`')).toBe('pakai `@decorator`');
  });

  it('membuang gambar markdown', () => {
    expect(sanitize('lihat ![x](https://evil/track.png) ini')).toBe('lihat  ini');
  });

  it('membuang komentar HTML (marker palsu)', () => {
    expect(sanitize('a<!-- chefjuno-ai:summary -->b')).toBe('ab');
    expect(sanitize('a<!-- chefjuno-ai:finding:abc -->b')).toBe('ab');
    expect(sanitize('x<!--\nmulti\nline\n-->y')).toBe('xy');
  });

  it('marker palsu yang disusun dari komentar bersarang tetap dibuang', () => {
    const t = sanitize('<!<!-- -->-- chefjuno-ai:summary -->');
    expect(t).not.toContain(SUMMARY_MARKER);
    expect(t).not.toContain('<!--');
    expect(sanitize('<!-<!---->- chefjuno-ai:finding:x -->')).not.toMatch(FINDING_MARKER_RE);
  });

  it('membuang tag HTML mentah, termasuk yang disusun dari tag bersarang', () => {
    expect(sanitize('<b>tebal</b> <img src=x onerror=alert(1)> <a href="x">l</a>')).toBe('tebal  l');
    expect(sanitize('<<b>img src=x onerror=alert(1)>')).not.toMatch(/<img/i);
    expect(sanitize('a < b && c > d')).toBe('a < b && c > d');
  });

  it('meredaksi ghs_/ghp_/-----BEGIN/AIza', () => {
    for (const s of [GHS, GHP, PEM, AIZA]) {
      const t = sanitize(`nilai: ${s} selesai`);
      expect(t, s).not.toContain(s);
      expect(t).toContain('[DIHAPUS]');
      expect(containsSecret(t)).toBe(false);
    }
  });

  it('meredaksi semua kemunculan', () => {
    expect(sanitize(`${GHS} ${GHS}`)).toBe('[DIHAPUS] [DIHAPUS]');
  });

  it('rahasia yang terpecah oleh tag/komentar HTML tetap diredaksi', () => {
    const split1 = GHS.slice(0, 8) + '<b></b>' + GHS.slice(8);
    const split2 = GHP.slice(0, 6) + '<!-- x -->' + GHP.slice(6);
    expect(containsSecret(sanitize(split1))).toBe(false);
    expect(containsSecret(sanitize(split2))).toBe(false);
  });

  it('memotong ke panjang maksimal dengan elipsis', () => {
    const t = sanitize('a'.repeat(5000));
    expect(t.length).toBe(MAX_FIELD_CHARS);
    expect(t.endsWith('…')).toBe(true);
    expect(sanitize('abcdef', 4)).toBe('abc…');
    expect(sanitize('abcd', 4)).toBe('abcd');
  });

  it('nilai null/undefined aman', () => {
    expect(sanitize(undefined as unknown as string)).toBe('');
    expect(sanitize(null as unknown as string)).toBe('');
  });
});

describe('containsSecret', () => {
  it('mendeteksi pola bawaan', () => {
    expect(containsSecret(`x ${GHS}`)).toBe(true);
    expect(containsSecret(`x ${GHP}`)).toBe(true);
    expect(containsSecret('gho_' + 'a'.repeat(30))).toBe(true);
    expect(containsSecret(PEM)).toBe(true);
    expect(containsSecret(AIZA)).toBe(true);
    expect(containsSecret('teks biasa ghs_short')).toBe(false);
  });

  it('rahasia tambahan (mis. machineSecret) ≥ 8 karakter', () => {
    expect(containsSecret('output ... ms_secret_value_123 ...', ['ms_secret_value_123'])).toBe(true);
    expect(containsSecret('output bersih', ['ms_secret_value_123'])).toBe(false);
  });

  it('rahasia tambahan pendek/kosong diabaikan (hindari false positive)', () => {
    expect(containsSecret('abc', ['abc'])).toBe(false);
    expect(containsSecret('apa saja', [''])).toBe(false);
  });
});

describe('helper', () => {
  it('sortFindings P0 → P1 → P2, stabil, tidak memutasi input', () => {
    const input = [
      { severity: 'P2' as const, id: 1 },
      { severity: 'P0' as const, id: 2 },
      { severity: 'P1' as const, id: 3 },
      { severity: 'P0' as const, id: 4 },
    ];
    expect(sortFindings(input).map((x) => x.id)).toEqual([2, 4, 3, 1]);
    expect(input.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(151_000)).toBe('2m 31s');
  });

  it('agentLabel', () => {
    expect(agentLabel('claude', 'claude-opus')).toBe('Claude Code (claude-opus)');
    expect(agentLabel('codex', null)).toBe('Codex (default)');
  });
});

describe('ambang posting & review sebagian (kontrak v4)', () => {
  it('selectPostable: keyakinan rendah & di bawah ambang prioritas ditahan, sisanya diposting', () => {
    const fs = [
      finding({ title: 'a', severity: 'P0', confidence: 0.95 }),
      finding({ title: 'b', severity: 'P1', confidence: 0.5 }),
      finding({ title: 'c', severity: 'P2', confidence: 0.9 }),
    ];
    const def = selectPostable(fs);
    expect(def.post.map((f) => f.title)).toEqual(['a', 'c']);
    expect(def.held).toEqual([{ finding: fs[1], reason: 'confidence' }]);
    const strict = selectPostable(fs, { minConfidence: 0.8, maxPriority: 'P0' });
    expect(strict.post.map((f) => f.title)).toEqual(['a']);
    expect(strict.held.map((h) => [h.finding.title, h.reason])).toEqual([
      ['b', 'confidence'],
      ['c', 'priority'],
    ]);
  });
  it('effectiveScore: review sebagian dibatasi 3', () => {
    expect(effectiveScore(5, true)).toBe(3);
    expect(effectiveScore(2, true)).toBe(2);
    expect(effectiveScore(5, false)).toBe(5);
  });
  it('ringkasan review sebagian: tidak pernah "Bersih. Merge.", skor dibatasi, alasan tampil', () => {
    const body = formatSummaryComment(out({ score: 5 }), [], [], ctx({ incomplete: 'Diff terpotong di 1 MB.' }));
    expect(body).toContain('Skor 3/5 · ⚠️ Review sebagian');
    expect(body).toContain('Diff terpotong di 1 MB.');
    expect(body).not.toContain('Bersih. Merge.');
  });
  it('ringkasan menyebut jumlah temuan yang ditahan; komentar inline menampilkan "Muncul saat"', () => {
    expect(formatSummaryComment(out(), [], [], ctx({ heldCount: 2 }))).toContain('2 temuan dengan keyakinan rendah');
    expect(formatInlineComment(finding({ trigger: 'token kedaluwarsa' }), 'f1')).toContain(
      '**Muncul saat:** token kedaluwarsa',
    );
    expect(formatInlineComment(finding(), 'f1')).not.toContain('Muncul saat');
  });
});

describe('komentar gaya reviewer akhir', () => {
  it('inline: catatan kecil kategori · keyakinan · skill dasar', () => {
    const body = formatInlineComment(finding({ skill: 'security-review', confidence: 0.85 }), 'f9');
    expect(body).toContain('<sub>Bug · keyakinan 85% · dasar: skill `security-review`</sub>');
    expect(body).not.toContain('**Kenapa:**');
    expect(body).not.toContain('**Benarnya:**');
  });

  it('ringkasan: tingkat dampak di judul, walkthrough (lipat) + perkiraan usaha, diagram mermaid, status temuan lama', () => {
    const body = formatSummaryComment(
      {
        ...out(),
        impactLevel: 'tinggi',
        effortMinutes: 25,
        walkthrough: [
          {
            area: 'Checkout voucher',
            files: ['lib/shop/voucher_bloc.dart', 'lib/shop/a|b.dart'],
            change: 'Membaca ulang paket sebelum menolak kode.',
          },
        ],
        diagram: 'flowchart TD\n  A[Kode promo] --> B{Paket terbaru?}',
      },
      [],
      [],
      { ...ctx(), previous: { fixed: ['Token tidak dicek'], open: ['Query N+1'] } },
    );
    expect(body).toMatch(/^## 👨‍🍳 Chef Juno — Skor \d\/5 · Dampak tinggi$/m);
    expect(body).toContain('**Temuan review sebelumnya** — ✅ 1 sudah beres · ⏳ 1 masih ada');
    expect(body).toContain('- ⏳ Query N+1');
    expect(body).toContain('- ✅ ~~Token tidak dicek~~');
    expect(body).toContain('<details><summary><b>Walkthrough</b> · perkiraan review ±25 menit</summary>');
    expect(body).toContain(
      '| Checkout voucher | `lib/shop/voucher_bloc.dart`, `lib/shop/ab.dart` | Membaca ulang paket sebelum menolak kode. |',
    );
    expect(body).toContain('```mermaid\nflowchart TD\n  A[Kode promo] --> B{Paket terbaru?}\n```');
  });

  it('hasil lama tanpa data reviewer akhir: tanpa walkthrough/diagram/dampak', () => {
    const body = formatSummaryComment(out(), [], [], ctx());
    expect(body).not.toContain('Walkthrough');
    expect(body).not.toContain('mermaid');
    expect(body).not.toContain('Dampak tinggi');
    expect(body).not.toContain('Temuan review sebelumnya');
  });
});

describe('baris uji aplikasi di ringkasan', () => {
  it('jalan → jumlah dicoba & terbukti; dipulihkan otomatis tercatat', () => {
    expect(
      appVerifyLine({
        ran: true,
        backend: 'emulator',
        repaired: true,
        scenarios: [{ status: 'reproduced' }, { status: 'inconclusive' }],
      }),
    ).toBe('🧪 Uji aplikasi (emulator lokal): 2 temuan dicoba, 1 terbukti · lingkungan emulator dipulihkan otomatis.');
  });
  it('dilewati karena masalah lingkungan → alasan tampil; alasan normal → tidak tampil', () => {
    expect(appVerifyLine({ ran: false, reason: 'emulator lokal belum menyala (port 8399 tidak menjawab)' })).toBe(
      '🧪 Uji aplikasi dilewati: emulator lokal belum menyala (port 8399 tidak menjawab)',
    );
    expect(appVerifyLine({ ran: false, reason: 'dimatikan di Pengaturan' })).toBeNull();
    expect(appVerifyLine({ ran: false, reason: 'tidak ada temuan P0/P1 yang bisa dicoba di aplikasi' })).toBeNull();
    expect(appVerifyLine(null)).toBeNull();
  });
  it('muncul di ringkasan PR', () => {
    const body = formatSummaryComment(out(), [], [], {
      ...ctx(),
      appVerify: { ran: false, reason: 'persiapan emulator gagal (x)' },
    });
    expect(body).toContain('<sub>🧪 Uji aplikasi dilewati: persiapan emulator gagal (x)</sub>');
  });
});

describe('gambar bukti inline', () => {
  it('hanya URL tautan bukti bertanda tangan yang dipasang sebagai <img>', () => {
    const good = 'https://chefjuno-ai.web.app/evidence?j=job1&s=f0-0&sig=0123456789abcdef0123456789abcdef';
    expect(evidenceImages([good], 'bukti')).toBe(`<img src="${good}" width="260" alt="bukti">`);
    expect(evidenceImages(['https://evil.example/x.png', 'javascript:alert(1)', `${good}"onerror="x`], 'bukti')).toBe(
      '',
    );
  });
  it('komentar inline memuat screenshot di bawah baris bukti', () => {
    const good = 'https://chefjuno-ai.web.app/evidence?j=job1&s=f0-0&sig=0123456789abcdef0123456789abcdef';
    const body = formatInlineComment(
      finding({ evidence: { status: 'reproduced', note: 'total Rp NaN', shots: ['f0-0'] } }),
      'f1',
      'https://chefjuno-ai.web.app/reviews/job0#bukti-f0-0',
      [good],
    );
    expect(body).toContain(
      '🧪 **Terbukti saat dicoba di aplikasi** — total Rp NaN · [detail di dashboard](https://chefjuno-ai.web.app/reviews/job0#bukti-f0-0)',
    );
    expect(body).toContain(`<img src="${good}"`);
  });
});

describe('formatRereviewReply', () => {
  const base = {
    login: 'xirf',
    requestUrl: 'https://github.example/o/r/pull/1#issuecomment-5',
    headSha: '0752c3dabcdef',
    verdict: 'Aman di-merge.',
    score: 4,
    incomplete: false,
    summaryUrl: 'https://github.example/o/r/pull/1#issuecomment-9',
  };
  it('membalas peminta: sudah diedit + inti perubahan (skor, beres, masih ada, baru)', () => {
    const b = formatRereviewReply({
      ...base,
      previousScore: 3,
      previous: { fixed: ['Jeda ikut terhitung'], open: ['Total waktu salah'] },
      added: ['Cache tidak dibersihkan'],
    });
    expect(b.split('\n')[0]).toBe(
      '@xirf Menjawab [permintaan review ulang](https://github.example/o/r/pull/1#issuecomment-5): hasil review sudah diperbarui (edit) di [komentar ringkasan](https://github.example/o/r/pull/1#issuecomment-9) untuk commit `0752c3d`.',
    );
    expect(b).toContain('- Skor: 3/5 → 4/5');
    expect(b).toContain('- ✅ Sudah beres (1): Jeda ikut terhitung');
    expect(b).toContain('- ⏳ Masih ada (1): Total waktu salah');
    expect(b).toContain('- 🆕 Temuan baru (1): Cache tidak dibersihkan');
    expect(b).toContain('> Aman di-merge.');
    expect(b).not.toContain(SUMMARY_MARKER);
  });
  it('skor sama & tanpa perubahan temuan; daftar panjang dipotong', () => {
    expect(formatRereviewReply({ ...base, previousScore: 4 })).toContain('- Skor tetap 4/5');
    expect(formatRereviewReply({ ...base, previousScore: 4 })).toContain('- Tidak ada perubahan temuan.');
    const many = formatRereviewReply({ ...base, added: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(many).toContain('- 🆕 Temuan baru (7): a; b; c; d; e; +2 lainnya');
  });
  it('review sebagian → skor dibatasi; skor lama tak diketahui tidak diklaim tetap; login aneh tidak di-mention', () => {
    const b = formatRereviewReply({
      ...base,
      score: 5,
      incomplete: true,
      login: 'x y`@z',
      summaryUrl: null,
      requestUrl: null,
    });
    expect(b).toContain(`- Skor: ${effectiveScore(5, true)}/5 (review sebagian)`);
    expect(b).not.toContain('tetap');
    expect(b).not.toContain('@');
    expect(b).toContain('komentar ringkasan Chef Juno di atas');
  });
});
