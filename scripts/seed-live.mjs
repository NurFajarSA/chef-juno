// MOCK: data dummy "seolah sudah dipakai tim ±2 minggu" untuk mencoba dashboard di emulator (`npm run dev`).
// Bukan hasil review sungguhan — dibangkitkan deterministik dari template di bawah. Hanya untuk demo lokal.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_SKILLS } from '@chefjuno/shared';
import { readSeedPrompt } from './seed-data.mjs';
import { readFileSync } from 'node:fs';

// MOCK: bukti uji aplikasi dummy memakai screenshot asli runner terhadap aplikasi fixture (bukan aplikasi tim)
const BUKTI_JPEG = readFileSync(
  new URL('../apps/daemon/test/fixtures/web-app/bukti-contoh.jpg', import.meta.url),
).toString('base64');

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export const LIVE_MEMBERS = [
  { id: '1001', githubLogin: 'admin1', name: 'Admin Tim', role: 'admin', level: 'senior' },
  { id: '2101', githubLogin: 'rina', name: 'Rina Kusuma', role: 'admin', level: 'senior' },
  { id: '2102', githubLogin: 'budi', name: 'Budi Santoso', role: 'member', level: 'mid' },
  { id: '2103', githubLogin: 'sari', name: 'Sari Wulandari', role: 'member', level: 'junior' },
  { id: '2104', githubLogin: 'dimas', name: 'Dimas Pratama', role: 'member', level: 'junior' },
  { id: '2105', githubLogin: 'yoga', name: 'Yoga Aditya', role: 'member', level: 'mid' },
];
const AUTHORS = ['rina', 'budi', 'sari', 'dimas', 'yoga'];

const REPOS = [
  {
    id: 7001,
    fullName: 'tim/api-gateway',
    files: [
      'src/auth/session.ts',
      'src/auth/token.ts',
      'src/routes/users.ts',
      'src/routes/orders.ts',
      'src/db/query.ts',
      'src/middleware/rate-limit.ts',
      'src/services/payment.ts',
    ],
  },
  {
    id: 7002,
    fullName: 'tim/dashboard-web',
    files: [
      'src/app/pages/orders.ts',
      'src/app/pages/report.ts',
      'src/app/core/api.service.ts',
      'src/app/ui/table.ts',
      'src/app/core/auth.guard.ts',
      'src/app/pages/settings.ts',
    ],
  },
  {
    id: 7003,
    fullName: 'tim/worker-jobs',
    files: ['jobs/export_csv.py', 'jobs/sync_inventory.py', 'jobs/notify.py', 'lib/db.py', 'lib/retry.py'],
  },
  {
    id: 7004,
    fullName: 'tim/notif-service',
    files: ['cmd/server/main.go', 'internal/push/sender.go', 'internal/push/queue.go', 'internal/store/redis.go'],
  },
];

const PR_TITLES = [
  'feat: cache untuk profil user',
  'fix: token refresh dobel saat tab ganda',
  'feat: export laporan bulanan ke CSV',
  'refactor: pisah service pembayaran',
  'fix: tabel order tidak refresh setelah filter',
  'feat: rate limit per API key',
  'chore: naikkan versi zod & angular',
  'feat: notifikasi push untuk order baru',
  'fix: retry sinkron inventori saat timeout',
  'feat: halaman pengaturan notifikasi',
  'fix: query laporan lambat di bulan berjalan',
  'feat: login dengan magic link',
  'refactor: hapus kode legacy checkout',
  'fix: zona waktu tanggal transaksi',
  'feat: dashboard ringkasan penjualan',
  'fix: memory leak di subscription tabel',
  'feat: webhook pembayaran dari gateway',
  'fix: validasi nomor telepon',
  'feat: antrean notifikasi dengan prioritas',
  'docs: README cara menjalankan lokal',
  'fix: N+1 query di daftar order',
  'feat: filter order berdasarkan status',
  'fix: guard admin bisa dilewati lewat URL',
  'feat: pagination di API users',
];

