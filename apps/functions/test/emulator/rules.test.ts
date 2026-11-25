import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { admin, cleanup, clearFirestore, clientDb, machineToken, memberToken } from '../helpers.js';

const { db } = admin();
const now = () => Date.now();

async function seed() {
  await db.doc('members/1001').set({ githubLogin: 'admin1', role: 'admin', level: 'senior' });
  await db.doc('members/2002').set({ githubLogin: 'dev2', role: 'member', level: 'junior' });
  await db.doc('settings/global').set({ maxInlineComments: 10, preferredAgent: 'any' });
  await db.doc('machines/m1').set({ name: 'M1', ownerUid: 'u1001', revoked: false, concurrency: 1, currentJobIds: [] });
  await db
    .doc('machines/mr')
    .set({ name: 'Revoked', ownerUid: 'u1001', revoked: true, concurrency: 1, currentJobIds: [] });
  await db.doc('machineSecrets/m1').set({ secretHash: 'x' });
  await db.doc('machineRegistrations/abc').set({ createdBy: 'u1001' });
  await db.doc('webhookDeliveries/d1').set({ event: 'x' });
  await db.doc('prompts/review').set({ activeVersion: 1, latestVersion: 1 });
  await db.doc('prompts/review/versions/1').set({ version: 1, content: 'x', message: 'awal' });
  await db.doc('repos/42').set({ fullName: 'o/r', enabled: true, installationId: 7 });
  await db.doc('repos/42/modules/src-a').set({ name: 'a' });
  await db.doc('rules/active1').set({ status: 'active', text: 'aturan' });
  await db.doc('rules/sugg1').set({ status: 'suggested', text: 'usulan' });
  await db.doc('people/dev2').set({ recurringMistakes: [] });
  await db.doc('jobs/q1').set({ type: 'review', status: 'queued', attempts: 0, repo: { id: 42 } });
  await db.doc('jobs/mine').set({ type: 'review', status: 'running', machineId: 'm1', attempts: 1, repo: { id: 42 } });
  await db
    .doc('jobs/claimedMine')
    .set({ type: 'review', status: 'claimed', machineId: 'm1', attempts: 1, repo: { id: 42 } });
  await db.doc('jobs/other').set({ type: 'review', status: 'running', machineId: 'm2', attempts: 1, repo: { id: 42 } });
  await db.doc('findings/f1').set({ outcome: 'pending' });
  await db.doc('reports/2026-11-16_team').set({ x: 1 });
  await db.doc('skills/sql').set({ name: 'sql', description: 'd', enabled: true, latestVersion: 1 });
  await db.doc('skills/sql/versions/1').set({ version: 1, files: { 'SKILL.md': 'x' } });
}

beforeEach(async () => {
  await clearFirestore();
  await seed();
});
afterAll(cleanup);

describe('kewarasan', () => {
  it('baca tanpa login ke database chefjuno GAGAL (rules benar-benar dimuat)', async () => {
    const c = clientDb(null);
    await assertFails(getDoc(doc(c, 'members/1001')));
    await assertFails(getDoc(doc(c, 'settings/global')));
  });
});

