import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_TIERS,
  LEAD_SCHEMA,
  MODEL_PROFILES,
  TRIAGE_SCHEMA,
  VALIDATE_SCHEMA,
  VerifyConfigSchema,
  mergeFindings,
  changedLineCount,
  DEFAULT_TIER_MODELS,
  heuristicReviewMode,
  isTrivialChange,
  newDiagnostics,
  parseReviewMode,
  resolveEffort,
  resolveModel,
} from './models.js';
import type { ReviewFinding } from './schemas.js';

const f = (o: Partial<ReviewFinding>): ReviewFinding => ({
  path: 'lib/a.dart',
  line: 10,
  startLine: null,
  severity: 'P1',
  category: 'bug',
  title: 'context dipakai setelah await tanpa cek mounted',
  what: 'x',
  why: 'y',
  fix: 'z',
  suggestion: null,
  confidence: 0.8,
  trigger: '',
  skill: '',
  ...o,
});

describe('resolveModel (model per peran)', () => {
  it('default seimbang: tanpa Haiku — pekerjaan ringan & review Sonnet, validasi & reviewer akhir Opus di setiap review', () => {
    for (const role of ['triage', 'index', 'learn', 'recap', 'review', 'lens'] as const)
      expect(resolveModel(undefined, 'claude', role)).toBe('sonnet');
    expect(resolveModel(undefined, 'claude', 'validate')).toBe('opus');
    expect(resolveModel(undefined, 'claude', 'lead')).toBe('opus');
    expect(Object.values(DEFAULT_TIER_MODELS.claude)).not.toContain('haiku');
    // Codex (login ChatGPT): Sol untuk pekerjaan ringan & review, Astra untuk validasi & reviewer akhir
    expect(resolveModel(undefined, 'codex', 'triage')).toBe('gpt-6.2-sol');
    expect(resolveModel(undefined, 'codex', 'lead')).toBe('gpt-6.2-astra');
    expect(resolveModel(undefined, 'codex', 'review')).toBe('gpt-6.2-sol');
    expect(resolveModel(undefined, 'codex', 'validate')).toBe('gpt-6.2-astra');
    // nama model Codex dikosongkan di setting → default CLI
    expect(resolveModel({ tierModels: { codex: { strong: '' } } }, 'codex', 'validate')).toBeUndefined();
  });
  it('roleTiers & tierModels dari setting menimpa default; model lama hanya dipakai bila tierModels belum diatur', () => {
    expect(resolveModel({ roleTiers: { review: 'strong' } }, 'claude', 'review')).toBe('opus');
    expect(resolveModel({ tierModels: { codex: { strong: 'gpt-kuat' } } }, 'codex', 'validate')).toBe('gpt-kuat');
    expect(resolveModel({ models: { claude: 'sonnet' } }, 'claude', 'validate')).toBe('sonnet');
    expect(resolveModel({ models: { claude: 'sonnet' }, tierModels: { claude: {} } }, 'claude', 'validate')).toBe(
      'opus',
    );
  });
  it('profil: hemat tidak pernah memakai model kuat; maksimal tetap triase murah', () => {
    expect(Object.values(MODEL_PROFILES.hemat)).not.toContain('strong');
    expect(MODEL_PROFILES.maksimal.triage).toBe('fast');
    expect(MODEL_PROFILES.seimbang).toEqual(DEFAULT_ROLE_TIERS);
  });
});

describe('parseReviewMode', () => {
  it('"dalam" / "deep" / "mendalam" di awal instruksi → mode mendalam, sisa instruksi dipertahankan', () => {
    expect(parseReviewMode('dalam fokus ke rules')).toEqual({ mode: 'deep', instruction: 'fokus ke rules' });
    expect(parseReviewMode('Deep')).toEqual({ mode: 'deep', instruction: '' });
    expect(parseReviewMode('tolong cek dalam-dalam')).toEqual({ mode: null, instruction: 'tolong cek dalam-dalam' });
  });
});

describe('mergeFindings', () => {
  it('temuan sama dari dua putaran digabung, keyakinan naik; keparahan tertinggi dipakai', () => {
    const m = mergeFindings([
      { lens: 'correctness', findings: [f({ confidence: 0.8 })] },
      {
        lens: 'platform',
        findings: [
          f({ line: 12, severity: 'P0', confidence: 0.85, title: 'Pemakaian context setelah await tanpa mounted' }),
        ],
      },
      {
        lens: 'security',
        findings: [f({ path: 'lib/b.dart', title: 'Token di SharedPreferences', category: 'security' })],
      },
    ]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ severity: 'P0', agreement: 2, lenses: ['correctness', 'platform'], confidence: 0.95 });
    expect(m[1]).toMatchObject({ path: 'lib/b.dart', agreement: 1, confidence: 0.8 });
  });
  it('file sama tapi baris jauh atau judul berbeda tidak digabung', () => {
    const m = mergeFindings([
      { lens: 'a', findings: [f({}), f({ line: 40 }), f({ line: 11, title: 'Query di dalam loop' })] },
    ]);
    expect(m).toHaveLength(3);
  });
});

