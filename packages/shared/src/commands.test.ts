import { describe, it, expect } from 'vitest';
import { COMMANDS, hasMention, helpText, mentionRegex, parseCommand, stripCode } from './commands.js';

describe('parseCommand — tabel §6.2', () => {
  it('`lapor @chefjuno` → review, kata sebelum mention', () => {
    expect(parseCommand('lapor @chefjuno')).toEqual({ kind: 'review', word: 'lapor', instruction: '' });
  });

  it('`@chefjuno lapor` → review, kata sesudah mention', () => {
    expect(parseCommand('@chefjuno lapor')).toEqual({ kind: 'review', word: 'lapor', instruction: '' });
  });

  it('`@chefjuno` saja → review tanpa kata perintah', () => {
    expect(parseCommand('@chefjuno')).toEqual({ kind: 'review', word: null, instruction: '' });
  });

  it('`@chefjuno cek bagian auth` → review dengan instruksi "bagian auth"', () => {
    expect(parseCommand('@chefjuno cek bagian auth')).toEqual({
      kind: 'review',
      word: 'cek',
      instruction: 'bagian auth',
    });
  });

  it('`@chefjuno lapor` + kalimat → instruksi = sisa kalimat', () => {
    expect(parseCommand('@chefjuno lapor   tolong fokus  ke query\nSQL')).toEqual({
      kind: 'review',
      word: 'lapor',
      instruction: 'tolong fokus ke query SQL',
    });
  });

  it('`@chefjuno bantuan` dan `@chefjuno help` → help', () => {
    expect(parseCommand('@chefjuno bantuan')).toEqual({ kind: 'help', word: 'bantuan', instruction: '' });
    expect(parseCommand('@chefjuno help')).toEqual({ kind: 'help', word: 'help', instruction: '' });
    expect(parseCommand('bantuan @chefjuno')).toEqual({ kind: 'help', word: 'bantuan', instruction: '' });
  });

  it('alias Inggris `review` diterima', () => {
    expect(parseCommand('@chefjuno review')).toEqual({ kind: 'review', word: 'review', instruction: '' });
    expect(parseCommand('review @chefjuno please')).toEqual({ kind: 'review', word: 'review', instruction: 'please' });
  });

  it('case-insensitive: `LAPOR @ChefJuno`', () => {
    expect(parseCommand('LAPOR @ChefJuno')).toEqual({ kind: 'review', word: 'lapor', instruction: '' });
    expect(parseCommand('@CHEFJUNO BANTUAN')).toEqual({ kind: 'help', word: 'bantuan', instruction: '' });
  });

  it('pemisah koma/titik dua setelah mention tetap dikenali', () => {
    expect(parseCommand('@chefjuno, cek bagian auth')).toEqual({
      kind: 'review',
      word: 'cek',
      instruction: 'bagian auth',
    });
    expect(parseCommand('@chefjuno: bantuan')).toEqual({ kind: 'help', word: 'bantuan', instruction: '' });
  });

  it('teks lain setelah mention → review dengan teks itu sebagai instruksi', () => {
    expect(parseCommand('@chefjuno tolong periksa race condition')).toEqual({
      kind: 'review',
      word: null,
      instruction: 'tolong periksa race condition',
    });
  });

  it('teks sebelum & sesudah mention tanpa kata perintah → semua jadi instruksi', () => {
    expect(parseCommand('Halo @chefjuno periksa ini ya')).toEqual({
      kind: 'review',
      word: null,
      instruction: 'Halo periksa ini ya',
    });
  });

  it('hanya kata yang menempel pada mention yang dianggap perintah', () => {
    // "bantuan" bukan kata pertama setelah mention → bukan perintah help
    expect(parseCommand('@chefjuno tolong bantuan')).toEqual({
      kind: 'review',
      word: null,
      instruction: 'tolong bantuan',
    });
  });

  it('mention di tengah kalimat multi-baris', () => {
    expect(parseCommand('Sudah saya perbaiki.\n\nlapor @chefjuno')).toEqual({
      kind: 'review',
      word: 'lapor',
      instruction: 'Sudah saya perbaiki.',
    });
  });

  it('mention di dalam inline code diabaikan → null', () => {
    expect(parseCommand('jalankan `lapor @chefjuno` untuk review')).toBeNull();
    expect(parseCommand('`@chefjuno`')).toBeNull();
  });

  it('mention di dalam fenced block diabaikan → null', () => {
    expect(parseCommand('Contoh:\n```\n@chefjuno lapor\n```\nselesai')).toBeNull();
    expect(parseCommand('Contoh:\n~~~md\n@chefjuno lapor\n~~~')).toBeNull();
    // blok kode yang tidak ditutup juga dibuang sampai akhir teks
    expect(parseCommand('```\n@chefjuno lapor')).toBeNull();
  });

  it('mention di luar kode tetap terdeteksi walau ada mention di dalam kode', () => {
    expect(parseCommand('`@chefjuno bantuan` lalu @chefjuno lapor')).toEqual({
      kind: 'review',
      word: 'lapor',
      instruction: 'lalu',
    });
  });

  it('`email@chefjuno.com` bukan mention', () => {
    expect(parseCommand('kirim ke email@chefjuno.com ya')).toBeNull();
    expect(parseCommand('foo@chefjuno')).toBeNull();
  });

  it('handle lain yang diawali chefjuno bukan mention (`@chefjunobot`)', () => {
    expect(parseCommand('@chefjunobot lapor')).toBeNull();
  });

  it('tanpa mention → null', () => {
    expect(parseCommand('lapor')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('handle kustom', () => {
    expect(parseCommand('@juru lapor', 'juru')).toEqual({ kind: 'review', word: 'lapor', instruction: '' });
    expect(parseCommand('@chefjuno lapor', 'juru')).toBeNull();
  });
});

describe('hasMention', () => {
  it('true untuk mention di awal, tengah, setelah baris baru, case-insensitive', () => {
    expect(hasMention('@chefjuno')).toBe(true);
    expect(hasMention('tolong @chefjuno lapor')).toBe(true);
    expect(hasMention('baris satu\n@ChefJuno')).toBe(true);
  });

  it('false di dalam kode atau email', () => {
    expect(hasMention('`@chefjuno`')).toBe(false);
    expect(hasMention('```\n@chefjuno\n```')).toBe(false);
    expect(hasMention('email@chefjuno.com')).toBe(false);
    expect(hasMention('tidak ada apa-apa')).toBe(false);
  });

  it('mentionRegex sama dengan pola spec /(^|\\s)@chefjuno\\b/i', () => {
    expect(mentionRegex().source).toBe('(^|\\s)@chefjuno\\b');
    expect(mentionRegex().flags).toContain('i');
  });
});

describe('stripCode', () => {
  it('membuang code span dan blok kode', () => {
    expect(stripCode('a `b` c')).toBe('a   c');
    expect(stripCode('x\n```ts\nconst y = 1;\n```\nz')).toBe('x\n \nz');
  });
});

describe('COMMANDS & helpText', () => {
  it('kata perintah utama Indonesia + alias Inggris', () => {
    expect(COMMANDS.review.words).toEqual(['lapor', 'cek', 'review']);
    expect(COMMANDS.help.words).toEqual(['bantuan', 'help']);
  });

  it('helpText menyebut perintah & format balasan', () => {
    const t = helpText();
    expect(t).toContain('`lapor @chefjuno`');
    expect(t).toContain('`@chefjuno bantuan`');
    expect(t).toContain('chefjuno: diperbaiki');
    expect(t).toContain('chefjuno: tidak diperbaiki');
  });
});

describe('perintah ingat (memory Chef Juno)', () => {
  it('`@chefjuno ingat <fakta>` dan `catat` → remember dengan fakta sebagai instruksi', () => {
    expect(parseCommand('@chefjuno ingat akun uji harus premium')).toEqual({
      kind: 'remember',
      word: 'ingat',
      instruction: 'akun uji harus premium',
    });
    expect(parseCommand('catat @chefjuno: akun A punya riwayat kuis')?.kind).toBe('remember');
  });
});