describe('anggota', () => {
  it('anggota bisa membaca koleksi umum', async () => {
    const c = clientDb(memberToken('2002'));
    for (const p of [
      'members/1001',
      'settings/global',
      'machines/m1',
      'jobs/q1',
      'findings/f1',
      'people/dev2',
      'reports/2026-11-16_team',
      'prompts/review/versions/1',
      'repos/42/modules/src-a',
      'rules/sugg1',
    ]) {
      await assertSucceeds(getDoc(doc(c, p)));
    }
  });
  it('anggota TIDAK bisa membaca machineRegistrations, webhookDeliveries, machineSecrets', async () => {
    const c = clientDb(memberToken('2002'));
    await assertFails(getDoc(doc(c, 'machineRegistrations/abc')));
    await assertFails(getDoc(doc(c, 'webhookDeliveries/d1')));
    await assertFails(getDoc(doc(c, 'machineSecrets/m1')));
  });
  it('login tanpa claim cj (bukan anggota) ditolak', async () => {
    const c = clientDb({ sub: 'x', user_id: 'x' });
    await assertFails(getDoc(doc(c, 'members/1001')));
  });
  it('claim cj masih ada tapi dokumen members sudah dihapus → ditolak', async () => {
    const c = clientDb(memberToken('3003'));
    await assertFails(getDoc(doc(c, 'members/1001')));
  });
  it('klien tidak bisa menulis members, rules, jobs, people, reports, findings, prompts', async () => {
    const c = clientDb(memberToken('1001', 'admin'));
    await assertFails(setDoc(doc(c, 'members/9'), { role: 'admin' }));
    await assertFails(setDoc(doc(c, 'rules/x'), { status: 'active' }));
    await assertFails(updateDoc(doc(c, 'rules/sugg1'), { status: 'active' }));
    await assertFails(setDoc(doc(c, 'jobs/x'), { status: 'queued' }));
    await assertFails(setDoc(doc(c, 'people/x'), {}));
    await assertFails(setDoc(doc(c, 'reports/x'), {}));
    await assertFails(updateDoc(doc(c, 'findings/f1'), { outcome: 'addressed' }));
    await assertFails(updateDoc(doc(c, 'prompts/review'), { activeVersion: 2 }));
    await assertFails(updateDoc(doc(c, 'machines/m1'), { revoked: true }));
  });
  it('versi prompt immutable: create/update/delete ditolak untuk klien', async () => {
    const c = clientDb(memberToken('1001', 'admin'));
    await assertFails(setDoc(doc(c, 'prompts/review/versions/2'), { version: 2, content: 'y', message: 'x' }));
    await assertFails(updateDoc(doc(c, 'prompts/review/versions/1'), { content: 'ubah' }));
    await assertFails(deleteDoc(doc(c, 'prompts/review/versions/1')));
  });
});

describe('admin', () => {
  it('admin boleh ubah settings.global (field dikenal), member tidak', async () => {
    await assertSucceeds(
      updateDoc(doc(clientDb(memberToken('1001', 'admin')), 'settings/global'), { maxInlineComments: 5 }),
    );
    await assertFails(updateDoc(doc(clientDb(memberToken('2002')), 'settings/global'), { maxInlineComments: 5 }));
  });
  it('admin tidak boleh set maxInlineComments > 30 atau field asing', async () => {
    const c = clientDb(memberToken('1001', 'admin'));
    await assertFails(updateDoc(doc(c, 'settings/global'), { maxInlineComments: 31 }));
    await assertFails(updateDoc(doc(c, 'settings/global'), { botHandle: 'lain' }));
  });
  it('claim admin palsu tapi members.role = member → ditolak', async () => {
    await assertFails(
      updateDoc(doc(clientDb(memberToken('2002', 'admin')), 'settings/global'), { maxInlineComments: 5 }),
    );
  });
  it('admin hanya boleh toggle repos.enabled', async () => {
    const c = clientDb(memberToken('1001', 'admin'));
    await assertSucceeds(updateDoc(doc(c, 'repos/42'), { enabled: false }));
    await assertFails(updateDoc(doc(c, 'repos/42'), { installationId: 9 }));
    await assertFails(updateDoc(doc(clientDb(memberToken('2002')), 'repos/42'), { enabled: false }));
  });
});

