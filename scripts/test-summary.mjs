// Menjalankan `npm run verify`, menyimpan output lengkap, dan menulis ringkasan ke docs/evidence/test-summary.txt.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const r = spawnSync('npm', ['run', 'verify'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
});
const out = (r.stdout ?? '') + (r.stderr ?? '');
const ESC = String.fromCharCode(27);
const strip = (s) =>
  s
    .split(ESC)
    .map((p, i) => (i ? p.replace(/^\[[0-9;]*m/, '') : p))
    .join('');
const clean = strip(out);
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/verify-output.txt', clean);
const lines = clean.split('\n');
const pick = (re) => lines.filter((l) => re.test(l)).map((l) => l.trim());
const summary = [
  `npm run verify — ${new Date().toISOString()} — exit code ${r.status}`,
  '',
  '== guard ==',
  ...pick(/guard-tests/),
  '',
  '== vitest — urutan: (1) unit shared+daemon+functions, (2) web (ng test), (3) emulator: rules + integrasi ==',
  ...pick(/^\s*(Test Files|Tests)\s/).map(
    (l, i) => `${['(1) unit', '(1) unit', '(2) web', '(2) web', '(3) emulator', '(3) emulator'][i] ?? ''} ${l}`,
  ),
  '',
  '== playwright ==',
  ...pick(/^\s*\d+ (passed|failed|flaky|skipped)/),
  '',
  `Status: ${r.status === 0 ? 'HIJAU' : 'GAGAL'}`,
].join('\n');
writeFileSync('docs/evidence/test-summary.txt', summary + '\n');
console.log(summary);
process.exit(r.status ?? 1);
