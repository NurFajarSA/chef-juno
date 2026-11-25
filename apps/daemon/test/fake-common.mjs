// Bagian bersama fake-claude & fake-codex. Tidak pernah memanggil model sungguhan.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Ambil daftar flag (dan apakah butuh nilai) dari file help asli yang direkam. */
export function flagsFromHelp(file) {
  const flags = new Map();
  for (const line of readFileSync(join(HERE, 'fixtures', file), 'utf8').split('\n')) {
    if (!/^\s+-/.test(line)) continue;
    const head = line.trim().split(/\s{2,}/)[0];
    const takes = /[<[]/.test(head);
    for (const m of head.matchAll(/(--?[A-Za-z][\w-]*)/g)) flags.set(m[1], takes);
  }
  return flags;
}

export function validateArgs(args, flags) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' || !a.startsWith('-')) continue;
    const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (!flags.has(name)) {
      process.stderr.write(`error: unknown option '${name}'\n`);
      process.exit(2);
    }
    if (flags.get(name) && !a.includes('=')) i++;
  }
}

export function argValue(args, ...names) {
  for (let i = 0; i < args.length; i++) if (names.includes(args[i])) return args[i + 1];
  return undefined;
}

export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function record(agent, data) {
  const dir = process.env.FAKE_AGENT_RECORD_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const name = `${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
  writeFileSync(
    join(dir, name),
    JSON.stringify({ agent, at: new Date().toISOString(), cwd: process.cwd(), ...data }, null, 2),
  );
}

function diffFiles(prompt) {
  const m = /```diff\n([\s\S]*?)\n```/.exec(prompt);
  const files = [];
  if (!m) return files;
  let cur = null;
  let line = 0;
  for (const l of m[1].split('\n')) {
    if (l.startsWith('+++ ')) {
      const p = l.slice(4).trim();
      cur = p === '/dev/null' ? null : { path: p.replace(/^b\//, ''), added: [] };
      if (cur) files.push(cur);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('+')) cur.added.push(line++);
    else if (l.startsWith(' ')) line++;
  }
  return files.filter((f) => f.added.length);
}

function f(path, line, severity, category, title, extra = {}) {
  return {
    path,
    line,
    startLine: null,
    severity,
    category,
    title,
    what: `${title}.`,
    why: 'Kalau dibiarkan, perilaku di produksi tidak bisa ditebak.',
    fix: 'Tangani kasus ini secara eksplisit sebelum dipakai.',
    suggestion: null,
    confidence: 0.9,
    trigger: '',
    skill: '',
    ...extra,
  };
}

export function reviewOutput(prompt, system = '') {
  const files = diffFiles(prompt);
  // atribusi skill: temuan pertama memakai skill pertama yang ada di prompt; satu temuan menyebut slug karangan
  // (harus dibuang mesin karena tidak dimuat)
  const firstSkill = /^## Skill: .+ \(`([^`]+)`\)$/m.exec(`${system}\n${prompt}`)?.[1] ?? '';
  const findings = [];
  if (files.length) {
    const a = files[0];
    findings.push(
      f(a.path, a.added[0], 'P1', 'bug', 'Hasil fetchUser tidak dicek null', {
        suggestion: 'if (!user) return null;',
        skill: firstSkill,
      }),
    );
    findings.push(
      f(
        a.path,
        a.added[a.added.length > 1 ? 1 : 0],
        'P1',
        'security',
        'Hasil fetchUser tidak dicek null sebelum dipakai untuk token',
      ),
    );
    const b = files[1] ?? a;
    findings.push(
      f(b.path, b.added[b.added.length - 1], 'P2', 'maintainability', 'Nama variabel terlalu umum', {
        skill: 'skill-karangan',
      }),
    );
    findings.push(f(a.path, 9999, 'P2', 'test', 'Jalur error belum punya test'));
  }
  // deskripsi PR berisi FAKE_LOW_CONF → semua temuan berkeyakinan rendah (penanda ikut ke prompt validator)
  if (String(prompt).includes('FAKE_LOW_CONF'))
    for (const x of findings) Object.assign(x, { confidence: 0.5, what: `${x.what} FAKE_LOW_CONF` });
  const leak = process.env.FAKE_AGENT_LEAK ? ` ${process.env.FAKE_AGENT_LEAK}` : '';
  return {
    score: findings.length ? 3 : 5,
    verdict: findings.length ? 'Belum layak merge. Null-check bolong.' : 'Bersih. Merge.',
    summary: `PR ini mengubah ${files.length} file.${leak}`,
    lessons: ['Nilai yang bisa null harus dicek sebelum dipakai, bukan diasumsikan ada.'],
    findings,
    reviewCompletion: 'complete',
    uncertainty: '',
  };
}

export function moduleOutput(prompt) {
  const ids = [...prompt.matchAll(/^MODULE_ID: (.+)$/gm)].map((m) => m[1].trim());
  const leak = process.env.FAKE_AGENT_LEAK ? ` ${process.env.FAKE_AGENT_LEAK}` : '';
  return {
    modules: ids.map((id) => ({
      id,
      summary: `Modul \`${id}\`: ringkasan otomatis (fake agent).${leak}`,
      patterns: ['Ekspor lewat index'],
    })),
  };
}

export function learnOutput(prompt) {
  const m = /```json\n([\s\S]*?)\n```/.exec(prompt);
  let items;
  try {
    items = JSON.parse(m?.[1] ?? '[]');
  } catch {
    items = [];
  }
  const disputed = items.filter((x) => x.outcome === 'disputed' && x.category !== 'security' && x.severity !== 'P0');
  const rules = [];
  if (disputed[0]) {
    const d = disputed[0];
    rules.push({
      text: `Di repo ini, ${d.title.toLowerCase()} tidak perlu dilaporkan kalau sudah dijaga guard (alasan tim: ${d.reason ?? 'dibantah'}).`,
      kind: 'rule',
      category: d.category,
      paths: [],
      matchTitle: null,
      evidence: [d.id],
    });
    rules.push({
      text: `Tekan temuan mirip: "${d.title}".`,
      kind: 'suppression',
      category: d.category,
      paths: [],
      matchTitle: d.title,
      evidence: [d.id],
    });
  }
  const personalLessons = [disputed[0] ?? items[0]]
    .filter((x) => x?.authorLogin)
    .map((x) => ({
      login: x.authorLogin,
      key: `${x.category}:${x.title.toLowerCase().slice(0, 30)}`,
      title: x.title,
      category: x.category,
      lesson: 'Cek null sebelum dipakai.',
    }));
  return { rules, personalLessons };
}

/** Triase palsu: semua putaran (supaya test mode mendalam menguji fan-out penuh). */
export function triageOutput() {
  return {
    prType: 'code',
    depth: 'deep',
    lenses: ['correctness', 'security', 'platform', 'rules'],
    reason: 'fake: PR berisiko, semua putaran',
  };
}

/** Validator palsu deterministik: temuan berpenanda FAKE_INVALID dianggap tidak nyata (untuk menguji temuan dibuang). */
export function validateOutput(prompt) {
  const f = prompt.split('# Temuan yang divalidasi').at(-1) ?? '';
  const invalid = f.includes('FAKE_INVALID');
  return {
    valid: !invalid,
    confidence: invalid ? 0.2 : f.includes('FAKE_LOW_CONF') ? 0.6 : 0.97,
    reason: invalid ? 'fake: sudah dicek di pemanggil' : 'fake: jalur terbukti',
  };
}

/** Reviewer akhir palsu: pertahankan semua temuan bernomor, tulis ulang `what`, isi dampak/walkthrough/diagram/usaha. */
export function leadOutput(prompt) {
  const keep = [...prompt.matchAll(/^## \[(\d+)\]/gm)].map((m) => Number(m[1]));
  const files = [...prompt.matchAll(/^- (\S+?)(?: \(\+\d+ −\d+\))?$/gm)].map((m) => m[1]);
  return {
    keep,
    rewrites: keep.map((index) => {
      const block = prompt.split(`## [${index}]`)[1] ?? '';
      const what = /^Masalah: (.*)$/m.exec(block)?.[1] ?? '';
      return { index, title: '', what: `${what} (ditulis ulang reviewer akhir)`, why: '', fix: '' };
    }),
    score: keep.length ? 3 : 5,
    verdict: keep.length ? 'Belum layak merge. Null-check bolong.' : 'Bersih. Merge.',
    summary: 'fake reviewer akhir: ringkasan PR.',
    lessons: ['Nilai yang bisa null harus dicek sebelum dipakai.'],
    reviewCompletion: 'complete',
    uncertainty: '',
    impact: 'sedang',
    diagram: 'flowchart TD\n  A[Permintaan] --> B[Cache]\n  B --> C[Respons]',
    walkthrough: [{ area: 'Layanan pengguna', files: files.slice(0, 3), change: 'fake: menambah opsi cache.' }],
    effortMinutes: 12,
  };
}

/** PNG 1×1 untuk screenshot palsu penguji. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Penguji aplikasi palsu (agent): "membuka" app, menyimpan screenshot ke folder yang diminta, melapor + 1 pelajaran. */
export function appAgentOutput(prompt, system = '') {
  // PR berisi FAKE_APP_SKIP_CHANGE → penguji melewatkan alur yang diubah, kecuali setelah ditegur
  if (String(prompt).includes('FAKE_APP_SKIP_CHANGE') && !String(system).includes('PERHATIAN: percobaan sebelumnya'))
    return {
      change: { status: 'inconclusive', note: 'fake: hanya mencoba temuan', shots: [] },
      findings: [],
      skipped: [],
      lessons: [],
    };
  const dir = /## Simpan screenshot ke\n(.+)/.exec(String(prompt))?.[1]?.trim();
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'alur.png'), TINY_PNG);
    writeFileSync(join(dir, 'temuan-1.png'), TINY_PNG);
  }
  const hasFinding = /^### Temuan 1:/m.test(String(prompt));
  return {
    change: { status: 'not_reproduced', note: 'fake: alur yang diubah berjalan normal', shots: ['alur.png'] },
    findings: hasFinding
      ? [{ item: 1, status: 'reproduced', note: 'fake: masalah terlihat', shots: ['temuan-1.png'] }]
      : [],
    skipped: [],
    lessons: ['Akun uji harus premium supaya kuis dan laporan terbuka (fake).'],
  };
}