describe('mesin', () => {
  const lease = (ms = 10 * 60_000) => Timestamp.fromMillis(now() + ms);

  it('mesin membaca job queued & job miliknya, bukan job mesin lain', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(getDoc(doc(c, 'jobs/q1')));
    await assertSucceeds(getDoc(doc(c, 'jobs/mine')));
    await assertFails(getDoc(doc(c, 'jobs/other')));
    await assertSucceeds(getDocs(query(collection(c, 'jobs'), where('status', '==', 'queued'))));
  });
  it('mesin baca prompt versions, rules active, people, modules; bukan rules suggested', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(getDoc(doc(c, 'prompts/review/versions/1')));
    await assertSucceeds(getDoc(doc(c, 'rules/active1')));
    await assertFails(getDoc(doc(c, 'rules/sugg1')));
    await assertSucceeds(getDoc(doc(c, 'people/dev2')));
    await assertSucceeds(getDoc(doc(c, 'repos/42/modules/src-a')));
    await assertFails(getDoc(doc(c, 'members/1001')));
    await assertFails(getDoc(doc(c, 'machineSecrets/m1')));
  });
  it('mesin tidak menulis modules langsung (lewat Function, §12.3)', async () => {
    await assertFails(setDoc(doc(clientDb(machineToken('m1')), 'repos/42/modules/x'), { name: 'x' }));
  });
  it('claim: queued → claimed dengan attempts+1 dan lease ≤ 11 menit', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(
      updateDoc(doc(c, 'jobs/q1'), {
        status: 'claimed',
        machineId: 'm1',
        attempts: 1,
        leaseExpiresAt: lease(),
        claimedAt: Timestamp.now(),
      }),
    );
  });
  it('claim ditolak: machineId orang lain, attempts salah, lease terlalu panjang, bukan queued', async () => {
    const c = clientDb(machineToken('m1'));
    await assertFails(
      updateDoc(doc(c, 'jobs/q1'), { status: 'claimed', machineId: 'm2', attempts: 1, leaseExpiresAt: lease() }),
    );
    await assertFails(
      updateDoc(doc(c, 'jobs/q1'), { status: 'claimed', machineId: 'm1', attempts: 5, leaseExpiresAt: lease() }),
    );
    await assertFails(
      updateDoc(doc(c, 'jobs/q1'), {
        status: 'claimed',
        machineId: 'm1',
        attempts: 1,
        leaseExpiresAt: lease(30 * 60_000),
      }),
    );
    await assertFails(
      updateDoc(doc(c, 'jobs/other'), { status: 'claimed', machineId: 'm1', attempts: 2, leaseExpiresAt: lease() }),
    );
  });
  it('claim tidak boleh mengubah field repo/pr/config', async () => {
    const c = clientDb(machineToken('m1'));
    await assertFails(
      updateDoc(doc(c, 'jobs/q1'), {
        status: 'claimed',
        machineId: 'm1',
        attempts: 1,
        leaseExpiresAt: lease(),
        repo: { id: 1 },
      }),
    );
  });
  it('update job miliknya: claimed→running→completed; field terbatas', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(updateDoc(doc(c, 'jobs/claimedMine'), { status: 'running', leaseExpiresAt: lease() }));
    await assertSucceeds(
      updateDoc(doc(c, 'jobs/mine'), { status: 'completed', result: { score: 3 }, finishedAt: Timestamp.now() }),
    );
  });
  it('update job ditolak: field terlarang, transisi tidak sah, job mesin lain', async () => {
    const c = clientDb(machineToken('m1'));
    await assertFails(updateDoc(doc(c, 'jobs/mine'), { github: { postedAt: 1 } }));
    await assertFails(updateDoc(doc(c, 'jobs/mine'), { type: 'index' }));
    await assertFails(updateDoc(doc(c, 'jobs/mine'), { status: 'posted' }));
    await assertFails(updateDoc(doc(c, 'jobs/claimedMine'), { status: 'completed' }));
    await assertFails(updateDoc(doc(c, 'jobs/other'), { status: 'completed' }));
  });
  it('heartbeat: mesin hanya boleh ubah field heartbeat miliknya', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(updateDoc(doc(c, 'machines/m1'), { lastSeenAt: Timestamp.now(), daemonVersion: '0.1.0' }));
    await assertFails(updateDoc(doc(c, 'machines/m1'), { revoked: true }));
    await assertFails(updateDoc(doc(c, 'machines/m1'), { concurrency: 5 }));
    await assertFails(updateDoc(doc(c, 'machines/m1'), { ownerUid: 'evil' }));
    await assertFails(updateDoc(doc(c, 'machines/mr'), { lastSeenAt: Timestamp.now() }));
  });
  it('mesin revoked ditolak semua akses', async () => {
    const c = clientDb(machineToken('mr'));
    await assertFails(getDoc(doc(c, 'jobs/q1')));
    await assertFails(getDoc(doc(c, 'prompts/review/versions/1')));
    await assertFails(updateDoc(doc(c, 'machines/mr'), { lastSeenAt: Timestamp.now() }));
  });
  it('token mesin dengan uid tidak cocok ditolak', async () => {
    const c = clientDb({ sub: 'u1', user_id: 'u1', machine: true, machineId: 'm1' });
    await assertFails(getDoc(doc(c, 'jobs/q1')));
  });
});

