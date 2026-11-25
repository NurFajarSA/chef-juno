import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReviewFinding } from '@chefjuno/shared';
import { deepReview, runTriage } from '../../src/jobs/deep-review.js';
import type { RunOptions } from '../../src/agents/types.js';

const f = (o: Partial<ReviewFinding>): ReviewFinding => ({
  path: 'lib/a.dart',
  line: 10,
  startLine: null,
  severity: 'P1',
  category: 'bug',
  title: 'context dipakai setelah await',
  what: 'x',
  why: 'y',
  fix: 'z',
  suggestion: null,
  confidence: 0.8,
  trigger: '',
  skill: '',
  ...o,
});
const review = (findings: ReviewFinding[], o: Record<string, unknown> = {}) => ({
  score: 3,
  verdict: 'v',
  summary: 's',
  lessons: [],
  findings,
  reviewCompletion: 'complete',
  uncertainty: '',
  ...o,
});

/** Konteks job tiruan: agent menjawab sesuai schema; mencatat model & fokus tiap putaran. */
function ctxWith(
  answer: (o: RunOptions) => unknown,
  config: Record<string, unknown> = {},
  agentName: 'claude' | 'codex' = 'claude',
) {
  const calls: { model?: string; effort?: string; system: string; user: string; schema: string[] }[] = [];
  const ctx = {
    job: { config: { agentMaxTurns: 10, reviewTimeoutMinutes: 1, ...config } },
    agent: {
      name: agentName,
      run: async (o: RunOptions) => {
        calls.push({
          model: o.model,
          effort: o.effort,
          system: o.systemPrompt,
          user: o.userPrompt,
          schema: Object.keys((o.schema as { properties?: object }).properties ?? {}),
        });
        const output = answer(o);
        if (output instanceof Error) throw output;
        return {
          output,
          raw: JSON.stringify(output),
          meta: { model: o.model ?? null, inputTokens: 100, outputTokens: 10, numTurns: 4, isolation: 'safe' }, // 4 giliran: menelusuri kode
        };
      },
    },
    daemon: { log: () => undefined },
  };
  return { ctx: ctx as never, calls };
}
const input = () => ({
  cwd: '/tmp',
  jobDir: mkdtempSync(join(tmpdir(), 'cj-deep-')),
  persona: 'PERSONA',
  systemPrompt: 'SYSTEM',
  userPrompt: 'USER-DIFF',
  prBrief: '# PR #1: judul',
});
const kind = (o: RunOptions) => Object.keys((o.schema as { properties: object }).properties);
/** keluaran reviewer akhir lengkap (field baru: tulis ulang, dampak, diagram, walkthrough, usaha) */
const lead = (o: Record<string, unknown>) => ({
  rewrites: [],
  impact: 'sedang',
  diagram: '',
  walkthrough: [],
  effortMinutes: 5,
  ...o,
});

