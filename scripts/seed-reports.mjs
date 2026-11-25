// Data seed BERLABEL untuk rapor (§9 Fase 7): angka yang diharapkan sudah dihitung manual — lihat EXPECTED.
import { Timestamp } from 'firebase-admin/firestore';

const DAY = 86400_000;
const weekStartMs = (w) => Date.parse(`${w}T00:00:00+07:00`);
const addWeeks = (w, n) => new Date(weekStartMs(w) + n * 7 * DAY + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Minggu W (weekStart) dan 3 minggu sebelumnya.
 * dev2  W   : 2 PR (skor 3, 4), temuan bug×2 + test×1, outcome addressed, addressed, disputed
 * dev2  W-1 : 2 PR (skor 2, 3), temuan bug×4 + test×2, outcome addressed×1, ignored×5
 * dev2  W-2 : 1 PR (skor 3), bug×2
 * dev2  W-3 : 1 PR (skor 3), bug×3
 * dev3  W   : 1 PR skor 5 tanpa temuan
 * dev3  W-1 : 1 PR skor 4, maintainability×1 (addressed)
 */
export async function seedReportFixture(db, weekStart) {
  const plan = [
    [
      'dev2',
      0,
      101,
      3,
      [
        ['bug', 'P1', 'addressed'],
        ['bug', 'P2', 'addressed'],
        ['test', 'P2', 'disputed'],
      ],
    ],
    ['dev2', 0, 102, 4, []],
    [
      'dev2',
      -1,
      91,
      2,
      [
        ['bug', 'P0', 'addressed'],
        ['bug', 'P1', 'ignored'],
        ['bug', 'P1', 'ignored'],
        ['test', 'P2', 'ignored'],
      ],
    ],
    [
      'dev2',
      -1,
      92,
      3,
      [
        ['bug', 'P2', 'ignored'],
        ['test', 'P2', 'ignored'],
      ],
    ],
    [
      'dev2',
      -2,
      81,
      3,
      [
        ['bug', 'P1', 'ignored'],
        ['bug', 'P2', 'ignored'],
      ],
    ],
    [
      'dev2',
      -3,
      71,
      3,
      [
        ['bug', 'P1', 'ignored'],
        ['bug', 'P1', 'ignored'],
        ['bug', 'P2', 'ignored'],
      ],
    ],
    ['dev3', 0, 201, 5, []],
    ['dev3', -1, 191, 4, [['maintainability', 'P2', 'addressed']]],
  ];
  const batch = db.batch();
  let k = 0;
  for (const [login, wk, pr, score, fs] of plan) {
    const t = weekStartMs(addWeeks(weekStart, wk)) + 2 * DAY + 3600_000 * (k % 5);
    const jobId = `rep-${login}-${pr}`;
    batch.set(db.doc(`jobs/${jobId}`), {
      type: 'review',
      status: 'posted',
      repo: { id: 4242, fullName: 'tim/sample-repo', installationId: 777 },
      pr: {
        number: pr,
        title: `PR ${pr} oleh ${login}`,
        authorLogin: login,
        htmlUrl: `https://github.com/tim/sample-repo/pull/${pr}`,
      },
      promptVersions: { persona: 1, review: 1 },
      result: {
        score,
        findings: fs.map(([category, severity]) => ({ category, severity, title: `${category} di PR ${pr}` })),
      },
      createdAt: Timestamp.fromMillis(t),
    });
    fs.forEach(([category, severity, outcome], i) => {
      batch.set(db.doc(`findings/rep-${pr}-${i}`), {
        jobId,
        repoFullName: 'tim/sample-repo',
        prNumber: pr,
        prAuthorLogin: login,
        path: 'src/a.ts',
        line: 10 + i,
        severity,
        category,
        title: category === 'bug' ? 'Hasil fetchUser tidak dicek null' : `${category} di PR ${pr}`,
        body: '',
        outcome,
        promptVersions: { persona: 1, review: 1 },
        createdAt: Timestamp.fromMillis(t + 60_000),
      });
    });
    k++;
  }
  batch.set(
    db.doc('people/dev2'),
    {
      recurringMistakes: [
        {
          key: 'bug:null',
          title: 'Hasil fetchUser tidak dicek null',
          category: 'bug',
          count: 9,
          firstSeen: addWeeks(weekStart, -3),
          lastSeen: weekStart,
          trend: 'down',
        },
        {
          key: 'test:error-path',
          title: 'Jalur error belum punya test',
          category: 'test',
          count: 3,
          firstSeen: addWeeks(weekStart, -1),
          lastSeen: weekStart,
          trend: 'flat',
        },
        {
          key: 'bug:await',
          title: 'Promise tidak di-await',
          category: 'bug',
          count: 2,
          firstSeen: addWeeks(weekStart, -2),
          lastSeen: addWeeks(weekStart, -1),
          trend: 'down',
        },
      ],
      lessons: [
        { text: 'Nilai yang bisa null harus dicek sebelum dipakai.', prNumber: 101, at: weekStart },
        { text: 'Setiap jalur error butuh test.', prNumber: 91, at: addWeeks(weekStart, -1) },
      ],
    },
    { merge: true },
  );
  await batch.commit();
}

export const EXPECTED = {
  dev2: {
    prsReviewed: 2,
    avgScore: 3.5,
    findings: 3,
    bug: 2,
    test: 1,
    addressedRate: 0.67,
    prevPrs: 2,
    prevFindings: 6,
    prevAddressedRate: 0.17,
    findingsPerPr: 1.5,
    prevFindingsPerPr: 3,
    improvement: 1.5,
    bugDevPct: -33,
  },
  dev3: { prsReviewed: 1, avgScore: 5, findings: 0, improvement: 1 },
  team: { prsReviewed: 3, findings: 3, avgScore: 4, mostImproved: ['dev2', 'dev3'] },
};