describe('skill tim', () => {
  it('anggota & mesin aktif boleh baca; tanpa login / mesin revoked ditolak', async () => {
    for (const t of [memberToken('2002'), machineToken('m1')]) {
      const c = clientDb(t);
      await assertSucceeds(getDoc(doc(c, 'skills/sql')));
      await assertSucceeds(getDoc(doc(c, 'skills/sql/versions/1')));
    }
    await assertFails(getDoc(doc(clientDb(null), 'skills/sql')));
    await assertFails(getDoc(doc(clientDb(machineToken('mr')), 'skills/sql/versions/1')));
  });
  it('tulis langsung dari klien ditolak (termasuk admin) — hanya lewat callable', async () => {
    const c = clientDb(memberToken('1001', 'admin'));
    await assertFails(setDoc(doc(c, 'skills/baru'), { name: 'baru', enabled: true }));
    await assertFails(updateDoc(doc(c, 'skills/sql'), { enabled: false }));
    await assertFails(setDoc(doc(c, 'skills/sql/versions/2'), { files: {} }));
    await assertFails(deleteDoc(doc(c, 'skills/sql')));
  });
});

describe('bukti uji aplikasi (jobs/{id}/evidence)', () => {
  const ev = (o: Record<string, unknown> = {}) => ({
    findingIndex: 0,
    name: 'total-salah',
    mime: 'image/jpeg',
    data: '/9j/AAAA',
    createdAt: Timestamp.now(),
    ...o,
  });
  it('mesin pemegang job yang sedang berjalan bisa menulis; tidak bisa mengubah/menghapus', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(setDoc(doc(c, 'jobs/mine/evidence/f0-0'), ev()));
    await assertFails(setDoc(doc(c, 'jobs/mine/evidence/f0-0'), ev({ name: 'ganti' })));
    await assertFails(deleteDoc(doc(c, 'jobs/mine/evidence/f0-0')));
  });
  it('ditolak: job mesin lain, job belum running, field asing, bukan JPEG, gambar terlalu besar', async () => {
    const c = clientDb(machineToken('m1'));
    await assertFails(setDoc(doc(c, 'jobs/other/evidence/x'), ev()));
    await assertFails(setDoc(doc(c, 'jobs/claimedMine/evidence/x'), ev()));
    await assertFails(setDoc(doc(c, 'jobs/mine/evidence/x'), ev({ url: 'https://evil' })));
    await assertFails(setDoc(doc(c, 'jobs/mine/evidence/x'), ev({ mime: 'text/html' })));
    await assertFails(setDoc(doc(c, 'jobs/mine/evidence/x'), ev({ data: 'A'.repeat(950_001) })));
    await assertFails(setDoc(doc(clientDb(machineToken('mr')), 'jobs/mine/evidence/x'), ev()));
  });
  it('anggota bisa membaca tapi tidak menulis; bukan anggota tidak bisa membaca', async () => {
    // seed lewat admin SDK: createdAt pakai Date (Timestamp klien tidak diterima admin SDK)
    await db.doc('jobs/mine/evidence/f0-0').set({ ...ev(), createdAt: new Date() });
    const m = clientDb(memberToken('2002'));
    await assertSucceeds(getDoc(doc(m, 'jobs/mine/evidence/f0-0')));
    await assertFails(setDoc(doc(m, 'jobs/mine/evidence/x'), ev()));
    await assertFails(getDoc(doc(clientDb(memberToken('3003')), 'jobs/mine/evidence/f0-0')));
    await assertFails(getDoc(doc(clientDb(null), 'jobs/mine/evidence/f0-0')));
  });
});

