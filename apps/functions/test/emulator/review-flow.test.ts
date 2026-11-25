import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { SUMMARY_MARKER, parseUnifiedDiff } from '@chefjuno/shared';
import { clearAuth, clearFirestore, FN_BASE } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';
import { sendWebhook, issueComment, pullRequestClosed } from '../../../../scripts/lib/payloads.mjs';
import { runMaintenance } from '../../src/dispatch.js';

let h: Harness;

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
});
afterAll(async () => {
  await h?.stop();
});

const reviewJobs = async () => (await h.db.collection('jobs').where('type', '==', 'review').get()).docs;

describe('alur review end-to-end (emulator + GitHub palsu + fake agent)', () => {
  it('signature salah → 401, tanpa job', async () => {
    const r = await sendWebhook(
      FN_BASE,
      'issue_comment',
      issueComment({ fullName: 'tim/sample-repo', repoId: 4242, prNumber: 1, body: 'lapor @chefjuno' }),
      {
        badSignature: true,
      },
    );
    expect(r.status).toBe(401);
    expect(await reviewJobs()).toHaveLength(0);
  });

  it('tanpa mesin online: job antre + balasan "belum ada mesin"', async () => {
    const r = await h.comment('lapor @chefjuno');
    expect(r.status).toBe(200);
    const job = await h.waitJob((j) => j.type === 'review' && j.status === 'queued');
    expect(job.data.promptVersions).toEqual({ persona: 1, review: 1 });
    expect(job.data.config.maxInlineComments).toBe(10);
    expect(job.data.pr.headSha).toBe(h.repo.headSha);
    expect(h.mock.issueComments.some((c) => c.body.includes('Belum ada mesin reviewer yang online'))).toBe(true);
    expect(h.mock.reactions.some((x) => x.content === 'eyes')).toBe(true);
  });

  it('pengiriman ulang delivery yang sama → idempoten', async () => {
    const p = issueComment({ fullName: 'tim/sample-repo', repoId: 4242, prNumber: 1, body: 'lapor @chefjuno' });
    const a = await sendWebhook(FN_BASE, 'issue_comment', p, { delivery: '00000000-0000-4000-8000-000000000001' });
    const b = await sendWebhook(FN_BASE, 'issue_comment', p, { delivery: '00000000-0000-4000-8000-000000000001' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body).toBe('duplikat');
    // PR + headSha sama sudah punya job aktif → tidak dobel
    expect((await reviewJobs()).length).toBe(1);
  });

  it('pemrosesan gagal (500) → pengiriman ulang delivery yang sama diproses lagi, bukan "duplikat"', async () => {
    // repo tidak dikenal GitHub palsu → ambil detail PR gagal
    const p = issueComment({ fullName: 'tim/tidak-ada', repoId: 999, prNumber: 5, body: 'lapor @chefjuno' });
    const a = await sendWebhook(FN_BASE, 'issue_comment', p, { delivery: '00000000-0000-4000-8000-0000000000aa' });
    expect(a.status).toBe(500);
    expect((await h.db.doc('webhookDeliveries/00000000-0000-4000-8000-0000000000aa').get()).exists).toBe(false);
    const b = await sendWebhook(FN_BASE, 'issue_comment', p, { delivery: '00000000-0000-4000-8000-0000000000aa' });
    expect(b.status).toBe(500);
    expect(b.body).not.toBe('duplikat');
  });

  it('mesin online mengambil job → completed → posted; GitHub palsu menerima komentar yang benar', async () => {
    await h.startMachine({ name: 'Mesin Uji', agents: ['claude'] });
    const job = await h.waitJob((j) => j.type === 'review' && j.status === 'posted');
    expect(job.data.result.meta.agent).toBe('claude');
    expect(job.data.attempts).toBe(1);

    // review inline: satu review, line+side RIGHT, semua baris memang ada di diff, ≤ batas
    expect(h.mock.reviews).toHaveLength(1);
    const rv = h.mock.reviews[0];
    expect(rv.commit_id).toBe(h.repo.headSha);
    expect(rv.event).toBe('COMMENT');
    const files = parseUnifiedDiff(h.repo.git('diff', `${h.repo.baseSha}...${h.repo.headSha}`));
    const inline = h.mock.reviewComments;
    expect(inline.length).toBeGreaterThan(0);
    expect(inline.length).toBeLessThanOrEqual(10);
    for (const c of inline) {
      expect(c.side).toBe('RIGHT');
      expect(files.get(c.path)!.rightLines.has(c.line)).toBe(true);
      expect(c.body).toMatch(/<!-- chefjuno-ai:finding:[A-Za-z0-9]+ -->/);
    }
    const req = h.mock.calls('POST', /\/pulls\/1\/reviews$/)[0];
    for (const c of req.body.comments) expect(c).not.toHaveProperty('position');
    // urutan P0 → P1 → P2
    const sev = req.body.comments.map((c: { body: string }) => /\*\*(P\d)/.exec(c.body)![1]);
    expect([...sev].sort()).toEqual(sev);

    // ringkasan sticky dengan marker, link ke inline, temuan lain (baris 9999 di luar diff)
    const sums = h.mock.summaryComments('tim/sample-repo', 1);
    expect(sums).toHaveLength(1);
    const body = sums[0].body;
    expect(body.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(body).toContain('## 👨‍🍳 Chef Juno — Skor 3/5');
    expect(body).toContain('Yang perlu kamu pahami dari PR ini');
    expect(body).toContain('Temuan lain (di luar diff)');
    expect(body).toContain(inline[0].html_url);
    expect(body).toContain('Claude Code');
    expect(body).toContain('prompt persona v1 / review v1');
    expect(body).toContain('mesin Mesin Uji');

    // findings tersimpan + reaksi 👀 diganti 👍
    const f = await h.db.collection('findings').where('jobId', '==', job.id).get();
    // satu standar (review penuh): temuan sama dari beberapa putaran digabung; temuan security tidak digabung
    expect(f.size).toBe(4);
    expect(f.docs.filter((d) => d.get('postedInline')).length).toBe(inline.length);
    expect(f.docs.every((d) => d.get('outcome') === 'pending')).toBe(true);
    // reaksi pada komentar pemicu job ini: 👀 dihapus, 👍 ditambah
    // reaksi dipasang sesaat setelah status "posted" (sesudah gate dicatat)
    const onTrigger = () => h.mock.reactions.filter((x) => x.subjectId === job.data.trigger.commentId);
    await h.waitFor(async () => onTrigger().some((x) => x.content === '+1'), 10_000, 'reaksi 👍');
    expect(onTrigger().map((x) => x.content)).toEqual(['+1']);
    expect(h.mock.calls('DELETE', /\/reactions\/\d+$/).length).toBeGreaterThan(0);

    // gate: commit status "Chef Juno" di head PR — pending saat job dibuat, lalu FAIL (ada P0/P1) dengan tautan dashboard
    const st = h.mock.statuses.filter((x) => x.sha === h.repo.headSha);
    expect(st.map((x) => x.state)).toEqual(['pending', 'failure']);
    expect(st.every((x) => x.context === 'Chef Juno')).toBe(true);
    expect(st[1].description).toBe('FAIL · 2 P1, 2 P2 · skor 3/5');
    expect(st[1].target_url).toBe(`http://localhost:4200/reviews/${job.id}`);
    const done = (await h.db.doc(`jobs/${job.id}`).get()).data()!;
    expect(done.result.gate).toMatchObject({ verdict: 'FAIL', state: 'failure' });
    expect(done.github.statusError ?? null).toBeNull();
  });

  it('prompt ke agent memuat diff, aturan repo dari baseSha (untrusted), tanpa token GitHub', async () => {
    // putaran correctness (review penuh) membawa diff & aturan repo
    const rec = readdirSync(h.recordDir)
      .filter((f) => f.startsWith('claude-'))
      .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
      .find((r) => String(r.system).includes('Fokus putaran ini: correctness'));
    expect(rec.prompt).toContain('```diff');
    expect(rec.prompt).toContain('<repo_rules untrusted path=".chefjuno/rules.md">');
    expect(rec.prompt).toContain('<repo_rules untrusted path="CLAUDE.md">');
    expect(rec.system).toContain('Chef Juno');
    expect(rec.argv).toContain('--safe-mode');
    expect(rec.argv).toContain('--restricted');
    expect(rec.argv).not.toContain('--bare');
    expect(JSON.stringify(rec)).not.toMatch(/ghs_/);
    expect(rec.env.ANTHROPIC_API_KEY).toBeNull();
    expect(rec.cwd).toContain('worktree');
  });

  it('lapor lagi di PR yang sama → ringkasan DIPERBARUI (PATCH), bukan dobel; komentar inline lama diganti', async () => {
    // satu komentar lama diberi reaksi 👎 oleh tim → dipertahankan; sisanya diganti review baru
    const old = h.mock.reviewComments.filter((c) => c.body.includes('chefjuno-ai:finding:'));
    expect(old.length).toBeGreaterThan(1);
    h.mock.reactions.push({
      id: 999001,
      subject: 'review_comment',
      subjectId: old[0].id,
      content: '-1',
      user: { login: 'dev2' },
    });
    await h.comment('@chefjuno lapor');
    await h.waitFor(
      async () => (await reviewJobs()).filter((d) => d.get('status') === 'posted').length === 2,
      45_000,
      'job kedua posted',
    );
    expect(h.mock.summaryComments('tim/sample-repo', 1)).toHaveLength(1);
    expect(h.mock.calls('PATCH', /\/issues\/comments\/\d+$/).length).toBe(1);
    // komentar inline lama tanpa balasan/reaksi dihapus; yang diberi reaksi tetap
    const latest = h.mock.reviews.at(-1)!;
    const remainingOld = h.mock.reviewComments.filter((c) => c.reviewId !== latest.id);
    expect(remainingOld.map((c) => c.id)).toEqual([old[0].id]);
    expect(h.mock.calls('DELETE', /\/pulls\/comments\/\d+$/)).toHaveLength(old.length - 1);
    const second = (await reviewJobs())
      .filter((d) => d.get('status') === 'posted')
      .sort((a, b) => b.get('createdAt').toMillis() - a.get('createdAt').toMillis())[0];
    expect(second.get('result.replacedInline')).toBe(old.length - 1);
  });

  it('reviewer menjawab tanpa membuka file → diulang dengan teguran; tetap dangkal → review sebagian (gate FAIL)', async () => {
    const pr = h.mock.repos.get('tim/sample-repo')!.prs.get(1)!;
    const body = pr.body;
    const posted = async () =>
      (await reviewJobs())
        .filter((d) => d.get('status') === 'posted')
        .sort((a, b) => b.get('createdAt').toMillis() - a.get('createdAt').toMillis());
    // putaran correctness (yang wajib menelusuri) untuk PR dengan penanda ini
    const reviewCalls = (marker: string) =>
      readdirSync(h.recordDir)
        .filter((f) => f.startsWith('claude-'))
        .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
        .filter(
          (r) => String(r.system).includes('Fokus putaran ini: correctness') && String(r.prompt).includes(marker),
        );
    try {
      // dangkal sekali → diulang dengan teguran → menelusuri → review lengkap
      pr.body = 'Perbaikan cache. FAKE_SHALLOW';
      let n = (await posted()).length;
      await h.comment('lapor @chefjuno');
      await h.waitFor(async () => (await posted()).length === n + 1, 45_000, 'review dangkal sekali');
      const once = reviewCalls('FAKE_SHALLOW');
      expect(once).toHaveLength(2);
      expect(once.filter((r) => String(r.system).includes('PERHATIAN: percobaan sebelumnya'))).toHaveLength(1);
      let last = (await posted())[0];
      expect(last.get('result.reviewCompletion')).toBe('complete');
      const corr = (last.get('result.meta.passes') as { label: string; numTurns: number }[]).find(
        (p) => p.label === 'lens-correctness',
      );
      expect(corr).toMatchObject({ numTurns: 4 });

      // tetap dangkal setelah ditegur → review sebagian, gate FAIL
      pr.body = 'Perbaikan cache. FAKE_SHALLOW_ALWAYS';
      n = (await posted()).length;
      await h.comment('lapor @chefjuno');
      await h.waitFor(async () => (await posted()).length === n + 1, 45_000, 'review selalu dangkal');
      last = (await posted())[0];
      expect(last.get('result.reviewCompletion')).toBe('incomplete');
      expect(last.get('result.uncertainty')).toContain('Reviewer tidak menelusuri kode');
      expect(last.get('result.gate')).toMatchObject({ verdict: 'FAIL' });
      expect(last.get('result.gate.description')).toContain('review sebagian');
    } finally {
      pr.body = body;
    }
  });

  it('GitHub App tanpa izin commit status → review tetap diposting, alasan tercatat di job', async () => {
    h.mock.denyStatuses = true;
    try {
      const posted = async () => (await reviewJobs()).filter((d) => d.get('status') === 'posted');
      const n = (await posted()).length;
      await h.comment('lapor @chefjuno');
      await h.waitFor(async () => (await posted()).length === n + 1, 45_000, 'job posted tanpa izin status');
      const newest = async () =>
        (await posted()).sort((a, b) => b.get('createdAt').toMillis() - a.get('createdAt').toMillis())[0];
      // gate dicatat sesaat setelah status "posted"
      await h.waitFor(async () => (await newest()).get('result.gate'), 15_000, 'gate tercatat');
      const last = await newest();
      expect(last.get('github.statusError')).toBe('GitHub App belum punya izin "Commit statuses: Read and write"');
      expect(last.get('result.gate.verdict')).toBe('FAIL');
    } finally {
      h.mock.denyStatuses = false;
    }
  });

  it('@chefjuno bantuan → balasan bantuan berbahasa Indonesia tanpa job', async () => {
    const before = (await reviewJobs()).length;
    await h.comment('@chefjuno bantuan');
    await h.waitFor(
      async () => h.mock.issueComments.some((c) => c.body.includes('**Perintah Chef Juno**')),
      15_000,
      'bantuan',
    );
    expect((await reviewJobs()).length).toBe(before);
  });

  it('pengirim tidak dipercaya (NONE, bukan anggota) → diabaikan diam-diam', async () => {
    const reacts = h.mock.reactions.length;
    const r = await h.comment('lapor @chefjuno', { login: 'orangluar', userId: 999999, association: 'NONE' });
    expect(r.body).toMatchObject({ result: 'pengirim tidak dipercaya' });
    expect(h.mock.reactions.length).toBe(reacts);
  });

  it('mention di dalam code span tidak memicu', async () => {
    const r = await h.comment('contoh: `lapor @chefjuno` di PR');
    expect(r.body).toMatchObject({ result: 'tanpa mention' });
  });

  it("preferredAgent 'codex' → dikerjakan fake-codex; footer menyebut Codex", async () => {
    await h.db.doc('settings/global').update({ preferredAgent: 'codex' });
    await h.startMachine({ name: 'Mesin Codex', agents: ['codex'] });
    await h.comment('lapor @chefjuno');
    const j = await h.waitJob((x) => x.type === 'review' && x.status === 'posted' && x.result?.meta?.agent === 'codex');
    expect(j.data.config.preferredAgent).toBe('codex');
    // model Codex default tingkat standar (review) = gpt-6.2-sol
    expect(h.mock.summaryComments('tim/sample-repo', 1)[0].body).toContain('Codex (gpt-6.2-sol + gpt-6.2-astra)'); // review + reviewer akhir
    // putaran correctness: tingkat standar (gpt-6.2-sol, effort high)
    const rec = readdirSync(h.recordDir)
      .filter((f) => f.startsWith('codex-'))
      .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
      .find(
        (r) =>
          String(r.prompt).includes('Fokus putaran ini: correctness') ||
          String(r.system ?? '').includes('Fokus putaran ini: correctness'),
      );
    expect(rec.argv[rec.argv.indexOf('-m') + 1]).toBe('gpt-6.2-sol');
    expect(rec.argv).toEqual(
      expect.arrayContaining([
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        'model_reasoning_effort="high"', // tingkat standar: effort high
      ]),
    );
    expect(rec.env.OPENAI_API_KEY).toBeNull();
    await h.db.doc('settings/global').update({ preferredAgent: 'any' });
  });

  it('review inline ditolak 422 → kirim ulang tanpa inline, semua ke "Temuan lain"', async () => {
    h.mock.failNextReview = true;
    const nPosted = (await reviewJobs()).filter((d) => d.get('status') === 'posted').length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () => (await reviewJobs()).filter((d) => d.get('status') === 'posted').length === nPosted + 1,
      45_000,
      'posted',
    );
    const last = (await reviewJobs()).find((d) => (d.get('result.notes') ?? []).length);
    expect(last?.get('result.postedInline')).toBe(0);
    expect(h.mock.summaryComments('tim/sample-repo', 1)[0].body).toContain('422');
  });

  it('PR ditutup → job review yang masih antre dibatalkan', async () => {
    for (const d of h.daemons.splice(0)) await d.stop();
    await h.comment('lapor @chefjuno');
    const q = await h.waitJob((j) => j.type === 'review' && j.status === 'queued');
    await sendWebhook(
      FN_BASE,
      'pull_request',
      pullRequestClosed({
        fullName: 'tim/sample-repo',
        repoId: 4242,
        prNumber: 1,
        merged: false,
        headSha: h.repo.headSha,
        baseSha: h.repo.baseSha,
      }),
    );
    await h.waitFor(
      async () => (await h.db.doc(`jobs/${q.id}`).get()).get('status') === 'cancelled',
      15_000,
      'cancelled',
    );
    // semua job PR itu mencatat pr.state = closed (tidak di-merge)
    const all = await h.db.collection('jobs').where('pr.number', '==', 1).get();
    expect(all.docs.filter((d) => d.get('type') === 'review').every((d) => d.get('pr.state') === 'closed')).toBe(true);
  });
});

describe('runMaintenance (lease & stale)', () => {
  it('lease kedaluwarsa → queued lagi; attempts 3 → failed; antre > 2 jam → stale + balasan', async () => {
    const base = {
      type: 'review',
      repo: { id: 4242, fullName: 'tim/sample-repo', installationId: 777 },
      pr: { number: 1, headSha: 'x' },
      trigger: { commentId: 1 },
      github: {},
    };
    const past = Timestamp.fromMillis(Date.now() - 60_000);
    await h.db.doc('jobs/m-lease1').set({
      ...base,
      status: 'running',
      attempts: 1,
      machineId: 'mx',
      leaseExpiresAt: past,
      createdAt: Timestamp.now(),
    });
    await h.db.doc('jobs/m-lease3').set({
      ...base,
      status: 'claimed',
      attempts: 3,
      machineId: 'mx',
      leaseExpiresAt: past,
      createdAt: Timestamp.now(),
    });
    await h.db.doc('jobs/m-ok').set({
      ...base,
      status: 'running',
      attempts: 1,
      machineId: 'mx',
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      createdAt: Timestamp.now(),
    });
    await h.db
      .doc('jobs/m-stale')
      .set({ ...base, status: 'queued', attempts: 0, createdAt: Timestamp.fromMillis(Date.now() - 3 * 3600_000) });
    const r = await runMaintenance(h.db);
    expect(r.requeued).toContain('m-lease1');
    expect(r.failed).toContain('m-lease3');
    expect(r.stale).toContain('m-stale');
    expect(r.requeued).not.toContain('m-ok');
    expect((await h.db.doc('jobs/m-lease1').get()).get('status')).toBe('queued');
    expect((await h.db.doc('jobs/m-lease3').get()).get('error.stage')).toBe('lease');
    expect((await h.db.doc('jobs/m-stale').get()).get('error.stage')).toBe('stale');
    await h.waitFor(
      async () => h.mock.issueComments.some((c) => c.body.includes('Antrean kedaluwarsa')),
      15_000,
      'balasan stale',
    );
  });
});
