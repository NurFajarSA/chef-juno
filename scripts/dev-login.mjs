// Cetak link login dashboard (KHUSUS EMULATOR) untuk akun seed: node scripts/dev-login.mjs [admin1|dev2|dev3]
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const login = process.argv[2] ?? 'admin1';
const token = await getAuth(initializeApp({ projectId: 'demo-chefjuno' })).createCustomToken(`uid-${login}`);
const base = process.env.WEB_URL ?? 'http://localhost:4200';
console.log(`Buka link ini untuk masuk sebagai @${login}:\n${base}/login?customToken=${encodeURIComponent(token)}`);
process.exit(0);
