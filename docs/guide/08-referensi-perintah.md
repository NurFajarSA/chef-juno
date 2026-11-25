# Referensi perintah

## Di pull request

| Perintah | Efek |
|---|---|
| `lapor @chefjuno` (atau `cek` / `review`; `@chefjuno lapor` juga bisa) | Review PR ini dengan [satu standar](03-review-mendalam.md), lalu uji aplikasi |
| `lapor @chefjuno <instruksi>` | Review dengan instruksi tambahan, mis. `lapor @chefjuno fokus ke query SQL` |
| `@chefjuno ingat <fakta>` (`catat` / `remember`) | Simpan fakta ke memory Chef Juno untuk repo ini, mis. `@chefjuno ingat akun uji harus premium supaya kuis terbuka`. Dibalas 🧠 |
| `@chefjuno bantuan` (`help`) | Tampilkan daftar perintah |
| Balas thread temuan: `chefjuno: diperbaiki` | Tandai temuan sudah diperbaiki (dipakai AI coder) |
| Balas thread temuan: `chefjuno: tidak diperbaiki — <alasan>` | Bantah dengan alasan; bahan belajar Chef Juno |

Kata `dalam` / `standar` di awal instruksi (perintah lama) diabaikan — tidak mengubah apa pun.

Reaksi Chef Juno di komentar pemicu: 👀 diterima → 👍 diposting, 😕 gagal.

## CLI mesin reviewer

| Perintah | Fungsi |
|---|---|
| `chefjuno login --server <url> --code XXXX-XXXX` | Daftarkan mesin (kode dari dashboard / Setup) |
| `chefjuno start [--agents claude,codex] [--no-app]` | Nyalakan mesin: bersihkan sisa uji aplikasi (`agentTest.cleanup`), heartbeat, ambil job. `--no-app`: mesin tanpa emulator — hanya mengambil review kode, uji aplikasi dibiarkan untuk mesin yang punya emulator |
| `chefjuno status` | Status mesin |
| `chefjuno logout` | Hapus kredensial lokal |
| `chefjuno memory pull --login <github>` | Tulis memory tim + kesalahan berulangmu ke file untuk agent pribadi |
| `chefjuno memory-mcp` | Server MCP memory tim (stdio) |
| `chefjuno graph-mcp --db <graph.db> --root <dir>` | Server MCP code map (stdio) |

## Status job

Jenis job: `review`, `app-verify` (uji aplikasi lanjutan setelah review diposting), `index` (code map), `learn` (belajar
dari PR yang ditutup), `recap` (narasi rapor).

| Status | Arti |
|---|---|
| `queued` | Menunggu mesin |
| `claimed` / `running` | Dipegang mesin (lease 10 menit, diperpanjang selama bekerja) |
| `completed` | Hasil sudah ditulis mesin, menunggu diposting |
| `posted` | Sudah tampil di PR |
| `failed` | Gagal (tahap tercatat: agent, parse, timeout, leak, lease, stale, …) |
| `cancelled` | Dibatalkan: PR ditutup, digantikan review untuk commit yang lebih baru, atau tombol **Batalkan** |

**Membatalkan.** Di detail review, admin atau orang yang meminta review melihat tombol **Batalkan review** (atau
**Batalkan uji aplikasi**) selama review/ujinya berjalan. Review dan uji aplikasi turunannya dibatalkan; mesin yang
mengerjakannya langsung menghentikan agent (app sisa uji tetap dibereskan) dan status commit **Chef Juno** diberi tahu.
Minta review untuk commit baru di PR yang sama → review & uji commit lama yang belum selesai otomatis dibatalkan.

**Posting ulang.** Review yang selesai tapi gagal diposting (status gagal, tahap `post`, mis. GitHub sedang gangguan)
menampilkan tombol **Posting ulang ke GitHub** untuk admin atau peminta review. Hasil yang sudah tersimpan diposting
lagi tanpa menjalankan agent. Tombol ditolak bila sudah ada review yang lebih baru untuk PR yang sama.

## Status merge di dashboard

| Label | Kapan |
|---|---|
| Siap merge | Review lengkap, skor ≥ 4 |
| Perlu perbaikan | Skor < 4 |
| Review sebagian | Skor ≥ 4 tapi review tidak lengkap (diff terpotong / agent `incomplete`) |
| Sedang direview · Review gagal · Sudah di-merge · Ditutup · Dibatalkan | Sesuai status job & PR |
