// Data contoh realistis untuk dashboard, Playwright, dan screenshot (bukan halaman kosong).
// Deterministik: waktu relatif terhadap `now`.
import { Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

// Screenshot asli dari runner uji aplikasi terhadap aplikasi fixture (total keranjang "Rp NaN").
const BUKTI_JPEG = readFileSync(
  new URL('../apps/daemon/test/fixtures/web-app/bukti-contoh.jpg', import.meta.url),
).toString('base64');
const BUKTI = {
  status: 'reproduced',
  note: 'Setelah menambah satu buku, total keranjang tampil "Rp NaN".',
  goal: 'Buka keranjang, tambah satu item, lihat total',
  shots: ['f0-0'],
};

const H = 3600_000;
const D = 24 * H;
const ts = (ms) => Timestamp.fromMillis(ms);

const REPOS = [
  { id: 4242, fullName: 'tim/sample-repo' },
  { id: 5151, fullName: 'tim/dashboard-web' },
];
const PRS = [
  { repo: 0, n: 12, title: 'feat: cache option untuk fetchUser', author: 'dev2', score: 3 },
  { repo: 1, n: 87, title: 'fix: tabel tidak refresh setelah filter', author: 'dev3', score: 4 },
  { repo: 0, n: 13, title: 'refactor: pisah service profil', author: 'dev2', score: 2 },
  { repo: 1, n: 88, title: 'feat: export CSV laporan', author: 'admin1', score: 5 },
  { repo: 0, n: 14, title: 'chore: naikkan versi zod', author: 'dev3', score: 4 },
  { repo: 1, n: 90, title: 'feat: halaman pengaturan notifikasi', author: 'dev2', score: 3 },
];
const FINDINGS = [
  ['P1', 'bug', 'Hasil fetchUser tidak dicek null', 'src/services/profile.ts', 5],
  ['P0', 'security', 'Token disimpan di localStorage', 'src/auth/session.ts', 22],
  ['P2', 'maintainability', 'Nama variabel terlalu umum', 'src/services/profile.ts', 6],
  ['P1', 'performance', 'Query di dalam loop (N+1)', 'src/reports/export.ts', 41],
  ['P2', 'test', 'Jalur error belum punya test', 'src/api/user.ts', 12],
  ['P1', 'bug', 'Promise tidak di-await', 'src/table/filter.ts', 30],
];
const OUTCOMES = ['addressed', 'disputed', 'ignored', 'accepted_by_merge', 'addressed', 'pending'];

export async function seedSample(db, now = Date.now()) {
  const batch = db.batch();
  // skill bawaan asli (isi & paths sungguhan) untuk analitik skills
  // + contoh skill tim dengan `paths` (dimuat hanya untuk file Dart) untuk analitik dimuat/dilewati
  const teamSkill = {
    slug: 'flutter-performance',
    name: 'flutter-performance',
    description: 'Contoh skill tim: performa Flutter (hanya untuk file Dart).',
    paths: ['**/*.dart'],
    category: 'domain',
    files: {
      'SKILL.md':
        '---\nname: flutter-performance\ndescription: Contoh skill tim: performa Flutter (hanya untuk file Dart).\ncategory: domain\npaths:\n  - "**/*.dart"\n---\n\n# Performa Flutter\n- Kerja berat di build().\n',
    },
  };
  for (const sk of [
    ...[
      ['bukti', 'Contoh skill tim: bedakan temuan terukur dari yang disimpulkan.'],
      ['kontrak-dan-dampak', 'Contoh skill tim: kontrak API dan pemanggil lain.'],
      ['sinyal-bukan-noise', 'Contoh skill tim: hanya temuan yang layak waktu manusia.'],
    ].map(([slug, description]) => ({
      slug,
      name: slug,
      description,
      paths: [],
      category: 'inti',
      files: { 'SKILL.md': `---\nname: ${slug}\ndescription: ${description}\ncategory: inti\n---\n\n# ${slug}\n` },
    })),
    teamSkill,
  ]) {
    batch.set(db.doc(`skills/${sk.slug}`), {
      name: sk.name,
      description: sk.description,
      paths: sk.paths,
      category: sk.category ?? null,
      latestVersion: 1,
      fileCount: Object.keys(sk.files).length,
      source: 'import',
      enabled: true,
    });
    batch.set(db.doc(`skills/${sk.slug}/versions/1`), {
      version: 1,
      files: sk.files,
      message: 'Skill bawaan Chef Juno',
      authorUid: 'system',
      authorLogin: 'chefjuno',
      parentVersion: null,
    });
  }
  for (const r of REPOS) {
    batch.set(db.doc(`repos/${r.id}`), {
      fullName: r.fullName,
      installationId: 777,
      private: true,
      enabled: true,
      defaultBranch: 'main',
      // contoh branch knowledge base pilihan admin (kode sedang ditulis ulang di branch lain)
      ...(r.id === 5151 ? { indexBranch: 'rewrite/v2' } : {}),
      updatedAt: ts(now - 2 * H),
      index:
        r.id === 4242
          ? {
              status: 'ready',
              indexedSha: '9f1c2ab7d00e',
              indexedAt: ts(now - 2 * H),
              byMachineId: 'mesin-tim',
              mode: 'full',
              stats: {
                files: 11,
                symbols: 24,
                edges: 31,
                resolvedEdgePct: 0.84,
                languages: { ts: 4, tsx: 2, js: 1, vue: 1, py: 1, go: 1 },
                durationMs: 840,
              },
            }
          : { status: 'indexing' },
    });
  }
  batch.set(db.doc('machines/mesin-tim'), {
    name: 'MacBook Tim',
    ownerUid: 'uid-admin1',
    ownerLogin: 'admin1',
    lastSeenAt: ts(now - 10_000),
    platform: 'darwin-arm64',
    daemonVersion: '0.1.0',
    agents: {
      claude: {
        version: '2.1.323',
        subscription: true,
        isolation: 'safe',
        enabled: true,
        authMethod: 'claude.ai',
        warning: null,
      },
      codex: {
        version: '0.160.1',
        subscription: true,
        isolation: 'read-only',
        enabled: true,
        authMethod: 'chatgpt',
        warning: null,
      },
    },
    concurrency: 1,
    currentJobIds: [],
    revoked: false,
    createdAt: ts(now - 6 * D),
  });
  batch.set(db.doc('machines/mesin-dev3'), {
    name: 'Desktop Dev Tiga',
    ownerUid: 'uid-dev3',
    ownerLogin: 'dev3',
    lastSeenAt: ts(now - 3 * H),
    platform: 'linux-x64',
    daemonVersion: '0.1.0',
    agents: {
      claude: {
        version: '2.1.323',
        subscription: false,
        isolation: 'safe',
        enabled: false,
        authMethod: 'api_key',
        warning: 'Claude Code login dengan api_key, bukan langganan claude.ai — tidak dipakai.',
      },
    },
    concurrency: 1,
    currentJobIds: [],
    revoked: false,
    createdAt: ts(now - 4 * D),
  });
  const MODS = [
    [
      'src/api',
      'Lapisan akses API user. `fetchUser` mengembalikan `null` bila gagal (bukan melempar).',
      ['src/api/user.ts', 'src/api/index.ts'],
      ['fetchUser', 'parseUser', 'User'],
      [],
      ['src/services', 'src/legacy', 'web'],
      3,
      3,
    ],
    [
      'src/services',
      'Logika profil di atas API. `loadProfile` menjaga null sebelum memformat nama.',
      ['src/services/profile.ts'],
      ['loadProfile', 'ProfileService'],
      ['src/api'],
      ['src/components'],
      1,
      4,
    ],
    [
      'src/components',
      'Komponen React tampilan profil (`ProfileCard`, `Avatar`).',
      ['src/components/ProfileCard.tsx', 'src/components/Avatar.tsx'],
      ['ProfileCard', 'Avatar'],
      ['src/services'],
      [],
      2,
      2,
    ],
    [
      'src/legacy',
      'Helper CommonJS lama (`slugify`, `userSlug`).',
      ['src/legacy/helpers.js'],
      ['slugify', 'userSlug'],
      ['src/api'],
      [],
      1,
      2,
    ],
    [
      'web',
      'Komponen Vue `UserBadge` yang memanggil `fetchUser`.',
      ['web/UserBadge.vue'],
      ['UserBadge'],
      ['src/api'],
      [],
      1,
      4,
    ],
    [
      'py',
      'Modul Python: `get_user`, `greet`, `UserRepo`.',
      ['py/app/users.py'],
      ['get_user', 'greet', 'UserRepo'],
      [],
      [],
      1,
      4,
    ],
    ['go', 'Paket Go `users`: `GetUser`, `Greet`.', ['go/users/users.go'], ['GetUser', 'Greet', 'User'], [], [], 1, 3],
  ];
  for (const [path, summary, keyFiles, exps, dependsOn, dependents, files, symbols] of MODS) {
    batch.set(db.doc(`repos/4242/modules/${path.replace(/[^A-Za-z0-9_-]/g, '__')}`), {
      path,
      name: path.split('/').pop(),
      summary,
      keyFiles,
      exports: exps,
      dependsOn,
      dependents,
      stats: { files, symbols },
      summarySha: 'seed',
      updatedAt: ts(now - 2 * H),
    });
  }
  const RULES = [
    [
      'rule-active-1',
      'Semua fungsi API yang bisa gagal mengembalikan `null`, bukan melempar error.',
      'rule',
      'bug',
      'active',
      'manual',
      null,
      4,
    ],
    [
      'rule-active-2',
      'Di repo ini `fetchUser` boleh mengembalikan null karena sudah ditangani di guard; jangan dilaporkan di `src/services/`.',
      'rule',
      'bug',
      'active',
      'learned',
      ['src/services/'],
      2,
    ],
    [
      'rule-suppress-1',
      'Tekan temuan mirip: "Nama variabel terlalu umum".',
      'suppression',
      'maintainability',
      'active',
      'learned',
      null,
      1,
    ],
    [
      'rule-sugg-1',
      'Komponen tabel wajib memakai `trackBy`/`track` saat merender daftar panjang.',
      'rule',
      'performance',
      'suggested',
      'learned',
      null,
      0,
    ],
    [
      'rule-sugg-2',
      'Tekan temuan mirip: "Promise tidak di-await" di skrip CLI.',
      'suppression',
      'bug',
      'suggested',
      'learned',
      ['scripts/'],
      0,
    ],
  ];
  RULES.forEach(([id, text, kind, category, status, source, paths, usage], k) => {
    batch.set(db.doc(`rules/${id}`), {
      text,
      kind,
      category,
      status,
      source,
      scope: { repoId: null, paths: paths ?? [] },
      ...(kind === 'suppression'
        ? { match: { category, titleTrigrams: [] }, matchTitle: text.replace(/^.*"(.*)".*$/, '$1') }
        : {}),
      evidence: status === 'suggested' ? ['sample-f-2-2', 'sample-f-3-1'] : [],
      usageCount: usage,
      lastUsedAt: usage ? ts(now - (k + 1) * H) : null,
      createdBy: source === 'manual' ? 'admin1' : 'job:sample',
      decidedBy: status === 'active' ? 'admin1' : null,
      decidedAt: status === 'active' ? ts(now - 2 * D) : null,
      createdAt: ts(now - (k + 1) * D),
    });
  });
  PRS.forEach((p, i) => {
    const repo = REPOS[p.repo];
    const created = now - i * 9 * H - 30 * 60_000;
    const id = `sample-job-${i + 1}`;
    const f = FINDINGS.slice(0, (i % 4) + 1).map(([severity, category, title, path, line]) => ({
      path,
      line,
      startLine: null,
      severity,
      category,
      title,
      what: `${title}.`,
      why: 'Akibatnya bisa crash atau bocor di produksi.',
      fix: 'Tangani kasus ini secara eksplisit.',
      suggestion: null,
    }));
    batch.set(db.doc(`jobs/${id}`), {
      type: 'review',
      status: i === 5 ? 'running' : 'posted',
      repo: { id: repo.id, fullName: repo.fullName, installationId: 777 },
      pr: {
        number: p.n,
        title: p.title,
        body: '',
        authorLogin: p.author,
        baseRef: 'main',
        baseSha: 'b'.repeat(40),
        headRef: 'feature',
        headSha: `${(i + 1) * 1111111}`.padEnd(40, 'a'),
        htmlUrl: `https://github.com/${repo.fullName}/pull/${p.n}`,
        draft: false,
      },
      trigger: { commentId: 100 + i, userLogin: p.author, command: 'lapor', instruction: '' },
      promptVersions: { persona: 1, review: i < 3 ? 2 : 1 },
      config: {
        preferredAgent: 'any',
        models: {},
        agentMaxTurns: 40,
        maxDiffBytes: 1000000,
        reviewTimeoutMinutes: 15,
        maxInlineComments: 10,
      },
      machineId: 'mesin-tim',
      attempts: 1,
      claimedAt: ts(created + 15_000 + i * 5_000),
      result:
        i === 5
          ? null
          : {
              score: p.score,
              verdict:
                p.score >= 5
                  ? 'Bersih. Merge.'
                  : p.score >= 4
                    ? 'Hampir. Rapikan dua hal ini dulu.'
                    : 'Belum layak merge. Null-check bolong.',
              summary: `PR ini mengubah ${f.length + 2} file di ${repo.fullName}.`,
              lessons: ['Nilai yang bisa null harus dicek sebelum dipakai, bukan diasumsikan ada.'],
              findings: p.score >= 5 ? [] : f,
              impact: i === 0 ? ['`fetchUser` dipakai di 4 tempat; signature berubah (parameter `opts` baru).'] : [],
              suppressed: i === 2 ? [{ ...f[0], ruleId: 'rule-suppress-1' }] : [],
              meta: {
                agent: i % 2 ? 'codex' : 'claude',
                model: i % 2 ? null : 'claude-sonnet-4-6',
                // skill yang dimuat ke prompt (bukti & kontrak-dan-dampak selalu; flutter-performance dilewati: bukan file Dart)
                skillsLoaded: ['bukti', 'kontrak-dan-dampak', 'sinyal-bukan-noise'],
                skillsSkipped: ['flutter-performance'],
                skillsDropped: [],
                // review #2 (codex) mode mendalam dengan rincian putaran; lainnya standar satu putaran
                ...(i === 1
                  ? {
                      mode: 'deep',
                      passes: [
                        {
                          role: 'triage',
                          label: 'triage',
                          model: 'gpt-6-luna',
                          ok: true,
                          durationMs: 9_000,
                          inputTokens: 3_000,
                          outputTokens: 200,
                        },
                        {
                          role: 'lens',
                          label: 'lens-correctness',
                          model: 'gpt-6.2-sol',
                          ok: true,
                          durationMs: 70_000,
                          inputTokens: 14_000,
                          outputTokens: 1_500,
                        },
                        {
                          role: 'lens',
                          label: 'lens-security',
                          model: 'gpt-6.2-sol',
                          ok: true,
                          durationMs: 64_000,
                          inputTokens: 13_500,
                          outputTokens: 1_100,
                        },
                        {
                          role: 'validate',
                          label: 'validate-0',
                          model: 'gpt-6.2-astra',
                          ok: true,
                          durationMs: 41_000,
                          inputTokens: 16_000,
                          outputTokens: 400,
                        },
                        {
                          role: 'lead',
                          label: 'lead',
                          model: 'gpt-6.2-sol',
                          ok: true,
                          durationMs: 12_000,
                          inputTokens: 2_500,
                          outputTokens: 700,
                        },
                      ],
                    }
                  : { mode: 'standard' }),
                durationMs: 60_000 + i * 17_000,
                // review mendalam: jumlah token semua putaran
                inputTokens: i === 1 ? 49_000 : 12000 + i * 900,
                outputTokens: i === 1 ? 3_900 : 1800 + i * 120,
                numTurns: 6,
                isolation: i % 2 ? 'read-only' : 'safe',
                ...(i === 0
                  ? {
                      appVerification: {
                        ran: true,
                        loginOk: true,
                        buildMs: 184_000,
                        runMs: 21_000,
                        scenarios: [
                          {
                            finding: 0,
                            title: f[0].title,
                            goal: BUKTI.goal,
                            status: 'reproduced',
                            note: BUKTI.note,
                            steps: [
                              { i: 0, do: 'goto', ok: true, error: null },
                              { i: 1, do: 'click', ok: true, error: null },
                              { i: 2, do: 'screenshot', ok: true, error: null },
                              { i: 3, do: 'expectNoText', ok: false, error: 'teks "NaN" terlihat' },
                            ],
                            console: [],
                            pageErrors: [],
                            failedRequests: [],
                            shots: ['f0-0'],
                          },
                        ],
                        skipped: [],
                      },
                    }
                  : {}),
              },
              rawOutput: JSON.stringify({ score: p.score }),
            },
      github: i === 5 ? {} : { summaryCommentId: 9000 + i, reviewId: 8000 + i, postedAt: ts(created + 2 * 60_000) },
      createdAt: ts(created),
      updatedAt: ts(created + 2 * 60_000),
      finishedAt: i === 5 ? null : ts(created + 2 * 60_000),
    });
    if (i === 0)
      batch.set(db.doc(`jobs/${id}/evidence/f0-0`), {
        findingIndex: 0,
        name: 'setelah-tambah',
        mime: 'image/jpeg',
        data: BUKTI_JPEG,
        createdAt: ts(created + 2 * 60_000),
      });
    if (i !== 5 && p.score < 5) {
      f.forEach((x, k) => {
        batch.set(db.doc(`findings/sample-f-${i + 1}-${k + 1}`), {
          jobId: id,
          repoId: repo.id,
          repoFullName: repo.fullName,
          prNumber: p.n,
          prAuthorLogin: p.author,
          path: x.path,
          line: x.line,
          startLine: null,
          severity: x.severity,
          category: x.category,
          title: x.title,
          body: `${x.what}\n\n${x.why}\n\n**Perbaikan:** ${x.fix}`,
          suggestion: null,
          postedInline: k < 3,
          githubCommentId: k < 3 ? 7000 + i * 10 + k : null,
          githubCommentUrl:
            k < 3 ? `https://github.com/${repo.fullName}/pull/${p.n}#discussion_r${7000 + i * 10 + k}` : null,
          promptVersions: { persona: 1, review: i < 3 ? 2 : 1 },
          evidence: i === 0 && k === 0 ? BUKTI : null,
          // atribusi skill: temuan pertama tiap review dari bukti, temuan keamanan dari kontrak-dan-dampak
          skill: x.category === 'security' ? 'kontrak-dan-dampak' : k === 0 ? 'bukti' : '',
          agent: i % 2 ? 'codex' : 'claude',
          reviewedSha: 'a'.repeat(40),
          createdAt: ts(created + 2 * 60_000),
          outcome: OUTCOMES[(i + k) % OUTCOMES.length],
          outcomeAt: ts(created + D),
          signals: {
            thumbsUp: 0,
            thumbsDown: OUTCOMES[(i + k) % OUTCOMES.length] === 'disputed' ? 1 : 0,
            threadResolved: false,
            codeChangedAfter: OUTCOMES[(i + k) % OUTCOMES.length] === 'addressed',
            humanReplies: [],
            aiCoderReply:
              OUTCOMES[(i + k) % OUTCOMES.length] === 'disputed'
                ? { verdict: 'wont_fix', reason: 'sengaja, sudah dicek di guard', at: ts(created + H) }
                : null,
            laterRevertOrFix: null,
          },
        });
      });
    }
  });
  // catatan PR untuk Analitik → Dampak: PR yang direview (di atas), PR yang tidak direview, dan riwayat sebelum pilot
  const prDoc = (repo, n, o) =>
    batch.set(db.doc(`prs/${repo.id}_${n}`), {
      repoId: repo.id,
      repoFullName: repo.fullName,
      number: n,
      title: o.title ?? `PR ${n}`,
      author: o.author ?? 'dev3',
      authorIsBot: false,
      draft: false,
      baseRef: 'main',
      state: o.state ?? 'merged',
      createdAt: ts(o.created),
      mergedAt: o.state === 'open' ? null : ts(o.created + (o.cycleH ?? 20) * H),
      firstHumanReviewAt: o.fhrH != null ? ts(o.created + o.fhrH * H) : null,
      revertedAt: o.revertedH != null ? ts(o.created + o.revertedH * H) : null,
      ...(o.backfilled ? { backfilled: true } : {}),
    });
  PRS.forEach((p, i) => {
    if (i === 5) return; // masih direview → PR terbuka
    prDoc(REPOS[p.repo], p.n, {
      title: p.title,
      author: p.author,
      created: now - i * 9 * H - 2 * H,
      cycleH: 1.5 + i,
      fhrH: 1,
    });
  });
  // tidak direview Chef Juno (satu di-revert)
  // di-merge setelah review Chef Juno pertama (dalam periode pilot), lalu di-revert
  prDoc(REPOS[0], 201, {
    title: 'fix: salah hitung diskon',
    created: now - 40 * H,
    cycleH: 20,
    fhrH: 9,
    revertedH: 30,
  });
  prDoc(REPOS[1], 202, { title: 'chore: rapikan util', created: now - 2 * D, cycleH: 12, fhrH: 6 });
  // sebelum pilot (riwayat dari GitHub): lebih lama sampai review & merge, 1 di-revert
  for (let k = 0; k < 6; k++)
    prDoc(REPOS[k % 2], 300 + k, {
      title: `feat lama ${k}`,
      created: now - (5 + k) * D,
      cycleH: 30 + k * 4,
      fhrH: 10 + k,
      revertedH: k === 2 ? 70 : undefined,
      backfilled: true,
    });
  await batch.commit();
}
