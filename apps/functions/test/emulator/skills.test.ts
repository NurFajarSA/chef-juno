import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callFn, clearAuth, clearFirestore, idTokenFor } from '../helpers.js';
import { createHarness, type Harness } from '../harness.js';

let h: Harness;
let admin: string;
let member: string;
beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  h = await createHarness();
  admin = await idTokenFor('uid-admin1', { cj: 'admin', cjGh: '1001' });
  member = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
});
afterAll(async () => h?.stop());

const md = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
const skill = async (slug: string) => (await h.db.doc(`skills/${slug}`).get()).data()!;

describe('skill tim', () => {
  it('import massal: skill dari admin langsung aktif, dari anggota menunggu admin; file pendukung ikut', async () => {
    const byAdmin = await callFn<{ created: string[] }>(
      'importSkills',
      {
        skills: [
          {
            files: {
              'SKILL.md': md('sql-review', 'Cek query SQL', 'SKILL-SQL: cari N+1.'),
              'references/contoh.md': 'contoh query',
            },
          },
        ],
      },
      admin,
    );
    expect(byAdmin.ok, JSON.stringify(byAdmin.error)).toBe(true);
    expect(byAdmin.result!.created).toEqual(['sql-review']);
    const byMember = await callFn<{ created: string[] }>(
      'importSkills',
      { skills: [{ files: { 'SKILL.md': md('UI Review', 'Cek UI', 'SKILL-UI: cek aksesibilitas.') } }] },
      member,
    );
    expect(byMember.ok, JSON.stringify(byMember.error)).toBe(true);
    expect(byMember.result!.created).toEqual(['ui-review']);
    expect(await skill('sql-review')).toMatchObject({
      name: 'sql-review',
      enabled: true,
      latestVersion: 1,
      fileCount: 2,
      source: 'import',
    });
    expect(await skill('ui-review')).toMatchObject({ name: 'UI Review', enabled: false, latestVersion: 1 });
    const v1 = (await h.db.doc('skills/sql-review/versions/1').get()).data()!;
    expect(v1.files['references/contoh.md']).toBe('contoh query');
    expect(v1.authorLogin).toBe('admin1');
  });

  it('import ulang: isi sama → unchanged; isi berubah → versi baru (status aktif tidak berubah)', async () => {
    const same = await callFn<{ unchanged: string[] }>(
      'importSkills',
      {
        skills: [
          {
            files: {
              'SKILL.md': md('sql-review', 'Cek query SQL', 'SKILL-SQL: cari N+1.'),
              'references/contoh.md': 'contoh query',
            },
          },
        ],
      },
      member,
    );
    expect(same.result!.unchanged).toEqual(['sql-review']);
    const changed = await callFn<{ updated: string[] }>(
      'importSkills',
      {
        skills: [
          {
            files: {
              'SKILL.md': md('sql-review', 'Cek query SQL', 'SKILL-SQL v2: cari N+1 & injeksi.'),
              'references/contoh.md': 'contoh query',
            },
          },
        ],
      },
      member,
    );
    expect(changed.result!.updated).toEqual(['sql-review']);
    expect(await skill('sql-review')).toMatchObject({ latestVersion: 2, enabled: true });
  });

  it('input tidak sah ditolak: tanpa frontmatter, non-anggota', async () => {
    expect(
      (await callFn('importSkills', { skills: [{ files: { 'SKILL.md': '# tanpa frontmatter' } }] }, admin)).ok,
    ).toBe(false);
    const luar = await idTokenFor('uid-luar');
    expect((await callFn('importSkills', { skills: [{ files: { 'SKILL.md': md('x', 'y', 'z') } }] }, luar)).ok).toBe(
      false,
    );
  });

  it('aktif/nonaktif & hapus hanya admin; edit SKILL.md oleh anggota → versi baru, file pendukung dibawa', async () => {
    expect((await callFn('setSkillEnabled', { slug: 'ui-review', enabled: true }, member)).ok).toBe(false);
    const saved = await callFn<{ version: number }>(
      'saveSkillVersion',
      { slug: 'sql-review', content: md('sql-review', 'Cek query SQL', 'SKILL-SQL v3: cari N+1.'), message: 'Rapikan' },
      member,
    );
    expect(saved.ok, JSON.stringify(saved.error)).toBe(true);
    expect(saved.result!.version).toBe(3);
    expect((await h.db.doc('skills/sql-review/versions/3').get()).get('files')['references/contoh.md']).toBe(
      'contoh query',
    );
    expect(
      (await callFn('saveSkillVersion', { slug: 'sql-review', content: 'tanpa frontmatter', message: 'abc' }, member))
        .ok,
    ).toBe(false);
  });

  it('review memakai skill aktif yang dipin ke job; skill nonaktif tidak masuk prompt', async () => {
    await h.comment('lapor @chefjuno');
    const q = await h.waitJob((j) => j.type === 'review' && j.status === 'queued');
    expect(q.data.skillVersions).toEqual([{ slug: 'sql-review', version: 3 }]);
    await h.startMachine({ agents: ['claude'] });
    await h.waitJob((j) => j.type === 'review' && j.status === 'posted');
    // putaran review (bukan triase/validator) memuat skill tim
    const rec = readdirSync(h.recordDir)
      .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
      .find((r) => String(r.system).includes('Fokus putaran ini: correctness'));
    expect(rec.system).toContain('# Skill tim');
    expect(rec.system).toContain('SKILL-SQL v3: cari N+1.');
    expect(rec.system).toContain('### File: references/contoh.md');
    expect(rec.system).not.toContain('SKILL-UI');
    // instruksi atribusi ada di kepala bagian skill (berlaku walau prompt inti tim tidak diperbarui)
    expect(rec.system).toContain('isi field `skill` dengan slug skill itu');
  });

  it('atribusi skill: temuan menyimpan slug skill yang dimuat; slug yang tidak dimuat (karangan agent) dibuang', async () => {
    const jobs = (await h.db.collection('jobs').where('status', '==', 'posted').get()).docs;
    const job = jobs.find((d) => (d.get('result.meta.skillsLoaded') as string[] | undefined)?.includes('sql-review'))!;
    const result = job.get('result') as { findings: { title: string; skill: string }[] };
    // agent palsu: temuan pertama memakai skill pertama di prompt, temuan "Nama variabel" menyebut slug karangan
    expect(result.findings.find((f) => f.title === 'Hasil fetchUser tidak dicek null')?.skill).toBe('sql-review');
    expect(result.findings.find((f) => f.title === 'Nama variabel terlalu umum')?.skill).toBe('');
    const docs = (await h.db.collection('findings').where('jobId', '==', job.id).get()).docs.map((d) => d.data());
    expect(docs.find((f) => f.title === 'Hasil fetchUser tidak dicek null')?.skill).toBe('sql-review');
    expect(docs.every((f) => f.skill !== 'skill-karangan')).toBe(true);
  });

  it('skill dengan paths (mis. **/*.dart) dipin ke job tapi tidak dimuat untuk PR tanpa file yang cocok', async () => {
    const imp = await callFn(
      'importSkills',
      {
        skills: [
          {
            files: {
              'SKILL.md':
                '---\nname: flutter-only\ndescription: Khusus Dart\npaths:\n  - "**/*.dart"\n---\n\nSKILL-FLUTTER: cek mounted.\n',
            },
          },
        ],
      },
      admin,
    );
    expect(imp.ok, JSON.stringify(imp.error)).toBe(true);
    const before = readdirSync(h.recordDir).length;
    await h.comment('lapor @chefjuno');
    await h.waitFor(
      async () =>
        readdirSync(h.recordDir).length > before &&
        (await h.db.collection('jobs').where('status', '==', 'posted').get()).size === 2,
      45_000,
      'review kedua',
    );
    const jobs = (await h.db.collection('jobs').where('status', '==', 'posted').get()).docs.map((d) => d.data());
    const second = jobs.find((j) => (j.skillVersions as { slug: string }[]).some((x) => x.slug === 'flutter-only'))!;
    expect(second.result.meta.skillsSkipped).toEqual(['flutter-only']);
    expect(second.result.meta.skillsLoaded).toEqual(['sql-review']);
    const recs = readdirSync(h.recordDir)
      .map((f) => JSON.parse(readFileSync(join(h.recordDir, f), 'utf8')))
      .filter((r) => String(r.prompt).includes('# PR #1'))
      // putaran review correctness (bukan triase/validator/reviewer akhir)
      .filter((r) => String(r.system).includes('Fokus putaran ini: correctness'))
      .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    expect(recs.at(-1).system).toContain('SKILL-SQL v3');
    expect(recs.at(-1).system).not.toContain('SKILL-FLUTTER');
  });

  it('admin menghapus skill', async () => {
    const r = await callFn('deleteSkill', { slug: 'ui-review' }, admin);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await h.db.doc('skills/ui-review').get()).exists).toBe(false);
    expect((await h.db.collection('skills/ui-review/versions').get()).size).toBe(0);
  });
});
