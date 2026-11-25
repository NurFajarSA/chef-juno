import { describe, it, expect } from 'vitest';
import {
  LEARN_OUTPUT_SCHEMA,
  LearnOutputSchema,
  MODULE_SUMMARY_SCHEMA,
  ModuleSummaryOutputSchema,
  RECAP_OUTPUT_SCHEMA,
  REVIEW_OUTPUT_SCHEMA,
  RecapOutputSchema,
  ReviewOutputSchema,
  StoredReviewOutputSchema,
  MachineRegistrationInputSchema,
  type ReviewOutput,
} from './schemas.js';

type Json = { [k: string]: unknown };

interface Violation {
  path: string;
  problem: string;
}

/** Jalan rekursif: setiap node object harus strict, tanpa oneOf/format di mana pun. */
function strictViolations(node: unknown, path = '$', isRoot = true): Violation[] {
  const out: Violation[] = [];
  if (Array.isArray(node)) {
    node.forEach((n, i) => out.push(...strictViolations(n, `${path}[${i}]`, false)));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const o = node as Json;
  for (const banned of ['oneOf', 'format']) if (banned in o) out.push({ path, problem: `has ${banned}` });
  if (!isRoot && '$schema' in o) out.push({ path, problem: 'nested $schema' });
  if (o.type === 'object') {
    const props = (o.properties ?? {}) as Json;
    if (o.additionalProperties !== false) out.push({ path, problem: 'additionalProperties !== false' });
    const req = Array.isArray(o.required) ? [...(o.required as string[])].sort() : null;
    if (JSON.stringify(req) !== JSON.stringify(Object.keys(props).sort()))
      out.push({
        path,
        problem: `required ${JSON.stringify(req)} != properties ${JSON.stringify(Object.keys(props))}`,
      });
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v as Json))
        out.push(...strictViolations(pv, `${path}.properties.${pk}`, false));
    } else {
      out.push(...strictViolations(v, `${path}.${k}`, false));
    }
  }
  return out;
}

function countObjects(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countObjects(x), 0);
  if (!node || typeof node !== 'object') return 0;
  const o = node as Json;
  return (o.type === 'object' ? 1 : 0) + Object.values(o).reduce((n: number, x) => n + countObjects(x), 0);
}

const SCHEMAS = {
  REVIEW_OUTPUT_SCHEMA: [REVIEW_OUTPUT_SCHEMA, 2],
  MODULE_SUMMARY_SCHEMA: [MODULE_SUMMARY_SCHEMA, 2],
  LEARN_OUTPUT_SCHEMA: [LEARN_OUTPUT_SCHEMA, 3],
  RECAP_OUTPUT_SCHEMA: [RECAP_OUTPUT_SCHEMA, 1],
} as const;

describe.each(Object.entries(SCHEMAS))('%s (strict JSON Schema, §7.1)', (_name, [schema, objectCount]) => {
  it('$schema = draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('root adalah object', () => {
    expect(schema.type).toBe('object');
  });

  it('setiap object: additionalProperties false & required = semua key; tanpa oneOf/format', () => {
    expect(strictViolations(schema)).toEqual([]);
  });

  it('jumlah node object sesuai (walker benar-benar menelusuri nested)', () => {
    expect(countObjects(schema)).toBe(objectCount);
  });

  it('bisa diserialisasi JSON (tanpa nilai non-JSON)', () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe('walker strictViolations mendeteksi pelanggaran', () => {
  it('menangkap object tidak strict, required kurang, oneOf, format', () => {
    const bad = {
      type: 'object',
      properties: {
        a: { type: 'string', format: 'email' },
        b: { type: 'object', properties: { c: { oneOf: [{ type: 'string' }] } }, required: [] },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    };
    const problems = strictViolations(bad).map((v) => `${v.path}: ${v.problem}`);
    expect(problems).toEqual([
      '$.properties.a: has format',
      '$.properties.b: additionalProperties !== false',
      '$.properties.b: required [] != properties ["c"]',
      '$.properties.b.properties.c: has oneOf',
    ]);
  });
});

describe('REVIEW_OUTPUT_SCHEMA detail', () => {
  const props = REVIEW_OUTPUT_SCHEMA.properties as Json;
  const finding = (props.findings as Json).items as Json;
  const fprops = finding.properties as Json;

  it('field opsional dibuat nullable (startLine, suggestion) tapi tetap required', () => {
    expect(finding.required).toContain('startLine');
    expect(finding.required).toContain('suggestion');
    expect(JSON.stringify(fprops.startLine)).toContain('"null"');
    expect(JSON.stringify(fprops.suggestion)).toContain('"null"');
  });

  it('severity & category berupa enum', () => {
    expect((fprops.severity as Json).enum).toEqual(['P0', 'P1', 'P2']);
    expect((fprops.category as Json).enum).toEqual(['bug', 'security', 'performance', 'maintainability', 'test']);
  });

  it('score integer 0–5', () => {
    expect(props.score).toMatchObject({ type: 'integer', minimum: 0, maximum: 5 });
  });

  it('tanpa batas integer raksasa (MAX_SAFE_INTEGER) yang ditolak mode strict', () => {
    expect(JSON.stringify(REVIEW_OUTPUT_SCHEMA)).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });
});

const validReview: ReviewOutput = {
  score: 3,
  verdict: 'Bumbunya kurang, perbaiki dulu.',
  summary: 'Menambah login.',
  lessons: ['Selalu cek token.'],
  findings: [
    {
      path: 'src/auth.ts',
      line: 42,
      startLine: null,
      severity: 'P1',
      category: 'bug',
      title: 'Token tidak dicek',
      what: 'x',
      why: 'y',
      fix: 'z',
      suggestion: null,
      confidence: 0.9,
      trigger: 'token kedaluwarsa dikirim ulang',
      skill: 'security-review',
    },
  ],
  reviewCompletion: 'complete',
  uncertainty: '',
};

describe('ReviewOutputSchema (zod)', () => {
  it('menerima sampel valid', () => {
    expect(ReviewOutputSchema.parse(validReview)).toEqual(validReview);
  });

  it('menolak score 6, -1, dan pecahan', () => {
    expect(ReviewOutputSchema.safeParse({ ...validReview, score: 6 }).success).toBe(false);
    expect(ReviewOutputSchema.safeParse({ ...validReview, score: -1 }).success).toBe(false);
    expect(ReviewOutputSchema.safeParse({ ...validReview, score: 2.5 }).success).toBe(false);
  });

  it('menolak severity/category di luar enum', () => {
    const f = validReview.findings[0];
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [{ ...f, severity: 'P3' }] }).success).toBe(false);
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [{ ...f, category: 'style' }] }).success).toBe(
      false,
    );
  });

  it('menolak field wajib yang hilang (suggestion harus null, bukan absen)', () => {
    const { suggestion: _s, ...noSuggestion } = validReview.findings[0];
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [noSuggestion] }).success).toBe(false);
  });
});

