/**
 * Aktivitas agent untuk dashboard ("intip kerja agent"): proses berpikir, alat yang dipakai (file dibaca, perintah),
 * dan teks keputusan. Hasil alat (isi file, output perintah) TIDAK dicatat; rahasia yang dikenali disensor.
 */
export interface AgentEvent {
  kind: 'think' | 'tool' | 'text';
  text: string;
}

const LIMIT: Record<AgentEvent['kind'], number> = { think: 1500, tool: 300, text: 800 };

/** Sensor pola rahasia umum (token GitHub/Google/OpenAI, private key, key=value rahasia). */
export function redact(s: string): string {
  return s
    .replace(/-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g, '[private key disensor]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[token]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, '[key]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[key]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, '[jwt]')
    .replace(/((?:token|password|passwd|secret|api[_-]?key)["']?\s*[=:]\s*["']?)[^\s"'&]{4,}/gi, '$1•••');
}

export function makeEvent(kind: AgentEvent['kind'], text: string): AgentEvent | null {
  const t = redact(String(text ?? '').trim());
  if (!t) return null;
  const n = LIMIT[kind];
  return { kind, text: t.length > n ? `${t.slice(0, n)}…` : t };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

/** Ringkasan satu pemanggilan alat Claude Code (tanpa hasilnya). */
export function toolSummary(name: string, input: Record<string, unknown> = {}): string {
  const p = str(input['file_path'] ?? input['path'] ?? input['notebook_path']);
  switch (name) {
    case 'Read':
      return `Baca ${p}`;
    case 'Grep':
      return `Cari "${str(input['pattern'])}"${p ? ` di ${p}` : ''}`;
    case 'Glob':
      return `Cari file ${str(input['pattern'])}`;
    case 'Bash':
      return `$ ${str(input['command'])}`;
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return `Ubah ${p}`;
    case 'TodoWrite':
      return 'Perbarui rencana kerja';
    case 'WebFetch':
    case 'WebSearch':
      return `${name} ${str(input['url'] ?? input['query'])}`;
    default:
      if (name.startsWith('mcp__chefjuno_graph__')) return `Peta kode: ${name.slice(21)} ${str(input).slice(0, 160)}`;
      return `${name} ${str(input).slice(0, 160)}`;
  }
}

/** Satu baris stream-json Claude Code → event (assistant: thinking, text, tool_use). */
export function claudeLineEvents(line: string): AgentEvent[] {
  let j: { type?: string; message?: { content?: unknown } };
  try {
    j = JSON.parse(line) as typeof j;
  } catch {
    return [];
  }
  if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) return [];
  const out: (AgentEvent | null)[] = [];
  for (const b of j.message.content as Record<string, unknown>[]) {
    if (b['type'] === 'thinking') out.push(makeEvent('think', str(b['thinking'])));
    else if (b['type'] === 'text') out.push(makeEvent('text', str(b['text'])));
    else if (b['type'] === 'tool_use')
      out.push(makeEvent('tool', toolSummary(str(b['name']), (b['input'] ?? {}) as Record<string, unknown>)));
  }
  return out.filter((e): e is AgentEvent => !!e);
}

/** Satu baris JSONL `codex exec --json` → event (reasoning, perintah, perubahan file, pesan). */
export function codexLineEvents(line: string): AgentEvent[] {
  let j: { type?: string; item?: Record<string, unknown> };
  try {
    j = JSON.parse(line) as typeof j;
  } catch {
    return [];
  }
  if (j.type !== 'item.completed' || !j.item) return [];
  const it = j.item;
  const e = (() => {
    switch (it['type']) {
      case 'reasoning':
        return makeEvent('think', str(it['text']));
      case 'command_execution':
        return makeEvent('tool', `$ ${str(it['command'])}`);
      case 'file_change':
        return makeEvent(
          'tool',
          `Ubah ${(Array.isArray(it['changes']) ? (it['changes'] as { path?: string }[]) : []).map((c) => c.path).join(', ')}`,
        );
      case 'mcp_tool_call':
        return makeEvent('tool', `${str(it['server'])}: ${str(it['tool'])}`);
      case 'web_search':
        return makeEvent('tool', `WebSearch ${str(it['query'])}`);
      case 'agent_message':
        return makeEvent('text', str(it['text']));
      default:
        return null;
    }
  })();
  return e ? [e] : [];
}