describe('kapasitas mesin', () => {
  it('admin boleh mengatur kapasitas 1–4; nilai di luar itu, field lain, dan anggota biasa ditolak', async () => {
    const adminC = clientDb(memberToken('1001', 'admin'));
    await assertSucceeds(updateDoc(doc(adminC, 'machines/m1'), { concurrency: 2 }));
    await assertSucceeds(updateDoc(doc(adminC, 'machines/m1'), { concurrency: 4 }));
    await assertFails(updateDoc(doc(adminC, 'machines/m1'), { concurrency: 5 }));
    await assertFails(updateDoc(doc(adminC, 'machines/m1'), { concurrency: 0 }));
    await assertFails(updateDoc(doc(adminC, 'machines/m1'), { concurrency: '2' }));
    await assertFails(updateDoc(doc(adminC, 'machines/m1'), { concurrency: 2, revoked: true }));
    await assertFails(updateDoc(doc(clientDb(memberToken('2002')), 'machines/m1'), { concurrency: 2 }));
  });
});

describe('aktivitas agent (jobs/{id}/activity)', () => {
  const act = (o: Record<string, unknown> = {}) => ({
    step: 'lens-correctness',
    seq: 0,
    events: [{ kind: 'think', text: 'cek pemanggil', at: 1 }],
    createdAt: Timestamp.now(),
    ...o,
  });
  it('mesin pemegang job yang berjalan bisa menambah; tidak bisa mengubah/menghapus', async () => {
    const c = clientDb(machineToken('m1'));
    await assertSucceeds(setDoc(doc(c, 'jobs/mine/activity/a0'), act()));
    await assertFails(setDoc(doc(c, 'jobs/mine/activity/a0'), act({ step: 'ganti' })));
    await assertFails(deleteDoc(doc(c, 'jobs/mine/activity/a0')));
  });
  it('ditolak: job mesin lain, job belum running, field asing, terlalu banyak event', async () => {
    const c = clientDb(machineToken('m1'));
    await assertFails(setDoc(doc(c, 'jobs/other/activity/x'), act()));
    await assertFails(setDoc(doc(c, 'jobs/claimedMine/activity/x'), act()));
    await assertFails(setDoc(doc(c, 'jobs/mine/activity/x'), act({ output: 'isi file' })));
    await assertFails(
      setDoc(doc(c, 'jobs/mine/activity/x'), act({ events: Array(41).fill({ kind: 'tool', text: 'x', at: 1 }) })),
    );
  });
  it('anggota bisa membaca tapi tidak menulis; bukan anggota tidak bisa membaca', async () => {
    await db.doc('jobs/mine/activity/a0').set({ ...act(), createdAt: new Date() });
    const m = clientDb(memberToken('2002'));
    await assertSucceeds(getDoc(doc(m, 'jobs/mine/activity/a0')));
    await assertFails(setDoc(doc(m, 'jobs/mine/activity/x'), act()));
    await assertFails(getDoc(doc(clientDb(memberToken('3003')), 'jobs/mine/activity/a0')));
  });
});
