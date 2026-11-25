import { claudeLineEvents } from './events.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInfo } from '@chefjuno/shared';
import { cfg } from '../env.js';
import { cleanEnv, runProc } from './proc.js';
import { AgentError, type AgentRunner, type RunnerOptions, type RunOptions, type RunResult } from './types.js';

export type ClaudeIsolation = 'safe' | 'restricted-mcp' | 'fallback';

export const SAFE_FLAGS = [
  '-p',
  '--restricted',
  '--safe-mode',
  '--strict-mcp-config',
  '--tools',
  '--disallowedTools',
  '--permission-mode',
  '--no-session-persistence',
  '--append-system-prompt',
  '--output-format',
  '--json-schema',
];
export const FALLBACK_FLAGS = [
  '-p',
  '--setting-sources',
  '--settings',
  '--strict-mcp-config',
  '--tools',
  '--disallowedTools',
  '--permission-mode',
  '--no-session-persistence',
  '--append-system-prompt',
  '--output-format',
  '--json-schema',
];

const hasFlag = (help: string, f: string) =>
  new RegExp(`(^|[\\s,])${f.replace(/[-]/g, '\\-')}([\\s,=<]|$)`, 'm').test(help);

/**
 * Dua set argumen kanonik (§12.8). Tidak pernah `--bare` (memaksa API key).
 * Mode `fallback` (§6.3.6) dipakai bila `selfTest` mendapati --restricted/--safe-mode tidak didukung.
 * `--max-turns` hanya dikirim bila tercantum di `claude --help` versi terpasang (2.1.323: tidak ada).
 */
export function claudeArgs(o: {
  isolation: ClaudeIsolation;
  systemPrompt: string;
  schema: Record<string, unknown>;
  model?: string;
  /** --effort (low/medium/high/xhigh/max); hanya dikirim bila CLI mendukungnya */
  effort?: string | null;
  mcpConfigPath?: string;
  maxTurns?: number | null;
  trusted?: boolean;
  /** stream-json: event per baris (aktivitas agent langsung); baris terakhir = hasil */
  stream?: boolean;
}): string[] {
  const common = ['-p'];
  const fmt = o.stream ? ['stream-json', '--verbose'] : ['json'];
  if (o.trusted)
    return [
      ...common,
      // uji aplikasi: semua tool (Bash dll.), setting user + project (skill verify repo & workspace)
      '--permission-mode',
      'bypassPermissions',
      '--setting-sources',
      'user,project',
      '--no-session-persistence',
      '--append-system-prompt',
      o.systemPrompt,
      '--output-format',
      ...fmt,
      '--json-schema',
      JSON.stringify(o.schema),
      ...(o.maxTurns ? ['--max-turns', String(o.maxTurns)] : []),
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort && CLAUDE_EFFORTS.includes(o.effort) ? ['--effort', o.effort] : []),
    ];
  const iso =
    o.isolation === 'fallback'
      ? // §6.3.6 fallback: tanpa hooks, tanpa setting project/local, tanpa MCP
        [
          '--setting-sources',
          'user',
          '--settings',
          '{"disableAllHooks":true}',
          '--strict-mcp-config',
          '--tools',
          'Read,Grep,Glob',
          '--disallowedTools',
          'mcp__*',
        ]
      : o.isolation === 'safe'
        ? [
            '--restricted',
            '--safe-mode',
            '--strict-mcp-config',
            '--tools',
            'Read,Grep,Glob',
            '--disallowedTools',
            'mcp__*',
          ]
        : [
            '--restricted',
            '--strict-mcp-config',
            '--mcp-config',
            o.mcpConfigPath ?? '',
            '--tools',
            'Read,Grep,Glob',
            '--allowedTools',
            'mcp__chefjuno_graph__*',
          ];
  return [
    ...common,
    ...iso,
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--append-system-prompt',
    o.systemPrompt,
    '--output-format',
    ...fmt,
    '--json-schema',
    JSON.stringify(o.schema),
    ...(o.maxTurns ? ['--max-turns', String(o.maxTurns)] : []),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort && CLAUDE_EFFORTS.includes(o.effort) ? ['--effort', o.effort] : []),
  ];
}

