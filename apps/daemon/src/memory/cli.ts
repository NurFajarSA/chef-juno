import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCreds } from '../creds.js';
import { connect } from '../fb.js';
import { cfg } from '../env.js';
import { buildMemoryMarkdown, loadActiveRules, loadPerson } from './data.js';

/** `chefjuno memory pull --login <github> [--repo <repoId>]` */
export async function memoryCommand(args: string[]) {
  const [sub, ...rest] = args;
  if (sub !== 'pull') throw new Error('Pakai: chefjuno memory pull --login <github>');
  const { values } = parseArgs({ args: rest, options: { login: { type: 'string' }, repo: { type: 'string' } } });
  if (!values.login) throw new Error('Wajib: --login <github>');
  const creds = loadCreds();
  if (!creds) throw new Error('Belum login. Jalankan: chefjuno login --server <url> --code XXXX-XXXX');
  const s = await connect(creds);
  try {
    const [rules, person] = await Promise.all([loadActiveRules(s.db), loadPerson(s.db, values.login)]);
    const md = buildMemoryMarkdown(values.login, rules, person, values.repo ?? null);
    const dir = join(cfg.home(), 'memory');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${values.login}.md`);
    writeFileSync(file, md);
    console.log(`✅ Memori ditulis ke ${file}`);
    console.log('');
    console.log('Tambahkan baris ini ke CLAUDE.md pribadimu (~/.claude/CLAUDE.md) supaya Claude Code ikut memakainya:');
    console.log(`  @${file}`);
    console.log('Untuk Codex, tambahkan ke ~/.codex/AGENTS.md:');
    console.log(`  Baca dan ikuti ${file} sebelum menulis kode.`);
    console.log('(File konfigurasi pribadimu tidak diubah otomatis.)');
  } finally {
    await s.close();
  }
  process.exit(0);
}
