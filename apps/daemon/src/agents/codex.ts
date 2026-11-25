import { codexLineEvents } from './events.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInfo } from '@chefjuno/shared';
import { cfg } from '../env.js';
import { cleanEnv, runProc } from './proc.js';
import { AgentError, type AgentRunner, type RunnerOptions, type RunOptions, type RunResult } from './types.js';

/**
 * Codex: read-only sandbox, ephemeral, abaikan config user & rules, tanpa AGENTS.md repo.
 * Tidak pernah `--dangerously-bypass-*`. Worktree tidak pernah ditandai trusted.
 */
export function codexArgs(o: {
  cwd: string;
  schemaPath: string;
  outPath: string;
  model?: string;
  effort?: string;
  /** uji aplikasi: boleh menjalankan perintah & jaringan (lihat RunOptions.trusted) */
  trusted?: boolean;
}): string[] {
  return [
    'exec',
    '--sandbox',
    o.trusted ? 'danger-full-access' : 'read-only',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    'project_doc_max_bytes=0',
    '--skip-git-repo-check',
    '-C',
    o.cwd,
    '--output-schema',
    o.schemaPath,
    '-o',
    o.outPath,
    '--json',
    ...(o.model ? ['-m', o.model] : []),
    // reasoning effort per peran (nilai sudah divalidasi huruf kecil saja oleh resolveEffort)
    ...(o.effort && /^[a-z]{2,10}$/.test(o.effort) ? ['-c', `model_reasoning_effort="${o.effort}"`] : []),
    '-',
  ];
}

export function joinSystemPrompt(system: string, user: string): string {
  return `<<<INSTRUKSI SISTEM CHEF JUNO>>>\n${system}\n<<<AKHIR INSTRUKSI SISTEM>>>\n\n${user}`;
}

export class CodexRunner implements AgentRunner {
  constructor(private readonly opts: RunnerOptions = {}) {}
  private bin() {
    return this.opts.bin ?? cfg.codexBin();
  }
  private env() {
    return { ...cleanEnv(), ...(this.opts.env ?? {}) };
  }
  readonly name = 'codex' as const;

  async detect(): Promise<AgentInfo | null> {
    const bin = this.bin();
    let version: string;
    try {
      const v = await runProc(bin, ['--version'], { timeoutMs: 15_000, env: this.env() });
      if (v.code !== 0) return null;
      version = v.stdout.trim().split(/\s/).pop() ?? '';
    } catch {
      return null;
    }
    let text = '';
    try {
      const s = await runProc(bin, ['login', 'status'], { timeoutMs: 15_000, env: this.env() });
      text = (s.stdout + s.stderr).trim();
    } catch {
      // abaikan
    }
    const chatgpt = /chatgpt/i.test(text) && !/api key/i.test(text);
    const apiKey = /api key/i.test(text);
    return {
      version,
      subscription: chatgpt,
      isolation: 'read-only',
      enabled: chatgpt,
      authMethod: chatgpt ? 'chatgpt' : apiKey ? 'api-key' : null,
      warning: chatgpt
        ? null
        : apiKey
          ? 'Codex login dengan API key, bukan langganan ChatGPT — tidak dipakai.'
          : 'Codex belum login (jalankan `codex login` dengan akun ChatGPT).',
    };
  }

  async selfTest(): Promise<{ ok: boolean; isolation: string; warning: string | null }> {
    return { ok: true, isolation: 'read-only', warning: null };
  }

  async run(o: RunOptions): Promise<RunResult> {
    const schemaPath = join(o.jobDir, 'schema.json');
    const outPath = join(o.jobDir, 'last-message.json');
    const input = joinSystemPrompt(o.systemPrompt, o.userPrompt);
    writeFileSync(schemaPath, JSON.stringify(o.schema));
    writeFileSync(join(o.jobDir, 'prompt-with-system.md'), input);
    const r = await runProc(
      this.bin(),
      codexArgs({ cwd: o.cwd, schemaPath, outPath, model: o.model, effort: o.effort, trusted: o.trusted }),
      {
        cwd: o.cwd,
        input,
        timeoutMs: o.timeoutMs,
        env: this.env(),
        onLine: o.onEvent ? (l) => codexLineEvents(l).forEach((e) => o.onEvent!(e)) : undefined,
      },
    );
    if (r.code !== 0) throw new AgentError(`Codex keluar dengan kode ${r.code}`, 'agent');
    if (!existsSync(outPath)) throw new AgentError('Codex tidak menulis last-message.json', 'parse');
    const txt = readFileSync(outPath, 'utf8').trim();
    if (!txt) throw new AgentError('last-message.json kosong', 'parse');
    let output: unknown;
    try {
      output = JSON.parse(txt);
    } catch {
      throw new AgentError('last-message.json bukan JSON', 'parse');
    }
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let model: string | null = o.model ?? null;
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as {
          type?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          model?: string;
        };
        if (ev.type === 'turn.completed' && ev.usage) {
          inputTokens = (inputTokens ?? 0) + (ev.usage.input_tokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (ev.usage.output_tokens ?? 0);
        }
        if (ev.model) model = ev.model;
      } catch {
        // baris non-JSON diabaikan
      }
    }
    return { output, raw: txt, meta: { model, inputTokens, outputTokens, numTurns: null, isolation: 'read-only' } };
  }
}