/** Level effort yang diterima `claude --effort`. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

interface ClaudeJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  structured_output?: unknown;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export function parseClaudeOutput(
  stdout: string,
): Omit<RunResult, 'meta'> & { meta: Omit<RunResult['meta'], 'isolation'> } {
  let j: ClaudeJson | null = null;
  // raw = baris hasil saja; stream (berpikir, hasil alat/isi file) tidak ikut disimpan/diperiksa sebagai keluaran
  let raw = stdout;
  try {
    j = JSON.parse(stdout.trim()) as ClaudeJson;
  } catch {
    // stream-json: banyak baris; hasil akhir = baris terakhir bertipe "result"
    for (const line of stdout.trim().split('\n').reverse()) {
      try {
        const x = JSON.parse(line) as ClaudeJson;
        if (x.type === 'result') {
          j = x;
          raw = line;
          break;
        }
      } catch {
        // baris bukan JSON
      }
    }
  }
  if (!j) throw new AgentError('Output Claude bukan JSON', 'parse');
  if (j.is_error) throw new AgentError('Claude mengembalikan is_error', 'agent');
  if (j.subtype !== 'success') throw new AgentError(`Claude subtype=${j.subtype}`, 'agent');
  if (j.structured_output === undefined || j.structured_output === null)
    throw new AgentError('structured_output tidak ada', 'parse');
  return {
    output: j.structured_output,
    raw,
    meta: {
      model: Object.keys(j.modelUsage ?? {})[0] ?? null,
      inputTokens: j.usage?.input_tokens ?? null,
      outputTokens: j.usage?.output_tokens ?? null,
      numTurns: j.num_turns ?? null,
    },
  };
}

export class ClaudeRunner implements AgentRunner {
  constructor(private readonly opts: RunnerOptions = {}) {}
  private bin() {
    return this.opts.bin ?? cfg.claudeBin();
  }
  private env() {
    return { ...cleanEnv(), ...(this.opts.env ?? {}) };
  }
  readonly name = 'claude' as const;
  isolation: ClaudeIsolation = 'safe';
  /** `--max-turns` hanya dikirim kalau tercantum di `claude --help` versi terpasang. */
  maxTurnsSupported = false;
  effortSupported = false;
  private isolationWarning: string | null = null;

  async selfTest(): Promise<{ ok: boolean; isolation: string; warning: string | null }> {
    let help = '';
    try {
      const h = await runProc(this.bin(), ['--help'], { timeoutMs: 15_000, env: this.env() });
      help = h.stdout + h.stderr;
    } catch {
      help = '';
    }
    this.maxTurnsSupported = hasFlag(help, '--max-turns');
    this.effortSupported = hasFlag(help, '--effort');
    if (SAFE_FLAGS.every((f) => hasFlag(help, f))) {
      this.isolation = 'safe';
      this.isolationWarning = null;
      return { ok: true, isolation: 'safe', warning: null };
    }
    if (FALLBACK_FLAGS.every((f) => hasFlag(help, f))) {
      this.isolation = 'fallback';
      this.isolationWarning =
        'Claude Code ini tidak mendukung --restricted/--safe-mode; memakai isolasi fallback (tanpa hooks/MCP, setting user saja).';
      return { ok: true, isolation: 'fallback', warning: this.isolationWarning };
    }
    this.isolationWarning = 'Flag isolasi Claude Code tidak lengkap di versi ini — agent tidak dipakai.';
    return { ok: false, isolation: 'none', warning: this.isolationWarning };
  }

  async detect(): Promise<AgentInfo | null> {
    const bin = this.bin();
    let version: string;
    try {
      const v = await runProc(bin, ['--version'], { timeoutMs: 15_000, env: this.env() });
      if (v.code !== 0) return null;
      version = v.stdout.trim().split(/\s/)[0];
    } catch {
      return null;
    }
    let authMethod: string | null = null;
    let loggedIn = false;
    try {
      const a = await runProc(bin, ['auth', 'status'], { timeoutMs: 15_000, env: this.env() });
      const j = JSON.parse(a.stdout) as { loggedIn?: boolean; authMethod?: string };
      loggedIn = !!j.loggedIn;
      authMethod = j.authMethod ?? null;
    } catch {
      // tidak bisa membaca status login
    }
    const subscription = loggedIn && authMethod === 'claude.ai';
    const st = await this.selfTest();
    return {
      version,
      subscription,
      isolation: st.isolation,
      enabled: subscription && st.ok,
      authMethod,
      warning: subscription
        ? st.warning
        : loggedIn
          ? `Claude Code login dengan ${authMethod ?? 'metode lain'}, bukan langganan claude.ai — tidak dipakai.`
          : 'Claude Code belum login (jalankan `claude` lalu login dengan akun claude.ai).',
    };
  }

  async run(o: RunOptions): Promise<RunResult> {
    const args = claudeArgs({
      isolation: this.isolation,
      systemPrompt: o.systemPrompt,
      schema: o.schema,
      model: o.model,
      maxTurns: this.maxTurnsSupported ? o.maxTurns : null,
      effort: this.effortSupported ? o.effort : null,
      trusted: o.trusted,
      stream: !!o.onEvent,
    });
    writeFileSync(join(o.jobDir, 'system.md'), o.systemPrompt);
    writeFileSync(join(o.jobDir, 'prompt.md'), o.userPrompt);
    const r = await runProc(this.bin(), args, {
      cwd: o.cwd,
      input: o.userPrompt,
      timeoutMs: o.timeoutMs,
      env: this.env(),
      onLine: o.onEvent ? (l) => claudeLineEvents(l).forEach((e) => o.onEvent!(e)) : undefined,
      signal: o.signal,
    });
    if (r.code !== 0 && !r.stdout.trim()) throw new AgentError(`Claude keluar dengan kode ${r.code}`, 'agent');
    const p = parseClaudeOutput(r.stdout);
    return { ...p, meta: { ...p.meta, isolation: o.trusted ? 'trusted' : this.isolation } };
  }
}
