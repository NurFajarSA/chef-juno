#!/usr/bin/env node
// Docker/Podman palsu untuk test verifikasi & uji aplikasi (CHEFJUNO_CONTAINER_BIN). Tidak menjalankan container apa pun.
// - `--version` → sukses
// - verifikasi statis (`-v <dir>:/src`): setup (berjaringan, memori 4g) → sukses; analisis (`--network none`) → keluarkan
//   "warning" untuk tiap baris berisi `cache` di file .ts dalam <dir> (fixture: hanya ada di head) supaya base vs head berbeda.
// - build uji aplikasi (`-v <dir>:/src`, memori 8g) → jalankan skrip build fixture apa adanya di <dir> (fixture tepercaya).
// - runner uji aplikasi (`node /runner/app-runner.mjs`) → jalankan runner SUNGGUHAN di host dengan path mount yang sama
//   (Chromium dari Playwright terpasang), memakai kredensial dari env proses CLI seperti `-e NAMA` di Docker.
// (Env dari daemon sengaja minimal — lihat containerEnv — jadi fake ini tidak bisa diberi konfigurasi lewat env.)
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('Docker version 99.0.0-fake\n');
  process.exit(0);
}
const mounts = new Map(
  args
    .map((a, i) => (args[i - 1] === '-v' ? a : null))
    .filter(Boolean)
    .map((v) => {
      const parts = v.split(':');
      return [parts[1], parts[0]];
    }),
);

if (args.includes('/runner/app-runner.mjs')) {
  const out = mounts.get('/out');
  // catatan untuk test: kredensial hanya diteruskan lewat `-e NAMA` (tanpa nilai di argumen)
  appendFileSync(
    join(out, 'fake-container.log'),
    JSON.stringify({
      phase: 'runner',
      credsInArgs: args.some((a) => a.includes('@')),
      email: !!process.env.CHEFJUNO_APP_EMAIL,
      network: args[args.indexOf('--network') + 1],
    }) + '\n',
  );
  const r = spawnSync(process.execPath, [join(mounts.get('/runner'), 'app-runner.mjs')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_DIR: mounts.get('/app'),
      OUT_DIR: out,
      PLAN_FILE: join(out, 'plan.json'),
      PW_MODULE: join(mounts.get('/pw'), 'index.mjs'),
    },
  });
  process.exit(r.status ?? 1);
}

const dir = mounts.get('/src') ?? '';
const memory = args[args.indexOf('--memory') + 1];
if (memory === '8g') {
  // build uji aplikasi: skrip fixture (mis. menyalin build/web) dijalankan di salinan kode
  const script = args.at(-1);
  const r = spawnSync('sh', ['-c', script], { cwd: dir, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// fase analisis selalu tanpa jaringan; fase setup berjaringan → sukses tanpa output
if (args[args.indexOf('--network') + 1] !== 'none') process.exit(0);
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p];
  });
const out = ['Analyzing fixture...'];
for (const f of walk(dir).filter((p) => p.endsWith('.ts'))) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('cache'))
        out.push(
          `  warning • Opsi cache tidak didokumentasikan • ${relative(dir, f)}:${i + 1}:3 • undocumented_cache_option`,
        );
    });
}
out.push(`${out.length - 1} issues found. (ran in 0.1s)`);
process.stdout.write(out.join('\n') + '\n');
process.exit(out.length > 2 ? 1 : 0);
