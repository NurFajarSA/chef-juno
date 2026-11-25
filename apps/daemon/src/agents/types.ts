import type { AgentEvent } from './events.js';
import type { AgentInfo } from '@chefjuno/shared';

export type AgentName = 'claude' | 'codex';

export interface RunOptions {
  cwd: string;
  jobDir: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  model?: string;
  /** reasoning effort (Codex: model_reasoning_effort); diabaikan agent yang tidak mendukungnya */
  effort?: string;
  maxTurns: number;
  timeoutMs: number;
  /**
   * Mode tepercaya: agent boleh menjalankan perintah (Bash) dan menulis berkas — HANYA untuk job uji aplikasi
   * (agent menyetir app lewat skill verify tim, seperti lane functional reviewer-agent). Reviewer kode tetap read-only.
   */
  trusted?: boolean;
  /** aktivitas agent selagi berjalan (berpikir, alat, teks) untuk dashboard */
  onEvent?: (e: AgentEvent) => void;
}

export interface RunResult {
  output: unknown;
  raw: string;
  meta: {
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    numTurns: number | null;
    isolation: string;
  };
}

export interface AgentRunner {
  name: AgentName;
  /** null = CLI tidak ada. info.enabled=false kalau login bukan langganan. */
  detect(): Promise<AgentInfo | null>;
  /** Uji saat start tanpa memanggil model: flag isolasi yang dibutuhkan didukung CLI terpasang? */
  selfTest(): Promise<{ ok: boolean; isolation: string; warning: string | null }>;
  run(o: RunOptions): Promise<RunResult>;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly stage: 'agent' | 'parse' | 'timeout' | 'leak' = 'agent',
  ) {
    super(message);
  }
}

export interface RunnerOptions {
  /** Override path binary (test: fake-claude/fake-codex). */
  bin?: string;
  /** Env tambahan untuk proses agent (setelah dibersihkan). */
  env?: Record<string, string>;
}