describe('kontrak review v4: confidence, trigger, reviewCompletion', () => {
  const f = validReview.findings[0];
  it('confidence wajib dan harus 0–1', () => {
    const { confidence: _c, ...noConf } = f;
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [noConf] }).success).toBe(false);
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [{ ...f, confidence: 1.2 }] }).success).toBe(false);
    expect(ReviewOutputSchema.safeParse({ ...validReview, findings: [{ ...f, confidence: -0.1 }] }).success).toBe(
      false,
    );
  });
  it('reviewCompletion hanya complete | incomplete, uncertainty wajib ada', () => {
    expect(ReviewOutputSchema.safeParse({ ...validReview, reviewCompletion: 'partial' }).success).toBe(false);
    const { uncertainty: _u, ...noUnc } = validReview;
    expect(ReviewOutputSchema.safeParse(noUnc).success).toBe(false);
  });
  it('JSON schema agent memuat field baru sebagai required', () => {
    const props = REVIEW_OUTPUT_SCHEMA.properties as Json;
    expect(REVIEW_OUTPUT_SCHEMA.required).toEqual(expect.arrayContaining(['reviewCompletion', 'uncertainty']));
    const item = (props.findings as Json).items as Json;
    expect(item.required).toEqual(expect.arrayContaining(['confidence', 'trigger']));
    expect((props.reviewCompletion as Json).enum).toEqual(['complete', 'incomplete']);
  });
  it('StoredReviewOutputSchema menerima hasil lama tanpa field baru (default aman)', () => {
    const { reviewCompletion: _r, uncertainty: _u, ...old } = validReview;
    const { confidence: _c, trigger: _t, skill: _s, ...oldF } = f;
    const r = StoredReviewOutputSchema.parse({ ...old, findings: [oldF] });
    expect(r.reviewCompletion).toBe('complete');
    // hasil lama (sebelum atribusi skill) tetap terbaca dengan skill kosong
    expect(r.findings[0]).toMatchObject({ confidence: 1, trigger: '', skill: '' });
  });
});

describe('skema output lain (zod)', () => {
  it('ModuleSummaryOutputSchema', () => {
    expect(ModuleSummaryOutputSchema.safeParse({ modules: [{ id: 'm', summary: 's', patterns: [] }] }).success).toBe(
      true,
    );
    expect(ModuleSummaryOutputSchema.safeParse({ modules: [{ id: 'm' }] }).success).toBe(false);
  });

  it('LearnOutputSchema', () => {
    const ok = {
      rules: [{ text: 't', kind: 'suppression', category: 'test', paths: [], matchTitle: 'x', evidence: ['f1'] }],
      personalLessons: [{ login: 'dev', key: 'k', title: 't', category: 'bug', lesson: 'l' }],
    };
    expect(LearnOutputSchema.safeParse(ok).success).toBe(true);
    expect(LearnOutputSchema.safeParse({ ...ok, rules: [{ ...ok.rules[0], kind: 'other' }] }).success).toBe(false);
  });

  it('RecapOutputSchema', () => {
    expect(RecapOutputSchema.safeParse({ narrative: 'n' }).success).toBe(true);
    expect(RecapOutputSchema.safeParse({}).success).toBe(false);
  });

  it('MachineRegistrationInputSchema trim + panjang', () => {
    expect(MachineRegistrationInputSchema.parse({ name: '  laptop  ' })).toEqual({ name: 'laptop' });
    expect(MachineRegistrationInputSchema.safeParse({ name: ' a ' }).success).toBe(false);
  });
});
