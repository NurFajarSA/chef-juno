import { describe, expect, it } from 'vitest';
import { claudeLineEvents, codexLineEvents, redact, toolSummary } from '../../src/agents/events.js';

describe('aktivitas agent (intip kerja agent)', () => {
  it('Claude stream-json: thinking, alat, teks dicatat; hasil alat tidak', () => {
    const a = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'cek pemanggil dulu' },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'fetchUser', path: 'src' } },
          { type: 'text', text: 'temuan valid' },
        ],
      },
    });
    expect(claudeLineEvents(a)).toEqual([
      { kind: 'think', text: 'cek pemanggil dulu' },
      { kind: 'tool', text: 'Cari "fetchUser" di src' },
      { kind: 'text', text: 'temuan valid' },
    ]);
    expect(
      claudeLineEvents(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } })),
    ).toEqual([]);
    expect(claudeLineEvents('bukan json')).toEqual([]);
  });

  it('Codex JSONL: reasoning & perintah dicatat, output perintah tidak', () => {
    expect(
      codexLineEvents(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'command_execution', command: 'ls', aggregated_output: 'RAHASIA' },
        }),
      ),
    ).toEqual([{ kind: 'tool', text: '$ ls' }]);
    expect(
      codexLineEvents(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'pikir' } })),
    ).toEqual([{ kind: 'think', text: 'pikir' }]);
    expect(codexLineEvents(JSON.stringify({ type: 'turn.completed' }))).toEqual([]);
  });

  it('rahasia disensor; teks panjang dipotong', () => {
    const s = redact(
      'ghp_abcdefghijklmnopqrstuvwxyz123456 AIzaSyA1234567890abcdefghijklmnopqrstu password=hunter22 -----BEGIN RSA PRIVATE KEY-----\nxx\n-----END RSA PRIVATE KEY-----',
    );
    expect(s).not.toMatch(/ghp_|AIza|hunter22|BEGIN RSA/);
    expect(s).toContain('password=•••');
    const long = claudeLineEvents(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x'.repeat(5000) }] } }),
    );
    expect(long[0].text.length).toBeLessThanOrEqual(1501);
  });

  it('ringkasan alat mudah dibaca', () => {
    expect(toolSummary('Read', { file_path: 'lib/a.dart' })).toBe('Baca lib/a.dart');
    expect(toolSummary('Bash', { command: 'flutter test' })).toBe('$ flutter test');
    expect(toolSummary('mcp__chefjuno_graph__get_callers', { symbol: 'f' })).toBe(
      'Peta kode: get_callers {"symbol":"f"}',
    );
  });
});
