import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callFn, clearAuth, clearFirestore, FN_BASE, idTokenFor } from '../helpers.js';
import { createHarness, FULL_NAME, REPO_ID, type Harness } from '../harness.js';
import { pullRequestClosed, reviewCommentReply, sendWebhook } from '../../../../scripts/lib/payloads.mjs';
import { exchangeCode } from '../../../daemon/src/api.js';
import { saveCreds } from '../../../daemon/src/creds.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLI = fileURLToPath(new URL('../../../daemon/dist/cli.js', import.meta.url));
let h: Harness;
let admin: string;
const BUG_TITLE = 'Hasil fetchUser tidak dicek null';
const RULE_MARK = 'tidak perlu dilaporkan kalau sudah dijaga guard';

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await h.startMachine({ name: 'Mesin Memory', agents: ['claude'] });
  admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
});
afterAll(async () => h?.stop());

const posted = async () =>
  (await h.db.collection('jobs').where('status', '==', 'posted').get()).docs.sort(
    (a, b) => a.get('createdAt').toMillis() - b.get('createdAt').toMillis(),
  );
const lastPrompt = () => {
  const recs = readdirSync(h.recordDir)
    .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
    .filter((r) => String(r.prompt).includes('# PR #1'))
    // prompt review, bukan panggilan reviewer akhir yang datang sesudahnya
    .filter((r) => !String(r.prompt).includes('# Ringkasan reviewer sebelumnya'))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return String(recs.at(-1).prompt);
};

