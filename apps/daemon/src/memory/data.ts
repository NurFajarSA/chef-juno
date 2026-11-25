import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { trigrams, jaccard, type Mistake, type PersonData, type RuleData } from '@chefjuno/shared';

export { buildMemoryMarkdown, topMistakes, type Mistake, type PersonData, type RuleData } from '@chefjuno/shared';

/** Aturan memory tim untuk penguji aplikasi (teks diawali "Uji aplikasi:"), bukan untuk reviewer kode. */
export const isAppRule = (text: string) => /^\s*uji aplikasi\s*:/i.test(text);

/** Aturan tim aktif (mesin hanya boleh membaca rules berstatus active). */
export async function loadActiveRules(db: Firestore): Promise<RuleData[]> {
  const snap = await getDocs(query(collection(db, 'rules'), where('status', '==', 'active')));
  return snap.docs.map((d) => ({
    id: d.id,
    text: String(d.get('text')),
    kind: d.get('kind') ?? 'rule',
    category: d.get('category') ?? 'maintainability',
    scope: { repoId: d.get('scope.repoId') ?? null, paths: d.get('scope.paths') ?? [] },
  }));
}

export async function loadPerson(db: Firestore, login: string): Promise<PersonData> {
  const s = await getDoc(doc(db, `people/${login}`));
  return { login, recurringMistakes: s.get('recurringMistakes') ?? [], lessons: s.get('lessons') ?? [] };
}

export function pathMatches(paths: string[], files: string[]): boolean {
  if (!paths.length) return true;
  return files.some((f) =>
    paths.some(
      (p) => f === p || f.startsWith(p.replace(/\*+$/, '').replace(/\/?$/, '/')) || f.startsWith(p.replace(/\*+$/, '')),
    ),
  );
}

/** Aturan yang berlaku untuk repo + file yang disentuh (global + repo + path). */
/** Fakta memory Chef Juno untuk repo ini (atau semua repo). */
export function repoFacts(rules: RuleData[], repoId: string | number | null): RuleData[] {
  return rules.filter(
    (r) => r.kind === 'fact' && (r.scope.repoId == null || String(r.scope.repoId) === String(repoId)),
  );
}

export function applicableRules(rules: RuleData[], repoId: string | number | null, files: string[]): RuleData[] {
  return rules.filter(
    (r) =>
      r.kind === 'rule' &&
      (r.scope.repoId == null || String(r.scope.repoId) === String(repoId)) &&
      pathMatches(r.scope.paths, files),
  );
}

const STOP = new Set([
  'yang',
  'tidak',
  'untuk',
  'dengan',
  'dari',
  'pada',
  'sebelum',
  'dipakai',
  'harus',
  'belum',
  'this',
  'that',
  'with',
]);

/** Cocokkan diff lokal dengan kesalahan yang sering diulang — deterministik, tanpa LLM. */
export function precheckDiff(
  diff: string,
  mistakes: Mistake[],
): { mistake: string; file: string; line: number; text: string; score: number }[] {
  const hits: { mistake: string; file: string; line: number; text: string; score: number }[] = [];
  let file = '';
  let ln = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.slice(4).replace(/^b\//, '');
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (l.startsWith('+')) {
      const text = l.slice(1);
      for (const m of mistakes) {
        const kws = m.title
          .toLowerCase()
          .split(/[^\p{L}\p{N}_]+/u)
          .filter((w) => w.length >= 4 && !STOP.has(w));
        const low = text.toLowerCase();
        const kwHit = kws.filter((k) => low.includes(k)).length;
        const sim = jaccard(trigrams(text), trigrams(m.title));
        const score = kwHit / Math.max(1, kws.length) + sim;
        if (kwHit > 0 && score >= 0.3)
          hits.push({
            mistake: m.title,
            file,
            line: ln,
            text: text.trim().slice(0, 200),
            score: Math.round(score * 100) / 100,
          });
      }
      ln++;
    } else if (l.startsWith(' ')) ln++;
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 50);
}
