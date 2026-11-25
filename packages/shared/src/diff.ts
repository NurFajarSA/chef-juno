/**
 * Parser unified diff → baris sisi RIGHT (head) yang bisa diberi komentar inline.
 * GitHub hanya menerima komentar pada baris yang ada di hunk (tambah atau konteks).
 */
export interface DiffFile {
  path: string;
  oldPath: string | null;
  /** baris RIGHT (nomor baris file head) yang ada di hunk */
  rightLines: Set<number>;
  /** baris yang ditambah */
  addedLines: Set<number>;
  hunks: { newStart: number; newLines: number; oldStart: number; oldLines: number }[];
  deleted: boolean;
}

export function parseUnifiedDiff(diff: string): Map<string, DiffFile> {
  const files = new Map<string, DiffFile>();
  let cur: DiffFile | null = null;
  let newLine = 0;
  let inHunk = false;
  let pendingOld: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = null;
      inHunk = false;
      pendingOld = null;
      continue;
    }
    if (line.startsWith('--- ') && !inHunk) {
      const p = line.slice(4).trim();
      pendingOld = p === '/dev/null' ? null : p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ') && !inHunk) {
      const p = line.slice(4).trim();
      const deleted = p === '/dev/null';
      const path = deleted ? (pendingOld ?? '') : p.replace(/^b\//, '');
      cur = { path, oldPath: pendingOld, rightLines: new Set(), addedLines: new Set(), hunks: [], deleted };
      files.set(path, cur);
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) {
      inHunk = true;
      newLine = Number(h[3]);
      cur.hunks.push({
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: newLine,
        newLines: h[4] === undefined ? 1 : Number(h[4]),
      });
      continue;
    }
    if (!cur || !inHunk) continue;
    if (line.startsWith('+')) {
      cur.rightLines.add(newLine);
      cur.addedLines.add(newLine);
      newLine++;
    } else if (line.startsWith(' ')) {
      cur.rightLines.add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      // baris LEFT saja
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
    } else if (line === '') {
      // baris kosong di akhir file diff / konteks kosong tanpa spasi
    } else {
      inHunk = false;
    }
  }
  return files;
}

export interface Mappable {
  path: string;
  line: number;
  startLine: number | null;
}

export interface MappedLocation {
  path: string;
  line: number;
  startLine: number | null;
}

/** Petakan temuan ke baris diff RIGHT; null kalau tidak bisa (→ "Temuan lain"). */
export function mapToDiff(f: Mappable, files: Map<string, DiffFile>): MappedLocation | null {
  const file = files.get(f.path.replace(/^\.?\//, ''));
  if (!file || file.deleted) return null;
  if (!file.rightLines.has(f.line)) return null;
  let startLine: number | null = null;
  if (f.startLine != null && f.startLine < f.line) {
    let ok = true;
    for (let l = f.startLine; l <= f.line; l++) if (!file.rightLines.has(l)) ok = false;
    if (ok) startLine = f.startLine;
  }
  return { path: file.path, line: f.line, startLine };
}

/** Apakah range [start,end] beririsan dengan hunk mana pun di sisi head. */
export function rangeTouchesHunks(file: DiffFile | undefined, start: number, end: number): boolean {
  if (!file) return false;
  for (const l of file.addedLines) if (l >= start && l <= end) return true;
  for (const hk of file.hunks) {
    // hapus murni: hunk tanpa baris baru tapi berada di dalam range
    if (hk.newLines === 0 && hk.newStart >= start && hk.newStart <= end) return true;
  }
  return false;
}