describe('memory & belajar end-to-end', () => {
  it('review pertama: profil penulis masuk prompt, tanpa level (sama untuk semua)', async () => {
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await posted()).length === 1, 45_000, 'review 1');
    const p = lastPrompt();
    expect(p).toContain('## Profil penulis PR');
    expect(p).toContain('Penulis: @dev2. Gaya penjelasan sama untuk semua anggota');
    expect(p).not.toMatch(/level (junior|mid|senior)/);
  });

  it('balasan AI coder di thread temuan → tersimpan; balasan manusia juga', async () => {
    const bug = (await h.db.collection('findings').where('title', '==', BUG_TITLE).get()).docs[0];
    expect(bug.get('postedInline')).toBe(true);
    const r = await sendWebhook(
      FN_BASE,
      'pull_request_review_comment',
      reviewCommentReply({
        fullName: FULL_NAME,
        repoId: REPO_ID,
        prNumber: 1,
        inReplyTo: bug.get('githubCommentId'),
        body: 'chefjuno: tidak diperbaiki — sengaja, sudah dicek di guard',
      }),
    );
    expect(r.body).toMatchObject({ result: 'balasan AI coder: wont_fix' });
    const after = (await bug.ref.get()).data()!;
    expect(after.signals.aiCoderReply).toMatchObject({ verdict: 'wont_fix', reason: 'sengaja, sudah dicek di guard' });
    const sec = (await h.db.collection('findings').where('category', '==', 'security').get()).docs[0];
    await sendWebhook(
      FN_BASE,
      'pull_request_review_comment',
      reviewCommentReply({
        fullName: FULL_NAME,
        repoId: REPO_ID,
        prNumber: 1,
        inReplyTo: sec.get('githubCommentId'),
        body: 'Oke, nanti saya cek.',
      }),
    );
    expect((await sec.ref.get()).get('signals.humanReplies')).toHaveLength(1);
  });

  it('PR ditutup (merge) → collectFeedback mengisi outcome semua temuan PR + enqueue learn', async () => {
    await sendWebhook(
      FN_BASE,
      'pull_request',
      pullRequestClosed({
        fullName: FULL_NAME,
        repoId: REPO_ID,
        prNumber: 1,
        merged: true,
        headSha: h.repo.headSha,
        baseSha: h.repo.baseSha,
      }),
    );
    const fs = await h.waitFor(
      async () => {
        const s = await h.db.collection('findings').where('prNumber', '==', 1).get();
        return s.docs.every((d) => d.get('outcome') !== 'pending') ? s : null;
      },
      20_000,
      'outcome terisi',
    );
    const byTitle = Object.fromEntries(fs.docs.map((d) => [d.get('title'), d.get('outcome')]));
    expect(byTitle[BUG_TITLE]).toBe('disputed');
    expect(byTitle['Nama variabel terlalu umum']).toBe('accepted_by_merge');
    const learn = await h.waitJob((j) => j.type === 'learn' && j.status === 'completed');
    expect(learn.data.learn.findingIds).toHaveLength(fs.size);
  });

  it('job learn → usulan aturan + suppression (status suggested) + pelajaran pribadi', async () => {
    const rules = await h.waitFor(
      async () => {
        const s = await h.db.collection('rules').where('status', '==', 'suggested').get();
        return s.size >= 2 ? s : null;
      },
      20_000,
      'usulan',
    );
    const kinds = rules.docs.map((d) => d.get('kind')).sort();
    expect(kinds).toEqual(['rule', 'suppression']);
    const sup = rules.docs.find((d) => d.get('kind') === 'suppression')!;
    expect(sup.get('match.category')).toBe('bug');
    expect(sup.get('match.titleTrigrams').length).toBeGreaterThan(5);
    const person = (await h.db.doc('people/dev2').get()).data()!;
    expect(person.recurringMistakes[0].title).toBe(BUG_TITLE);
  });

  it('aturan suggested TIDAK dipakai sebelum disetujui', async () => {
    const n = (await posted()).length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await posted()).length === n + 1, 45_000, 'review sebelum setuju');
    expect(lastPrompt()).not.toContain(RULE_MARK);
    const last = (await posted()).at(-1)!;
    expect(last.get('result.suppressed')).toEqual([]);
    expect(
      h.mock.reviewComments
        .filter((c) => c.reviewId === h.mock.reviews.at(-1)!.id)
        .some((c) => c.body.includes(BUG_TITLE + '**')),
    ).toBe(true);
  });

  it('member biasa tidak bisa menyetujui; admin setujui massal → review berikutnya: aturan di prompt, temuan serupa ditekan, security tetap, usageCount = 1', async () => {
    const ids = (await h.db.collection('rules').where('status', '==', 'suggested').get()).docs.map((d) => d.id);
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    expect((await callFn('decideRules', { ids, action: 'approve' }, member)).ok).toBe(false);
    const r = await callFn('decideRules', { ids, action: 'approve' }, admin);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const n = (await posted()).length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(async () => (await posted()).length === n + 1, 45_000, 'review sesudah setuju');
    expect(lastPrompt()).toContain(RULE_MARK);
    const last = (await posted()).at(-1)!;
    const suppressed = last.get('result.suppressed') as { title: string; category: string }[];
    expect(suppressed.map((s) => s.title)).toEqual([BUG_TITLE]);
    const review = h.mock.reviews.at(-1)!;
    const bodies = h.mock.reviewComments.filter((c) => c.reviewId === review.id).map((c) => c.body);
    // format komentar: "**P1 · <judul>**" + catatan kategori di bawah
    expect(bodies.some((b) => b.includes(`· ${BUG_TITLE}**`))).toBe(false);
    // temuan security yang mirip pola yang ditekan → tetap diposting
    expect(
      bodies.some(
        (b) =>
          b.includes('**P1 · Hasil fetchUser tidak dicek null sebelum dipakai untuk token**') &&
          b.includes('<sub>Keamanan'),
      ),
    ).toBe(true);
    const rule = (await h.db.collection('rules').where('kind', '==', 'rule').get()).docs[0];
    await h.waitFor(async () => (await rule.ref.get()).get('usageCount') === 1, 10_000, 'usageCount');
    expect(h.mock.summaryComments(FULL_NAME, 1)[0].body).toContain('1 temuan di-suppress oleh memory tim');
  });

  it('aturan manual langsung aktif; nonaktifkan → tidak dipakai lagi', async () => {
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    const r = await callFn<{ id: string }>(
      'createManualRule',
      {
        text: 'Semua query Firestore wajib punya index di firestore.indexes.json.',
        category: 'performance',
        repoId: null,
        paths: [],
      },
      member,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await h.db.doc(`rules/${r.result!.id}`).get()).get('status')).toBe('active');
    expect((await callFn('decideRules', { ids: [r.result!.id], action: 'deactivate' }, admin)).ok).toBe(true);
    expect((await h.db.doc(`rules/${r.result!.id}`).get()).get('status')).toBe('inactive');
  });

  it('chefjuno memory pull --login dev2 → file memori memuat kesalahan berulang & aturan aktif', async () => {
    const tok = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    const code = (await callFn<{ code: string }>('createMachineRegistration', { name: 'Mesin Memori' }, tok)).result!
      .code;
    const ex = await exchangeCode(FN_BASE, code);
    saveCreds({
      server: FN_BASE,
      machineId: ex.machineId,
      machineSecret: ex.machineSecret,
      firebaseConfig: ex.firebaseConfig,
    });
    const out = execFileSync('node', [CLI, 'memory', 'pull', '--login', 'dev2'], {
      env: process.env,
      encoding: 'utf8',
    });
    expect(out).toContain('Memori ditulis ke');
    expect(out).toContain('@' + join(process.env.CHEFJUNO_HOME!, 'memory', 'dev2.md'));
    const md = readFileSync(join(process.env.CHEFJUNO_HOME!, 'memory', 'dev2.md'), 'utf8');
    expect(md).toContain('# Memori Chef Juno untuk @dev2');
    expect(md).toContain(`**${BUG_TITLE}**`);
    expect(md).toContain(RULE_MARK);
    expect(md).not.toContain('Semua query Firestore wajib'); // aturan nonaktif tidak ikut
  });

  it('chefjuno memory-mcp (stdio) menjawab get_team_rules, get_my_lessons, precheck_diff dari Firestore', async () => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [CLI, 'memory-mcp'],
        env: process.env as Record<string, string>,
      }),
    );
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'get_my_lessons',
      'get_team_rules',
      'precheck_diff',
    ]);
    const text = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text);
    const rules = await text('get_team_rules', { repo: String(REPO_ID) });
    expect(rules.map((r: { text: string }) => r.text).join('\n')).toContain(RULE_MARK);
    const lessons = await text('get_my_lessons', { login: 'dev2' });
    expect(lessons.recurringMistakes[0].title).toBe(BUG_TITLE);
    const hits = await text('precheck_diff', {
      login: 'dev2',
      diff: '+++ b/src/x.ts\n@@ -0,0 +1,1 @@\n+const u = await fetchUser(id); u.name\n',
    });
    expect(hits[0]).toMatchObject({ mistake: BUG_TITLE, file: 'src/x.ts', line: 1 });
    await client.close();
  });
});
