// KHUSUS EMULATOR: siapkan pengalaman "orang pertama yang masuk" — database kosong, satu akun GitHub
// (ID 1001 = BOOTSTRAP_ADMIN_GITHUB_IDS di .env.demo-chefjuno) yang BELUM jadi anggota.
// Saat login, syncMembership menjalankan alur bootstrap sungguhan dan menjadikannya admin pertama.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const auth = getAuth(initializeApp({ projectId: 'demo-chefjuno' }));
const uid = 'uid-pemilik';
try {
  await auth.getUser(uid);
} catch {
  await auth.importUsers([
    {
      uid,
      displayName: 'Pemilik Tim',
      email: 'pemilik@example.test',
      providerData: [{ uid: '1001', providerId: 'github.com', displayName: 'pemilik', email: 'pemilik@example.test' }],
    },
  ]);
}
const token = await auth.createCustomToken(uid);
const base = process.env.WEB_URL ?? 'http://localhost:4200';
console.log(
  `Mode orang pertama (database kosong). Buka link ini untuk masuk sebagai @pemilik:\n${base}/login?customToken=${encodeURIComponent(token)}`,
);
process.exit(0);
