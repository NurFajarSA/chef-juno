// Persiapan lokal untuk emulator (semua berkas di sini gitignored):
// 1. apps/functions/.secret.local berisi secret PALSU (private key RSA dibangkitkan lokal — bukan kunci GitHub App asli).
// 2. .firebaserc: project demo `demo-chefjuno` + target Hosting `dashboard` untuk emulator. Alias & target produksimu
//    (lihat .firebaserc.example / docs/SETUP.md) dipertahankan bila sudah ada.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

const path = new URL('../apps/functions/.secret.local', import.meta.url);
if (existsSync(path)) {
  console.log('setup-local: apps/functions/.secret.local sudah ada');
} else {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const body = [
    '# DIBANGKITKAN OTOMATIS oleh scripts/setup-local.mjs — nilai palsu untuk emulator saja.',
    'GITHUB_APP_ID=12345',
    'GITHUB_WEBHOOK_SECRET=demo-webhook-secret',
    `GITHUB_APP_PRIVATE_KEY="${pem.replace(/\n/g, '\\n')}"`,
    '',
  ].join('\n');
  writeFileSync(path, body, { mode: 0o600 });
  console.log('setup-local: apps/functions/.secret.local dibuat (secret palsu)');
}

const rcPath = new URL('../.firebaserc', import.meta.url);
const DEMO = 'demo-chefjuno';
let rc = {};
if (existsSync(rcPath)) {
  try {
    rc = JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch {
    throw new Error('setup-local: .firebaserc bukan JSON yang sah');
  }
}
const before = JSON.stringify(rc);
rc.projects = { default: DEMO, ...(rc.projects ?? {}) };
rc.targets = rc.targets ?? {};
rc.targets[DEMO] = {
  ...(rc.targets[DEMO] ?? {}),
  hosting: { ...(rc.targets[DEMO]?.hosting ?? {}), dashboard: [DEMO] },
};
if (JSON.stringify(rc) !== before) {
  writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n');
  console.log('setup-local: .firebaserc diperbarui (project & target Hosting demo)');
}
