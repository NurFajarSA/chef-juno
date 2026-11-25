// Langkah-langkah demo §11.1. Langkah tanpa `run` dicetak ⏭️ BELUM DIBUAT.
import { writeFileSync, mkdirSync } from 'node:fs';
import { isSuppressed, machineStatus, SUMMARY_MARKER, trigrams } from '@chefjuno/shared';
import { callFn, FN_BASE, idTokenFor } from '../apps/functions/test/helpers.js';
import { FULL_NAME, REPO_ID } from '../apps/functions/test/harness.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  installationRepositories,
  issueComment,
  pullRequestClosed,
  push,
  reviewCommentReply,
  sendWebhook,
} from './lib/payloads.mjs';
import { exchangeCode } from '../apps/daemon/src/api.js';
import { saveCreds } from '../apps/daemon/src/creds.js';

import { seedReportFixture, EXPECTED } from './seed-reports.mjs';
import { buildWeeklyReport, enqueueRecap } from '../apps/functions/src/reports.js';

const BUG_TITLE = 'Hasil fetchUser tidak dicek null';
import type { Ctx, Step } from './demo.js';

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const postedReviews = async (c: Ctx) =>
  (await c.h.db.collection('jobs').where('type', '==', 'review').get()).docs.filter(
    (d) => d.get('status') === 'posted',
  );

async function waitPostedCount(c: Ctx, n: number) {
  await c.h.waitFor(async () => (await postedReviews(c)).length >= n, 45_000, `${n} review posted`);
  const docs = await postedReviews(c);
  return docs.sort((a, b) => a.get('createdAt').toMillis() - b.get('createdAt').toMillis())[n - 1];
}

function saveEvidence(c: Ctx) {
  mkdirSync('docs/evidence', { recursive: true });
  const sum = c.h.mock.summaryComments(FULL_NAME, 1)[0];
  writeFileSync(
    'docs/evidence/sample-summary-comment.md',
    `<!-- Persis seperti yang dikirim ke GitHub palsu pada npm run demo -->\n${sum.body}\n`,
  );
  const inline = c.h.mock.reviewComments
    .filter((x) => x.reviewId === c.h.mock.reviews[0].id)
    .map((x) => `### \`${x.path}:${x.line}\` (side ${x.side})\n\n${x.body}\n`)
    .join('\n---\n\n');
  writeFileSync(
    'docs/evidence/sample-inline-comments.md',
    `<!-- Persis seperti yang dikirim ke GitHub palsu pada npm run demo (review pertama) -->\n\n${inline}`,
  );
}

