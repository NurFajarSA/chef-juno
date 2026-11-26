// Daftar prompt berversi Chef Juno (dipakai gen-default-prompts.mjs & release.mjs).
// Urutan = urutan tampil di dashboard. Inti (persona, review) dipakai semua mode; sisanya cara kerja agent di mesin.
export const PROMPT_META = [
  ['persona', 'Persona Chef Juno', 'Karakter dan gaya bicara reviewer'],
  ['review', 'Instruksi review', 'Cara mereview PR dan format temuan'],
  ['method', 'Cara kerja reviewer', 'Tujuan, cara kerja (serang premis PR), prinsip, subagent, batas — mode tujuan'],
  ['final', 'Reviewer akhir', 'Menggabung & memutuskan temuan (mode mendalam)'],
  ['triage', 'Triase PR', 'Memilih area risiko dan lensa (mode mendalam)'],
  ['validate', 'Validator temuan', 'Membuktikan/membantah satu temuan (mode mendalam)'],
  ['tester', 'Penguji aplikasi', 'Agent yang menjalankan app PR, membandingkan base vs PR, menyimpan bukti'],
  ['tester-plan', 'Rencana uji aplikasi', 'Menyusun skenario uji per temuan ({{BACKEND}} diganti aturan backend)'],
  ['tester-judge', 'Penilai uji aplikasi', 'Menilai skeptis hasil uji per temuan'],
];
