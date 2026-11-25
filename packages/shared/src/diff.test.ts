import { describe, it, expect } from 'vitest';
import { mapToDiff, parseUnifiedDiff, rangeTouchesHunks } from './diff.js';

const lines = (...l: string[]) => l.join('\n') + '\n';

/** Modifikasi file: hunk 1 (baris 10–16 head) dan hunk 2 (baris 40–43 head). */
const MODIFY = lines(
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 3b18e51..a9c2f0d 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -10,5 +10,7 @@ export function login(user: User) {',
  '   const token = sign(user);',
  '-  if (!token) return null;',
  '+  if (!token) {',
  '+    throw new Error("no token");',
  '+  }',
  '   audit(user);',
  '   return token;',
  ' }',
  '@@ -39,4 +41,3 @@ export function logout() {',
  '   clear();',
  '-  log("bye");',
  '-  flush();',
  '+  flush(true);',
  '   return;',
);

const NEW_FILE = lines(
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  'index 0000000..e69de29',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,3 @@',
  '+export const a = 1;',
  '+export const b = 2;',
  '+export const c = 3;',
  '\\ No newline at end of file',
);

const DELETED_FILE = lines(
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  'index e69de29..0000000',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-export const x = 1;',
  '-export const y = 2;',
);

const RENAME = lines(
  'diff --git a/src/util/old-name.ts b/src/util/new-name.ts',
  'similarity index 90%',
  'rename from src/util/old-name.ts',
  'rename to src/util/new-name.ts',
  'index 1111111..2222222 100644',
  '--- a/src/util/old-name.ts',
  '+++ b/src/util/new-name.ts',
  '@@ -1,3 +1,3 @@',
  ' export function f() {',
  '-  return 1;',
  '+  return 2;',
  ' }',
);

const NO_NEWLINE = lines(
  'diff --git a/README.md b/README.md',
  'index aaaaaaa..bbbbbbb 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,2 +1,3 @@',
  ' # Judul',
  '-teks lama',
  '\\ No newline at end of file',
  '+teks baru',
  '+baris tambahan',
  '\\ No newline at end of file',
);

/** Hunk yang hanya menghapus (tanpa baris baru). */
const PURE_DELETE_HUNK = lines(
  'diff --git a/src/del.ts b/src/del.ts',
  'index 1..2 100644',
  '--- a/src/del.ts',
  '+++ b/src/del.ts',
  '@@ -20,2 +19,0 @@ function g() {',
  '-  dead();',
  '-  code();',
);

/** Isi baris yang mirip header (`--- `, `+++ `) di dalam hunk tetap dihitung sebagai isi. */
const HEADER_LOOKALIKE = lines(
  'diff --git a/q.sql b/q.sql',
  'index 1..2 100644',
  '--- a/q.sql',
  '+++ b/q.sql',
  '@@ -1,2 +1,2 @@',
  '--- komentar lama',
  '+++ komentar baru',
  ' SELECT 1;',
);

const ALL = MODIFY + NEW_FILE + DELETED_FILE + RENAME + NO_NEWLINE + PURE_DELETE_HUNK + HEADER_LOOKALIKE;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(ALL);

  it('mengenali semua file', () => {
    expect([...files.keys()].sort()).toEqual(
      ['README.md', 'q.sql', 'src/auth.ts', 'src/del.ts', 'src/new.ts', 'src/old.ts', 'src/util/new-name.ts'].sort(),
    );
  });

  it('baris tambah & konteks masuk rightLines, baris tambah masuk addedLines (multi hunk)', () => {
    const f = files.get('src/auth.ts')!;
    expect(f.oldPath).toBe('src/auth.ts');
    expect(f.deleted).toBe(false);
    expect([...f.rightLines].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15, 16, 41, 42, 43]);
    expect([...f.addedLines].sort((a, b) => a - b)).toEqual([11, 12, 13, 42]);
    expect(f.hunks).toEqual([
      { oldStart: 10, oldLines: 5, newStart: 10, newLines: 7 },
      { oldStart: 39, oldLines: 4, newStart: 41, newLines: 3 },
    ]);
  });

  it('file baru: oldPath null, semua baris ditambah', () => {
    const f = files.get('src/new.ts')!;
    expect(f.oldPath).toBeNull();
    expect(f.deleted).toBe(false);
    expect([...f.addedLines]).toEqual([1, 2, 3]);
    expect([...f.rightLines]).toEqual([1, 2, 3]);
  });

  it('file dihapus: deleted true, path = path lama, tanpa baris RIGHT', () => {
    const f = files.get('src/old.ts')!;
    expect(f.deleted).toBe(true);
    expect(f.path).toBe('src/old.ts');
    expect(f.rightLines.size).toBe(0);
  });

  it('rename: path = baru, oldPath = lama', () => {
    expect(files.has('src/util/old-name.ts')).toBe(false);
    const f = files.get('src/util/new-name.ts')!;
    expect(f.path).toBe('src/util/new-name.ts');
    expect(f.oldPath).toBe('src/util/old-name.ts');
    expect([...f.rightLines]).toEqual([1, 2, 3]);
    expect([...f.addedLines]).toEqual([2]);
  });

  it('`\\ No newline at end of file` tidak menggeser nomor baris', () => {
    const f = files.get('README.md')!;
    expect([...f.rightLines]).toEqual([1, 2, 3]);
    expect([...f.addedLines]).toEqual([2, 3]);
  });

  it('hunk hapus murni: tanpa baris RIGHT, newLines 0', () => {
    const f = files.get('src/del.ts')!;
    expect(f.rightLines.size).toBe(0);
    expect(f.hunks).toEqual([{ oldStart: 20, oldLines: 2, newStart: 19, newLines: 0 }]);
  });

  it('baris isi yang mirip header `--- `/`+++ ` di dalam hunk dihitung sebagai hapus/tambah', () => {
    const f = files.get('q.sql')!;
    expect([...f.addedLines]).toEqual([1]);
    expect([...f.rightLines]).toEqual([1, 2]);
  });

  it('hunk header tanpa jumlah baris (`@@ -5 +5 @@`) → jumlah 1', () => {
    const d = lines('diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -5 +5 @@', '-a', '+b');
    const f = parseUnifiedDiff(d).get('x')!;
    expect(f.hunks).toEqual([{ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1 }]);
    expect([...f.addedLines]).toEqual([5]);
  });

  it('diff kosong → map kosong', () => {
    expect(parseUnifiedDiff('').size).toBe(0);
  });
});

