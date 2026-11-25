# Dokumentasi Chef Juno

Chef Juno adalah reviewer kode untuk tim: membaca pull request di GitHub, mereview dengan Claude Code atau Codex
**di mesin milik tim** (memakai langganan, tanpa API key), membalas langsung di PR, lalu **mencoba perubahannya di
aplikasi** (emulator lokal) sebelum PR boleh lulus. Ia belajar dari keputusan tim, mengingat fakta yang diajarkan,
memahami struktur repo lewat knowledge base, dan memberi rapor perkembangan tiap minggu.

| Halaman | Isi |
|---|---|
| [Ringkasan & arsitektur](01-ringkasan.md) | Komponen, di mana tiap bagian berjalan, alur data |
| [Cara kerja review](02-cara-kerja-review.md) | Dari `lapor @chefjuno` sampai komentar di PR: antrean, mesin, konteks, posting, gate, pantau di dashboard |
| [Standar review](03-review-mendalam.md) | Satu standar: triase → putaran spesialis paralel → validasi → reviewer akhir |
| [Model & biaya](04-model-dan-biaya.md) | Sonnet mengerjakan, Opus memutuskan; nama model & effort per tingkat |
| [Memory & knowledge base](05-memory-dan-knowledge.md) | Belajar dari tim, fakta `@chefjuno ingat`, code map, rapor, server MCP |
| [Kustomisasi](06-kustomisasi.md) | 10 skill inti, skill tim, aturan tim, file aturan repo, `.chefjuno/verify.json`, pengaturan |
| [Uji aplikasi](09-uji-aplikasi.md) | Penguji agent mencoba app PR di emulator lokal, bukti screenshot, gate "Belum teruji" |
| [Keamanan](07-keamanan.md) | Isolasi agent, penguji tepercaya, log aktivitas, data yang dikirim, security rules |
| [Referensi perintah](08-referensi-perintah.md) | Perintah di PR (`lapor`, `ingat`), CLI mesin, status job |

Cara menyiapkan instalasi baru ada di [`docs/SETUP.md`](../SETUP.md); admin pertama juga dipandu halaman **Setup** di dashboard.
