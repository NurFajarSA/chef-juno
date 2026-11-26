import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PROMPTS,
  LEAD_SCHEMA,
  LeadOutputSchema,
  type ReviewFinding,
  type ReviewOutput,
} from '@chefjuno/shared';
import type { JobContext } from '../daemon.js';
import { promptFor } from './prompt-source.js';
import { runPass, type PassMeta } from './deep-review.js';

/** Tambahan hasil reviewer akhir yang ikut disimpan & diposting di ringkasan PR. */
export interface FinalExtras {
  impactLevel?: 'rendah' | 'sedang' | 'tinggi';
  diagram: string;
  walkthrough: { area: string; files: string[]; change: string }[];
  effortMinutes: number | null;
}
export type FinalOutput = ReviewOutput & FinalExtras;

export const FINAL_PROMPT = DEFAULT_PROMPTS['final'].content.trimEnd();

/** Potongan kode ±n baris di sekitar baris temuan (versi head), dengan nomor baris. */
export function codeAround(cwd: string, path: string, line: number, n = 12): string {
  const f = join(cwd, path);
  if (!existsSync(f) || line <= 0) return '';
  try {
    const lines = readFileSync(f, 'utf8').split('\n');
    const from = Math.max(1, line - n);
    const to = Math.min(lines.length, line + n);
    return lines
      .slice(from - 1, to)
      .map((l, k) => `${String(from + k).padStart(5)}${from + k === line ? ' >' : '  '} ${l}`)
      .join('\n');
  } catch {
    return '';
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Diagram hanya bila berupa Mermaid yang dikenal; pagar kode dibuang. */
export function cleanDiagram(d: string): string {
  const t = d
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return /^(flowchart|graph|sequenceDiagram|stateDiagram)/.test(t) ? clip(t, 3000) : '';
}

/**
 * Reviewer akhir (peran `lead`, default Opus): saring + tulis ulang temuan, skor, ringkasan, dampak, walkthrough, diagram.
 * Gagal → null (pemanggil memakai hasil reviewer sebelumnya).
 */
export async function runFinalReview(
  ctx: JobContext,
  o: {
    cwd: string;
    jobDir: string;
    persona: string;
    prBrief: string;
    draft: ReviewOutput;
    /** keterangan tambahan per temuan (mis. "disepakati 3 putaran") */
    notes?: string[];
    /** skill inti (prinsip): dasar memutuskan temuan, severity, & verdict */
    coreSkills?: string;
  },
): Promise<{ output: FinalOutput; meta: PassMeta } | { error: unknown }> {
  const list = o.draft.findings
    .map((f, k) => {
      const code = codeAround(o.cwd, f.path, f.line);
      return [
        `## [${k}] ${f.severity} · ${f.category} · ${f.path}:${f.line}${f.skill ? ` · skill \`${f.skill}\`` : ''}`,
        `Judul: ${f.title}`,
        `Masalah: ${f.what}`,
        `Akibat: ${f.why}`,
        ...(f.trigger ? [`Muncul saat: ${f.trigger}`] : []),
        `Perbaikan: ${f.fix}`,
        `Keyakinan reviewer: ${f.confidence}${o.notes?.[k] ? ` · ${o.notes[k]}` : ''}`,
        ...(code ? ['```', code, '```'] : []),
      ].join('\n');
    })
    .join('\n\n');
  try {
    const r = await runPass(ctx, {
      cwd: o.cwd,
      jobDir: o.jobDir,
      role: 'lead',
      label: 'final',
      systemPrompt: `${o.persona}\n\n---\n\n${await promptFor(ctx, 'final')}${o.coreSkills ? `\n\n---\n\n${o.coreSkills}` : ''}`,
      userPrompt: [
        o.prBrief,
        `# Ringkasan reviewer sebelumnya\nSkor ${o.draft.score}/5 — ${o.draft.verdict}\n${o.draft.summary}`,
        `# Temuan (${o.draft.findings.length})`,
        list || '(tidak ada temuan)',
      ].join('\n\n'),
      schema: LEAD_SCHEMA,
    });
    const p = LeadOutputSchema.safeParse(r.output);
    if (!p.success) return { error: new Error('Output reviewer akhir tidak sesuai schema') };
    const keep = new Set(p.data.keep.filter((k) => k >= 0 && k < o.draft.findings.length));
    // P0 tidak boleh dibuang reviewer akhir
    o.draft.findings.forEach((f, k) => f.severity === 'P0' && keep.add(k));
    const rw = new Map(p.data.rewrites.map((x) => [x.index, x]));
    const findings: ReviewFinding[] = o.draft.findings
      .map((f, k) => ({ f, k }))
      .filter(({ k }) => keep.has(k))
      .map(({ f, k }) => {
        const x = rw.get(k);
        if (!x) return f;
        return {
          ...f,
          title: x.title.trim() ? clip(x.title.trim(), 200) : f.title,
          what: x.what.trim() ? clip(x.what.trim(), 3000) : f.what,
          why: x.why.trim() ? clip(x.why.trim(), 2000) : f.why,
          fix: x.fix.trim() ? clip(x.fix.trim(), 2000) : f.fix,
        };
      });
    const hasP0 = findings.some((f) => f.severity === 'P0');
    return {
      output: {
        score: hasP0 ? Math.min(p.data.score, 2) : p.data.score,
        verdict: p.data.verdict,
        summary: p.data.summary,
        lessons: p.data.lessons.slice(0, 3),
        findings,
        reviewCompletion: o.draft.reviewCompletion === 'incomplete' ? 'incomplete' : p.data.reviewCompletion,
        uncertainty: [o.draft.uncertainty, p.data.uncertainty].filter(Boolean).join(' '),
        impactLevel: p.data.impact,
        diagram: cleanDiagram(p.data.diagram),
        walkthrough: p.data.walkthrough.slice(0, 8).map((w) => ({
          area: clip(w.area, 80),
          files: w.files.slice(0, 12).map((x) => clip(x, 200)),
          change: clip(w.change, 300),
        })),
        effortMinutes: Math.min(600, Math.max(0, p.data.effortMinutes)),
      },
      meta: r.meta,
    };
  } catch (e) {
    return { error: e };
  }
}
