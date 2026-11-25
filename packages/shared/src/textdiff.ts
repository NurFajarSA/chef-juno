/** Diff baris (LCS) untuk tampilan "Bandingkan" versi prompt, side-by-side. */
export type DiffOp = { type: 'same' | 'add' | 'del'; left: number | null; right: number | null; text: string };

export function diffLines(a: string, b: string): DiffOp[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: 'same', left: i + 1, right: j + 1, text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', left: i + 1, right: null, text: A[i] });
      i++;
    } else {
      out.push({ type: 'add', left: null, right: j + 1, text: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', left: i + 1, right: null, text: A[i++] });
  while (j < m) out.push({ type: 'add', left: null, right: j + 1, text: B[j++] });
  return out;
}

export interface SideBySideRow {
  left: { n: number; text: string; type: 'same' | 'del' } | null;
  right: { n: number; text: string; type: 'same' | 'add' } | null;
}

/** Pasangkan hapus/tambah yang berurutan supaya tampil sejajar kiri-kanan. */
export function sideBySide(ops: DiffOp[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.type === 'same') {
      rows.push({
        left: { n: op.left!, text: op.text, type: 'same' },
        right: { n: op.right!, text: op.text, type: 'same' },
      });
      k++;
      continue;
    }
    const dels: DiffOp[] = [];
    const adds: DiffOp[] = [];
    while (k < ops.length && ops[k].type !== 'same') (ops[k].type === 'del' ? dels : adds).push(ops[k++]);
    for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
      rows.push({
        left: dels[x] ? { n: dels[x].left!, text: dels[x].text, type: 'del' } : null,
        right: adds[x] ? { n: adds[x].right!, text: adds[x].text, type: 'add' } : null,
      });
    }
  }
  return rows;
}

export function diffStats(ops: DiffOp[]) {
  return { added: ops.filter((o) => o.type === 'add').length, removed: ops.filter((o) => o.type === 'del').length };
}
