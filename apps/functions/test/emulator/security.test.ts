import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { callFn, clearAuth, clearFirestore, idTokenFor, importGithubUser } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
});
afterAll(async () => h?.stop());

describe('keamanan tambahan', () => {
  it('getJobRepoAccess: hanya mesin pemegang job (claimed/running); anggota & mesin lain ditolak', async () => {
    const base = {
      type: 'review',
      repo: { id: 4242, fullName: 'tim/sample-repo', installationId: 777 },
      pr: { number: 1 },
      createdAt: Timestamp.now(),
    };
    await h.db.doc('machines/mA').set({ name: 'A', revoked: false, concurrency: 1, currentJobIds: [] });
    await h.db.doc('machines/mB').set({ name: 'B', revoked: false, concurrency: 1, currentJobIds: [] });
    await h.db.doc('jobs/jA').set({ ...base, status: 'running', machineId: 'mA' });
    await h.db.doc('jobs/jQ').set({ ...base, status: 'queued', machineId: null });
    const tA = await idTokenFor('machine:mA', { machine: true, machineId: 'mA' });
    const tB = await idTokenFor('machine:mB', { machine: true, machineId: 'mB' });
    const member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    const ok = await callFn<{ token: string }>('getJobRepoAccess', { jobId: 'jA' }, tA);
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.result!.token).toMatch(/^ghs_/);
    const req = h.mock.calls('POST', /\/app\/installations\/777\/access_tokens$/).at(-1)!;
    expect(req.body).toEqual({ repository_ids: [4242], permissions: { contents: 'read' } });
    expect((await callFn('getJobRepoAccess', { jobId: 'jA' }, tB)).ok).toBe(false);
    expect((await callFn('getJobRepoAccess', { jobId: 'jQ' }, tA)).ok).toBe(false);
    expect((await callFn('getJobRepoAccess', { jobId: 'jA' }, member)).ok).toBe(false);
    await h.db.doc('machines/mA').update({ revoked: true });
    expect((await callFn('getJobRepoAccess', { jobId: 'jA' }, tA)).ok).toBe(false);
    for (const id of ['jA', 'jQ']) await h.db.doc(`jobs/${id}`).delete();
  });

  it('output agent memuat rahasia (pola ghs_) → job gagal tahap leak, tidak diposting', async () => {
    await h.startMachine({ agents: ['claude'] });
    const d = h.daemons[0];
    const runner = d.runners.claude as unknown as { opts: { env: Record<string, string> } };
    runner.opts.env.FAKE_AGENT_LEAK = 'ghs_' + 'A'.repeat(36);
    await h.comment('lapor @chefjuno');
    const j = await h.waitJob((x) => x.type === 'review' && x.status === 'failed' && x.pr?.headSha === h.repo.headSha);
    expect(j.data.error.stage, j.data.error.message).toBe('leak');
    expect(h.mock.summaryComments('tim/sample-repo', 1)).toHaveLength(0);
    await h.waitFor(
      async () => h.mock.issueComments.some((c) => c.body.includes('Review gagal di tahap `leak`')),
      15_000,
      'balasan gagal',
    );
    expect(h.mock.reactions.some((r) => r.content === 'confused')).toBe(true);
    expect(JSON.stringify(h.mock.issueComments)).not.toContain('ghs_AAAA');
    delete runner.opts.env.FAKE_AGENT_LEAK;
  });

  it('job index yang ringkasan modulnya memuat rahasia → gagal tahap leak; modul tidak ditulis', async () => {
    const runner = h.daemons[0].runners.claude as unknown as { opts: { env: Record<string, string> } };
    runner.opts.env.FAKE_AGENT_LEAK = '-----BEGIN ' + 'PRIVATE KEY-----';
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const r = await callFn<{ jobId: string }>('requestReindex', { repoId: 4242 }, admin);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    await h.waitFor(
      async () => (await h.db.doc(`jobs/${r.result!.jobId}`).get()).get('status') === 'failed',
      30_000,
      'index gagal',
    );
    expect((await h.db.doc(`jobs/${r.result!.jobId}`).get()).get('error.stage')).toBe('leak');
    expect((await h.db.collection('repos/4242/modules').get()).size).toBe(0);
    await h.waitFor(
      async () => (await h.db.doc('repos/4242').get()).get('index.status') === 'failed',
      15_000,
      'repo failed',
    );
    delete runner.opts.env.FAKE_AGENT_LEAK;
  });

  it('removeMember: hapus dokumen + cabut claim cj/cjGh tanpa menimpa claim lain', async () => {
    await h.db.doc('members/3003').set({ githubLogin: 'dev3', role: 'member', level: 'mid' });
    await importGithubUser('uid-dev3', '3003', 'dev3');
    const { auth } = (await import('../helpers.js')).admin();
    await auth.setCustomUserClaims('uid-dev3', { appLain: 'x' });
    const t3 = await idTokenFor('uid-dev3');
    const s = await callFn<{ member: boolean }>('syncMembership', {}, t3);
    expect(s.result!.member).toBe(true);
    expect((await auth.getUser('uid-dev3')).customClaims).toEqual({ appLain: 'x', cj: 'member', cjGh: '3003' });
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    expect(
      (
        await callFn(
          'removeMember',
          { githubUserId: '3003' },
          await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' }),
        )
      ).ok,
    ).toBe(false);
    const r = await callFn('removeMember', { githubUserId: '3003' }, admin);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await h.db.doc('members/3003').get()).exists).toBe(false);
    expect((await auth.getUser('uid-dev3')).customClaims).toEqual({ appLain: 'x' });
  });

  it('upsertMember: admin menambah lewat login GitHub (resolve ID dari GitHub); level lama diabaikan', async () => {
    const admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
    const r = await callFn<{ githubUserId: string }>(
      'upsertMember',
      { githubLogin: 'dev3', role: 'member', level: 'senior' },
      admin,
    );
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.result!.githubUserId).toBe('3003');
    const saved = (await h.db.doc('members/3003').get()).data()!;
    expect(saved).toMatchObject({ githubLogin: 'dev3', role: 'member' });
    // level penulis dihapus (keputusan pemilik 24 Nov 2026): klien lama yang masih mengirim level tidak mengubah apa pun
    expect(saved['level']).not.toBe('senior');
  });
});
