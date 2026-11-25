import { describe, expect, it } from 'vitest';
import {
  applicableRules,
  buildMemoryMarkdown,
  pathMatches,
  precheckDiff,
  type PersonData,
  type RuleData,
} from '../../src/memory/data.js';
import { memoryTools } from '../../src/memory/mcp.js';

const RULES: RuleData[] = [
  { id: 'g', text: 'Aturan global.', kind: 'rule', category: 'bug', scope: { repoId: null, paths: [] } },
  { id: 'r', text: 'Aturan repo 42.', kind: 'rule', category: 'bug', scope: { repoId: '42', paths: [] } },
  { id: 'p', text: 'Aturan path api.', kind: 'rule', category: 'bug', scope: { repoId: '42', paths: ['src/api/'] } },
  { id: 'o', text: 'Aturan repo lain.', kind: 'rule', category: 'bug', scope: { repoId: '7', paths: [] } },
  { id: 's', text: 'Tekan.', kind: 'suppression', category: 'bug', scope: { repoId: null, paths: [] } },
];
const PERSON: PersonData = {
  login: 'dev2',
  recurringMistakes: [
    { key: 'a', title: 'Hasil fetchUser tidak dicek null', category: 'bug', count: 3, trend: 'up' },
    { key: 'b', title: 'Promise tidak di-await', category: 'bug', count: 1 },
  ],
  lessons: [{ text: 'Cek null sebelum dipakai.', prNumber: 12 }],
};

describe('memory: aturan & file memori', () => {
  it('applicableRules: global + repo + path yang cocok; bukan suppression; bukan repo lain', () => {
    expect(applicableRules(RULES, 42, ['src/api/user.ts']).map((r) => r.id)).toEqual(['g', 'r', 'p']);
    expect(applicableRules(RULES, 42, ['web/x.vue']).map((r) => r.id)).toEqual(['g', 'r']);
    expect(pathMatches(['src/api/*'], ['src/api/a.ts'])).toBe(true);
  });
  it('buildMemoryMarkdown memuat aturan aktif + kesalahan berulang + pelajaran', () => {
    const md = buildMemoryMarkdown('dev2', RULES, PERSON, '42');
    expect(md).toContain('# Memori Chef Juno untuk @dev2');
    expect(md).toContain('- Aturan global.');
    expect(md).toContain('- Aturan repo 42.');
    expect(md).not.toContain('Aturan repo lain.');
    expect(md).not.toContain('Tekan.');
    expect(md).toContain('**Hasil fetchUser tidak dicek null** (bug, 3x, naik)');
    expect(md).toContain('Cek null sebelum dipakai. (PR #12)');
  });
  it('precheckDiff menandai baris yang mirip kesalahan berulang (tanpa LLM)', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -1,0 +1,3 @@',
      '+const u = await fetchUser(id);',
      '+return u.name;',
      '+const x = 1;',
    ].join('\n');
    const hits = precheckDiff(diff, PERSON.recurringMistakes);
    expect(hits).toContainEqual(
      expect.objectContaining({ mistake: 'Hasil fetchUser tidak dicek null', file: 'src/a.ts', line: 1 }),
    );
    expect(hits.some((h) => h.line === 3)).toBe(false);
  });
});

describe('memory-mcp tools', () => {
  const tools = memoryTools({ rules: async () => RULES, person: async () => PERSON });
  it('get_team_rules', async () => {
    expect((await tools.get_team_rules.run({ repo: '42', paths: ['src/api/user.ts'] })).map((r) => r.id)).toEqual([
      'g',
      'r',
      'p',
    ]);
    expect((await tools.get_team_rules.run({})).map((r) => r.id)).toEqual(['g']);
  });
  it('get_my_lessons', async () => {
    const r = await tools.get_my_lessons.run({ login: 'dev2' });
    expect(r.recurringMistakes.map((m) => m.title)).toEqual([
      'Hasil fetchUser tidak dicek null',
      'Promise tidak di-await',
    ]);
    expect(r.lessons).toHaveLength(1);
  });
  it('precheck_diff', async () => {
    const r = await tools.precheck_diff.run({
      login: 'dev2',
      diff: '+++ b/x.ts\n@@ -0,0 +1,1 @@\n+fetchUser(1).then(() => null)\n',
    });
    expect(r).toHaveLength(1);
  });
});
