import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pembaruan mandiri daemon: rilis (`releases/daemon.commit`) → saat mesin kosong, maju fast-forward ke commit itu,
 * pasang dependensi bila lockfile berubah, build, lalu keluar dengan kode RESTART_CODE supaya supervisor (`chefjuno
 * start`) menyalakan kode baru. Tidak pernah menimpa pekerjaan lokal: branch selain main, perubahan yang belum
 * di-commit, atau commit lokal yang belum ada di rilis → dilewati dengan alasan.
 */
export const RESTART_CODE = 75;

export type Run = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;

export const run: Run = (cmd, args, cwd) =>
  new Promise((res) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: '1' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => res({ code: 127, out: String(e) }));
    p.on('close', (code) => res({ code: code ?? 1, out: out.slice(-4000) }));
  });

/** Akar repo tempat daemon ini di-build (apps/daemon/dist → ../../..), atau null bila bukan checkout git. */
export function repoRoot(from = dirname(fileURLToPath(import.meta.url))): string | null {
  const root = resolve(from, '../../..');
  return existsSync(join(root, '.git')) && existsSync(join(root, 'apps/daemon')) ? root : null;
}

export async function headCommit(root: string | null, r: Run = run): Promise<string | null> {
  if (!root) return null;
  const h = await r('git', ['rev-parse', 'HEAD'], root);
  return h.code === 0 ? h.out.trim() : null;
}

export type UpdatePlan = { ok: true; from: string; to: string } | { ok: false; reason: string; upToDate?: boolean };

/** Bisakah checkout ini maju ke `target` tanpa menimpa apa pun? */
export async function planUpdate(root: string, target: string, r: Run = run): Promise<UpdatePlan> {
  if (!/^[0-9a-f]{40}$/.test(target)) return { ok: false, reason: 'commit rilis tidak sah' };
  const head = await headCommit(root, r);
  if (!head) return { ok: false, reason: 'bukan checkout git' };
  if (head === target) return { ok: false, reason: 'sudah di commit rilis', upToDate: true };
  const br = await r('git', ['symbolic-ref', '--short', '-q', 'HEAD'], root);
  if (br.code !== 0 || br.out.trim() !== 'main')
    return { ok: false, reason: `checkout di ${br.out.trim() || 'detached HEAD'}, bukan main` };
  const st = await r('git', ['status', '--porcelain', '--untracked-files=no'], root);
  if (st.code !== 0 || st.out.trim()) return { ok: false, reason: 'ada perubahan lokal yang belum di-commit' };
  const f = await r('git', ['fetch', '--quiet', 'origin'], root);
  if (f.code !== 0) return { ok: false, reason: `git fetch gagal: ${f.out.trim().slice(0, 200)}` };
  if ((await r('git', ['cat-file', '-e', `${target}^{commit}`], root)).code !== 0)
    return { ok: false, reason: 'commit rilis tidak ditemukan di origin' };
  // Dipasang dari main setelah rilis dibuat → sudah memuat rilis; bukan pekerjaan lokal yang perlu dilindungi.
  if ((await r('git', ['merge-base', '--is-ancestor', target, head], root)).code === 0)
    return { ok: false, reason: 'sudah lebih baru dari commit rilis', upToDate: true };
  if ((await r('git', ['merge-base', '--is-ancestor', head, target], root)).code !== 0)
    return { ok: false, reason: 'checkout lokal punya commit yang tidak ada di rilis' };
  return { ok: true, from: head, to: target };
}

/**
 * Maju ke rilis lalu build. Gagal di tengah → kembali ke commit semula dan build ulang, supaya restart berikutnya tetap
 * menjalankan kode yang utuh.
 */
export async function applyUpdate(
  root: string,
  plan: { from: string; to: string },
  o: { npm: string; r?: Run; log?: (m: string) => void },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = o.r ?? run;
  const log = o.log ?? (() => undefined);
  const lockChanged = async (a: string, b: string) =>
    (await r('git', ['diff', '--name-only', a, b, '--', 'package-lock.json'], root)).out.trim() !== '';
  const build = async (deps: boolean) => {
    if (deps) {
      const i = await r(o.npm, ['ci', '--no-audit', '--no-fund'], root);
      if (i.code !== 0) return `npm ci gagal: ${i.out.trim().slice(-300)}`;
    }
    const b = await r(o.npm, ['run', 'build', '-w', 'packages/shared', '-w', 'apps/daemon'], root);
    return b.code === 0 ? null : `build gagal: ${b.out.trim().slice(-300)}`;
  };
  const deps = await lockChanged(plan.from, plan.to);
  const m = await r('git', ['merge', '--ff-only', '--quiet', plan.to], root);
  if (m.code !== 0) return { ok: false, reason: `git merge gagal: ${m.out.trim().slice(0, 200)}` };
  log(`⬆ memperbarui daemon ${plan.from.slice(0, 7)} → ${plan.to.slice(0, 7)}${deps ? ' (dependensi berubah)' : ''}`);
  const err = await build(deps);
  if (!err) return { ok: true };
  log(`✗ ${err} — kembali ke ${plan.from.slice(0, 7)}`);
  await r('git', ['reset', '--keep', plan.from], root);
  const back = await build(deps);
  return { ok: false, reason: back ? `${err}; build ulang versi lama juga gagal: ${back}` : err };
}

/** npm milik Node yang sedang menjalankan daemon (bukan npm global yang mungkin beda versi). */
export function npmBin(): string {
  const p = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return existsSync(p) ? p : 'npm';
}

/**
 * Supervisor untuk `chefjuno start`: menjalankan daemon sebagai proses anak dan menyalakannya lagi setelah pembaruan
 * (kode keluar RESTART_CODE). Sinyal stop diteruskan ke anak. Proses lain → keluar dengan kode anak.
 */
export function supervise(argv: string[], o: { spawnChild?: typeof spawn; exit?: (c: number) => void } = {}) {
  const sp = o.spawnChild ?? spawn;
  const exit = o.exit ?? ((c: number) => process.exit(c));
  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  const startChild = () => {
    child = sp(process.execPath, argv, { stdio: 'inherit', env: { ...process.env, CHEFJUNO_SUPERVISED: '1' } });
    child.on('exit', (code, signal) => {
      if (!stopping && code === RESTART_CODE) {
        console.log('↻ menyalakan ulang daemon dengan versi baru…');
        startChild();
        return;
      }
      exit(code ?? (signal ? 1 : 0));
    });
  };
  const forward = (sig: NodeJS.Signals) => () => {
    stopping = true;
    child?.kill(sig);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  startChild();
  return {
    get child() {
      return child;
    },
  };
}