export function outputFor(schema, prompt, system = '') {
  const props = Object.keys(schema?.properties ?? {});
  if (props.includes('lenses')) return triageOutput();
  if (props.includes('lessons') && props.includes('change')) return appAgentOutput(prompt, system);
  if (props.includes('scenarios')) return appPlanOutput(prompt);
  if (props.includes('verdicts')) return appJudgeOutput(prompt);
  if (props.includes('valid')) return validateOutput(prompt);
  if (props.includes('keep')) return leadOutput(prompt);
  if (props.includes('score')) return reviewOutput(prompt, system);
  if (props.includes('modules')) return moduleOutput(prompt);
  if (props.includes('rules')) return learnOutput(prompt);
  return { narrative: 'Minggu ini null-check membaik. Yang berulang masih sama: test jalur error. Perbaiki.' };
}

const temuanNumbers = (prompt) => [...String(prompt).matchAll(/^### Temuan (\d+):/gm)].map((m) => Number(m[1]));

/** Perencana uji aplikasi palsu: temuan 1 dicoba (buka keranjang, tambah, screenshot), sisanya dilewati. */
export function appPlanOutput(prompt) {
  const ns = temuanNumbers(prompt);
  const step = (o) => ({
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
  // item "Alur yang diubah PR" (selalu terakhir) dicoba: buka beranda, screenshot, pastikan tidak ada "NaN"
  const changeN = /^### Temuan (\d+): \[P\d\] Alur yang diubah PR/m.exec(String(prompt))?.[1];
  const findingNs = ns.filter((n) => String(n) !== changeN);
  return {
    scenarios: [
      ...findingNs.slice(0, 1).map((n) => ({
        finding: n,
        goal: 'fake: buka keranjang, tambah item, lihat total',
        steps: [
          step({ do: 'goto', path: '/keranjang' }),
          step({ do: 'click', role: 'button', name: 'Tambah buku' }),
          step({ do: 'screenshot', shot: 'bukti' }),
          step({ do: 'expectNoText', text: 'NaN' }),
        ],
      })),
      ...(changeN
        ? [
            {
              finding: Number(changeN),
              goal: 'fake: buka beranda yang diubah PR',
              steps: [
                step({ do: 'goto', path: '/' }),
                step({ do: 'screenshot', shot: 'alur' }),
                step({ do: 'expectNoText', text: 'NaN' }),
              ],
            },
          ]
        : []),
    ],
    skipped: findingNs.slice(1).map((n) => ({ finding: n, reason: 'fake: tidak bisa dicoba lewat UI' })),
  };
}

/** Penilai palsu: skenario dengan langkah gagal "teks ... terlihat" dianggap terbukti. */
export function appJudgeOutput(prompt) {
  const parts = String(prompt)
    .split(/^### Temuan /m)
    .slice(1);
  return {
    verdicts: parts.map((p) => {
      const n = Number(p.split(':')[0]);
      const reproduced = /GAGAL: teks "NaN" terlihat/.test(p);
      // alur yang diubah PR: semua langkah ok → berjalan normal
      if (/Alur yang diubah PR/.test(p.split('\n')[0]) && !reproduced && !/→ GAGAL/.test(p))
        return { finding: n, status: 'not_reproduced', note: 'fake: beranda tampil normal', shot: 'alur' };
      return {
        finding: n,
        status: reproduced ? 'reproduced' : 'inconclusive',
        note: reproduced ? 'fake: total tampil "Rp NaN" setelah tambah item' : 'fake: tidak jelas',
        shot: reproduced ? 'bukti' : '',
      };
    }),
  };
}