describe('verifikasi statis', () => {
  it('VerifyConfigSchema: analyze wajib, default setup & timeout', () => {
    expect(
      VerifyConfigSchema.parse({ image: 'ghcr.io/cirruslabs/flutter:stable', analyze: ['flutter analyze --no-pub'] }),
    ).toMatchObject({
      setup: [],
      timeoutSec: 600,
    });
    expect(VerifyConfigSchema.safeParse({ image: 'x', analyze: [] }).success).toBe(false);
  });
  it('newDiagnostics: hanya masalah yang baru di head (multiset, abaikan nomor baris & ringkasan)', () => {
    const base =
      'Analyzing app...\n  info • Unused import • lib/a.dart:3:8 • unused_import\n1 issue found. (ran in 2.1s)';
    const head = [
      'Analyzing app...',
      '  info • Unused import • lib/a.dart:5:8 • unused_import',
      '  warning • Dead code • lib/b.dart:10:3 • dead_code',
      '  error • The getter x is not defined • lib/c.dart:2:1 • undefined_getter',
      '3 issues found. (ran in 2.4s)',
    ].join('\n');
    expect(newDiagnostics(base, head)).toEqual([
      'warning • Dead code • lib/b.dart:10 • dead_code',
      'error • The getter x is not defined • lib/c.dart:2 • undefined_getter',
    ]);
    expect(newDiagnostics(head, head)).toEqual([]);
  });
  it('schema strict untuk triase, validasi, lead', () => {
    for (const s of [TRIAGE_SCHEMA, VALIDATE_SCHEMA, LEAD_SCHEMA]) {
      expect(s.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(s.additionalProperties).toBe(false);
    }
  });
});

describe('reasoning effort per peran', () => {
  it('effort low / medium / high mengikuti tingkat untuk Claude (--effort) & Codex; nilai aneh diabaikan', () => {
    expect(resolveEffort(undefined, 'codex', 'triage')).toBe('low');
    expect(resolveEffort(undefined, 'codex', 'lens')).toBe('high');
    expect(resolveEffort(undefined, 'codex', 'validate')).toBe('high');
    expect(resolveEffort(undefined, 'claude', 'triage')).toBe('low');
    expect(resolveEffort(undefined, 'claude', 'review')).toBe('high');
    expect(resolveEffort(undefined, 'claude', 'lead')).toBe('high');
    expect(resolveEffort({ tierEffort: { claude: { strong: 'max' } } }, 'claude', 'validate')).toBe('max');
    expect(resolveEffort({ tierEffort: { codex: { strong: 'xhigh' } } }, 'codex', 'validate')).toBe('xhigh');
    expect(resolveEffort({ tierEffort: { codex: { strong: 'high"; rm -rf' } } }, 'codex', 'validate')).toBeUndefined();
  });
});

describe('mode otomatis', () => {
  it('kata "standar" / "cepat" memaksa mode standar', () => {
    expect(parseReviewMode('standar tolong cek nama')).toEqual({ mode: 'standard', instruction: 'tolong cek nama' });
    expect(parseReviewMode('cepat')).toEqual({ mode: 'standard', instruction: '' });
  });
  it('changedLineCount menghitung baris +/- tanpa header file', () => {
    expect(changedLineCount('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+c\n konteks')).toBe(3);
  });
  it('PR kecil tanpa area sensitif → standar tanpa memanggil model; selain itu triase', () => {
    expect(heuristicReviewMode(['lib/home/home_page.dart', 'lib/home/widgets.dart'], 40)).toMatchObject({
      mode: 'standard',
    });
    // area sensitif selalu ke triase walau kecil
    for (const f of [
      'lib/auth/login_page.dart',
      'firestore.rules',
      'pubspec.yaml',
      'android/app/src/main/AndroidManifest.xml',
      'db/migrations/001.sql',
      '.github/workflows/ci.yml',
      'lib/payments/checkout.dart',
    ])
      expect(heuristicReviewMode([f], 5)).toBeNull();
    // besar → langsung mendalam (triase tidak bisa menurunkannya ke standar)
    expect(heuristicReviewMode(['lib/a.dart'], 151)).toMatchObject({ mode: 'deep' });
    expect(
      heuristicReviewMode(
        Array.from({ length: 9 }, (_, i) => `lib/f${i}.dart`),
        20,
      ),
    ).toMatchObject({ mode: 'deep', reason: 'PR besar (20 baris, 9 file)' });
    // kasus #1926: 206 baris, 10 file → mendalam
    expect(
      heuristicReviewMode(
        Array.from({ length: 10 }, (_, i) => `lib/r${i}.dart`),
        206,
      )?.mode,
    ).toBe('deep');
  });
});

describe('satu standar: perubahan remeh', () => {
  it('hanya dokumentasi → remeh; ada satu file kode → tidak', () => {
    expect(isTrivialChange(['README.md', 'docs/architecture.md', 'docs/img/flow.png', 'LICENSE'])).toBe(true);
    expect(isTrivialChange(['.github/PULL_REQUEST_TEMPLATE.md', 'CHANGELOG.md'])).toBe(true);
    expect(isTrivialChange(['docs/guide.md', 'lib/app/main.dart'])).toBe(false);
    expect(isTrivialChange(['pubspec.yaml'])).toBe(false);
    expect(isTrivialChange(['web/index.html'])).toBe(false);
    expect(isTrivialChange([])).toBe(false);
  });
});

describe('gabung temuan: keamanan', () => {
  it('temuan security tidak digabung dengan temuan bug di baris & judul mirip', () => {
    const base = {
      path: 'a.ts',
      line: 10,
      startLine: null,
      what: 'w',
      why: 'y',
      fix: 'f',
      suggestion: null,
      confidence: 0.9,
      trigger: '',
      skill: '',
    };
    const m = mergeFindings([
      {
        lens: 'correctness',
        findings: [{ ...base, severity: 'P1', category: 'bug', title: 'Hasil fetchUser tidak dicek null' }],
      },
      {
        lens: 'security',
        findings: [
          { ...base, severity: 'P1', category: 'security', title: 'Hasil fetchUser tidak dicek null untuk token' },
        ],
      },
    ]);
    expect(m.map((x) => x.category).sort()).toEqual(['bug', 'security']);
  });
});
