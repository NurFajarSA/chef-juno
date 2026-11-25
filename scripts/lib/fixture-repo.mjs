// Membangun bare repo lokal dari apps/daemon/test/fixtures/sample-repo dengan commit base/head yang diketahui (§12.2).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = fileURLToPath(new URL('../../apps/daemon/test/fixtures/', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
      GIT_AUTHOR_DATE: '2026-11-20T10:00:00+07:00',
      GIT_COMMITTER_DATE: '2026-11-20T10:00:00+07:00',
    },
  }).trim();
}

/**
 * @returns {{ root: string, bare: string, work: string, fullName: string, baseSha: string, headSha: string, prNumber: number,
 *   commit: (files: Record<string,string>, msg: string, branch?: string) => string, git: (...a: string[]) => string }}
 */
export function createFixtureRepo(fullName = 'tim/sample-repo', root = mkdtempSync(join(tmpdir(), 'cj-fixture-'))) {
  const work = join(root, 'work');
  const bare = join(root, 'remotes', `${fullName}.git`);
  mkdirSync(work, { recursive: true });
  mkdirSync(bare, { recursive: true });
  cpSync(join(FIX, 'sample-repo'), work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init: sample repo');
  const baseSha = git(work, 'rev-parse', 'HEAD');
  git(work, 'checkout', '-q', '-b', 'feat/cache-user');
  cpSync(join(FIX, 'sample-repo-head'), work, { recursive: true });
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'feat: cache option untuk fetchUser');
  const headSha = git(work, 'rev-parse', 'HEAD');
  git(work, 'checkout', '-q', 'main');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(work, 'push', '-q', bare, 'main', 'feat/cache-user');
  git(work, 'push', '-q', bare, `${headSha}:refs/pull/1/head`);
  const commit = (files, msg, branch = 'main') => {
    git(work, 'checkout', '-q', branch);
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(work, p, '..'), { recursive: true });
      writeFileSync(join(work, p), c);
    }
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', msg);
    const sha = git(work, 'rev-parse', 'HEAD');
    git(work, 'push', '-q', '-f', bare, branch);
    return sha;
  };
  return { root, bare, work, fullName, baseSha, headSha, prNumber: 1, commit, git: (...a) => git(work, ...a) };
}

/** Template URL git untuk daemon: file://<root>/remotes/{fullName}.git */
export const gitUrlTemplate = (root) => `file://${join(root, 'remotes')}/{fullName}.git`;
