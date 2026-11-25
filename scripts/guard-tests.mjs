#!/usr/bin/env node
// Penjaga kejujuran test. Milik pemilik repo — agent dilarang mengubah file ini.
// Gagal (exit 1) kalau:
//  - ada test yang di-skip / fokus / todo, atau pengecekan dimatikan di file test
//  - script npm menyembunyikan kegagalan (`|| true`, `--passWithNoTests`, `exit 0`)
//  - config vitest/playwright mengecualikan file test lewat `exclude`/`testIgnore` yang mencurigakan
//  - script `verify` di root tidak menjalankan penjaga ini lebih dulu
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['apps', 'packages', 'e2e', 'tests', 'scripts'];
// Hanya folder hasil build/dependency yang dilewati. Nama seperti `lib` di dalam `src/` TETAP diperiksa.
const IGNORE_NAMES = new Set(['node_modules', '.angular', '.firebase', 'coverage', '.git', 'playwright-report', 'test-results']);
const IGNORE_PATHS = new Set(['apps/functions/lib', 'apps/web/dist', 'apps/daemon/dist', 'packages/shared/dist']);
const CODE_EXT = /\.(m|c)?[jt]sx?$/;
const TEST_FILE = /(\.|\/)(test|spec|e2e)\.(m|c)?[jt]sx?$|\/(test|tests|__tests__|e2e)\/.*\.(m|c)?[jt]sx?$/;

const RULES = [
  { re: /\b(describe|it|test|suite|context|bench)(\s*\.\s*\w+)*\s*\.\s*(skip|only|todo|skipIf|runIf|fails)\b/, why: 'test di-skip/fokus/todo' },
  { re: /\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/, why: 'test di-skip/fokus (x*/f*)' },
  { re: /\b(ctx|context|t|task)\s*\.\s*skip\s*\(/, why: 'skip dari dalam test (ctx.skip)' },
  { re: /\btest\.fixme\b|\btest\.describe\.(skip|only|fixme)\b/, why: 'Playwright skip/fixme/only' },
  { re: /@ts-nocheck/, why: '@ts-nocheck di file test' },
  { re: /eslint-disable(?!-next-line|-line)/, why: 'eslint-disable seluruh file test' },
];

const findings = [];
const rel = (f) => relative(ROOT, f).split('\\').join('/');

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORE_NAMES.has(name)) continue;
    const full = join(dir, name);
    if (IGNORE_PATHS.has(rel(full))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else checkFile(full);
  }
}

function checkFile(file) {
  const r = rel(file);
  if (r === 'scripts/guard-tests.mjs') return;
  const base = r.split('/').pop();
  if (/^(vitest|vite|playwright|karma)\.config\./.test(base) || /^vitest\.workspace\./.test(base)) checkTestConfig(file, r);
  if (base === 'package.json') checkPackageJson(file, r);
  if (!CODE_EXT.test(r) || !TEST_FILE.test('/' + r)) return;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const { re, why } of RULES) {
        if (re.test(line)) findings.push(`${r}:${i + 1}  ${why}\n    ${line.trim()}`);
      }
    });
}

function checkTestConfig(file, r) {
  const src = readFileSync(file, 'utf8');
  // exclude/testIgnore yang menyebut file test (.test./.spec./e2e) dianggap menyembunyikan test.
  const m = src.match(/(exclude|testIgnore)\s*:\s*\[([^\]]*)\]/g) || [];
  for (const block of m) {
    if (/\.(test|spec)\.|\/(test|tests|e2e|__tests__)\//.test(block) && !/node_modules|dist|lib\/|\.angular/.test(block.replace(/['"][^'"]*(test|spec)[^'"]*['"]/g, ''))) {
      findings.push(`${r}  config mengecualikan file test: ${block.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  if (/passWithNoTests\s*:\s*true/.test(src)) findings.push(`${r}  passWithNoTests: true di config`);
}

function checkPackageJson(file, r) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    findings.push(`${r}  package.json tidak valid`);
    return;
  }
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    if (!/test|verify|e2e|demo|lint|typecheck|check/.test(name)) continue;
    if (/\|\|\s*(true|exit 0|:)\b|;\s*exit 0\b|--passWithNoTests|--pass-with-no-tests/.test(cmd)) {
      findings.push(`${r}  script "${name}" menyembunyikan kegagalan: ${cmd}`);
    }
  }
}

function checkVerifyRunsGuard() {
  const p = join(ROOT, 'package.json');
  if (!existsSync(p)) return; // sebelum Fase 0 belum ada package.json
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return;
  }
  checkPackageJson(p, 'package.json');
  const verify = pkg.scripts?.verify;
  if (!verify) {
    findings.push('package.json  script "verify" belum ada');
    return;
  }
  const first = verify.split(/&&|;/)[0].trim();
  if (!/node\s+(\.\/)?scripts\/guard-tests\.mjs$/.test(first) && !/^npm run guard$/.test(first)) {
    findings.push(`package.json  "verify" harus diawali "node scripts/guard-tests.mjs", sekarang: ${verify}`);
  }
  if (/^npm run guard$/.test(first) && !/^node\s+(\.\/)?scripts\/guard-tests\.mjs$/.test((pkg.scripts.guard || '').trim())) {
    findings.push(`package.json  script "guard" harus tepat "node scripts/guard-tests.mjs"`);
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d));
checkVerifyRunsGuard();

if (findings.length) {
  console.error(`❌ guard-tests: ${findings.length} pelanggaran kejujuran test:\n`);
  console.error(findings.join('\n'));
  console.error('\nPerbaiki test/config-nya, atau biarkan gagal dan catat di docs/PROGRESS.md. Jangan disembunyikan.');
  process.exit(1);
}
console.log('✅ guard-tests: tidak ada test yang di-skip/fokus/todo atau kegagalan yang disembunyikan.');
