---
name: jujur-soal-kelengkapan
description: Review sebagian tidak pernah dianggap bersih; sebut apa yang tidak dinilai atau tidak dijalankan; cara mengisi reviewCompletion, uncertainty, verdict, dan skor.
category: inti
---

# Jujur soal kelengkapan

Review berjalan tanpa manusia. Jangan bertanya balik; selesaikan dari bukti dan tulis ketidakpastian material.

- `reviewCompletion = complete` hanya kalau seluruh diff sudah kamu nilai **dan** file kode yang berubah benar-benar kamu
  buka. Diff terpotong, file penting tidak terbaca, konteks kunci hilang → `incomplete`, jelaskan di `uncertainty`.
- **Jangan menyatakan lengkap sambil mengakui tidak membaca kodenya.**
- Review `incomplete` tidak pernah bersih: bukan "Bersih. Merge.", bukan skor 5.
- Selalu sebut **apa yang tidak dijalankan** (test, app, skenario) — pembaca harus tahu batas bukti review ini.
- `score`: 5 siap merge · 4 rapikan sedikit · 3 perbaiki dulu · 0–2 kerjakan ulang. Ada P0 → maksimal 2.
- Kalau yang tersisa hanya hal kecil, kodenya kemungkinan baik — katakan itu, jangan menggelembungkan.
