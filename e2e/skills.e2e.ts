import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { db, importGithubUser, loginAs, resetEmulators } from './support.js';
import { seedBase } from '../scripts/seed-data.mjs';

const md = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;

test.beforeEach(async () => {
  await resetEmulators();
  await seedBase(db);
  await importGithubUser('uid-admin1', '1001', 'admin1');
});

test('Skills (editor): import massal .md + .zip → pratinjau → aktif; pohon file; file pendukung hanya-baca; edit SKILL.md → versi baru', async ({
  page,
}) => {
  await loginAs(page, 'uid-admin1');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.getByTestId('skills-core')).toContainText('Instruksi review');

  const zip = zipSync({
    'skills/sql-review/SKILL.md': strToU8(md('sql-review', 'Cek query SQL', 'Cari N+1 dan injeksi.')),
    'skills/sql-review/references/contoh.md': strToU8('# Contoh\nquery buruk'),
    'skills/rusak/SKILL.md': strToU8('# tanpa frontmatter'),
  });
  await page.getByTestId('skills-import').click();
  await page.getByTestId('skills-file-input').setInputFiles([
    {
      name: 'angular.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(md('Angular Signals', 'Pakai signal', 'Gunakan computed().')),
    },
    { name: 'bundle.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
  ]);
  const preview = page.getByTestId('skills-preview');
  await expect(preview).toContainText('angular-signals/');
  await expect(preview).toContainText('sql-review/');
  await expect(page.getByTestId('skills-preview-errors')).toContainText('frontmatter');
  await page.getByTestId('skills-import-submit').click();
  await expect(page.getByTestId('skills-import-result')).toContainText('2 skill baru');
  await page.getByRole('button', { name: 'Selesai' }).click();

  const list = page.getByTestId('skills-list');
  await expect(list.locator('[data-skill="sql-review"]')).toContainText('2 file');
  expect((await db.doc('skills/sql-review').get()).get('enabled')).toBe(true); // diimport admin → aktif

  // admin menonaktifkan lewat switch di explorer
  await page.getByTestId('skill-toggle-angular-signals').click();
  await expect(page.getByText('Skill dinonaktifkan.')).toBeVisible();
  await expect.poll(async () => (await db.doc('skills/angular-signals').get()).get('enabled')).toBe(false);

  // buka folder skill → SKILL.md terbuka di tab; pohon file memuat folder references
  await list.getByRole('button', { name: 'Buka skill sql-review' }).click();
  await expect(page).toHaveURL(/f=skills%2Fsql-review%2FSKILL\.md/);
  const tree = page.locator('[data-tree="sql-review"]');
  await expect(tree).toContainText('SKILL.md');
  await expect(tree).toContainText('references');
  await tree.getByRole('button', { name: 'contoh.md' }).click();
  const editor = page.getByTestId('skill-editor');
  await expect(editor).toHaveValue(/query buruk/);
  await expect(editor).not.toBeEditable();
  await expect(page.getByText('File pendukung hanya-baca')).toBeVisible();

  await tree.getByRole('button', { name: 'SKILL.md' }).click();
  await expect(editor).toHaveValue(/Cari N\+1 dan injeksi/);
  await editor.fill(md('sql-review', 'Cek query SQL', 'Cari N+1, injeksi, dan index yang hilang.'));
  await page.getByTestId('skill-save').click();
  await expect(page.getByText('Pesan perubahan minimal 3 karakter')).toBeVisible();
  await page.getByTestId('skill-message').fill('Tambah cek index');
  await page.getByTestId('skill-save').click();
  await expect(page.getByText('Versi v2 tersimpan.')).toBeVisible();
  const v2 = (await db.doc('skills/sql-review/versions/2').get()).data()!;
  expect(v2.files['SKILL.md']).toContain('index yang hilang');
  expect(v2.files['references/contoh.md']).toContain('query buruk');
});

test('Skills (editor): tanpa skill bawaan; skill tim dikelompokkan menurut kategori', async ({ page }) => {
  await db.doc('skills/flutter-tim').set({
    name: 'flutter-tim',
    description: 'Konvensi widget tim.',
    paths: ['**/*.dart'],
    category: 'domain',
    enabled: true,
    latestVersion: 1,
    fileCount: 1,
    source: 'import',
  });
  await db.doc('skills/flutter-tim/versions/1').set({
    version: 1,
    files: {
      'SKILL.md': '---\nname: flutter-tim\ndescription: Konvensi widget tim.\ncategory: domain\n---\n\n# Isi\n',
    },
    message: 'Impor',
    authorUid: 'uid-admin1',
    authorLogin: 'admin1',
    parentVersion: null,
  });
  await loginAs(page, 'uid-admin1');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.getByTestId('skills-group-domain')).toContainText('SKILL DOMAIN');
  await expect(page.getByTestId('skills-list').locator('[data-skill="flutter-tim"]')).toBeVisible();
  // tidak ada skill bawaan untuk dipulihkan: kelompok inti kosong, tombol pulihkan hilang
  await expect(page.getByTestId('skills-group-inti')).toHaveCount(0);
  await expect(page.getByTestId('skills-restore')).toHaveCount(0);
});
