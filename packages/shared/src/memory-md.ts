// Markdown memori untuk agent pribadi — dipakai CLI `chefjuno memory pull` dan tombol "Salin memori untuk agent".
export interface RuleData {
  id: string;
  text: string;
  /** fact = hal yang diingat Chef Juno (dari uji aplikasi, `@chefjuno ingat`, dashboard) */
  kind: 'rule' | 'suppression' | 'fact';
  category: string;
  scope: { repoId: string | null; paths: string[] };
}

export interface Mistake {
  key: string;
  title: string;
  category: string;
  count: number;
  trend?: string;
}

export interface PersonData {
  login: string;
  recurringMistakes: Mistake[];
  lessons: { text: string; prNumber?: number | null; at?: string }[];
}

export function topMistakes(p: PersonData, n = 3): Mistake[] {
  return [...p.recurringMistakes].sort((a, b) => b.count - a.count).slice(0, n);
}

/** Markdown memori untuk agent pribadi (`chefjuno memory pull`, tombol "Salin memori untuk agent"). */
export function buildMemoryMarkdown(
  login: string,
  rules: RuleData[],
  person: PersonData,
  repoId: string | null = null,
): string {
  const team = rules.filter(
    (r) => r.kind === 'rule' && (repoId == null || r.scope.repoId == null || String(r.scope.repoId) === repoId),
  );
  const lines = [
    `# Memori Chef Juno untuk @${login}`,
    '',
    '_Dibangkitkan oleh `chefjuno memory pull`. Pakai sebagai konteks saat menulis kode; jangan diedit manual._',
    '',
    '## Aturan tim (aktif)',
    ...(team.length
      ? team.map((r) => `- ${r.text}${r.scope.paths.length ? ` _(path: ${r.scope.paths.join(', ')})_` : ''}`)
      : ['- (belum ada)']),
    '',
    '## Kesalahan yang sering kamu ulangi',
    ...(person.recurringMistakes.length
      ? topMistakes(person, 10).map(
          (m) =>
            `- **${m.title}** (${m.category}, ${m.count}x${m.trend === 'up' ? ', naik' : m.trend === 'down' ? ', turun' : ''}) — periksa ini sebelum membuka PR.`,
        )
      : ['- (belum ada)']),
    '',
    '## Pelajaran terbaru',
    ...(person.lessons.length
      ? person.lessons.slice(0, 10).map((l) => `- ${l.text}${l.prNumber ? ` (PR #${l.prNumber})` : ''}`)
      : ['- (belum ada)']),
    '',
    '## Saat membalas temuan Chef Juno',
    '- `chefjuno: diperbaiki` atau `chefjuno: diperbaiki di <sha>`',
    '- `chefjuno: tidak diperbaiki — <alasan>` (sengaja / salah paham konteks / di luar scope / false positive)',
    '',
  ];
  return lines.join('\n');
}
