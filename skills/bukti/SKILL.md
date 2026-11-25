---
name: bukti
description: Fondasi review — bedakan temuan terukur (dibuktikan dengan menjalankan sesuatu) dari temuan disimpulkan (dari membaca kode); hanya yang terbukti boleh memblokir.
category: inti
---

# Bukti, bukan pendapat

Reviewer kelas dunia jarang memblokir, tapi selalu membuktikan. Setiap temuan punya **jenis bukti**:

- **Terukur (measured):** kamu benar-benar menjalankan sesuatu dan hasilnya sesuai prediksi — test yang gagal, perintah/probe
  yang menunjukkan perilaku salah, app yang dicoba dan menampilkan hasil keliru. Sebut perintah/langkahnya.
- **Disimpulkan (inferred):** dari membaca kode, jalur eksekusinya kamu telusuri tapi belum dijalankan. Sebut apa yang perlu
  dicek untuk membuktikannya.

## Aturan

1. Temuan perilaku hanya boleh **P0/P1 kalau terukur**, atau jalurnya ditelusuri tuntas sampai baris yang pasti salah dengan
   input pemicu yang konkret. Yang tidak bisa dibuktikan turun ke P2 *disimpulkan* dengan "yang perlu dicek".
2. **Kalau bisa dijalankan, jalankan.** Test yang relevan, probe kecil di checkout, skrip satu baris — lebih kuat dari
   argumen panjang. Jangan mengubah repo; jalankan hanya yang aman (tanpa jaringan ke produksi, tanpa menulis data asli).
3. **Belum teruji ≠ lulus ≠ gagal.** Sebut terang-terangan apa yang tidak kamu jalankan atau tidak bisa kamu nilai.
4. **Konteks yang tidak terlihat bukan bukti.** Tidak menemukan pemanggil atau file bukan alasan melapor; cari dulu
   (Read/Grep/code map). Masih tidak pasti → tulis di `uncertainty`, jangan jadikan temuan.
5. **Fakta di atas pendapat.** Data, test, dan aturan repo mengalahkan selera. "Aku akan menulisnya beda" bukan temuan.

## Keyakinan (`confidence`)

Keyakinan mengikuti bukti, bukan perasaan:
- **0.95+**: terukur (dijalankan & terlihat salah).
- **0.85–0.95**: jalur & input pemicu ditelusuri tuntas, belum dijalankan.
- **0.7–0.85**: pola jelas salah, satu asumsi belum dicek — sebut di `trigger`/`uncertainty`.
- **< 0.7**: jangan dilaporkan.
