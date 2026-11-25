// Bundel prompts/seed/*.md → packages/shared/src/prompts/defaults.ts (dipakai setupWorkspace di Functions).
// Jalankan ulang setelah mengubah prompts/seed: node scripts/gen-default-prompts.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = new URL('../', import.meta.url);
const read = (k) => readFileSync(new URL(`prompts/seed/${k}.md`, ROOT), 'utf8');
const out = `// FILE DIBUAT OTOMATIS oleh scripts/gen-default-prompts.mjs dari prompts/seed/*.md — jangan diedit manual.
// Test packages/shared/src/prompts/defaults.test.ts memastikan isinya sama dengan file .md.

export const DEFAULT_PROMPTS = {
  persona: {
    title: 'Persona Chef Juno',
    description: 'Karakter dan gaya bicara reviewer',
    content: ${JSON.stringify(read('persona'))},
  },
  review: {
    title: 'Instruksi review',
    description: 'Cara mereview PR dan format temuan',
    content: ${JSON.stringify(read('review'))},
  },
} as const;
`;
writeFileSync(new URL('packages/shared/src/prompts/defaults.ts', ROOT), out);

// Skill bawaan: semua file teks di skills/<slug>/** (README.md di root skills/ bukan skill)
const skillsDir = fileURLToPath(new URL('skills/', ROOT));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ path: relative(skillsDir, p).split('\\').join('/'), content: readFileSync(p, 'utf8') });
  }
};
for (const d of readdirSync(skillsDir).sort()) if (statSync(join(skillsDir, d)).isDirectory()) walk(join(skillsDir, d));
const skillsOut = `// FILE DIBUAT OTOMATIS oleh scripts/gen-default-prompts.mjs dari skills/** — jangan diedit manual.
// Test packages/shared/src/prompts/defaults.test.ts memastikan isinya sama dengan folder skills/.

export const DEFAULT_SKILL_FILES: { path: string; content: string }[] = ${JSON.stringify(files, null, 2)};
`;
writeFileSync(new URL('packages/shared/src/prompts/default-skills.ts', ROOT), skillsOut);
console.log(`defaults.ts & default-skills.ts diperbarui (${files.length} file skill)`);
