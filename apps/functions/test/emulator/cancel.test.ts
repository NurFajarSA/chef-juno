import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFn, clearAuth, clearFirestore, idTokenFor } from '../helpers.js';
import { createHarness, FULL_NAME, type Harness } from '../harness.js';

// Pembatalan job: tombol Batalkan (admin / peminta) & review untuk commit baru menggantikan job lama.
// Mesin yang mengerjakan job yang dibatalkan menghentikan agent-nya (fake agent lambat 60 dtk) dan bebas lagi.
let h: Harness;
const review = async (status: string) =>
  (await h.db.collection('jobs').where('type', '==', 'review').where('status', '==', status).get()).docs;

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  process.env.FAKE_AGENT_MODE = 'slow';
  h = await createHarness();
  await h.startMachine({ agents: ['claude'] });
});
afterAll(async () => {
  delete process.env.FAKE_AGENT_MODE;
  await h?.stop();
});

describe('pembatalan job', () => {
  it('Batalkan: hanya admin/peminta; agent dihentikan, status tetap "dibatalkan", status commit diberi tahu', async () => {
    await h.comment('lapor @chefjuno'); // peminta: dev2
    const running = await h.waitFor(async () => (await review('running'))[0], 30_000, 'review berjalan');

    const dev3 = await idTokenFor('uid-dev3', { cj: 'member', cjGh: '3003' });
    const denied = await callFn('cancelJob', { jobId: running.id }, dev3);
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied.error)).toContain('Hanya admin atau yang meminta review ini');

    const dev2 = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
    const r = await callFn<{ cancelled: string[] }>('cancelJob', { jobId: running.id }, dev2);
    expect(r.result?.cancelled).toEqual([running.id]);

    // status commit tidak tertinggal "pending"
    await h.waitFor(
      async () =>
        h.mock.statuses.some(
          (s: { state: string; description: string }) =>
            s.state === 'error' && s.description.includes('Dibatalkan oleh @dev2'),
        ),
      10_000,
      'status commit dibatalkan',
    );
    // mesin bebas lagi (agent lambat dihentikan): review berikutnya langsung diambil & berjalan
    await h.comment('lapor @chefjuno');
    const next = await h.waitFor(
      async () => (await review('running')).find((d) => d.id !== running.id),
      20_000,
      'mesin mengambil review berikutnya',
    );
    // job yang dibatalkan tidak ditimpa "gagal" oleh mesin
    const old = (await h.db.doc(`jobs/${running.id}`).get()).data()!;
    expect(old.status).toBe('cancelled');
    expect(old.error).toEqual({ stage: 'cancelled', message: 'Dibatalkan oleh @dev2' });

    // tidak ada lagi yang aktif → pesan jelas
    await callFn('cancelJob', { jobId: next.id }, dev2);
    const again = await callFn('cancelJob', { jobId: next.id }, dev2);
    expect(JSON.stringify(again.error)).toContain('Tidak ada job aktif');
  });

  it('review untuk commit baru menggantikan review commit lama yang masih berjalan', async () => {
    await h.comment('lapor @chefjuno');
    const oldJob = await h.waitFor(async () => (await review('running'))[0], 30_000, 'review commit lama berjalan');
    // commit baru di PR, lalu minta review lagi
    const sha = h.repo.commit({ 'src/baru.ts': 'export const x = 1;\n' }, 'feat: commit baru');
    h.mock.repos.get(FULL_NAME)!.prs.get(1)!.headSha = sha;
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () => (await h.db.doc(`jobs/${oldJob.id}`).get()).get('status') === 'cancelled',
      15_000,
      'review lama dibatalkan',
    );
    expect((await h.db.doc(`jobs/${oldJob.id}`).get()).get('error.message')).toBe(
      'Digantikan review untuk commit yang lebih baru',
    );
    const fresh = await h.waitFor(
      async () => (await review('running')).find((d) => d.get('pr.headSha') === sha),
      20_000,
      'review commit baru berjalan',
    );
    expect(fresh.id).not.toBe(oldJob.id);
    await callFn('cancelJob', { jobId: fresh.id }, await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' }));
  });
});
