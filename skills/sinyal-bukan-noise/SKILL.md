---
name: sinyal-bukan-noise
description: Kapan sebuah masalah pantas jadi temuan, kapan diam; label Nit/Consider/FYI; daftar temuan palsu yang umum; cara menulis komentar yang langsung dipahami.
category: inti
---

# Sinyal, bukan noise

Satu temuan palsu merusak kepercayaan lebih cepat dari sepuluh temuan benar membangunnya. **Nol temuan adalah hasil sah.**

## Laporkan hanya kalau semua benar
1. Berdampak nyata (kebenaran, keamanan, performa, biaya merawat) dan **diperkenalkan PR ini**.
2. Spesifik: satu masalah, satu lokasi, satu perbaikan yang jelas.
3. Engineer senior di tim ini akan mengubahnya kalau tahu.
4. Klaim "merusak bagian lain" menunjukkan bagian itu (file + fungsi).
5. Bukan perubahan yang jelas disengaja (baca deskripsi PR & diskusi).

Hal kecil yang tidak memblokir → `severity` P2 dan awali judul dengan **Nit:**, **Consider:**, atau **FYI:**.

## Jangan laporkan
- Masalah lama di baris yang tidak disentuh PR; yang ditangkap linter/formatter/type checker.
- "Possible null" padahal sudah dipersempit guard; "tambah error handling" padahal ditangani pemanggil/framework.
- N+1 pada loop kecil tetap; "fungsi terlalu panjang" untuk switch lengkap/konfigurasi/tabel test; hardcode di fixture.
- Saran refactor besar tanpa masalah konkret; konsistensi gaya yang tidak mengubah perilaku.
- Apa pun yang sudah ditangani di bagian lain diff (baca diff sampai habis); pola yang di-suppress memory tim.

## Temuan keamanan
- Hanya kalau **jalur datanya bisa ditelusuri** dari input yang dikendalikan pengguna sampai titik berbahaya; `trigger` wajib
  berisi skenario eksploitasinya. "Bisa jadi celah injeksi" tanpa jalur input bukan temuan. Keyakinan < 0.8 → `uncertainty`.
- Bandingkan dengan pola aman yang sudah dipakai repo (validasi, middleware auth, security rules); penyimpangan = kandidat.
- Kredensial asli di kode/log/error → selalu P0, dan **jangan pernah mengulang nilainya**. Placeholder & fixture bukan kredensial.
- Nilai buatan LLM (URL, query, kode) yang disimpan/dieksekusi/di-fetch tanpa validasi = batas kepercayaan.
- Jangan laporkan (kecuali aturan tim memintanya): DoS/ketiadaan rate limit, validasi field tidak kritis tanpa masalah
  terbukti, rahasia yang disimpan di secret manager sebagaimana mestinya.

## Menulis temuan
- `title`: **akibat** bagi pengguna/sistem (≤ 70 karakter), bukan gejala kode. Baik: "Promo baru tetap ditolak walau
  sudah berlaku". Buruk: "Hasil `fetchUser` tidak dicek null".
- `what`: mekanisme konkret — identifier dalam backtick, jalur eksekusi, skenario pemicu nyata.
- `why`: dampak nyata 1–2 kalimat, tanpa melebih-lebihkan. `trigger`: input/keadaan pemicu.
- `fix`: apa yang diubah **dan test yang perlu ditambah**. `suggestion`: hanya kode pengganti yang langsung menyelesaikan
  masalah di baris itu (saran inline paling sering ditindaklanjuti).
- Nada datar, tegas, tanpa pujian, tanpa "mungkin bisa dipertimbangkan".
