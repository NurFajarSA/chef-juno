import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { clearAuth, clearFirestore, seedTeamSkills } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

// Mode mendalam (agent paralel + validasi, model per peran) & verifikasi statis di container (runtime palsu).
const FAKE_CONTAINER = fileURLToPath(new URL('../../../daemon/test/fake-container.mjs', import.meta.url));
let h: Harness;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  await seedTeamSkills();
  await h.startMachine({ agents: ['claude'] });
});
afterAll(async () => {
  delete process.env.CHEFJUNO_CONTAINER_BIN;
  await h?.stop();
});

const records = () =>
  readdirSync(h.recordDir)
    .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const argModel = (r: { argv: string[] }) => r.argv[r.argv.indexOf('--model') + 1];

describe('review mendalam & verifikasi', () => {
  it('`lapor @chefjuno dalam`: triase (sonnet) → 5 putaran paralel (sonnet, termasuk docs) → validasi P0/P1 (opus) → reviewer akhir (opus); temuan digabung', async () => {
    await h.comment('lapor @chefjuno dalam fokus null-check');
    const done = await h.waitJob((j) => j.type === 'review' && j.status === 'posted', 90_000);
    expect(done.data.reviewMode).toBe('deep');
    expect(done.data.trigger.instruction).toBe('fokus null-check');
    const meta = done.data.result.meta;
    expect(meta.mode).toBe('deep');
    // kata "dalam" di perintah memilih pipeline lama (bawaan: mode tujuan)
    expect(meta.modeDecision).toEqual({
      requested: 'deep',
      chosen: 'deep',
      by: 'perintah',
      reason: 'pipeline mendalam diminta',
    });
    const roles = (meta.passes as { role: string; model: string; ok: boolean }[]).map((p) => `${p.role}:${p.model}`);
    expect(roles[0]).toBe('triage:sonnet');
    expect(roles.filter((r) => r === 'lens:sonnet')).toHaveLength(5);
    // dua P1 (bug & security, tidak digabung) → dua validasi Opus
    expect(roles.filter((r) => r.startsWith('validate:'))).toEqual(['validate:opus', 'validate:opus']);
    expect(roles.at(-1)).toBe('lead:opus'); // reviewer akhir
    // timeline proses agent untuk dashboard: tiap langkah tercatat (mulai → selesai) di dokumen job
    const steps = done.data.progress as {
      key: string;
      label: string;
      status: string;
      startedAt: number;
      endedAt: number;
    }[];
    expect(steps.map((x) => x.key)).toEqual(
      expect.arrayContaining(['prepare', 'triage', 'lens-correctness', 'lens-docs', 'final']),
    );
    expect(steps.every((x) => x.status === 'done' && x.endedAt >= x.startedAt)).toBe(true);
    expect(steps.find((x) => x.key === 'final')!.label).toBe('Reviewer akhir (Opus)');
    // intip kerja agent: aktivitas (berpikir, alat, keputusan) per langkah; rahasia disensor; hasil alat tidak dicatat
    const act = (await h.db.collection(`jobs/${done.id}/activity`).get()).docs.map((d) => d.data());
    const stepsWithAct = new Set(act.map((a) => a.step));
    expect([...stepsWithAct]).toEqual(expect.arrayContaining(['triage', 'lens-correctness', 'final']));
    const events = act.flatMap((a) => a.events as { kind: string; text: string; at: number }[]);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['think', 'tool', 'text']));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', text: 'Baca src/api/user.ts' }));
    const all = JSON.stringify(events);
    expect(all).not.toContain('ghp_');
    expect(all).toContain('token=•••');
    expect(all).not.toContain('ISI FILE RAHASIA');
    // hasil reviewer akhir ikut tersimpan
    expect(done.data.result).toMatchObject({ impactLevel: 'sedang', effortMinutes: 12 });
    expect(done.data.result.diagram).toContain('flowchart TD');
    expect((meta.passes as { ok: boolean }[]).every((p) => p.ok)).toBe(true);
    // fake agent: tiap putaran melaporkan 4 temuan yang sama → digabung jadi 4 (temuan security tidak digabung dengan bug)
    expect(done.data.result.findings).toHaveLength(4);
    // disepakati 4 putaran → keyakinan naik ke 1.0 (validator 0.97 tidak menurunkannya: diambil yang tertinggi)
    expect(done.data.result.findings[0].confidence).toBe(1);
    // skill tim berkategori inti juga dipakai validator & reviewer akhir; skill domain tidak
    const sys = records().map((r) => String(r.system));
    const validators = sys.filter((x) => x.startsWith('Kamu validator temuan'));
    expect(validators.length).toBeGreaterThan(0);
    expect(validators.every((x) => x.includes('(`bukti`)') && x.includes('(`sinyal-bukan-noise`)'))).toBe(true);
    expect(validators.some((x) => x.includes('(`flutter-tim`)'))).toBe(false);
    expect(sys.find((x) => x.includes('Kamu reviewer akhir (senior)'))).toContain('(`bukti`)');
    // model benar-benar dikirim ke CLI (--model) per peran
    const models = records().map(argModel);
    expect(models).toEqual(expect.arrayContaining(['sonnet', 'opus']));
    expect(models).not.toContain('haiku');
    // Opus: validasi dua P1 + reviewer akhir
    expect(models.filter((m) => m === 'opus')).toHaveLength(3);
    // effort per tingkat ikut dikirim ke Claude Code (--effort): Opus high, Sonnet medium/low
    const effortOf = (r: { argv: string[] }) => r.argv[r.argv.indexOf('--effort') + 1];
    expect(
      records()
        .filter((r) => argModel(r) === 'opus')
        .map(effortOf),
    ).toEqual(['high', 'high', 'high']);
    expect(
      new Set(
        records()
          .filter((r) => argModel(r) === 'sonnet')
          .map(effortOf),
      ),
    ).toEqual(new Set(['low', 'high']));
  });

  it('verifikasi statis: masalah yang baru di head masuk prompt reviewer & tercatat di hasil', async () => {
    process.env.CHEFJUNO_CONTAINER_BIN = FAKE_CONTAINER;
    // konfigurasi verifikasi dibaca dari branch tujuan: commit ke main, lalu PR berbasis commit itu
    const base = h.repo.commit(
      {
        '.chefjuno/verify.json': JSON.stringify({
          image: 'node:24-alpine',
          setup: ['npm ci --ignore-scripts'],
          analyze: ['npx tsc --noEmit'],
          timeoutSec: 120,
        }),
      },
      'chore: konfigurasi verifikasi',
    );
    h.mock.repos.get(h.repo.fullName)!.prs.get(1)!.baseSha = base;
    await h.db.doc('settings/global').update({ verifyEnabled: true, reviewMode: 'standard' });
    const before = records().length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () => (await h.db.collection('jobs').where('status', '==', 'posted').get()).size === 2,
      90_000,
      'review kedua',
    );
    const job = (await h.db.collection('jobs').where('status', '==', 'posted').get()).docs
      .map((d) => d.data())
      .find((j) => j.reviewMode !== 'deep')!;
    const v = job.result.meta.verification;
    expect(v).toMatchObject({ ran: true, image: 'node:24-alpine' });
    expect(v.newIssues.length).toBeGreaterThan(0);
    // head menambah opsi cache di dua file (user.ts & profile.ts); base tidak punya → keduanya masalah baru
    expect(v.newIssues.every((i: string) => i.includes('undocumented_cache_option'))).toBe(true);
    expect(v.newIssues.some((i: string) => i.includes('src/api/user.ts'))).toBe(true);
    expect(v.newIssues.some((i: string) => i.includes('src/services/profile.ts'))).toBe(true);
    expect(v.baseIssueLines).toBe(0);
    // bawaan: mode tujuan — satu agent (model terkuat, akses penuh), setting mode lama diabaikan
    expect((job.result.meta.passes as { role: string }[]).map((p) => p.role)).toEqual(['review']);
    expect(job.result.meta.mode).toBe('goal');
    const rec = records()
      .slice(before)
      .find((r) => String(r.prompt).includes('# PR #1') && String(r.prompt).includes('```diff'))!;
    expect(rec.system).toContain('# Tujuan');
    expect(rec.argv).toContain('bypassPermissions');
    expect(argModel(rec)).toBe('opus');
    expect(rec.prompt).toContain('## Analisis statis (verifikasi empiris, base vs head)');
    expect(rec.prompt).toContain('undocumented_cache_option');
  });

  it('tanpa Docker/Podman: verifikasi dilewati dengan alasan, review tetap jalan', async () => {
    process.env.CHEFJUNO_CONTAINER_BIN = '/tidak/ada/docker';
    // setting mode lama diabaikan: bawaan mode tujuan
    await h.db.doc('settings/global').update({ reviewMode: 'standard' });
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () => (await h.db.collection('jobs').where('status', '==', 'posted').get()).size === 3,
      90_000,
      'review ketiga',
    );
    const jobs = (await h.db.collection('jobs').where('status', '==', 'posted').get()).docs.map((d) => d.data());
    const last = jobs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
    expect(last.result.meta.verification).toEqual({ ran: false, reason: 'Docker/Podman tidak tersedia di mesin ini' });
    expect(last.result.meta.modeDecision).toMatchObject({ chosen: 'goal', by: 'aturan' });
    expect(last.result.meta.passes.map((p: { role: string }) => p.role)).toEqual(['review']);
  });
});
