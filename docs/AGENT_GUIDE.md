# Panduan untuk AI coder (Claude Code / Codex) & tim

Chef Juno belajar dari **hasil**, bukan dari 👍/👎 manual. Bantu dengan membalas setiap temuan di thread komentarnya
(manusia atau AI coder kamu), memakai format baku ini:

| Situasi | Balasan |
|---|---|
| Sudah diperbaiki | `chefjuno: diperbaiki` atau `chefjuno: diperbaiki di <sha>` |
| Tidak diperbaiki (alasan **wajib**) | `chefjuno: tidak diperbaiki — <alasan>` |

Alasan yang dianjurkan: **sengaja**, **salah paham konteks**, **di luar scope**, **false positive** (boleh ditambah penjelasan).
Parser juga menerima variasi wajar: huruf besar/kecil bebas, `fixed`, `won't fix: …`, `wontfix - …`, `diperbaiki di abc1234`.

Contoh:
```
chefjuno: tidak diperbaiki — sengaja, sudah dicek di guard
chefjuno: diperbaiki di 3f2c1ab
chefjuno: won't fix: out of scope untuk PR ini
```

## Apa yang terjadi dengan balasanmu
1. Saat PR ditutup, `collectFeedback` menggabungkan sinyal (kode berubah di sekitar temuan, thread resolved, 👍/👎,
   balasan manusia, balasan AI coder, revert/fix susulan) → `outcome` tiap temuan: diperbaiki / dibantah / diabaikan / diterima (merge).
2. Job **learn** (agent langganan di mesin tim) mengusulkan **aturan tim** dan **pola yang ditekan** dari temuan yang dibantah.
   Usulan **tidak langsung berlaku** — admin menyetujui/menolak di dashboard → **Ingatan**.
3. Temuan `security` dan `P0` **tidak pernah** ditekan.

## Supaya agent pribadimu ikut belajar
```
node apps/daemon/dist/cli.js memory pull --login <github-login-mu>
```
Menulis `~/.chefjuno/memory/<login>.md` (aturan tim aktif + kesalahan yang sering kamu ulangi + pelajaran terbaru) dan
mencetak baris untuk ditambahkan ke `~/.claude/CLAUDE.md` (`@~/.chefjuno/memory/<login>.md`) atau `~/.codex/AGENTS.md`.
File konfigurasimu **tidak** diubah otomatis.

Server MCP memori (read-only) untuk dipasang di Claude Code / Codex milikmu:
```
node apps/daemon/dist/cli.js memory-mcp
```
Tool: `get_team_rules(repo)`, `get_my_lessons(login)`, `precheck_diff(diff, login)` (cek diff lokal terhadap kesalahan
yang sering kamu ulangi — tanpa LLM). Butuh mesin yang sudah `chefjuno login`.

Di dashboard, halaman **Rapor** tiap orang punya tombol **Salin memori untuk agent** (Markdown yang sama).
