import { spawn } from 'node:child_process';
import { AgentError } from './types.js';

const SECRET_ENV = /(API_KEY|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|_TOKEN)$/i;
const EXACT = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'FIREBASE_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

/** Env proses agent dibersihkan: tanpa API key / token / secret → selalu langganan (§6.3.6). */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDE_CODE_OAUTH_TOKEN') {
      out[k] = v; // token langganan claude.ai (setup-token), bukan API key
      continue;
    }
    if (EXACT.has(k) || SECRET_ENV.test(k) || k.startsWith('GIT_CONFIG_') || k.startsWith('CHEFJUNO_SECRET')) continue;
    out[k] = v;
  }
  return out;
}

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const safeLine = (f: (l: string) => void, l: string) => {
  try {
    f(l);
  } catch {
    // pencatat aktivitas tidak boleh menggagalkan agent
  }
};

export function runProc(
  bin: string,
  args: string[],
  opts: {
    cwd?: string;
    input?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    /** dipanggil per baris stdout selagi proses berjalan (aktivitas agent langsung) */
    onLine?: (line: string) => void;
    /** job dibatalkan → proses dihentikan (SIGTERM, lalu SIGKILL bila bandel) */
    signal?: AbortSignal;
  } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new AgentError('Job dibatalkan', 'cancelled'));
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    let pending = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!opts.onLine) return;
      pending += String(d);
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) safeLine(opts.onLine, l);
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(new AgentError(`Gagal menjalankan ${bin}: ${e.message}`));
    });
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (aborted) reject(new AgentError('Job dibatalkan', 'cancelled'));
      else if (timedOut) reject(new AgentError(`Agent melewati batas waktu ${opts.timeoutMs} ms`, 'timeout'));
      else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}
