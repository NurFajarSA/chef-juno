import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDiagram, codeAround } from '../../src/jobs/final-review.js';
import { claudeArgs } from '../../src/agents/claude.js';

describe('reviewer akhir', () => {
  it('potongan kode ±n baris di sekitar temuan, baris temuan ditandai', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cj-final-'));
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib/a.dart'), Array.from({ length: 30 }, (_, i) => `baris ${i + 1}`).join('\n'));
    const c = codeAround(dir, 'lib/a.dart', 10, 2);
    expect(c.split('\n')).toEqual([
      '    8   baris 8',
      '    9   baris 9',
      '   10 > baris 10',
      '   11   baris 11',
      '   12   baris 12',
    ]);
    expect(codeAround(dir, 'lib/tidak-ada.dart', 3)).toBe('');
  });

  it('diagram: pagar kode dibuang, hanya jenis Mermaid yang dikenal', () => {
    expect(cleanDiagram('```mermaid\nflowchart TD\n  A --> B\n```')).toBe('flowchart TD\n  A --> B');
    expect(cleanDiagram('sequenceDiagram\n  A->>B: x')).toBe('sequenceDiagram\n  A->>B: x');
    expect(cleanDiagram('<script>alert(1)</script>')).toBe('');
    expect(cleanDiagram('')).toBe('');
  });

  it('Claude Code: --effort hanya untuk level yang dikenal', () => {
    const base = { isolation: 'safe' as const, systemPrompt: 's', schema: {} };
    const a = claudeArgs({ ...base, model: 'opus', effort: 'high' });
    expect(a[a.indexOf('--effort') + 1]).toBe('high');
    expect(claudeArgs({ ...base, effort: 'high; rm -rf' })).not.toContain('--effort');
    expect(claudeArgs({ ...base, effort: null })).not.toContain('--effort');
  });
});
