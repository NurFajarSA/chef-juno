import { describe, it, expect } from 'vitest';
import {
  DISPUTE_RE,
  SUPPRESSION_THRESHOLD,
  classifyOutcome,
  emptySignals,
  isSuppressed,
  jaccard,
  parseAiCoderReply,
  trigrams,
  type FindingSignals,
  type SuppressionRule,
} from './memory.js';

describe('trigrams & jaccard', () => {
  it('trigram dengan padding spasi, lowercase, tanpa tanda baca, unik', () => {
    expect(trigrams('Abc')).toEqual([' ab', 'abc', 'bc ']);
    expect(trigrams('a-b')).toEqual([' a ', 'a b', ' b ']);
    expect(trigrams('aaaa')).toEqual([' aa', 'aaa', 'aa ']);
  });

  it('teks kosong / hanya tanda baca → tanpa trigram', () => {
    expect(trigrams('')).toEqual([]);
    expect(trigrams('!!!')).toEqual([]);
  });

  it('huruf non-ASCII dipertahankan', () => {
    expect(trigrams('Ñandú')).toContain('ñan');
  });

  it('jaccard: identik = 1, terpisah = 0, keduanya kosong = 0', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a'], [])).toBe(0);
  });

  it('jaccard: irisan / gabungan, duplikat diabaikan', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
    expect(jaccard(['a', 'a', 'b'], ['a'])).toBe(0.5);
  });
});

describe('isSuppressed (§12.10)', () => {
  const rule: SuppressionRule = {
    id: 'r1',
    match: { category: 'maintainability', titleTrigrams: trigrams('Fungsi terlalu panjang') },
  };

  it('threshold 0.5', () => {
    expect(SUPPRESSION_THRESHOLD).toBe(0.5);
  });

  it('judul mirip + kategori sama → aturan dikembalikan', () => {
    const f = { title: 'Fungsi ini terlalu panjang', category: 'maintainability' as const, severity: 'P2' as const };
    expect(jaccard(trigrams(f.title), rule.match.titleTrigrams)).toBeGreaterThanOrEqual(0.5);
    expect(isSuppressed(f, [rule])).toBe(rule);
  });

  it('judul identik beda huruf besar/tanda baca tetap ditekan', () => {
    expect(
      isSuppressed({ title: 'FUNGSI TERLALU PANJANG!', category: 'maintainability', severity: 'P1' }, [rule]),
    ).toBe(rule);
  });

  it('kategori berbeda → null', () => {
    expect(isSuppressed({ title: 'Fungsi terlalu panjang', category: 'bug', severity: 'P2' }, [rule])).toBeNull();
  });

  it('judul tidak mirip → null', () => {
    const f = { title: 'Query N+1 di loop', category: 'maintainability' as const, severity: 'P2' as const };
    expect(jaccard(trigrams(f.title), rule.match.titleTrigrams)).toBeLessThan(0.5);
    expect(isSuppressed(f, [rule])).toBeNull();
  });

  it('tidak pernah menekan security, walau aturan cocok persis', () => {
    const sec: SuppressionRule = { id: 's', match: { category: 'security', titleTrigrams: trigrams('Token bocor') } };
    expect(isSuppressed({ title: 'Token bocor', category: 'security', severity: 'P2' }, [sec])).toBeNull();
  });

  it('tidak pernah menekan P0, walau aturan cocok persis', () => {
    expect(
      isSuppressed({ title: 'Fungsi terlalu panjang', category: 'maintainability', severity: 'P0' }, [rule]),
    ).toBeNull();
  });

  it('mengembalikan aturan pertama yang cocok di antara beberapa', () => {
    const other: SuppressionRule = {
      id: 'r0',
      match: { category: 'bug', titleTrigrams: trigrams('Fungsi terlalu panjang') },
    };
    const dup: SuppressionRule = { ...rule, id: 'r2' };
    expect(
      isSuppressed({ title: 'Fungsi terlalu panjang', category: 'maintainability', severity: 'P2' }, [other, rule, dup])
        ?.id,
    ).toBe('r1');
  });

  it('tanpa aturan → null', () => {
    expect(isSuppressed({ title: 'x', category: 'bug', severity: 'P2' }, [])).toBeNull();
  });
});