export const demoSteps: Step[] = [
  {
    n: 1,
    title: 'Seed admin, anggota, prompt v1',
    run: async (c) => {
      const m = await c.h.db.collection('members').get();
      const p = await c.h.db.doc('prompts/persona/versions/1').get();
      const r = await c.h.db.doc('prompts/review/versions/1').get();
      check(m.size >= 3, 'anggota belum ter-seed');
      check(p.exists && String(p.get('content')).includes('Chef Juno') && r.exists, 'prompt v1 tidak ada');
      return `${m.size} anggota, prompt persona v1 & review v1`;
    },
  },
  {
    n: 2,
    title: 'Daftarkan mesin lewat kode registrasi → mesin online',
    run: async (c) => {
      const d = await c.h.startMachine({ name: 'Mesin Demo' });
      const m = (await c.h.db.doc(`machines/${d.machineId}`).get()).data()!;
      const st = machineStatus(
        {
          revoked: m.revoked,
          lastSeenAtMs: m.lastSeenAt.toMillis(),
          currentJobIds: m.currentJobIds,
          concurrency: m.concurrency,
        },
        Date.now(),
      );
      check(st === 'online', `status ${st}`);
      c.state.machineId = d.machineId;
      return `mesin ${d.machineId} online (Claude ${m.agents.claude.version}, Codex ${m.agents.codex.version})`;
    },
  },
  {
    n: 3,
    title: 'Webhook issue_comment "lapor @chefjuno" (signature valid)',
    run: async (c) => {
      const r = await c.h.comment('lapor @chefjuno');
      check(r.status === 200, `status ${r.status}`);
      return `200 ${JSON.stringify(r.body)}`;
    },
  },
  {
    n: 4,
    title: 'Webhook dengan signature salah → 401',
    run: async () => {
      const r = await sendWebhook(
        FN_BASE,
        'issue_comment',
        issueComment({ fullName: FULL_NAME, repoId: REPO_ID, prNumber: 1, body: 'lapor @chefjuno' }),
        { badSignature: true },
      );
      check(r.status === 401, `status ${r.status}`);
      return '401 ditolak';
    },
  },
  {
    n: 5,
    title: 'Job queued → diambil mesin → completed → posted',
    run: async (c) => {
      const j = await waitPostedCount(c, 1);
      c.state.firstJob = j.id;
      return `job ${j.id} posted (agent ${j.get('result.meta.agent')}, ${j.get('result.findings').length} temuan, skor ${j.get('result.score')})`;
    },
  },
  {
    n: 6,
    title: 'GitHub palsu menerima 👀, ringkasan (marker), review inline (≤ batas), lalu 👍',
    run: async (c) => {
      const m = c.h.mock;
      const eyes = m.calls('POST', /\/issues\/comments\/\d+\/reactions$/).filter((r) => r.body?.content === 'eyes');
      const plus = m.calls('POST', /\/issues\/comments\/\d+\/reactions$/).filter((r) => r.body?.content === '+1');
      const sum = m.summaryComments(FULL_NAME, 1);
      check(eyes.length >= 1, 'tidak ada reaksi 👀');
      check(sum.length === 1 && sum[0].body.startsWith(SUMMARY_MARKER), 'ringkasan bermarker tidak ada');
      check(m.reviews.length === 1, 'review inline tidak ada');
      const n = m.reviewComments.length;
      check(n > 0 && n <= 10, `jumlah inline ${n}`);
      check(plus.length >= 1, 'tidak ada reaksi 👍');
      saveEvidence(c);
      return `👀 → ringkasan #${sum[0].id} → ${n} komentar inline → 👍 (disimpan ke docs/evidence/sample-*.md)`;
    },
  },
  {
    n: 7,
    title: 'lapor lagi di PR yang sama → ringkasan diperbarui, bukan dobel',
    run: async (c) => {
      await c.h.comment('@chefjuno lapor');
      await waitPostedCount(c, 2);
      const sums = c.h.mock.summaryComments(FULL_NAME, 1);
      check(sums.length === 1, `${sums.length} komentar ringkasan`);
      check(c.h.mock.calls('PATCH', /\/issues\/comments\/\d+$/).length >= 1, 'tidak ada PATCH');
      return `1 komentar ringkasan, diperbarui ${sums[0].updated}x`;
    },
  },
  {
    n: 8,
    title: '@chefjuno bantuan → balasan bantuan Indonesia tanpa job',
    run: async (c) => {
      const before = (await c.h.db.collection('jobs').get()).size;
      await c.h.comment('@chefjuno bantuan');
      await c.h.waitFor(
        async () => c.h.mock.issueComments.some((x) => x.body.includes('**Perintah Chef Juno**')),
        15_000,
        'bantuan',
      );
      const after = (await c.h.db.collection('jobs').get()).size;
      check(after === before, 'job tercipta');
      return 'balasan "Perintah Chef Juno", 0 job baru';
    },
  },
  {
    n: 9,
    title: 'Ubah prompt ke v2 setelah enqueue → job tetap memakai versi yang dipin',
    run: async (c) => {
      const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
      for (const d of c.h.daemons) d.paused = true;
      await c.h.comment('lapor @chefjuno');
      const q = await c.h.waitJob((j) => j.type === 'review' && j.status === 'queued');
      const saved = await callFn<{ version: number }>(
        'savePromptVersion',
        {
          key: 'review',
          content: 'Instruksi review v2 (demo): periksa null-check lebih dulu.',
          message: 'Demo: v2 setelah enqueue',
          activate: true,
        },
        member,
      );
      check(saved.ok, 'gagal simpan v2');
      const active = (await c.h.db.doc('prompts/review').get()).get('activeVersion');
      check(active === 2, `versi aktif ${active}`);
      for (const d of c.h.daemons) d.paused = false;
      for (const d of c.h.daemons) d.rescan();
      await c.h.waitFor(
        async () => (await c.h.db.doc(`jobs/${q.id}`).get()).get('status') === 'posted',
        45_000,
        'job posted',
      );
      const j = (await c.h.db.doc(`jobs/${q.id}`).get()).data()!;
      check(j.promptVersions.review === 1, `job memakai review v${j.promptVersions.review}`);
      const recs = readdirSync(c.h.recordDir).map((f) => JSON.parse(readFileSync(join(c.h.recordDir, f), 'utf8')));
      // rekaman fake agent dipilih lewat cwd (worktree di ~/.chefjuno/jobs/<jobId>-…), bukan urutan waktu
      const used = recs.find((r) => String(r.cwd).includes(`/jobs/${q.id}-`));
      check(
        used && !String(used.system).includes('Instruksi review v2 (demo)'),
        'prompt yang dipakai agent memuat isi v2',
      );
      check(
        String(used.system).includes((await c.h.db.doc('prompts/review/versions/1').get()).get('content').slice(0, 60)),
        'prompt v1 tidak dipakai agent',
      );
      await callFn('activatePromptVersion', { key: 'review', version: 1 }, member);
      return `aktif = v2, tapi job ${q.id} tetap memakai review v1 (footer: "${/prompt persona v\d+ \/ review v\d+/.exec(c.h.mock.summaryComments(FULL_NAME, 1)[0].body)![0]}"); lalu rollback ke v1`;
    },
  },
  {
    n: 10,
    title: "preferredAgent 'codex' → dikerjakan fake-codex; footer menyebut Codex",
    run: async (c) => {
      await c.h.db.doc('settings/global').update({ preferredAgent: 'codex' });
      const n = (await postedReviews(c)).length;
      await c.h.comment('lapor @chefjuno');
      const j = await waitPostedCount(c, n + 1);
      check(j.get('result.meta.agent') === 'codex', `agent ${j.get('result.meta.agent')}`);
      const body = c.h.mock.summaryComments(FULL_NAME, 1)[0].body;
      check(body.includes('Codex ('), 'footer tidak menyebut Codex');
      await c.h.db.doc('settings/global').update({ preferredAgent: 'any' });
      return `job ${j.id} oleh codex; footer: "${/Codex \([^)]*\)/.exec(body)![0]}"`;
    },
  },
  {
    n: 11,
    title: 'Mesin dengan agent login API key → agent ditolak, tidak dipakai',
    run: async (c) => {
      let rejected = false;
      try {
        await c.h.startMachine({ name: 'Mesin API key', claudeAuth: 'api-key', codexAuth: 'api-key' });
      } catch (e) {
        rejected = /Tidak ada agent langganan/.test((e as Error).message);
      }
      check(rejected, 'mesin API key tidak ditolak');
      const d = await c.h.startMachine({ name: 'Mesin campuran', claudeAuth: 'api-key', codexAuth: 'chatgpt' });
      const m = (await c.h.db.doc(`machines/${d.machineId}`).get()).data()!;
      check(m.agents.claude.enabled === false && m.agents.codex.enabled === true, 'agent API key tetap dipakai');
      await d.stop();
      return `Claude (API key) ditandai "tidak dipakai": ${m.agents.claude.warning}`;
    },
  },
  {
    n: 12,
    title: 'Pasang repo fixture → job index → repo ready + statistik > 0 + ringkasan modul',
    run: async (c) => {
      await c.h.db.doc(`repos/${REPO_ID}`).delete();
      const r = await sendWebhook(
        FN_BASE,
        'installation_repositories',
        installationRepositories({ fullName: FULL_NAME, repoId: REPO_ID }),
      );
      check(r.status === 200, `status ${r.status}`);
      const repo = await c.h.waitFor(
        async () => {
          const d = (await c.h.db.doc(`repos/${REPO_ID}`).get()).data();
          return d?.index?.status === 'ready' ? d : null;
        },
        45_000,
        'repo ready',
      );
      const st = repo.index.stats;
      check(st.files > 0 && st.symbols > 0 && st.edges > 0, 'statistik kosong');
      const mods = await c.h.db.collection(`repos/${REPO_ID}/modules`).get();
      const withSummary = mods.docs.filter((d) => d.get('summary')).length;
      check(withSummary > 0, 'ringkasan modul tidak tersimpan');
      return `ready @ ${String(repo.index.indexedSha).slice(0, 7)}: ${st.files} file, ${st.symbols} simbol, ${st.edges} edge (${Math.round(st.resolvedEdgePct * 100)}% ter-resolve), ${withSummary} ringkasan modul`;
    },
  },
  {
    n: 13,
    title: 'Webhook push ke default branch → job index incremental → indexedSha maju',
    run: async (c) => {
      const sha = c.h.repo.commit(
        {
          'src/api/extra.ts':
            "import { fetchUser } from './user';\nexport async function exists(id: string) {\n  return (await fetchUser(id)) !== null;\n}\n",
        },
        'feat: exists',
      );
      await sendWebhook(
        FN_BASE,
        'push',
        push({ fullName: FULL_NAME, repoId: REPO_ID, before: c.h.repo.baseSha, after: sha }),
      );
      const j = await c.h.waitJob(
        (x) => x.type === 'index' && x.status === 'completed' && x.index?.targetSha === sha,
        45_000,
      );
      await c.h.waitFor(
        async () => (await c.h.db.doc(`repos/${REPO_ID}`).get()).get('index.indexedSha') === sha,
        20_000,
        'indexedSha',
      );
      check(j.data.result.mode === 'incremental', `mode ${j.data.result.mode}`);
      return `incremental, ${j.data.result.stats.parsedFiles} file di-parse ulang, indexedSha → ${sha.slice(0, 7)}`;
    },
  },
  {
    n: 14,
    title: 'Review PR yang mengubah signature → prompt fake agent memuat caller dari peta kode',
    run: async (c) => {
      const n = (await postedReviews(c)).length;
      const t0 = Date.now();
      await c.h.comment('lapor @chefjuno');
      const j = await waitPostedCount(c, n + 1);
      const recs = readdirSync(c.h.recordDir)
        .map((f) => JSON.parse(readFileSync(join(c.h.recordDir, f), 'utf8')))
        .filter((r) => Date.parse(r.at) >= t0 - 1000 && String(r.prompt).includes('# PR #1'));
      check(recs.length, 'prompt tidak terekam');
      const p = String(recs.at(-1).prompt);
      for (const want of [
        '## Konteks dari peta kode',
        '`loadProfile` di src/services/profile.ts:4',
        '`userSlug` di src/legacy/helpers.js:8',
        '`refresh` di web/UserBadge.vue:13',
        'signature berubah',
      ])
        check(p.includes(want), `prompt tidak memuat: ${want}`);
      const impact = j.get('result.impact') as string[];
      check(impact?.length, 'impact kosong');
      check(
        c.h.mock.summaryComments(FULL_NAME, 1)[0].body.includes('**Dampak (dari peta kode)**'),
        'ringkasan tidak menyebut dampak',
      );
      return `prompt memuat 4 caller fetchUser + peringatan; dampak: "${impact[0]}"`;
    },
  },
  {
    n: 15,
    title: 'Balasan "chefjuno: tidak diperbaiki — …" tersimpan; PR ditutup → collectFeedback isi outcome',
    run: async (c) => {
      const bug = (
        await c.h.db.collection('findings').where('title', '==', BUG_TITLE).where('postedInline', '==', true).get()
      ).docs.at(-1)!;
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
      check(r.body?.result === 'balasan AI coder: wont_fix', `hasil ${JSON.stringify(r.body)}`);
      await sendWebhook(
        FN_BASE,
        'pull_request',
        pullRequestClosed({
          fullName: FULL_NAME,
          repoId: REPO_ID,
          prNumber: 1,
          merged: true,
          headSha: c.h.repo.headSha,
          baseSha: c.h.repo.baseSha,
        }),
      );
      const fs = await c.h.waitFor(
        async () => {
          const s = await c.h.db.collection('findings').where('prNumber', '==', 1).get();
          return s.docs.every((d) => d.get('outcome') !== 'pending') ? s : null;
        },
        20_000,
        'outcome',
      );
      const counts: Record<string, number> = {};
      for (const d of fs.docs) counts[d.get('outcome')] = (counts[d.get('outcome')] ?? 0) + 1;
      check((await bug.ref.get()).get('outcome') === 'disputed', 'temuan yang dibantah tidak "disputed"');
      return `aiCoderReply wont_fix tersimpan; ${fs.size} temuan PR #1 → ${JSON.stringify(counts)}`;
    },
  },
  {
    n: 16,
    title:
      'Job learn → usulan aturan disetujui → review berikutnya: aturan di prompt, temuan serupa ditekan, usageCount = 1',
    run: async (c) => {
      await c.h.waitJob((j) => j.type === 'learn' && j.status === 'completed', 45_000);
      const sugg = await c.h.waitFor(
        async () => {
          const s = await c.h.db.collection('rules').where('status', '==', 'suggested').get();
          return s.size >= 2 ? s : null;
        },
        20_000,
        'usulan',
      );
      const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
      const r = await callFn('decideRules', { ids: sugg.docs.map((d) => d.id), action: 'approve' }, admin);
      check(r.ok, 'gagal menyetujui');
      const n = (await postedReviews(c)).length;
      const t0 = Date.now();
      await c.h.comment('lapor @chefjuno');
      const j = await waitPostedCount(c, n + 1);
      const rec = readdirSync(c.h.recordDir)
        .map((f) => JSON.parse(readFileSync(join(c.h.recordDir, f), 'utf8')))
        .filter((x) => Date.parse(x.at) >= t0 - 1000 && String(x.prompt).includes('# PR #1'))
        .at(-1);
      check(
        String(rec?.prompt).includes('tidak perlu dilaporkan kalau sudah dijaga guard'),
        'aturan tidak ada di prompt',
      );
      const sup = j.get('result.suppressed') as { title: string }[];
      check(
        sup.some((x) => x.title === BUG_TITLE),
        'temuan serupa tidak ditekan',
      );
      const rule = (await c.h.db.collection('rules').where('kind', '==', 'rule').where('status', '==', 'active').get())
        .docs[0];
      await c.h.waitFor(async () => (await rule.ref.get()).get('usageCount') === 1, 10_000, 'usageCount 1');
      c.state.lastReviewId = c.h.mock.reviews.at(-1)!.id;
      return `${sugg.size} usulan (aturan + suppression) disetujui; prompt memuat aturan; "${BUG_TITLE}" ditekan; usageCount = 1`;
    },
  },
  {
    n: 17,
    title: 'Temuan security mirip pola yang ditekan → tetap diposting',
    run: async (c) => {
      // Pola suppression berkategori SAMA (security) & judul hampir identik → hanya pengecualian security/P0 yang membuatnya lolos.
      const SEC = 'Hasil fetchUser tidak dicek null sebelum dipakai untuk token';
      await c.h.db.doc('rules/demo-suppress-security').set({
        text: `Tekan: "${SEC}"`,
        kind: 'suppression',
        category: 'security',
        status: 'active',
        source: 'manual',
        scope: { repoId: null, paths: [] },
        match: { category: 'security', titleTrigrams: trigrams(SEC) },
        evidence: [],
        usageCount: 0,
        createdAt: new Date(),
      });
      check(
        isSuppressed({ title: SEC, category: 'bug', severity: 'P1' }, [
          { id: 'x', match: { category: 'bug', titleTrigrams: trigrams(SEC) } },
        ]),
        'kontrol: temuan bug dengan pola sama harus ditekan',
      );
      const n = (await postedReviews(c)).length;
      await c.h.comment('lapor @chefjuno');
      const j = await waitPostedCount(c, n + 1);
      const bodies = c.h.mock.reviewComments
        .filter((x) => x.reviewId === c.h.mock.reviews.at(-1)!.id)
        .map((x) => x.body);
      check(
        bodies.some((b) => b.includes(`**P1 · ${SEC}**`) && b.includes('<sub>Keamanan')),
        'temuan security tidak diposting',
      );
      const sup = (j.get('result.suppressed') as { category: string }[]).map((s) => s.category);
      check(!sup.includes('security'), 'temuan security ikut ditekan');
      check(!bodies.some((b) => b.includes(`bug — ${BUG_TITLE}**`)), 'temuan bug yang ditekan ikut diposting');
      await c.h.db.doc('rules/demo-suppress-security').delete();
      return `walau ada suppression aktif berkategori security dengan judul identik, "${SEC}" tetap diposting; temuan bug serupa tetap ditekan`;
    },
  },
  {
    n: 18,
    title: 'buildWeeklyReport minggu seed → rapor pribadi & tim berisi angka yang diharapkan',
    run: async (c) => {
      const W = '2026-11-16';
      await seedReportFixture(c.h.db, W);
      await buildWeeklyReport(c.h.db, W);
      const u = (await c.h.db.doc(`reports/${W}_u_dev2`).get()).data()!;
      const t = (await c.h.db.doc(`reports/${W}_team`).get()).data()!;
      const e = EXPECTED.dev2;
      check(
        u.prsReviewed === e.prsReviewed &&
          u.avgScore === e.avgScore &&
          u.byCategory.bug === e.bug &&
          u.addressedRate === e.addressedRate,
        `rapor dev2 ${JSON.stringify({ prs: u.prsReviewed, avg: u.avgScore, bug: u.byCategory.bug, ar: u.addressedRate })}`,
      );
      check(
        JSON.stringify(t.mostImproved.map((m: { login: string }) => m.login)) ===
          JSON.stringify(EXPECTED.team.mostImproved),
        'paling berkembang salah',
      );
      await enqueueRecap(W, t);
      await c.h.waitFor(
        async () => (await c.h.db.doc(`reports/${W}_team`).get()).get('narrative'),
        30_000,
        'narasi recap',
      );
      return `dev2: ${u.prsReviewed} PR, skor ${u.avgScore}, bug ${u.byCategory.bug}, diperbaiki ${Math.round(u.addressedRate * 100)}%, "${u.development[0].text}"; paling berkembang: ${t.mostImproved.map((m: { login: string }) => '@' + m.login).join(', ')}; narasi recap tersimpan`;
    },
  },
  {
    n: 19,
    title: 'chefjuno memory pull --login <penulis> → file memori memuat kesalahan berulang & aturan aktif',
    run: async () => {
      const tok = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
      const code = (await callFn<{ code: string }>('createMachineRegistration', { name: 'Mesin memory pull' }, tok))
        .result!.code;
      const ex = await exchangeCode(FN_BASE, code);
      saveCreds({
        server: FN_BASE,
        machineId: ex.machineId,
        machineSecret: ex.machineSecret,
        firebaseConfig: ex.firebaseConfig,
      });
      const out = execFileSync('node', ['apps/daemon/dist/cli.js', 'memory', 'pull', '--login', 'dev2'], {
        env: process.env,
        encoding: 'utf8',
      });
      const file = join(process.env.CHEFJUNO_HOME!, 'memory', 'dev2.md');
      const md = readFileSync(file, 'utf8');
      check(md.includes(`**${BUG_TITLE}**`), 'kesalahan berulang tidak ada');
      check(md.includes('tidak perlu dilaporkan kalau sudah dijaga guard'), 'aturan aktif tidak ada');
      mkdirSync('docs/evidence', { recursive: true });
      writeFileSync('docs/evidence/sample-memory-dev2.md', md);
      return `${out.split('\n')[0]} (disalin ke docs/evidence/sample-memory-dev2.md)`;
    },
  },
];
