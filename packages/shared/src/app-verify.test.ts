import { describe, expect, it } from 'vitest';
import {
  AppConfigSchema,
  AppStepSchema,
  confidenceAfterTrial,
  DEFAULT_RUNNER_IMAGE,
  pickAppCandidates,
  stepProblem,
  type AppStep,
} from './app-verify.js';
import { evidenceLine } from './format.js';
import type { ReviewFinding } from './schemas.js';

const step = (o: Partial<AppStep> & { do: AppStep['do'] }): AppStep =>
  AppStepSchema.parse({
    path: null,
    text: null,
    label: null,
    role: null,
    name: null,
    nth: null,
    value: null,
    key: null,
    dy: null,
    ms: null,
    shot: null,
    ...o,
  });

const finding = (o: Partial<ReviewFinding>): ReviewFinding => ({
  path: 'lib/a.dart',
  line: 1,
  startLine: null,
  severity: 'P1',
  category: 'bug',
  title: 't',
  what: 'w',
  why: 'y',
  fix: 'f',
  suggestion: null,
  confidence: 0.8,
  trigger: '',
  skill: '',
  ...o,
});

describe('config .chefjuno/app.json', () => {
  it('default: viewport ponsel, semantics Flutter aktif, image runner sesuai versi playwright-core', () => {
    const c = AppConfigSchema.parse({
      build: { image: 'flutter', commands: ['flutter build web'], outDir: 'build/web' },
    });
    expect(c.viewport).toEqual({ width: 412, height: 915 });
    expect(c.flutterSemantics).toBe(true);
    expect(c.runner.image).toBe(DEFAULT_RUNNER_IMAGE);
    expect(c.maxScenarios).toBe(3);
  });
  it('outDir di luar repo & langkah login tanpa sasaran ditolak; login boleh memakai placeholder kredensial', () => {
    const base = { image: 'flutter', commands: ['x'] };
    expect(AppConfigSchema.safeParse({ build: { ...base, outDir: '../etc' } }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ build: { ...base, outDir: '/etc' } }).success).toBe(false);
    const c = AppConfigSchema.parse({
      build: { ...base, outDir: 'build/web' },
      login: [{ do: 'fill', label: 'Email', value: '{{email}}' }],
    });
    expect(stepProblem(c.login[0], true)).toBeNull();
    expect(stepProblem(c.login[0])).toMatch(/placeholder kredensial/);
  });
});

describe('langkah uji (dari agent)', () => {
  it('validasi per jenis langkah', () => {
    expect(stepProblem(step({ do: 'goto', path: '/keranjang' }))).toBeNull();
    expect(stepProblem(step({ do: 'goto', path: 'https://evil.example' }))).toMatch(/goto/);
    expect(stepProblem(step({ do: 'goto', path: '//evil.example' }))).toMatch(/goto/);
    expect(stepProblem(step({ do: 'click' }))).toMatch(/click/);
    expect(stepProblem(step({ do: 'click', role: 'button', name: 'Simpan' }))).toBeNull();
    expect(stepProblem(step({ do: 'fill', label: 'Nama' }))).toMatch(/fill/);
    expect(stepProblem(step({ do: 'screenshot', shot: 'Total Salah' }))).toMatch(/screenshot/);
    expect(stepProblem(step({ do: 'screenshot', shot: 'total-salah' }))).toBeNull();
    expect(stepProblem(step({ do: 'wait' }))).toMatch(/wait/);
    // agent tidak boleh meminta kredensial
    expect(stepProblem(step({ do: 'fill', label: 'Sandi', value: '{{password}}' }))).toMatch(/placeholder/);
  });
});

describe('pemilihan & keyakinan', () => {
  it('P0/P1 bug/security/performance dicoba lebih dulu; P2, test & maintainability tidak', () => {
    const fs = [
      finding({ severity: 'P2' }),
      finding({ severity: 'P1', confidence: 0.7 }),
      finding({ severity: 'P0', confidence: 0.6 }),
      finding({ severity: 'P1', category: 'test' }),
      finding({ severity: 'P1', confidence: 0.9 }),
    ];
    expect(pickAppCandidates(fs, 3)).toEqual([2, 4, 1]);
    expect(pickAppCandidates(fs, 1)).toEqual([2]);
  });
  it('terbukti → ≥0.95; tidak terbukti → ×0.6; tidak meyakinkan → tetap', () => {
    expect(confidenceAfterTrial(0.7, 'reproduced')).toBe(0.95);
    expect(confidenceAfterTrial(0.99, 'reproduced')).toBe(0.99);
    expect(confidenceAfterTrial(0.9, 'not_reproduced')).toBe(0.54);
    expect(confidenceAfterTrial(0.8, 'inconclusive')).toBe(0.8);
  });
  it('baris bukti di komentar PR: catatan + tautan dashboard (+ screenshot inline bila ada); inconclusive tidak ditulis', () => {
    const e = { status: 'reproduced' as const, note: 'Total tampil "Rp NaN".', shots: ['f0-0'] };
    expect(evidenceLine(e, 'https://dash/reviews/j#bukti-f0-0')).toBe(
      '🧪 **Terbukti saat dicoba di aplikasi** — Total tampil "Rp NaN". · [detail di dashboard](https://dash/reviews/j#bukti-f0-0)',
    );
    expect(evidenceLine(e, null)).toBe('🧪 **Terbukti saat dicoba di aplikasi** — Total tampil "Rp NaN".');
    expect(evidenceLine({ ...e, status: 'inconclusive' }, null)).toBeNull();
    expect(evidenceLine(undefined, null)).toBeNull();
  });
});
