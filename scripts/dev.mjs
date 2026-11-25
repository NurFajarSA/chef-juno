// npm run dev: emulator (demo-chefjuno) + dashboard (ng serve) + data dummy "live" + simulasi heartbeat mesin.
// Setelah siap, mencetak link login. Ctrl+C untuk berhenti.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const procs = [];
const run = (cmd, args, opts = {}) => {
  const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
  procs.push(p);
  return p;
};
const stop = () => procs.forEach((p) => p.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const tryHost = (port, host) =>
  new Promise((res) => {
    const s = connect(port, host);
    s.on('connect', () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
  });
// ng serve bisa hanya mendengarkan IPv6 (::1) → cek keduanya
const portOpen = async (port) => (await tryHost(port, '127.0.0.1')) || (await tryHost(port, '::1'));
async function waitPort(port, label) {
  for (let i = 0; i < 240; i++) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`❌ ${label} tidak siap dalam 4 menit.`);
  stop();
  process.exit(1);
}

run('npx', ['firebase', 'emulators:start', '--project', 'demo-chefjuno', '--only', 'auth,firestore,functions']);
run('npm', ['run', 'start', '-w', 'apps/web', '--', '--port', '4200']);
await waitPort(8085, 'Firestore emulator');
await waitPort(9099, 'Auth emulator');
await waitPort(5001, 'Functions emulator');
if (process.argv.includes('--fresh')) {
  // database kosong + akun bootstrap yang belum jadi anggota → alur orang pertama yang masuk
  await waitPort(4200, 'Dashboard');
  run('node', ['scripts/dev-first-run.mjs']);
} else if (!process.argv.includes('--no-seed')) {
  run('npx', ['tsx', 'scripts/seed.mjs', '--watch']);
  await waitPort(4200, 'Dashboard');
  await new Promise((r) => setTimeout(r, 8000));
  run('node', ['scripts/dev-login.mjs', 'admin1']);
}