// [severity, category, title, what, why, fix]
const FINDINGS = [
  [
    'P0',
    'security',
    'Token disimpan di localStorage',
    'Access token ditulis ke localStorage.',
    'Skrip pihak ketiga atau XSS bisa membacanya. Satu XSS = semua sesi bocor.',
    'Simpan di cookie httpOnly + SameSite, atau di memori saja.',
  ],
  [
    'P0',
    'security',
    'Query SQL dirakit dengan string',
    'Parameter `status` digabung langsung ke string SQL.',
    'SQL injection. Data semua pelanggan bisa diambil.',
    'Pakai parameterized query / placeholder.',
  ],
  [
    'P1',
    'security',
    'Guard admin hanya dicek di UI',
    'Halaman admin disembunyikan di menu, tapi endpoint tidak mengecek role.',
    'Siapa pun yang tahu URL bisa memanggil endpoint admin.',
    'Cek role di server untuk setiap endpoint admin.',
  ],
  [
    'P1',
    'bug',
    'Hasil fetchUser tidak dicek null',
    '`user.name` dipakai tanpa cek, padahal `fetchUser` bisa mengembalikan null.',
    'Crash saat user dihapus atau API 404.',
    'Tangani `null` sebelum dipakai: early return atau nilai default.',
  ],
  [
    'P1',
    'bug',
    'Promise tidak di-await',
    '`saveOrder()` dipanggil tanpa `await` di dalam handler.',
    'Error ditelan; respons 200 padahal data belum tersimpan.',
    'Tambahkan `await` dan tangani error-nya.',
  ],
  [
    'P1',
    'bug',
    'Zona waktu tanggal transaksi salah',
    '`new Date().toISOString().slice(0, 10)` dipakai untuk tanggal lokal.',
    'Transaksi jam 00.00–07.00 WIB tercatat di hari sebelumnya.',
    'Hitung tanggal dengan zona `Asia/Jakarta` secara eksplisit.',
  ],
  [
    'P1',
    'performance',
    'Query di dalam loop (N+1)',
    'Setiap order memanggil query user terpisah.',
    '100 order = 101 query. Halaman lambat dan DB tertekan.',
    'Ambil semua user sekaligus dengan `IN (...)` lalu petakan.',
  ],
  [
    'P1',
    'performance',
    'Subscription tidak di-unsubscribe',
    'Listener realtime dibuat di komponen tanpa dibersihkan saat destroy.',
    'Memory leak dan request dobel setiap navigasi.',
    'Unsubscribe di `DestroyRef.onDestroy` atau pakai signal.',
  ],
  [
    'P1',
    'bug',
    'Retry tanpa batas',
    'Loop retry tidak punya batas percobaan maupun backoff.',
    'Saat layanan mati, worker berputar selamanya dan membanjiri log.',
    'Batasi percobaan (mis. 5) dengan exponential backoff.',
  ],
  [
    'P2',
    'maintainability',
    'Nama variabel terlalu umum',
    '`data`, `res2`, `tmp` dipakai untuk tiga hal berbeda.',
    'Pembaca berikutnya harus menebak isinya.',
    'Beri nama sesuai isi: `orders`, `paidOrders`, `csvRows`.',
  ],
  [
    'P2',
    'maintainability',
    'Fungsi terlalu panjang',
    'Fungsi `handleCheckout` 180 baris dengan 6 tanggung jawab.',
    'Sulit dites dan rawan regresi saat diubah.',
    'Pecah per langkah: validasi, hitung, simpan, notifikasi.',
  ],
  [
    'P2',
    'test',
    'Jalur error belum punya test',
    'Hanya jalur sukses yang dites.',
    'Regresi di penanganan error tidak akan ketahuan.',
    'Tambah test untuk timeout, 404, dan input tidak valid.',
  ],
  [
    'P2',
    'test',
    'Test bergantung pada waktu sekarang',
    'Assertion memakai `new Date()` tanpa clock palsu.',
    'Test gagal acak di tengah malam atau akhir bulan.',
    'Injeksi clock atau pakai fake timers.',
  ],
  [
    'P2',
    'maintainability',
    'Magic number untuk status',
    'Status order dibandingkan dengan angka `3` dan `7`.',
    'Tidak ada yang ingat 3 itu apa.',
    'Pakai enum/konstanta bernama.',
  ],
  [
    'P2',
    'performance',
    'Render ulang seluruh tabel',
    'Daftar 2.000 baris dirender tanpa `track`.',
    'Scroll patah-patah di laptop biasa.',
    'Pakai `track item.id` dan virtual scroll.',
  ],
];

const VERDICT = {
  5: ['Bersih. Merge.'],
  4: ['Hampir. Rapikan dua hal ini dulu.', 'Layak, setelah satu perbaikan kecil.'],
  3: ['Belum layak merge. Perbaiki dulu.', 'Logikanya jalan, tapi penanganan error bolong.'],
  2: ['Ulang bagian ini. Terlalu banyak yang bocor.', 'Tidak. Ada celah keamanan.'],
  1: ['Tidak. Ini membuka celah serius.'],
};
const LESSONS = [
  'Nilai yang bisa null harus dicek sebelum dipakai, bukan diasumsikan ada.',
  'Setiap operasi async di handler harus di-await dan ditangani error-nya.',
  'Otorisasi selalu di server; UI hanya kosmetik.',
  'Tanggal bisnis dihitung di zona Asia/Jakarta, bukan UTC.',
  'Ambil data sekaligus, jangan per baris di dalam loop.',
  'Test jalur gagal sama pentingnya dengan jalur sukses.',
];

/** PRNG deterministik supaya data sama setiap kali seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = (ms) => Timestamp.fromMillis(ms);
const sha = (r) => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');

/** Waktu kerja WIB (Senin–Jumat 09.00–18.00) sebanyak `n` hari ke belakang. */
function workTime(r, now, maxDays) {
  for (;;) {
    const t = now - Math.floor(r() * maxDays * D);
    const wib = new Date(t + 7 * H);
    const dow = wib.getUTCDay();
    const hr = wib.getUTCHours();
    if (dow >= 1 && dow <= 5 && hr >= 9 && hr < 18) return t;
  }
}

