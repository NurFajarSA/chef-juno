// KHUSUS EMULATOR (project demo-chefjuno): simulasikan langkah setup supaya onboarding bisa dicoba tanpa GitHub/mesin sungguhan.
//   npm run dev:simulate -- install   → webhook GitHub App "repo ditambahkan" (lewat Functions sungguhan)
//   npm run dev:simulate -- machine   → MOCK: mesin "Laptop Demo" online (heartbeat tiap 20 detik sampai Ctrl+C)
//   npm run dev:simulate -- review    → MOCK: satu review PR yang sudah diposting
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { installationRepositories, sendWebhook } from './lib/payloads.mjs';

const PROJECT = 'demo-chefjuno';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const FN_BASE = `http://127.0.0.1:5001/${PROJECT}/asia-southeast2`;
const db = getFirestore(initializeApp({ projectId: PROJECT }), 'chefjuno');
const what = process.argv[2];
const REPO = { fullName: 'tim/contoh-repo', repoId: 5151 };

if (what === 'install') {
  const r = await sendWebhook(FN_BASE, 'installation_repositories', installationRepositories(REPO));
  console.log(`Webhook instalasi terkirim (${r.status}): ${REPO.fullName}`);
  process.exit(r.status < 300 ? 0 : 1);
} else if (what === 'machine') {
  // MOCK: dokumen mesin + heartbeat palsu (mesin sungguhan: chefjuno login + start)
  const ref = db.doc('machines/demo-laptop');
  await ref.set({
    name: 'Laptop Demo',
    ownerUid: 'uid-pemilik',
    ownerLogin: 'pemilik',
    platform: 'darwin-arm64',
    daemonVersion: '0.1.0',
    agents: { claude: { version: '2.1.323', safeMode: true }, codex: null },
    concurrency: 1,
    currentJobIds: [],
    revoked: false,
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
  });
  console.log('Mesin "Laptop Demo" online (MOCK). Ctrl+C untuk berhenti — mesin akan offline ±90 detik kemudian.');
  setInterval(() => void ref.update({ lastSeenAt: FieldValue.serverTimestamp() }).catch(() => undefined), 20_000);
} else if (what === 'review') {
  // MOCK: hasil review yang sudah diposting (review sungguhan: komentar `lapor @chefjuno` di PR)
  await db.doc('jobs/demo-review-1').set({
    type: 'review',
    status: 'posted',
    repo: { id: REPO.repoId, fullName: REPO.fullName, installationId: 777 },
    pr: {
      number: 1,
      title: 'feat: halaman login',
      authorLogin: 'pemilik',
      htmlUrl: `https://github.com/${REPO.fullName}/pull/1`,
    },
    trigger: { login: 'pemilik', word: 'lapor' },
    machineId: 'demo-laptop',
    agent: 'claude',
    result: {
      score: 4,
      verdict: 'Rapi. Satu hal perlu dibereskan sebelum merge.',
      summary: 'PR ini menambah halaman login.',
      findings: [],
      suppressed: [],
    },
    attempts: 1,
    createdAt: FieldValue.serverTimestamp(),
    finishedAt: FieldValue.serverTimestamp(),
  });
  console.log('Review pertama (MOCK) dibuat: tim/contoh-repo #1');
  process.exit(0);
} else {
  console.log('Pakai: npm run dev:simulate -- install | machine | review');
  process.exit(1);
}
