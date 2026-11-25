import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cfg } from '../env.js';

const pexec = promisify(execFile);

/**
 * Token dipakai sebagai Basic auth `x-access-token` lewat env GIT_CONFIG_COUNT/KEY/VALUE (http.extraHeader) —
 * bukan di argv, URL remote, atau .git/config (§6.3.3).
 */
export function gitEnv(token: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  return env;
}

export async function git(
  cwd: string,
  args: string[],
  token: string | null = null,
  maxBuffer = 64 * 1024 * 1024,
): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd, env: gitEnv(token), maxBuffer });
  return stdout;
}

export function repoUrl(fullName: string) {
  return cfg.gitUrlTemplate().replace('{fullName}', fullName);
}

/** Cache clone di ~/.chefjuno/work/{owner}/{repo}; fetch ref yang dibutuhkan. */
const repoLocks = new Map<string, Promise<void>>();

/**
 * Operasi git yang menulis ke repo cache bersama (fetch, worktree add/remove) dijalankan bergiliran per repo.
 * Mesin dengan kapasitas >1 bisa mengerjakan dua job di repo yang sama; tanpa ini git bentrok di file kunci
 * (`cannot lock ref`, `worktrees/...lock`). Pekerjaan agent sendiri tetap paralel.
 */
export async function withRepoLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(dir) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  repoLocks.set(dir, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (repoLocks.get(dir) === tail) repoLocks.delete(dir);
  }
}

export async function ensureRepo(fullName: string, token: string | null, refs: string[]): Promise<string> {
  const dir = join(cfg.home(), 'work', ...fullName.split('/'));
  return withRepoLock(dir, async () => {
    if (!existsSync(join(dir, '.git')) && !existsSync(join(dir, 'HEAD'))) {
      mkdirSync(dir, { recursive: true });
      await git(dir, ['init', '-q', '--bare']);
      await git(dir, ['remote', 'add', 'origin', repoUrl(fullName)]);
    }
    await git(dir, ['fetch', '-q', '--no-tags', 'origin', ...refs], token);
    return dir;
  });
}

export async function addWorktree(repoDir: string, jobDir: string, sha: string): Promise<string> {
  const wt = join(jobDir, 'worktree');
  await withRepoLock(repoDir, () => git(repoDir, ['worktree', 'add', '-q', '--detach', wt, sha]));
  return wt;
}

/** Worktree detached di path tertentu (mis. base untuk verifikasi). */
export async function addWorktreeAt(repoDir: string, path: string, sha: string): Promise<string> {
  await withRepoLock(repoDir, () => git(repoDir, ['worktree', 'add', '-q', '--detach', path, sha]));
  return path;
}

export async function removeWorktree(repoDir: string, jobDir: string) {
  await withRepoLock(repoDir, () => git(repoDir, ['worktree', 'remove', '--force', join(jobDir, 'worktree')])).catch(
    () => undefined,
  );
  rmSync(jobDir, { recursive: true, force: true });
  await git(repoDir, ['worktree', 'prune']).catch(() => undefined);
}

export async function showFile(repoDir: string, sha: string, path: string): Promise<string | null> {
  try {
    return await git(repoDir, ['show', `${sha}:${path}`]);
  } catch {
    return null;
  }
}
