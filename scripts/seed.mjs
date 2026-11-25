// Seed emulator yang sedang jalan (npm run dev). Tidak pernah menyentuh produksi: project demo-chefjuno.
// Data = MOCK "seolah tim sudah memakai ±2 minggu" (scripts/seed-live.mjs). `--watch` = tetap jalan & simulasikan heartbeat mesin.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { seedBase } from './seed-data.mjs';
import { LIVE_MEMBERS, seedLive, startHeartbeatSimulator } from './seed-live.mjs';
import { buildWeeklyReport } from '../apps/functions/src/reports.ts';
import { previousWeek, weekStartJakarta } from '@chefjuno/shared';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= 'demo-chefjuno';
// modul Functions (reports.ts) mungkin sudah menginisialisasi app default lebih dulu
const app = getApps()[0] ?? initializeApp({ projectId: 'demo-chefjuno' });
const db = getFirestore(app, 'chefjuno');
const auth = getAuth(app);

await seedBase(db, LIVE_MEMBERS);
const { machines } = await seedLive(db);
const thisWeek = weekStartJakarta(new Date());
const w1 = previousWeek(thisWeek);
const w2 = previousWeek(w1);
// rekap mingguan hanya untuk minggu yang sudah lewat (seperti scheduler Senin 08.00)
for (const w of [w2, w1]) await buildWeeklyReport(db, w);
const NARR = {
  [w2]: 'Minggu pertama. Banyak null-check bolong dan query di dalam loop. Standar belum dipegang.',
  [w1]: 'Rina, Budi, dan Sari mengurangi temuan per PR. Yoga naik: query di dalam loop dan retry tanpa batas masih muncul di worker. Test jalur error masih tipis. Perbaiki sebelum minta review.',
};
for (const [w, narrative] of Object.entries(NARR))
  await db.doc(`reports/${w}_team`).set({ narrative }, { merge: true });
for (const m of LIVE_MEMBERS) {
  await auth
    .importUsers([
      {
        uid: `uid-${m.githubLogin}`,
        displayName: m.name,
        providerData: [{ uid: m.id, providerId: 'github.com', displayName: m.githubLogin }],
      },
    ])
    .catch(() => undefined);
}
console.log(
  `✅ seed selesai: ${LIVE_MEMBERS.length} anggota, 4 repo, 52 review (±2 minggu), rapor minggu ${w2} & ${w1}.`,
);
console.log('Masuk ke dashboard: npm run dev:login -- admin1   (atau rina / budi / sari / dimas / yoga)');
if (process.argv.includes('--watch')) {
  startHeartbeatSimulator(db, machines);
  console.log(`(simulasi heartbeat aktif untuk ${machines.join(', ')} — mesin tampil online selama proses ini jalan)`);
} else process.exit(0);
