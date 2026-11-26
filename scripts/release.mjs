#!/usr/bin/env node
// Rilis Chef Juno ke satu deployment (jalankan setelah `firebase deploy` untuk commit yang sama):
//   1. commit harus ada di origin/main dan semua check CI-nya hijau;
//   2. prompt bawaan (prompts/seed/*.md di commit itu) → registry prompt. Prompt yang dipakai tim apa adanya (versi
//      aktif bertanda `source: 'bawaan'`) langsung pindah ke bawaan baru; prompt yang sudah diubah tim TIDAK ditimpa —
//      bawaan baru disimpan sebagai versi yang belum aktif, tim memutuskan di halaman Skills;
//   3. `releases/daemon.commit` → semua mesin menyelesaikan job, memperbarui diri ke commit itu, lalu menyala ulang.
//
//   node scripts/release.mjs --project <firebase-project> [--database <id>] [--commit <sha>] [--dry-run]
//
// Butuh `gcloud auth print-access-token` (akses Firestore project itu) dan `gh` (cek CI).
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    database: { type: 'string', default: '(default)' },
    commit: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'skip-ci': { type: 'boolean' },
  },
});
if (!values.project) {
  console.error(
    'Pakai: node scripts/release.mjs --project <firebase-project> [--database <id>] [--commit <sha>] [--dry-run]',
  );
  process.exit(2);
}
const dry = !!values['dry-run'];
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

// 1) commit + CI
sh('git', ['fetch', '--quiet', 'origin', 'main']);
const commit = sh('git', ['rev-parse', `${values.commit ?? 'origin/main'}^{commit}`]);
try {
  sh('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
} catch {
  fail(`${commit.slice(0, 7)} tidak ada di origin/main — hanya commit main yang boleh dirilis.`);
}
const subject = sh('git', ['log', '-1', '--format=%s', commit]);
if (!values['skip-ci']) {
  const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  const runs = JSON.parse(sh('gh', ['api', `repos/${repo}/commits/${commit}/check-runs`, '-q', '.check_runs']));
  const bad = runs.filter((r) => r.status !== 'completed' || !['success', 'skipped', 'neutral'].includes(r.conclusion));
  if (!runs.length || bad.length)
    fail(
      `CI ${commit.slice(0, 7)} belum hijau: ${runs.length ? bad.map((r) => `${r.name}=${r.conclusion ?? r.status}`).join(', ') : 'tidak ada check'}`,
    );
}
console.log(`Rilis ${commit.slice(0, 7)} — ${subject}${dry ? ' (dry-run)' : ''}`);

// Firestore REST
const token = dry ? '' : sh('gcloud', ['auth', 'print-access-token']);
const base = `projects/${values.project}/databases/${values.database}/documents`;
const api = async (method, path, body) => {
  const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok)
    fail(`${method} ${path.split('/documents')[1] ?? path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });
const now = () => ({ timestampValue: new Date().toISOString() });
const str = (d, k) => d?.fields?.[k]?.stringValue;
const int = (d, k) => Number(d?.fields?.[k]?.integerValue ?? 0);

// 2) prompt bawaan dari commit rilis (bukan dari working tree)
const { PROMPT_META } = await import('./prompt-meta.mjs');
const seed = (k) => execFileSync('git', ['show', `${commit}:prompts/seed/${k}.md`], { encoding: 'utf8' });
for (const [key, title, description] of PROMPT_META) {
  const content = seed(key);
  if (dry) {
    console.log(`  · ${key}: ${content.length} karakter`);
    continue;
  }
  const doc = await api('GET', `${base}/prompts/${key}`);
  const version = (v, parent) => ({
    update: {
      name: `${base}/prompts/${key}/versions/${v}`,
      fields: {
        version: I(v),
        content: S(content),
        message: S(`Bawaan Chef Juno ${commit.slice(0, 7)}`),
        source: S('bawaan'),
        authorUid: { nullValue: null },
        authorLogin: S('chefjuno-release'),
        parentVersion: parent ? I(parent) : { nullValue: null },
        createdAt: now(),
      },
    },
    currentDocument: { exists: false },
  });
  if (!doc) {
    await api('POST', `${base}:commit`, {
      writes: [
        {
          update: {
            name: `${base}/prompts/${key}`,
            fields: {
              title: S(title),
              description: S(description),
              activeVersion: I(1),
              latestVersion: I(1),
              updatedAt: now(),
              updatedBy: S('chefjuno-release'),
            },
          },
          currentDocument: { exists: false },
        },
        version(1, null),
      ],
    });
    console.log(`  + ${key}: v1 (bawaan, aktif)`);
    continue;
  }
  const latest = int(doc, 'latestVersion');
  const active = int(doc, 'activeVersion') || latest;
  const latestDoc = await api('GET', `${base}/prompts/${key}/versions/${latest}`);
  if (str(latestDoc, 'content') === content) {
    console.log(`  = ${key}: v${latest} sudah bawaan terbaru${active !== latest ? ` (aktif v${active})` : ''}`);
    continue;
  }
  const activeDoc = active === latest ? latestDoc : await api('GET', `${base}/prompts/${key}/versions/${active}`);
  const teamUsesDefault = str(activeDoc, 'source') === 'bawaan';
  const v = latest + 1;
  await api('POST', `${base}:commit`, {
    writes: [
      version(v, latest),
      {
        update: {
          name: `${base}/prompts/${key}`,
          fields: {
            latestVersion: I(v),
            activeVersion: I(teamUsesDefault ? v : active),
            updatedAt: now(),
            updatedBy: S('chefjuno-release'),
          },
        },
        updateMask: { fieldPaths: ['latestVersion', 'activeVersion', 'updatedAt', 'updatedBy'] },
        currentDocument: { updateTime: doc.updateTime },
      },
    ],
  });
  console.log(
    teamUsesDefault
      ? `  ↑ ${key}: v${v} bawaan baru, aktif`
      : `  ! ${key}: v${v} bawaan baru disimpan TIDAK aktif — tim memakai v${active} buatan sendiri (bandingkan di Skills)`,
  );
}

// 3) rilis daemon
if (!dry) {
  await api('PATCH', `${base}/releases/daemon`, {
    fields: { commit: S(commit), subject: S(subject.slice(0, 200)), releasedAt: now() },
  });
  console.log(
    `✓ releases/daemon → ${commit.slice(0, 7)}. Mesin memperbarui diri setelah job yang berjalan selesai (lihat halaman Mesin).`,
  );
}