describe('mapToDiff (sisi RIGHT)', () => {
  const files = parseUnifiedDiff(ALL);

  it('baris tambah bisa dipetakan', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 12, startLine: null }, files)).toEqual({
      path: 'src/auth.ts',
      line: 12,
      startLine: null,
    });
  });

  it('baris konteks bisa dipetakan', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 10, startLine: null }, files)).toEqual({
      path: 'src/auth.ts',
      line: 10,
      startLine: null,
    });
  });

  it('baris yang hanya dihapus (tidak ada di head) tidak bisa dipetakan', () => {
    // baris 44 lama sudah hilang; hunk 2 head hanya 41–43
    expect(mapToDiff({ path: 'src/auth.ts', line: 44, startLine: null }, files)).toBeNull();
    expect(mapToDiff({ path: 'src/del.ts', line: 19, startLine: null }, files)).toBeNull();
    expect(mapToDiff({ path: 'src/del.ts', line: 20, startLine: null }, files)).toBeNull();
  });

  it('baris di luar diff → null', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 30, startLine: null }, files)).toBeNull();
    expect(mapToDiff({ path: 'src/auth.ts', line: 1, startLine: null }, files)).toBeNull();
  });

  it('file yang tidak ada di diff → null', () => {
    expect(mapToDiff({ path: 'src/lain.ts', line: 1, startLine: null }, files)).toBeNull();
  });

  it('file dihapus → null', () => {
    expect(mapToDiff({ path: 'src/old.ts', line: 1, startLine: null }, files)).toBeNull();
  });

  it('file baru bisa dipetakan', () => {
    expect(mapToDiff({ path: 'src/new.ts', line: 3, startLine: 1 }, files)).toEqual({
      path: 'src/new.ts',
      line: 3,
      startLine: 1,
    });
  });

  it('rename: dipetakan lewat path baru, path lama → null', () => {
    expect(mapToDiff({ path: 'src/util/new-name.ts', line: 2, startLine: null }, files)).toEqual({
      path: 'src/util/new-name.ts',
      line: 2,
      startLine: null,
    });
    expect(mapToDiff({ path: 'src/util/old-name.ts', line: 2, startLine: null }, files)).toBeNull();
  });

  it('path diawali `./` atau `/` dinormalisasi', () => {
    expect(mapToDiff({ path: './src/auth.ts', line: 11, startLine: null }, files)?.path).toBe('src/auth.ts');
    expect(mapToDiff({ path: '/src/auth.ts', line: 11, startLine: null }, files)?.path).toBe('src/auth.ts');
  });

  it('multi-baris valid: semua baris start..line ada di hunk', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 13, startLine: 11 }, files)).toEqual({
      path: 'src/auth.ts',
      line: 13,
      startLine: 11,
    });
  });

  it('multi-baris melintasi celah antar hunk → startLine dibuang, line tetap', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 41, startLine: 15 }, files)).toEqual({
      path: 'src/auth.ts',
      line: 41,
      startLine: null,
    });
  });

  it('multi-baris dengan startLine di luar diff → startLine null', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 11, startLine: 5 }, files)).toEqual({
      path: 'src/auth.ts',
      line: 11,
      startLine: null,
    });
  });

  it('startLine >= line → startLine null', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 12, startLine: 12 }, files)?.startLine).toBeNull();
    expect(mapToDiff({ path: 'src/auth.ts', line: 12, startLine: 14 }, files)?.startLine).toBeNull();
  });

  it('line di luar diff → null walau startLine valid', () => {
    expect(mapToDiff({ path: 'src/auth.ts', line: 20, startLine: 12 }, files)).toBeNull();
  });

  it('`\\ No newline at end of file`: baris terakhir tetap bisa dipetakan', () => {
    expect(mapToDiff({ path: 'README.md', line: 3, startLine: 1 }, files)).toEqual({
      path: 'README.md',
      line: 3,
      startLine: 1,
    });
    expect(mapToDiff({ path: 'README.md', line: 4, startLine: null }, files)).toBeNull();
  });
});

describe('rangeTouchesHunks', () => {
  const files = parseUnifiedDiff(ALL);

  it('true kalau range memuat baris tambah', () => {
    expect(rangeTouchesHunks(files.get('src/auth.ts'), 1, 11)).toBe(true);
    expect(rangeTouchesHunks(files.get('src/auth.ts'), 42, 42)).toBe(true);
  });

  it('false kalau range hanya memuat konteks / di luar hunk', () => {
    expect(rangeTouchesHunks(files.get('src/auth.ts'), 14, 16)).toBe(false);
    expect(rangeTouchesHunks(files.get('src/auth.ts'), 20, 30)).toBe(false);
  });

  it('true untuk hunk hapus murni di dalam range', () => {
    expect(rangeTouchesHunks(files.get('src/del.ts'), 17, 21)).toBe(true);
    expect(rangeTouchesHunks(files.get('src/del.ts'), 1, 10)).toBe(false);
  });

  it('file tidak ada → false', () => {
    expect(rangeTouchesHunks(undefined, 1, 100)).toBe(false);
  });
});
