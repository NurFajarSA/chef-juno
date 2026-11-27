import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyUpdate, headCommit, planUpdate, run, supervise, RESTART_CODE, type Run } from '../../src/updater.js';
import { EventEmitter } from 'node:events';

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

/** origin (bare) dengan main berisi 2 commit; clone lokal di commit pertama. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cj-upd-'));
  const work = join(dir, 'work');
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  writeFileSync(join(work, 'package-lock.json'), '{"v":1}');
  writeFileSync(join(work, 'a.txt'), '1');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'satu');
  const first = git(work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'a.txt'), '2');
  git(work, 'commit', '-qam', 'dua');
  const second = git(work, 'rev-parse', 'HEAD');
  git(dir, 'clone', '-q', '--bare', work, 'origin.git');
  git(dir, 'clone', '-q', join(dir, 'origin.git'), 'local');
  const local = join(dir, 'local');
  git(local, 'reset', '-q', '--hard', first);
  return { dir, work, local, first, second };
}

/** run sungguhan untuk git; npm dipalsukan (dicatat, kode keluar bisa diatur). */
const fakeNpm = (codes: Record<string, number> = {}) => {
  const calls: string[] = [];
  const r: Run = async (cmd, args, cwd) => {
    if (cmd === 'npm') {
      calls.push(args.join(' '));
      return { code: codes[args[0]] ?? 0, out: codes[args[0]] ? 'ERR!' : '' };
    }
    return run(cmd, args, cwd);
  };
  return { r, calls };
};

describe('planUpdate', () => {
  it('maju fast-forward ke rilis di main yang bersih', async () => {
    const t = setup();
    expect(await planUpdate(t.local, t.second)).toEqual({ ok: true, from: t.first, to: t.second });
  });
  it('sudah di rilis → upToDate', async () => {
    const t = setup();
    git(t.local, 'reset', '-q', '--hard', t.second);
    expect(await planUpdate(t.local, t.second)).toMatchObject({ ok: false, upToDate: true });
  });
  it('checkout sudah di depan rilis (dipasang dari main setelah rilis) → upToDate, bukan dilewati', async () => {
    const t = setup();
    git(t.local, 'reset', '-q', '--hard', t.second);
    expect(await planUpdate(t.local, t.first)).toEqual({
      ok: false,
      reason: 'sudah lebih baru dari commit rilis',
      upToDate: true,
    });
  });
  it('tidak pernah menimpa pekerjaan lokal: branch lain, perubahan belum di-commit, commit lokal', async () => {
    const a = setup();
    git(a.local, 'switch', '-q', '-c', 'fitur');
    expect(await planUpdate(a.local, a.second)).toMatchObject({ ok: false, reason: 'checkout di fitur, bukan main' });
    const b = setup();
    writeFileSync(join(b.local, 'a.txt'), 'lokal');
    expect(await planUpdate(b.local, b.second)).toMatchObject({
      ok: false,
      reason: 'ada perubahan lokal yang belum di-commit',
    });
    const c = setup();
    writeFileSync(join(c.local, 'b.txt'), 'x');
    git(c.local, 'add', '.');
    git(c.local, 'commit', '-qm', 'lokal');
    expect(await planUpdate(c.local, c.second)).toMatchObject({
      ok: false,
      reason: 'checkout lokal punya commit yang tidak ada di rilis',
    });
  });
  it('commit rilis tidak sah / tidak ada di origin', async () => {
    const t = setup();
    expect(await planUpdate(t.local, 'main')).toMatchObject({ ok: false, reason: 'commit rilis tidak sah' });
    expect(await planUpdate(t.local, 'f'.repeat(40))).toMatchObject({
      ok: false,
      reason: 'commit rilis tidak ditemukan di origin',
    });
  });
});

describe('applyUpdate', () => {
  it('maju + build (tanpa npm ci bila lockfile sama)', async () => {
    const t = setup();
    const n = fakeNpm();
    const plan = { from: t.first, to: t.second };
    expect(await applyUpdate(t.local, plan, { npm: 'npm', r: n.r })).toEqual({ ok: true });
    expect(await headCommit(t.local)).toBe(t.second);
    expect(n.calls).toEqual(['run build -w packages/shared -w apps/daemon']);
  });
  it('lockfile berubah → npm ci dulu', async () => {
    const t = setup();
    writeFileSync(join(t.work, 'package-lock.json'), '{"v":2}');
    git(t.work, 'commit', '-qam', 'deps');
    const third = git(t.work, 'rev-parse', 'HEAD');
    git(t.dir, '--git-dir', 'origin.git', 'fetch', '-q', t.work, 'main:main');
    git(t.local, 'fetch', '-q', 'origin');
    const n = fakeNpm();
    expect(await applyUpdate(t.local, { from: t.first, to: third }, { npm: 'npm', r: n.r })).toEqual({ ok: true });
    expect(n.calls[0]).toBe('ci --no-audit --no-fund');
  });
  it('build gagal → kembali ke commit semula dan build ulang versi lama', async () => {
    const t = setup();
    let builds = 0;
    const r: Run = async (cmd, args, cwd) => {
      if (cmd === 'npm') return { code: ++builds === 1 ? 1 : 0, out: builds === 1 ? 'TS2322' : '' };
      return run(cmd, args, cwd);
    };
    const res = await applyUpdate(t.local, { from: t.first, to: t.second }, { npm: 'npm', r });
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain('build gagal');
    expect(await headCommit(t.local)).toBe(t.first);
    expect(builds).toBe(2);
  });
});

describe('supervise', () => {
  it('anak keluar dengan RESTART_CODE → dinyalakan lagi; kode lain → supervisor keluar dengan kode itu', () => {
    const kids: (EventEmitter & { kill: () => void })[] = [];
    const exits: number[] = [];
    const before = process.listeners('SIGTERM').length;
    supervise(['cli.js', 'start'], {
      spawnChild: (() => {
        const k = Object.assign(new EventEmitter(), { kill: () => undefined });
        kids.push(k);
        return k;
      }) as never,
      exit: (c) => exits.push(c),
    });
    expect(kids).toHaveLength(1);
    kids[0].emit('exit', RESTART_CODE, null);
    expect(kids).toHaveLength(2);
    expect(exits).toEqual([]);
    kids[1].emit('exit', 3, null);
    expect(exits).toEqual([3]);
    // bersihkan handler sinyal yang dipasang test ini
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const ls = process.listeners(sig);
      process.removeListener(sig, ls[ls.length - 1] as never);
    }
    expect(process.listeners('SIGTERM').length).toBe(before);
  });
});