describe('parseAiCoderReply (§6.8)', () => {
  it.each([
    ['chefjuno: diperbaiki', { verdict: 'fixed', reason: null, sha: null }],
    ['chefjuno: diperbaiki di abc1234', { verdict: 'fixed', reason: null, sha: 'abc1234' }],
    [
      '@chefjuno: sudah diperbaiki di 0123456789abcdef0123456789abcdef01234567',
      {
        verdict: 'fixed',
        reason: null,
        sha: '0123456789abcdef0123456789abcdef01234567',
      },
    ],
    ['Chefjuno: Fixed', { verdict: 'fixed', reason: null, sha: null }],
    ['chefjuno: fixed in deadbee', { verdict: 'fixed', reason: null, sha: 'deadbee' }],
    ['CHEFJUNO: done', { verdict: 'fixed', reason: null, sha: null }],
    ['chefjuno: diperbaiki (commit 9f8e7d6)', { verdict: 'fixed', reason: null, sha: '9f8e7d6' }],
    [
      'chefjuno: tidak diperbaiki — sengaja, sudah dicek di guard',
      {
        verdict: 'wont_fix',
        reason: 'sengaja, sudah dicek di guard',
        sha: null,
      },
    ],
    ['chefjuno: tidak diperbaiki - di luar scope', { verdict: 'wont_fix', reason: 'di luar scope', sha: null }],
    ['chefjuno: tidak diperbaiki', { verdict: 'wont_fix', reason: null, sha: null }],
    ['chefjuno: gak diperbaiki: false positive', { verdict: 'wont_fix', reason: 'false positive', sha: null }],
    ["chefjuno: won't fix: out of scope", { verdict: 'wont_fix', reason: 'out of scope', sha: null }],
    ['chefjuno: wont fix - false positive', { verdict: 'wont_fix', reason: 'false positive', sha: null }],
    ['chefjuno: wontfix', { verdict: 'wont_fix', reason: null, sha: null }],
    ['chefjuno: Will not fix, by design', { verdict: 'wont_fix', reason: 'by design', sha: null }],
    ['  chefjuno : diperbaiki  ', { verdict: 'fixed', reason: null, sha: null }],
  ])('%j', (text, expected) => {
    expect(parseAiCoderReply(text)).toEqual(expected);
  });

  it('hanya baris pertama yang dibaca', () => {
    expect(parseAiCoderReply('chefjuno: diperbaiki\n\nchefjuno: tidak diperbaiki — x')).toEqual({
      verdict: 'fixed',
      reason: null,
      sha: null,
    });
    expect(parseAiCoderReply('Terima kasih!\nchefjuno: diperbaiki')).toBeNull();
  });

  it('kata hex biasa setelah "fixed" bukan sha (mis. "feedback")', () => {
    expect(parseAiCoderReply('chefjuno: fixed — added feedback handling')).toEqual({
      verdict: 'fixed',
      reason: null,
      sha: null,
    });
  });

  it.each([
    'oke makasih, nanti saya cek',
    'chefjuno lapor',
    'chefjuno: mungkin nanti',
    'chefjuno: diperbaikinya besok',
    'kata chefjuno: diperbaiki',
    '',
  ])('teks lain → null: %j', (text) => {
    expect(parseAiCoderReply(text)).toBeNull();
  });
});

describe('classifyOutcome (§6.8)', () => {
  const s = (o: Partial<FindingSignals>): FindingSignals => ({ ...emptySignals(), ...o });
  const reply = (login: string, text: string) => ({ login, text });

  it.each<[string, FindingSignals, boolean, string]>([
    ['kode berubah → addressed', s({ codeChangedAfter: true }), true, 'addressed'],
    ['kode berubah, tidak merge → addressed', s({ codeChangedAfter: true }), false, 'addressed'],
    ['AI coder fixed → addressed', s({ aiCoderReply: { verdict: 'fixed', reason: null } }), false, 'addressed'],
    ['kode berubah menang atas 👎', s({ codeChangedAfter: true, thumbsDown: 3 }), true, 'addressed'],
    ['👎 > 👍 → disputed', s({ thumbsDown: 1 }), true, 'disputed'],
    ['👎 == 👍 bukan dispute', s({ thumbsDown: 1, thumbsUp: 1 }), true, 'accepted_by_merge'],
    ['👍 saja + merge → accepted_by_merge', s({ thumbsUp: 2 }), true, 'accepted_by_merge'],
    [
      'balasan manusia membantah → disputed',
      s({ humanReplies: [reply('dev', 'Ini sengaja, by design')] }),
      true,
      'disputed',
    ],
    ['balasan "false positive" → disputed', s({ humanReplies: [reply('dev', 'false positive')] }), false, 'disputed'],
    ['balasan netral bukan dispute', s({ humanReplies: [reply('dev', 'oke, makasih')] }), false, 'ignored'],
    [
      'AI coder wont_fix → disputed',
      s({ aiCoderReply: { verdict: 'wont_fix', reason: 'di luar scope' } }),
      true,
      'disputed',
    ],
    [
      'wont_fix menang atas thread resolved',
      s({ aiCoderReply: { verdict: 'wont_fix', reason: null }, threadResolved: true }),
      true,
      'disputed',
    ],
    ['thread resolved → addressed', s({ threadResolved: true }), false, 'addressed'],
    ['merged tanpa sinyal → accepted_by_merge', s({}), true, 'accepted_by_merge'],
    ['tidak merge tanpa sinyal → ignored', s({}), false, 'ignored'],
    ['aiCoderReply verdict null diabaikan', s({ aiCoderReply: { verdict: null, reason: null } }), false, 'ignored'],
  ])('%s', (_name, signals, merged, expected) => {
    expect(classifyOutcome(signals, merged)).toBe(expected);
  });

  it('DISPUTE_RE mengenali kata bantahan ID & EN', () => {
    for (const t of [
      'salah',
      'Keliru',
      'tidak relevan',
      'bukan masalah',
      'sengaja',
      'by design',
      'intended',
      'not an issue',
    ])
      expect(DISPUTE_RE.test(t)).toBe(true);
    expect(DISPUTE_RE.test('sudah diperbaiki, makasih')).toBe(false);
  });

  it('emptySignals memberi objek baru tiap panggilan', () => {
    const a = emptySignals();
    a.humanReplies.push(reply('x', 'y'));
    expect(emptySignals().humanReplies).toEqual([]);
  });
});