describe('deepReview (mode mendalam)', () => {
  it('model per peran: triase & putaran sonnet, validasi & reviewer akhir opus; reviewer akhir tanpa diff penuh, menulis ulang temuan', async () => {
    const { ctx, calls } = ctxWith((o) => {
      const k = kind(o);
      if (k.includes('lenses')) return { prType: 'code', depth: 'deep', lenses: ['security'], reason: '' };
      if (k.includes('valid')) return { valid: true, confidence: 0.97, reason: 'ok' };
      if (k.includes('keep'))
        return lead({
          keep: [0],
          rewrites: [{ index: 0, title: 'Promo baru tetap ditolak', what: 'Mekanisme konkret.', why: '', fix: '' }],
          impact: 'tinggi',
          diagram: '```mermaid\nflowchart TD\n  A --> B\n```',
          walkthrough: [{ area: 'Checkout', files: ['lib/a.dart'], change: 'Baca ulang paket.' }],
          score: 3,
          verdict: 'Perbaiki dulu.',
          summary: 'ringkas',
          lessons: ['l'],
          reviewCompletion: 'complete',
          uncertainty: '',
        });
      return review([f({})]);
    });
    const r = await deepReview(ctx, input());
    expect(
      calls.map((c) => [
        c.schema.includes('lenses')
          ? 'triage'
          : c.schema.includes('valid')
            ? 'validate'
            : c.schema.includes('keep')
              ? 'lead'
              : 'lens',
        c.model,
      ]),
    ).toEqual([
      ['triage', 'sonnet'],
      ['lens', 'sonnet'], // correctness selalu ikut
      ['lens', 'sonnet'], // docs (dokumen usang & klaim PR) selalu ikut
      ['lens', 'sonnet'], // security dari triase
      ['validate', 'opus'],
      ['lead', 'opus'], // reviewer akhir di setiap review
    ]);
    expect(calls.find((c) => c.schema.includes('keep'))!.user).not.toContain('USER-DIFF');
    expect(
      calls.filter((c) => c.schema.includes('findings')).map((c) => /Fokus putaran ini: (\w+)/.exec(c.system)![1]),
    ).toEqual(['correctness', 'docs', 'security']);
    // putaran docs membawa cek dokumen & klaim deskripsi PR
    const docs = calls.find((c) => c.system.includes('Fokus putaran ini: docs'))!;
    expect(docs.system).toContain('## Cek wajib: dokumen & klaim PR');
    // tiga putaran menemukan hal yang sama → satu temuan, keyakinan dari validator
    expect(r.output.findings).toHaveLength(1);
    expect(r.output.findings[0].confidence).toBe(0.97);
    expect(r.output.verdict).toBe('Perbaiki dulu.');
    // tulisan ulang reviewer akhir dipakai; dampak & walkthrough ikut ke hasil
    expect(r.output.findings[0].title).toBe('Promo baru tetap ditolak');
    expect(r.output.findings[0].what).toBe('Mekanisme konkret.');
    expect(r.output.findings[0].why).toBe(f({}).why); // field kosong di tulisan ulang → tetap yang lama
    expect(r.output.impactLevel).toBe('tinggi');
    expect(r.output.walkthrough).toEqual([{ area: 'Checkout', files: ['lib/a.dart'], change: 'Baca ulang paket.' }]);
    expect(r.output.diagram).toBe('flowchart TD\n  A --> B');
    // potongan kode & keterangan kesepakatan putaran ada di prompt reviewer akhir
    expect(calls.find((c) => c.schema.includes('keep'))!.user).toContain('disepakati 3 putaran');
    expect(r.passes.map((p) => p.role)).toEqual(['triage', 'lens', 'lens', 'lens', 'validate', 'lead']);
  });

  it('validator membuang temuan palsu; lead tidak bisa membuang P0 yang tervalidasi; ada P0 → skor maks 2', async () => {
    const { ctx } = ctxWith((o) => {
      const k = kind(o);
      if (k.includes('lenses')) return { prType: 'code', depth: 'deep', lenses: [], reason: '' };
      if (k.includes('valid'))
        return o.userPrompt.includes('palsu')
          ? { valid: false, confidence: 0.1, reason: 'sudah dicek' }
          : { valid: true, confidence: 0.95, reason: 'ok' };
      if (k.includes('keep'))
        return lead({
          keep: [],
          score: 5,
          verdict: 'v',
          summary: 's',
          lessons: [],
          reviewCompletion: 'complete',
          uncertainty: '',
        });
      return review([
        f({ title: 'Temuan palsu null', line: 1 }),
        f({ title: 'Token bocor ke log', severity: 'P0', category: 'security', line: 50, path: 'lib/b.dart' }),
        f({ title: 'Nama kurang jelas', severity: 'P2', line: 90 }),
      ]);
    });
    const r = await deepReview(ctx, input());
    expect(r.dropped.map((d) => d.title)).toEqual(['Temuan palsu null']);
    expect(r.output.findings.map((x) => x.title)).toEqual(['Token bocor ke log']); // lead keep [] tapi P0 dipertahankan
    expect(r.output.score).toBe(2);
  });

  it('putaran gagal → review sebagian; triase & lead gagal → semua putaran jalan & temuan tervalidasi dipakai', async () => {
    const { ctx, calls } = ctxWith((o) => {
      const k = kind(o);
      if (k.includes('lenses') || k.includes('keep')) return new Error('rate limit');
      if (k.includes('valid')) return { valid: true, confidence: 0.9, reason: 'ok' };
      if (o.systemPrompt.includes('Fokus putaran ini: platform')) return new Error('timeout');
      return review([f({})]);
    });
    const r = await deepReview(ctx, input());
    expect(calls.filter((c) => c.schema.includes('findings'))).toHaveLength(5); // tanpa triase: semua putaran
    expect(r.output.reviewCompletion).toBe('incomplete');
    expect(r.output.uncertainty).toContain('Sebagian putaran spesialis gagal');
    expect(r.output.findings).toHaveLength(1);
    expect(r.passes.filter((p) => !p.ok).map((p) => p.label)).toEqual(['triage', 'lens-platform', 'final']);
  });

  it('semua putaran gagal → error (job gagal, bukan "bersih")', async () => {
    const { ctx } = ctxWith((o) =>
      kind(o).includes('findings') ? new Error('down') : { prType: 'code', depth: 'deep', lenses: [], reason: '' },
    );
    await expect(deepReview(ctx, input())).rejects.toThrow('Semua putaran spesialis gagal');
  });

  it('tingkat model mengikuti setting (profil hemat: putaran memakai model cepat)', async () => {
    const { ctx, calls } = ctxWith(
      (o) => {
        const k = kind(o);
        if (k.includes('lenses')) return { prType: 'code', depth: 'deep', lenses: [], reason: '' };
        if (k.includes('keep'))
          return lead({
            keep: [],
            score: 5,
            verdict: 'v',
            summary: 's',
            lessons: [],
            reviewCompletion: 'complete',
            uncertainty: '',
          });
        return review([]);
      },
      { roleTiers: { lens: 'fast', lead: 'fast' }, tierModels: { claude: { fast: 'model-cepat' } } },
    );
    await deepReview(ctx, input());
    expect(calls.filter((c) => c.schema.includes('findings')).map((c) => c.model)).toEqual([
      'model-cepat',
      'model-cepat',
    ]);
    expect(calls.find((c) => c.schema.includes('keep'))!.model).toBe('model-cepat');
  });

  it('triase dari mode otomatis dipakai ulang (tidak memanggil triase dua kali)', async () => {
    const { ctx, calls } = ctxWith((o) => {
      const k = kind(o);
      if (k.includes('lenses')) throw new Error('triase tidak boleh dipanggil lagi');
      if (k.includes('keep'))
        return lead({
          keep: [],
          score: 5,
          verdict: 'v',
          summary: 's',
          lessons: [],
          reviewCompletion: 'complete',
          uncertainty: '',
        });
      return review([]);
    });
    const pre = {
      triage: { prType: 'code' as const, depth: 'deep' as const, lenses: ['rules' as const], reason: 'rules berubah' },
      meta: {
        role: 'triage' as const,
        label: 'triage',
        model: 'haiku',
        ok: true,
        durationMs: 1,
        inputTokens: 1,
        outputTokens: 1,
      },
    };
    const r = await deepReview(ctx, input(), pre);
    expect(calls.filter((c) => c.schema.includes('lenses'))).toHaveLength(0);
    expect(
      calls.filter((c) => c.schema.includes('findings')).map((c) => /Fokus putaran ini: (\w+)/.exec(c.system)![1]),
    ).toEqual(['correctness', 'docs', 'rules']);
    expect(r.passes[0]).toBe(pre.meta);
  });

  it('runTriage: output tidak sesuai schema → triage null & pass ditandai gagal', async () => {
    const { ctx } = ctxWith(() => ({ prType: 'code', lenses: [] })); // tanpa depth
    const t = await runTriage(ctx, { cwd: '/tmp', jobDir: input().jobDir, prBrief: 'x' });
    expect(t.triage).toBeNull();
    expect(t.meta.ok).toBe(false);
  });

  it('Codex: model & reasoning effort per peran (sol/low triase, sol/medium putaran, astra/high validasi & reviewer akhir)', async () => {
    const { ctx, calls } = ctxWith(
      (o) => {
        const k = kind(o);
        if (k.includes('lenses')) return { prType: 'code', depth: 'deep', lenses: [], reason: '' };
        if (k.includes('valid')) return { valid: true, confidence: 0.9, reason: 'ok' };
        if (k.includes('keep'))
          return lead({
            keep: [0],
            score: 3,
            verdict: 'v',
            summary: 's',
            lessons: [],
            reviewCompletion: 'complete',
            uncertainty: '',
          });
        return review([f({})]);
      },
      {},
      'codex',
    );
    await deepReview(ctx, input());
    const by = (k: string) => calls.find((c) => c.schema.includes(k))!;
    expect([by('lenses').model, by('lenses').effort]).toEqual(['gpt-6.2-sol', 'low']);
    expect([by('findings').model, by('findings').effort]).toEqual(['gpt-6.2-sol', 'high']);
    expect([by('valid').model, by('valid').effort]).toEqual(['gpt-6.2-astra', 'high']);
    expect([by('keep').model, by('keep').effort]).toEqual(['gpt-6.2-astra', 'high']); // reviewer akhir
  });
});