export async function seedLive(db, now = Date.now()) {
  const r = rng(20261124);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  let batch = db.batch();
  let ops = 0;
  const put = async (ref, data) => {
    batch.set(ref, data);
    if (++ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  // ---- prompt: v1 (seed), v2 (minggu lalu), v3 (2 hari lalu, aktif) ----
  const review1 = readSeedPrompt('review');
  const versions = [
    [
      2,
      review1 + '\n- Periksa null-check dan error handling async sebelum hal lain.\n',
      'Pertegas null-check & async',
      'rina',
      now - 9 * D,
    ],
    [
      3,
      review1 +
        '\n- Periksa null-check dan error handling async sebelum hal lain.\n- Untuk penulis junior: sertakan contoh kode benar dari repo ini.\n',
      'Contoh kode untuk penulis junior',
      'admin1',
      now - 2 * D,
    ],
  ];
  for (const [v, content, message, author, at] of versions) {
    await put(db.doc(`prompts/review/versions/${v}`), {
      version: v,
      content,
      message,
      authorUid: `uid-${author}`,
      authorLogin: author,
      parentVersion: v - 1,
      createdAt: ts(at),
    });
  }
  await put(db.doc('prompts/review'), {
    title: 'Instruksi review',
    description: 'Cara mereview PR dan format temuan',
    activeVersion: 3,
    latestVersion: 3,
    updatedAt: ts(now - 2 * D),
    updatedBy: 'admin1',
  });
  const promptAt = (t) => ({ persona: 1, review: t >= now - 2 * D ? 3 : t >= now - 9 * D ? 2 : 1 });

  // ---- repo + modul ----
  const MODS = {
    7001: [
      [
        'src/auth',
        'Autentikasi & sesi: penerbitan token, refresh, dan validasi.',
        ['src/auth/session.ts', 'src/auth/token.ts'],
        ['createSession', 'refreshToken', 'verifyToken'],
        [],
        ['src/routes', 'src/middleware'],
      ],
      [
        'src/routes',
        'Endpoint HTTP publik (users, orders). Validasi input dengan zod.',
        ['src/routes/users.ts', 'src/routes/orders.ts'],
        ['usersRouter', 'ordersRouter'],
        ['src/auth', 'src/db', 'src/services'],
        [],
      ],
      [
        'src/db',
        'Akses database. Semua query wajib parameterized.',
        ['src/db/query.ts'],
        ['query', 'tx'],
        [],
        ['src/routes', 'src/services'],
      ],
      [
        'src/middleware',
        'Rate limit & logging per request.',
        ['src/middleware/rate-limit.ts'],
        ['rateLimit'],
        ['src/auth'],
        [],
      ],
      [
        'src/services',
        'Logika bisnis pembayaran & webhook gateway.',
        ['src/services/payment.ts'],
        ['chargeOrder', 'handleWebhook'],
        ['src/db'],
        ['src/routes'],
      ],
    ],
    7002: [
      [
        'src/app/core',
        'Service API, guard auth, interceptor token.',
        ['src/app/core/api.service.ts', 'src/app/core/auth.guard.ts'],
        ['ApiService', 'authGuard'],
        [],
        ['src/app/pages', 'src/app/ui'],
      ],
      [
        'src/app/pages',
        'Halaman order, laporan, pengaturan.',
        ['src/app/pages/orders.ts', 'src/app/pages/report.ts'],
        ['OrdersPage', 'ReportPage', 'SettingsPage'],
        ['src/app/core', 'src/app/ui'],
        [],
      ],
      [
        'src/app/ui',
        'Komponen tabel, chip, dan dialog bersama.',
        ['src/app/ui/table.ts'],
        ['DataTable'],
        ['src/app/core'],
        ['src/app/pages'],
      ],
    ],
    7003: [
      [
        'jobs',
        'Job terjadwal: export CSV, sinkron inventori, notifikasi.',
        ['jobs/export_csv.py', 'jobs/sync_inventory.py'],
        ['export_monthly', 'sync_inventory'],
        ['lib'],
        [],
      ],
      [
        'lib',
        'Koneksi DB & util retry dengan backoff.',
        ['lib/db.py', 'lib/retry.py'],
        ['get_conn', 'with_retry'],
        [],
        ['jobs'],
      ],
    ],
    7004: [
      ['cmd', 'Entry point server notifikasi.', ['cmd/server/main.go'], ['main'], ['internal'], []],
      [
        'internal',
        'Pengirim push, antrean prioritas, penyimpanan Redis.',
        ['internal/push/sender.go', 'internal/push/queue.go'],
        ['Send', 'Enqueue', 'NewStore'],
        [],
        ['cmd'],
      ],
    ],
  };
  const LANGS = { 7001: { ts: 38 }, 7002: { ts: 61, tsx: 0 }, 7003: { py: 24 }, 7004: { go: 19 } };
  for (const repo of REPOS) {
    const mods = MODS[repo.id];
    const files = Object.values(LANGS[repo.id]).reduce((a, b) => a + b, 0) + 6;
    await put(db.doc(`repos/${repo.id}`), {
      fullName: repo.fullName,
      installationId: 777,
      private: true,
      enabled: true,
      defaultBranch: 'main',
      updatedAt: ts(now - 3 * H),
      index:
        repo.id === 7004
          ? { status: 'indexing' }
          : {
              status: 'ready',
              indexedSha: sha(r),
              indexedAt: ts(now - Math.floor(r() * 20) * H - 30 * MIN),
              byMachineId: 'mesin-rina',
              mode: 'incremental',
              stats: {
                files,
                symbols: files * 7,
                edges: files * 11,
                resolvedEdgePct: 0.78 + r() * 0.15,
                languages: LANGS[repo.id],
                durationMs: 900 + Math.floor(r() * 4000),
              },
            },
    });
    for (const [path, summary, keyFiles, exps, dependsOn, dependents] of mods) {
      await put(db.doc(`repos/${repo.id}/modules/${path.replace(/[^A-Za-z0-9_-]/g, '__')}`), {
        path,
        name: path.split('/').pop(),
        summary,
        keyFiles,
        exports: exps,
        dependsOn,
        dependents,
        stats: { files: keyFiles.length + 2, symbols: exps.length * 4 },
        summarySha: sha(r),
        updatedAt: ts(now - 1 * D),
      });
    }
  }

  // ---- mesin (lastSeenAt diperbarui terus oleh simulator heartbeat di `npm run dev`) ----
  const agentClaude = {
    version: '2.1.323',
    subscription: true,
    isolation: 'safe',
    enabled: true,
    authMethod: 'claude.ai',
    warning: null,
  };
  const agentCodex = {
    version: '0.160.1',
    subscription: true,
    isolation: 'read-only',
    enabled: true,
    authMethod: 'chatgpt',
    warning: null,
  };
  const machines = [
    [
      'mesin-rina',
      'MacBook Rina',
      'rina',
      'darwin-arm64',
      { claude: agentClaude, codex: agentCodex },
      now - 8000,
      false,
    ],
    ['mesin-budi', 'Desktop Budi', 'budi', 'linux-x64', { claude: agentClaude }, now - 12000, false],
    ['mesin-yoga', 'Laptop Yoga', 'yoga', 'darwin-x64', { codex: agentCodex }, now - 5 * H, false],
    [
      'mesin-lama',
      'Mesin uji lama',
      'admin1',
      'linux-x64',
      {
        claude: {
          ...agentClaude,
          subscription: false,
          enabled: false,
          authMethod: 'api_key',
          warning: 'Claude Code login dengan api_key, bukan langganan claude.ai — tidak dipakai.',
        },
      },
      now - 6 * D,
      true,
    ],
  ];

  // ---- review jobs + temuan, 14 hari ke belakang ----
  const people = Object.fromEntries(AUTHORS.map((a) => [a, new Map()]));
  const lessonsBy = Object.fromEntries(AUTHORS.map((a) => [a, []]));
  // kecenderungan kesalahan per orang (index template FINDINGS)
  const BIAS = {
    rina: [10, 11, 13],
    budi: [6, 4, 9, 12],
    sari: [3, 4, 5, 11, 0],
    dimas: [3, 7, 14, 2, 1],
    yoga: [8, 6, 12, 10],
  };
  // lebih rapat di 3 hari kerja terakhir supaya terasa "sedang dipakai"
  const times = [
    ...Array.from({ length: 38 }, () => workTime(r, now - 20 * MIN, 14)),
    ...Array.from({ length: 14 }, () => workTime(r, now - 20 * MIN, 4)),
  ].sort((a, b) => a - b);
  let prNo = 120;
  let runningJob = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const author = pick(AUTHORS);
    const repo = pick(REPOS);
    const level = LIVE_MEMBERS.find((m) => m.githubLogin === author).level;
    const isLast = i === times.length - 1;
    const status = isLast
      ? 'running'
      : i === times.length - 2
        ? 'queued'
        : i === 9 || i === 27
          ? 'failed'
          : i === 15
            ? 'cancelled'
            : 'posted';
    const ageDays = (now - t) / D;
    // makin baru makin sedikit temuan untuk sari & dimas (mereka "berkembang")
    const improving = (author === 'sari' || author === 'dimas') && ageDays < 7;
    const nFind =
      status !== 'posted' ? 0 : Math.max(0, Math.round(r() * (improving ? 2 : 4)) - (level === 'senior' ? 1 : 0));
    const score =
      status !== 'posted' ? null : nFind === 0 ? 5 : Math.max(1, 5 - nFind + (r() < 0.3 ? 1 : 0) - (r() < 0.2 ? 1 : 0));
    const prNumber = prNo++;
    const id = `live-job-${String(i + 1).padStart(3, '0')}`;
    const agent = r() < 0.7 ? 'claude' : 'codex';
    const machineId =
      agent === 'codex' ? (r() < 0.5 ? 'mesin-rina' : 'mesin-yoga') : r() < 0.6 ? 'mesin-rina' : 'mesin-budi';
    const findings = [];
    const bias = BIAS[author];
    for (let k = 0; k < nFind; k++) {
      const tpl = FINDINGS[r() < 0.75 ? pick(bias) : Math.floor(r() * FINDINGS.length)];
      const [severity, category, title, what, why, fix] = tpl;
      findings.push({
        path: pick(repo.files),
        line: 10 + Math.floor(r() * 180),
        startLine: null,
        severity,
        category,
        title,
        what,
        why,
        fix,
        suggestion: null,
      });
    }
    const durationMs = 45_000 + Math.floor(r() * 150_000);
    const pv = promptAt(t);
    const suppressed =
      status === 'posted' && r() < 0.12
        ? [
            {
              path: pick(repo.files),
              line: 40,
              startLine: null,
              severity: 'P2',
              category: 'maintainability',
              title: 'Nama variabel terlalu umum',
              what: '',
              why: '',
              fix: '',
              suggestion: null,
              ruleId: 'live-rule-sup-1',
            },
          ]
        : [];
    const job = {
      type: 'review',
      status,
      repo: { id: repo.id, fullName: repo.fullName, installationId: 777 },
      pr: {
        number: prNumber,
        title: PR_TITLES[i % PR_TITLES.length],
        body: 'Lihat deskripsi di tiket terkait.',
        authorLogin: author,
        authorLevel: level,
        baseRef: 'main',
        baseSha: sha(r),
        headRef: `feat/${prNumber}`,
        headSha: sha(r),
        htmlUrl: `https://github.com/${repo.fullName}/pull/${prNumber}`,
        draft: false,
        // PR lama sudah ditutup (kebanyakan di-merge); yang baru masih terbuka
        state: status === 'cancelled' ? 'closed' : ageDays > 4 ? (r() < 0.85 ? 'merged' : 'closed') : 'open',
      },
      trigger: {
        commentId: 900000 + i,
        commentUrl: null,
        userLogin: r() < 0.8 ? author : 'rina',
        userId: 0,
        command: pick(['lapor', 'lapor', 'cek', null]) ?? 'review',
        instruction: r() < 0.2 ? 'cek bagian auth' : '',
        rawText: 'lapor @chefjuno',
      },
      promptVersions: pv,
      config: {
        preferredAgent: 'any',
        models: {},
        agentMaxTurns: 40,
        maxDiffBytes: 1000000,
        reviewTimeoutMinutes: 15,
        maxInlineComments: 10,
      },
      machineId: status === 'queued' ? null : machineId,
      attempts: status === 'queued' ? 0 : 1,
      github:
        status === 'posted'
          ? {
              eyesReactionId: 1,
              summaryCommentId: 800000 + i,
              reviewId: 700000 + i,
              postedAt: ts(t + durationMs + 5000),
            }
          : {},
      createdAt: ts(t),
      updatedAt: ts(t + durationMs),
      finishedAt: status === 'posted' || status === 'failed' ? ts(t + durationMs) : null,
    };
    if (status === 'posted') {
      job.result = {
        score,
        verdict: pick(VERDICT[score]),
        summary: `PR ini mengubah ${2 + Math.floor(r() * 9)} file di ${repo.fullName}${findings.length ? `; ${findings.length} hal perlu dibereskan.` : '.'}`,
        lessons: findings.length ? [pick(LESSONS)] : [],
        findings,
        impact:
          r() < 0.25
            ? [
                `fungsi \`${pick(MODS[repo.id])[3][0]}\` dipakai di ${2 + Math.floor(r() * 6)} tempat; signature berubah — cek semua pemanggil.`,
              ]
            : [],
        suppressed,
        appliedRuleIds: r() < 0.5 ? ['live-rule-1'] : [],
        rawOutput: JSON.stringify({ score, findings: findings.length }),
        meta: {
          agent,
          model: agent === 'claude' ? 'claude-sonnet-4-6' : null,
          durationMs,
          inputTokens: 8000 + Math.floor(r() * 30000),
          outputTokens: 900 + Math.floor(r() * 3000),
          numTurns: agent === 'claude' ? 3 + Math.floor(r() * 8) : null,
          isolation: agent === 'claude' ? 'safe' : 'read-only',
          graphMcp: false,
          indexBuildMs: 0,
          diffTruncated: false,
          // MOCK: sebagian PR dummy direview mode mendalam (putaran paralel + validasi) & verifikasi statis
          ...(agent === 'claude' && findings.length && r() < 0.35
            ? {
                mode: 'deep',
                modeDecision: {
                  requested: 'auto',
                  chosen: 'deep',
                  by: 'triase',
                  reason: 'Menyentuh alur auth dan aturan data; perubahan lintas modul',
                },
                passes: [
                  {
                    role: 'triage',
                    label: 'triage',
                    model: 'haiku',
                    ok: true,
                    durationMs: 4100,
                    inputTokens: 1900,
                    outputTokens: 80,
                  },
                  ...['correctness', 'security', 'platform'].map((l) => ({
                    role: 'lens',
                    label: `lens-${l}`,
                    model: 'sonnet',
                    ok: true,
                    durationMs: 40000 + Math.floor(r() * 30000),
                    inputTokens: 14000,
                    outputTokens: 1200,
                  })),
                  {
                    role: 'validate',
                    label: 'validate-0',
                    model: 'opus',
                    ok: true,
                    durationMs: 21000,
                    inputTokens: 15000,
                    outputTokens: 220,
                  },
                  {
                    role: 'lead',
                    label: 'lead',
                    model: 'sonnet',
                    ok: true,
                    durationMs: 9000,
                    inputTokens: 2600,
                    outputTokens: 600,
                  },
                ],
                verification: {
                  ran: true,
                  runtime: 'docker',
                  image: 'ghcr.io/cirruslabs/flutter:stable',
                  commands: ['flutter analyze --no-pub'],
                  newIssues: ['warning • Unused import • lib/home/home_page.dart:4 • unused_import'],
                  baseIssueLines: 3,
                  headIssueLines: 4,
                  durationMs: 52000,
                },
              }
            : {
                mode: 'standard',
                modeDecision: {
                  requested: 'auto',
                  chosen: 'standard',
                  by: 'heuristik',
                  reason: 'PR kecil tanpa area sensitif',
                },
                passes: [
                  {
                    role: 'review',
                    label: 'review',
                    model: agent === 'claude' ? 'sonnet' : null,
                    ok: true,
                    durationMs,
                    inputTokens: 12000,
                    outputTokens: 1500,
                  },
                ],
              }),
        },
        postedInline: Math.min(findings.length, 10),
        postedOther: 0,
      };
    }
    if (status === 'failed')
      job.error =
        i === 9
          ? { stage: 'timeout', message: 'Agent melewati batas waktu 900000 ms' }
          : { stage: 'agent', message: 'Claude subtype=error_max_turns' };
    if (status === 'cancelled') job.error = { stage: 'cancelled', message: 'PR ditutup' };
    if (status === 'running') {
      job.claimedAt = ts(now - 3 * MIN);
      job.leaseExpiresAt = ts(now + 7 * MIN);
      job.createdAt = ts(now - 4 * MIN);
      job.machineId = 'mesin-budi';
      runningJob = id;
    }
    if (status === 'queued') job.createdAt = ts(now - 1 * MIN);
    await put(db.doc(`jobs/${id}`), job);
    // MOCK: review mendalam dummy dengan temuan P0/P1 pertama → seolah sudah dicoba di aplikasi & terbukti
    const tried = job.result?.meta?.mode === 'deep' && findings[0] && findings[0].severity !== 'P2';
    if (tried) {
      await put(db.doc(`jobs/${id}/evidence/f0-0`), {
        findingIndex: 0,
        name: 'setelah-tambah',
        mime: 'image/jpeg',
        data: BUKTI_JPEG,
        createdAt: ts(t + durationMs),
      });
      job.result.meta.appVerification = {
        ran: true,
        loginOk: true,
        buildMs: 190_000,
        runMs: 24_000,
        scenarios: [
          {
            finding: 0,
            title: findings[0].title,
            goal: 'Buka layar terkait, picu kondisi dari temuan, ambil screenshot',
            status: 'reproduced',
            note: 'Contoh dummy: masalah terlihat di layar setelah langkah pemicu.',
            steps: [
              { i: 0, do: 'goto', ok: true, error: null },
              { i: 1, do: 'click', ok: true, error: null },
              { i: 2, do: 'screenshot', ok: true, error: null },
            ],
            console: [],
            pageErrors: [],
            failedRequests: [],
            shots: ['f0-0'],
          },
        ],
        skipped: [],
      };
      await put(db.doc(`jobs/${id}`), job);
    }

    findings.forEach((f, k) => {
      const closed = ageDays > 2.5;
      let outcome = 'pending';
      let ai = null;
      if (closed) {
        const x = r();
        outcome =
          f.severity === 'P0' || f.category === 'security'
            ? x < 0.85
              ? 'addressed'
              : 'disputed'
            : x < 0.55
              ? 'addressed'
              : x < 0.7
                ? 'disputed'
                : x < 0.85
                  ? 'accepted_by_merge'
                  : 'ignored';
        if (outcome === 'disputed')
          ai = {
            verdict: 'wont_fix',
            reason: pick([
              'sengaja, sudah dicek di guard',
              'di luar scope PR ini',
              'false positive: nilai tidak pernah null di sini',
            ]),
            at: new Date(t + 3 * H).toISOString(),
          };
        if (outcome === 'addressed' && r() < 0.5)
          ai = { verdict: 'fixed', reason: null, at: new Date(t + 2 * H).toISOString() };
      }
      batch.set(db.doc(`findings/${id}-f${k + 1}`), {
        jobId: id,
        repoId: repo.id,
        repoFullName: repo.fullName,
        prNumber,
        prAuthorLogin: author,
        path: f.path,
        line: f.line,
        startLine: null,
        severity: f.severity,
        category: f.category,
        title: f.title,
        body: `${f.what}\n\n${f.why}\n\n**Perbaikan:** ${f.fix}`,
        suggestion: null,
        postedInline: k < 10,
        githubCommentId: 600000 + i * 20 + k,
        githubCommentUrl: `https://github.com/${repo.fullName}/pull/${prNumber}#discussion_r${600000 + i * 20 + k}`,
        promptVersions: pv,
        evidence:
          tried && k === 0
            ? {
                status: 'reproduced',
                note: 'Contoh dummy: masalah terlihat di layar setelah langkah pemicu.',
                goal: 'Buka layar terkait, picu kondisi dari temuan, ambil screenshot',
                shots: ['f0-0'],
              }
            : null,
        agent,
        reviewedSha: job.pr.headSha,
        createdAt: ts(t + durationMs),
        outcome,
        outcomeAt: closed ? ts(t + 2 * D) : null,
        signals: {
          thumbsUp: 0,
          thumbsDown: outcome === 'disputed' && r() < 0.3 ? 1 : 0,
          threadResolved: outcome === 'addressed' && r() < 0.6,
          codeChangedAfter: outcome === 'addressed',
          humanReplies: [],
          aiCoderReply: ai,
          laterRevertOrFix: null,
        },
      });
      ops++;
      const key = `${f.category}:${f.title}`;
      const m = people[author].get(key) ?? {
        key,
        title: f.title,
        category: f.category,
        count: 0,
        first: t,
        last: t,
        recent: 0,
        older: 0,
      };
      m.count++;
      m.last = Math.max(m.last, t);
      if (ageDays < 7) m.recent++;
      else m.older++;
      people[author].set(key, m);
    });
    if (findings.length && status === 'posted')
      lessonsBy[author].push({ text: job.result.lessons[0], prNumber, at: new Date(t).toISOString() });
  }
  await batch.commit();
  batch = db.batch();
  ops = 0;

  for (const a of AUTHORS) {
    const list = [...people[a].values()]
      .sort((x, y) => y.count - x.count)
      .map((m) => ({
        key: m.key,
        title: m.title,
        category: m.category,
        count: m.count,
        firstSeen: new Date(m.first).toISOString(),
        lastSeen: new Date(m.last).toISOString(),
        trend: m.recent < m.older ? 'down' : m.recent > m.older ? 'up' : 'flat',
      }));
    await put(db.doc(`people/${a}`), {
      recurringMistakes: list,
      lessons: lessonsBy[a].reverse().slice(0, 20),
      updatedAt: ts(now - 1 * H),
    });
  }

  for (const [id, name, owner, platform, agents, seen, revoked] of machines) {
    await put(db.doc(`machines/${id}`), {
      name,
      ownerUid: `uid-${owner}`,
      ownerLogin: owner,
      lastSeenAt: ts(seen),
      platform,
      daemonVersion: '0.1.0',
      agents,
      concurrency: 1,
      currentJobIds: id === 'mesin-budi' && runningJob ? [runningJob] : [],
      revoked,
      createdAt: ts(now - 13 * D),
    });
  }

  // ---- skill tim (MOCK: contoh skill untuk direktori Skills) ----
  const SKILLS = [
    [
      'sql-review',
      'sql-review',
      'Cek query SQL: N+1, injeksi, index yang hilang, dan transaksi.',
      true,
      'admin1',
      {
        'SKILL.md':
          '---\nname: sql-review\ndescription: Cek query SQL: N+1, injeksi, index yang hilang, dan transaksi.\n---\n\n# SQL review\n\n1. Cari query di dalam loop (N+1).\n2. Parameter selalu di-bind, jangan string concat.\n3. Kolom di WHERE/JOIN baru → cek index.\n4. Banyak tulis berurutan → bungkus transaksi.\n',
        'references/contoh-n-plus-1.md':
          '# Contoh N+1\n\n```py\nfor o in orders:\n    user = db.get_user(o.user_id)  # query per baris\n```\n',
      },
    ],
    [
      'angular-signals',
      'Angular Signals',
      'Pola Angular 22: signal, computed, Signal Forms, OnPush default.',
      true,
      'rina',
      {
        'SKILL.md':
          '---\nname: Angular Signals\ndescription: Pola Angular 22: signal, computed, Signal Forms, OnPush default.\n---\n\n- State lokal pakai `signal()`, turunan pakai `computed()`.\n- Jangan subscribe manual tanpa `takeUntilDestroyed`.\n- Form baru pakai Signal Forms.\n',
      },
    ],
    [
      'go-error-handling',
      'go-error-handling',
      'Error di Go dibungkus dengan konteks (%w), tidak ditelan.',
      true,
      'rina',
      {
        'SKILL.md':
          '---\nname: go-error-handling\ndescription: Error di Go dibungkus dengan konteks (%w), tidak ditelan.\n---\n\n- `if err != nil { return fmt.Errorf("simpan order: %w", err) }`\n- Jangan `_ = err`.\n',
        'scripts/cek.sh': '#!/bin/sh\ngrep -rn "_ = err" .\n',
      },
    ],
    [
      'ui-copy-indonesia',
      'ui-copy-indonesia',
      'Teks UI berbahasa Indonesia yang ringkas dan konsisten.',
      false,
      'sari',
      {
        'SKILL.md':
          '---\nname: ui-copy-indonesia\ndescription: Teks UI berbahasa Indonesia yang ringkas dan konsisten.\n---\n\nPakai istilah Inggris untuk istilah teknis yang janggal (memory, knowledge base).\n',
      },
    ],
  ];
  // skill bawaan (folder skills/ di repo) — sama seperti yang dipasang setupWorkspace
  for (const sk of DEFAULT_SKILLS) {
    await put(db.doc(`skills/${sk.slug}`), {
      name: sk.name,
      description: sk.description,
      paths: sk.paths,
      enabled: true,
      everEnabled: true,
      source: 'default',
      latestVersion: 1,
      fileCount: Object.keys(sk.files).length,
      createdAt: ts(now - 13 * D),
      createdBy: 'admin1',
      updatedAt: ts(now - 13 * D),
      updatedBy: 'chefjuno',
    });
    await put(db.doc(`skills/${sk.slug}/versions/1`), {
      version: 1,
      files: sk.files,
      message: 'Skill bawaan Chef Juno',
      authorUid: 'system',
      authorLogin: 'chefjuno',
      parentVersion: null,
      createdAt: ts(now - 13 * D),
    });
  }
  for (const [slug, name, description, enabled, by, files] of SKILLS) {
    await put(db.doc(`skills/${slug}`), {
      name,
      description,
      enabled,
      everEnabled: enabled,
      source: 'import',
      latestVersion: 1,
      fileCount: Object.keys(files).length,
      createdAt: ts(now - 6 * D),
      createdBy: by,
      updatedAt: ts(now - 6 * D),
      updatedBy: by,
    });
    await put(db.doc(`skills/${slug}/versions/1`), {
      version: 1,
      files,
      message: 'Diimport',
      authorUid: `uid-${by}`,
      authorLogin: by,
      parentVersion: null,
      createdAt: ts(now - 6 * D),
    });
  }

  // ---- ingatan ----
  const RULES = [
    [
      'live-rule-1',
      'Semua fungsi API yang bisa gagal mengembalikan `null`, bukan melempar error. Pemanggil wajib menangani null.',
      'rule',
      'bug',
      'active',
      'manual',
      'rina',
      null,
      [],
      23,
    ],
    [
      'live-rule-2',
      'Endpoint di `src/routes/` wajib memvalidasi input dengan zod sebelum menyentuh database.',
      'rule',
      'security',
      'active',
      'manual',
      'admin1',
      '7001',
      ['src/routes/'],
      9,
    ],
    [
      'live-rule-3',
      'Di worker Python, `with_retry` sudah menangani backoff; jangan laporkan retry manual di `lib/retry.py`.',
      'rule',
      'bug',
      'active',
      'learned',
      'job:learn',
      '7003',
      ['lib/'],
      4,
    ],
    [
      'live-rule-sup-1',
      'Tekan temuan mirip: "Nama variabel terlalu umum" (sering dibantah di kode lama).',
      'suppression',
      'maintainability',
      'active',
      'learned',
      'job:learn',
      null,
      [],
      6,
    ],
    [
      'live-rule-4',
      'Komponen tabel wajib memakai `track item.id` saat merender daftar panjang.',
      'rule',
      'performance',
      'suggested',
      'learned',
      'job:learn',
      '7002',
      ['src/app/'],
      0,
    ],
    [
      'live-rule-5',
      'Tekan temuan mirip: "Test bergantung pada waktu sekarang" untuk test snapshot UI.',
      'suppression',
      'test',
      'suggested',
      'learned',
      'job:learn',
      '7002',
      [],
      0,
    ],
    [
      'live-rule-6',
      'Di `tim/notif-service`, error dari `Send` boleh diabaikan bila sudah dicatat ke antrean ulang.',
      'rule',
      'bug',
      'suggested',
      'learned',
      'job:learn',
      '7004',
      ['internal/push/'],
      0,
    ],
    [
      'live-rule-7',
      'Abaikan semua temuan di folder `legacy/`.',
      'rule',
      'maintainability',
      'rejected',
      'learned',
      'job:learn',
      null,
      [],
      0,
    ],
  ];
  RULES.forEach(([id, text, kind, category, status, source, by, repoId, paths, usage], k) =>
    batch.set(db.doc(`rules/${id}`), {
      text,
      kind,
      category,
      status,
      source,
      scope: { repoId, paths },
      ...(kind === 'suppression'
        ? { match: { category, titleTrigrams: [] }, matchTitle: text.replace(/^[^"]*"([^"]*)".*$/, '$1') }
        : {}),
      evidence: source === 'learned' ? ['live-job-012-f1', 'live-job-020-f2'] : [],
      usageCount: usage,
      lastUsedAt: usage ? ts(now - (k + 1) * 3 * H) : null,
      createdBy: by,
      decidedBy: status === 'active' || status === 'rejected' ? 'rina' : null,
      decidedAt: status === 'suggested' ? null : ts(now - (6 - k) * D),
      createdAt: ts(now - (12 - k) * D),
    }),
  );
  // jejak audit
  [
    ['prompt.save', 'uid-rina', 'review@2', now - 9 * D],
    ['prompt.activate', 'uid-admin1', 'review@3', now - 2 * D],
    ['member.add', 'uid-admin1', '2105', now - 12 * D],
    ['machine.revoke', 'uid-admin1', 'mesin-lama', now - 5 * D],
    ['rule.approve', 'uid-rina', 'live-rule-3', now - 4 * D],
  ].forEach(([action, actorUid, target, at], k) =>
    batch.set(db.doc(`auditLog/live-${k}`), { action, actorUid, target, data: {}, createdAt: ts(at) }),
  );
  await batch.commit();
  return { machines: machines.filter((m) => !m[6] && m[5] > now - H).map((m) => m[0]) };
}

/** MOCK: simulator heartbeat supaya mesin dummy tetap "online" selama `npm run dev` berjalan. */
export function startHeartbeatSimulator(db, machineIds, intervalMs = 30_000) {
  const beat = () =>
    Promise.all(
      machineIds.map((id) => db.doc(`machines/${id}`).update({ lastSeenAt: FieldValue.serverTimestamp() })),
    ).catch(() => undefined);
  void beat();
  return setInterval(beat, intervalMs);
}
