import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { newDiagnostics, VerifyConfigSchema, type VerifyConfig } from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { runProc } from '../agents/proc.js';
import { addWorktreeAt, git, showFile } from './git.js';

export const VERIFY_CONFIG_PATH = '.chefjuno/verify.json';

export interface VerificationResult {
  ran: boolean;
  /** alasan tidak dijalankan / gagal */
  reason?: string;
  runtime?: string;
  image?: string;
  commands?: string[];
  newIssues?: string[];
  baseIssueLines?: number;
  headIssueLines?: number;
  durationMs?: number;
}

/** Env minimum untuk CLI container — tanpa secret/token apa pun dari mesin. */
const containerEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin',
  HOME: process.env.HOME ?? '/tmp',
  ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
  ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
});

/** Docker/Podman yang tersedia (CHEFJUNO_CONTAINER_BIN untuk test/override); null = tidak ada → verifikasi dilewati. */
export async function detectContainerRuntime(): Promise<string | null> {
  const candidates = process.env.CHEFJUNO_CONTAINER_BIN ? [process.env.CHEFJUNO_CONTAINER_BIN] : ['docker', 'podman'];
  for (const bin of candidates) {
    try {
      const r = await runProc(bin, ['--version'], { timeoutMs: 10_000, env: containerEnv() });
      if (r.code === 0) return bin;
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

/**
 * Argumen `run` container yang dikunci: tanpa jaringan (kecuali setup), tanpa capability, tanpa eskalasi hak,
 * batas CPU/memori/proses, hanya folder salinan yang di-mount. Tidak ada env yang diteruskan ke container.
 */
export function containerRunArgs(o: { image: string; dir: string; script: string; network: boolean }): string[] {
  return [
    'run',
    '--rm',
    '--network',
    o.network ? 'bridge' : 'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--cpus',
    '2',
    '--memory',
    '4g',
    '--pids-limit',
    '512',
    '-v',
    `${o.dir}:/src`,
    '-w',
    '/src',
    o.image,
    'sh',
    '-c',
    o.script,
  ];
}

async function runSide(bin: string, cfg: VerifyConfig, dir: string, deadline: number): Promise<string> {
  const left = () => Math.max(10_000, deadline - Date.now());
  if (cfg.setup.length) {
    const r = await runProc(
      bin,
      containerRunArgs({ image: cfg.image, dir, script: cfg.setup.join(' && '), network: true }),
      {
        timeoutMs: left(),
        env: containerEnv(),
      },
    );
    if (r.code !== 0) throw new Error(`setup gagal (kode ${r.code}): ${(r.stderr || r.stdout).slice(-300)}`);
  }
  // analyze boleh keluar non-zero (ada issue) — yang dibandingkan adalah outputnya
  const script = cfg.analyze.map((c) => `${c} 2>&1; true`).join('; ');
  const r = await runProc(bin, containerRunArgs({ image: cfg.image, dir, script, network: false }), {
    timeoutMs: left(),
    env: containerEnv(),
  });
  return `${r.stdout}\n${r.stderr}`;
}

/**
 * Verifikasi empiris tahap 1: analisis statis base vs head di container. Hasil = diagnostik yang BARU di PR ini.
 * Tidak pernah membuat review gagal: kalau tidak bisa dijalankan, alasannya dicatat dan review tetap jalan.
 */
export async function runVerification(
  ctx: JobContext,
  o: { repoDir: string; jobDir: string; headWorktree: string; baseSha: string },
): Promise<VerificationResult> {
  if (ctx.job.config?.verifyEnabled !== true) return { ran: false, reason: 'dimatikan di Pengaturan' };
  const raw = await showFile(o.repoDir, o.baseSha, VERIFY_CONFIG_PATH);
  if (!raw) return { ran: false, reason: `${VERIFY_CONFIG_PATH} tidak ada di branch tujuan` };
  let cfg: VerifyConfig;
  try {
    const parsed = VerifyConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return { ran: false, reason: `${VERIFY_CONFIG_PATH} tidak sah: ${parsed.error.issues[0]?.message}` };
    cfg = parsed.data;
  } catch {
    return { ran: false, reason: `${VERIFY_CONFIG_PATH} bukan JSON yang sah` };
  }
  const bin = await detectContainerRuntime();
  if (!bin) return { ran: false, reason: 'Docker/Podman tidak tersedia di mesin ini' };

  const started = Date.now();
  const deadline = started + cfg.timeoutSec * 1000;
  const root = join(o.jobDir, 'verify');
  const baseWt = join(root, 'base-wt');
  const copies = { base: join(root, 'base'), head: join(root, 'head') };
  try {
    mkdirSync(root, { recursive: true });
    await addWorktreeAt(o.repoDir, baseWt, o.baseSha);
    // salinan: container boleh menulis (cache, .dart_tool) tanpa menyentuh worktree yang dibaca agent
    const skipGit = (src: string) => !src.split(/[\\/]/).includes('.git');
    cpSync(baseWt, copies.base, { recursive: true, filter: skipGit });
    cpSync(o.headWorktree, copies.head, { recursive: true, filter: skipGit });
    const [baseOut, headOut] = [
      await runSide(bin, cfg, copies.base, deadline),
      await runSide(bin, cfg, copies.head, deadline),
    ];
    const issues = newDiagnostics(baseOut, headOut);
    const count = (s: string) => newDiagnostics('', s, 10_000).length;
    return {
      ran: true,
      runtime: bin.split('/').at(-1),
      image: cfg.image,
      commands: cfg.analyze,
      newIssues: issues,
      baseIssueLines: count(baseOut),
      headIssueLines: count(headOut),
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ran: false,
      reason: `gagal dijalankan: ${(e as Error).message.slice(0, 300)}`,
      runtime: bin,
      image: cfg.image,
    };
  } finally {
    await git(o.repoDir, ['worktree', 'remove', '--force', baseWt]).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

/** Bagian prompt reviewer berisi hasil verifikasi (kosong bila tidak dijalankan). */
export function verificationSection(v: VerificationResult): string {
  if (!v.ran) return '';
  const lines = [
    '## Analisis statis (verifikasi empiris, base vs head)',
    `Perintah: ${(v.commands ?? []).map((c) => `\`${c}\``).join(', ')} · image \`${v.image}\``,
  ];
  if (!v.newIssues?.length) lines.push('Tidak ada masalah baru dibanding branch tujuan.');
  else {
    lines.push(
      'Masalah yang **baru muncul di PR ini** (tidak ada di branch tujuan). Ini bukti deterministik; laporkan yang berdampak:',
    );
    for (const i of v.newIssues) lines.push(`- ${i}`);
  }
  return lines.join('\n');
}
