# Skill bawaan Chef Juno

Folder ini berisi skill bawaan reviewer (format skill Claude Code: satu folder per skill berisi `SKILL.md`).
Skill di sini dibundel ke aplikasi (`node scripts/gen-default-prompts.mjs` → `packages/shared/src/prompts/defaults.ts`)
dan dipasang **aktif** saat Setup pertama, atau lewat tombol "Pulihkan skill bawaan" di halaman Skills.

Hanya **skill inti**: prinsip cara berpikir & membuktikan yang berlaku di repo & stack apa pun. Pengetahuan teknis
umum (bahasa, framework, database) sudah dikuasai model, jadi tidak dijadikan skill. Pengetahuan khusus repo
(cara menjalankan app, akun uji, konvensi) ada di adapter repo (`CLAUDE.md`, skill verify) dan memory Chef Juno.
Tim tetap bisa mengimpor skill sendiri; beri frontmatter `category: domain` dan `paths` bila hanya untuk file tertentu.

Isinya adaptasi (ditulis ulang, bukan disalin) dari praktik review publik:
- Kriteria temuan & gaya komentar — rubrik review OpenAI Codex (`codex-rs/prompts/templates/review/rubric.md`, Apache-2.0).
- Kelengkapan review, kemungkinan × dampak, kredensial, atribusi — `openclaw/agent-skills` skill `autoreview` (MIT).
- Sapu samping, kelas selalu-P0, daftar temuan palsu — `garrytan/gstack` `review/checklist.md` (MIT).
- Review keamanan, ambang keyakinan, pengecualian — `anthropics/claude-code-security-review` (MIT) dan plugin `code-review` resmi Anthropic.
- Penyaringan verdict (nitpick gravity, ≤ 5 hal penting) — `adamsardo/pstack-claude` skill `interrogate`.
