import type { FindingRow, JobRow } from './rows';

export interface SkillInfo {
  slug: string;
  name: string;
  enabled: boolean;
  source: string;
  paths: string[];
  /** ukuran versi terbaru (semua file skill), null = belum terbaca */
  sizeBytes: number | null;
}

export interface SkillFlag {
  kind: 'warn' | 'good';
  text: string;
}

export interface SkillStat {
  slug: string;
  name: string;
  enabled: boolean;
  source: string;
  /** review yang memuat skill ini */
  loaded: number;
  /** review yang melewatinya karena `paths:` tidak cocok */
  skipped: number;
  /** review yang terpotong batas ukuran prompt */
  dropped: number;
  findings: number;
  decided: number;
  addressed: number;
  disputed: number;
  addressedRate: number | null;
  disputedRate: number | null;
  /** perkiraan token yang ditambahkan ke prompt setiap kali dimuat (≈ 4 karakter / token) */
  approxTokens: number | null;
  /** temuan per 10 review yang memuatnya */
  per10: number | null;
  /** contoh temuan yang dibantah tim (bahan perbaikan skill) */
  disputedExamples: { title: string; jobId: string; reason: string | null }[];
  flags: SkillFlag[];
}

/** Ambang saran perbaikan (dengan jumlah sampel minimum supaya tidak menyimpulkan dari 1–2 kasus). */
export const SKILL_RULES = {
  minDecided: 3,
  disputedHigh: 0.3,
  addressedGood: 0.7,
  idleLoads: 10,
  bigTokens: 2500,
  bigMinLoads: 5,
  neverLoadedSkips: 5,
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function skillStats(jobs: JobRow[], findings: FindingRow[], skills: SkillInfo[]): SkillStat[] {
  const reviews = jobs.filter((j) => j.type === 'review' && (j.status === 'posted' || j.status === 'completed'));
  const slugs = new Set<string>(skills.map((s) => s.slug));
  for (const j of reviews) for (const s of [...j.skillsLoaded, ...j.skillsSkipped, ...j.skillsDropped]) slugs.add(s);
  for (const f of findings) if (f.skill) slugs.add(f.skill);
  const info = new Map(skills.map((s) => [s.slug, s]));
  return [...slugs]
    .map((slug): SkillStat => {
      const s = info.get(slug);
      const loaded = reviews.filter((j) => j.skillsLoaded.includes(slug)).length;
      const skipped = reviews.filter((j) => j.skillsSkipped.includes(slug)).length;
      const dropped = reviews.filter((j) => j.skillsDropped.includes(slug)).length;
      const fs = findings.filter((f) => f.skill === slug);
      const decided = fs.filter((f) => f.outcome !== 'pending');
      const addressed = decided.filter((f) => f.outcome === 'addressed').length;
      const disputed = decided.filter((f) => f.outcome === 'disputed');
      const approxTokens = s?.sizeBytes != null ? Math.round(s.sizeBytes / 4) : null;
      const st: SkillStat = {
        slug,
        name: s?.name ?? slug,
        enabled: s?.enabled ?? false,
        source: s?.source ?? 'team',
        loaded,
        skipped,
        dropped,
        findings: fs.length,
        decided: decided.length,
        addressed,
        disputed: disputed.length,
        addressedRate: decided.length ? addressed / decided.length : null,
        disputedRate: decided.length ? disputed.length / decided.length : null,
        approxTokens,
        per10: loaded ? (fs.length / loaded) * 10 : null,
        disputedExamples: disputed.slice(0, 3).map((f) => ({ title: f.title, jobId: f.jobId, reason: f.aiReply })),
        flags: [],
      };
      st.flags = flagsFor(st, s);
      return st;
    })
    .sort((a, b) => Number(b.flags.some((f) => f.kind === 'warn')) - Number(a.flags.some((f) => f.kind === 'warn')) || b.loaded - a.loaded || a.name.localeCompare(b.name));
}

/** Saran perbaikan per skill. Bahasa langsung, berbasis angka periode yang dipilih. */
export function flagsFor(st: SkillStat, s: SkillInfo | undefined): SkillFlag[] {
  const R = SKILL_RULES;
  const out: SkillFlag[] = [];
  if (st.decided >= R.minDecided && (st.disputedRate ?? 0) >= R.disputedHigh)
    out.push({
      kind: 'warn',
      text: `Sering dibantah (${pct(st.disputedRate!)} dari ${st.decided} temuan yang sudah diputuskan). Perjelas kapan aturan ini berlaku dan tambahkan contoh yang bukan masalah.`,
    });
  if (st.loaded >= R.idleLoads && st.findings === 0)
    out.push({
      kind: 'warn',
      text: `Dimuat di ${st.loaded} review tanpa satu pun temuan. Kalau memang tidak relevan untuk repo ini, batasi dengan \`paths:\` atau nonaktifkan.`,
    });
  if ((st.approxTokens ?? 0) >= R.bigTokens && !(s?.paths.length ?? 0) && st.loaded >= R.bigMinLoads)
    out.push({
      kind: 'warn',
      text: `Besar (≈${st.approxTokens!.toLocaleString('id-ID')} token) dan selalu dimuat. Tambahkan \`paths:\` supaya hanya dimuat untuk file yang relevan.`,
    });
  if (st.enabled && st.loaded === 0 && st.skipped >= R.neverLoadedSkips)
    out.push({
      kind: 'warn',
      text: `Tidak pernah dimuat di periode ini: \`paths:\` tidak cocok di ${st.skipped} review. Cek pola path-nya.`,
    });
  if (st.dropped > 0)
    out.push({ kind: 'warn', text: `Terpotong batas ukuran prompt di ${st.dropped} review. Ringkas skill ini atau skill lain yang selalu dimuat.` });
  if (st.decided >= R.minDecided && (st.addressedRate ?? 0) >= R.addressedGood && !out.length)
    out.push({ kind: 'good', text: `Efektif: ${pct(st.addressedRate!)} temuannya diperbaiki penulis PR.` });
  return out;
}
