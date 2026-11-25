import type { JobContext } from '../daemon.js';
import { isAppRule, applicableRules, loadActiveRules, loadPerson, repoFacts, topMistakes } from '../memory/data.js';

/**
 * Aturan tim aktif yang cocok + profil penulis PR (kesalahan berulang) untuk prompt review (§6.8.4).
 * Level penulis (junior/mid/senior) dihapus atas keputusan pemilik (24 Nov 2026): gaya penjelasan sama untuk semua anggota.
 */
const STYLE_HINT = 'Gaya penjelasan sama untuk semua anggota: jelaskan masalahnya, kenapa penting, dan cara benarnya.';

export async function memoryContext(
  ctx: JobContext,
  files: string[],
): Promise<{ teamRules: { id: string; text: string }[]; authorProfile: string | null }> {
  const job = ctx.job;
  let teamRules: { id: string; text: string }[] = [];
  try {
    const all = await loadActiveRules(ctx.session.db);
    // aturan "Uji aplikasi:" (lama) khusus penguji aplikasi
    const rules = all.filter((r) => !isAppRule(r.text));
    teamRules = [
      ...applicableRules(rules, job.repo?.id ?? null, files).map((r) => ({ id: r.id, text: r.text })),
      // memory Chef Juno: fakta yang diingat (uji aplikasi, `@chefjuno ingat`, dashboard)
      ...repoFacts(all, job.repo?.id ?? null).map((r) => ({ id: r.id, text: `Fakta yang diingat: ${r.text}` })),
    ];
  } catch (e) {
    ctx.daemon.log(`⚠ aturan tim tidak terbaca: ${(e as Error).message}`);
  }
  const login = String(job.pr?.authorLogin ?? '');
  const parts = [`Penulis: @${login}. ${STYLE_HINT}`];
  try {
    const p = await loadPerson(ctx.session.db, login);
    const top = topMistakes(p);
    if (top.length)
      parts.push(
        'Kesalahan yang sering diulang penulis ini (periksa area ini lebih teliti):',
        ...top.map((m) => `- ${m.title} (${m.category}, ${m.count}x)`),
      );
  } catch {
    // profil opsional
  }
  return { teamRules, authorProfile: login ? parts.join('\n') : null };
}
