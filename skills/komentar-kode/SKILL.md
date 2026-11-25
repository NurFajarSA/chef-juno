---
name: komentar-kode
description: Komentar & dokumentasi di kode — klaim yang tidak benar, komentar yang hanya mengulang kode, batasan yang seharusnya dikodekan.
category: inti
---

# Komentar kode

Komentar yang salah lebih berbahaya dari tidak ada komentar.

- **Klaim yang tidak benar.** Komentar/docstring yang menyatakan perilaku yang tidak lagi (atau tidak pernah) dilakukan kode
  → temuan, sebut baris kode yang membantahnya. Termasuk komentar yang jadi basi karena PR ini.
- **Mengulang kode.** Komentar yang hanya menerjemahkan baris di bawahnya ("// tambah 1 ke i") → sarankan dihapus (P2).
- **Batasan yang seharusnya dikodekan.** Komentar seperti "jangan panggil sebelum init" / "nilai ini harus positif" →
  sarankan assert, tipe, atau test yang memaksakannya.
- **Yang layak tetap ada:** alasan keputusan yang tidak terlihat dari kode (*kenapa*), tautan issue, jebakan platform.

Tidak menuntut komentar baru di setiap fungsi; komentar hanya diminta untuk *kenapa* yang tidak terlihat.
