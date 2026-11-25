---
name: migrasi-tuntas
description: Kalau PR memperkenalkan cara baru, semua pemakai cara lama dipindah dan cara lama dihapus atau dikunci — dua cara yang hidup berdampingan melahirkan bug.
category: inti
---

# Migrasi tuntas

Setiap PR yang memperkenalkan cara baru (helper, API internal, aturan perhitungan, sumber data, komponen, theme) harus
menjawab tiga pertanyaan:

1. **Masih ada pemakai cara lama?** Grep/code map untuk semua pemanggil lama. Pemakai yang tertinggal dan kini memakai
   aturan yang berbeda dari bagian lain = temuan (contoh nyata: satu layar masih membaca tabel skor induk padahal helper
   baru yang mengenali segmen sudah dipakai di layar lain → angka yang ditampilkan saling bertentangan).
2. **Cara lama dihapus atau dikunci?** Kalau dibiarkan, orang berikutnya akan memakainya lagi. Usulkan penghapusan, atau
   penjaga (lint, test aturan repo, deprecation) bila penghapusan harus bertahap.
3. **Migrasi bertahap tertulis jelas?** Kalau memang sengaja dua fase, fase & batasnya harus tertulis (deskripsi PR, issue,
   komentar di titik transisi). Tanpa itu = temuan.

Jangan menuntut migrasi untuk hal yang memang tidak berkaitan dengan perubahan PR.
