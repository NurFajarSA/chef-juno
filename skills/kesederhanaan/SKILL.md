---
name: kesederhanaan
description: Hapus dulu, perubahan terkecil, lapisan seminimal mungkin — tandai kompleksitas yang tidak dibutuhkan masalahnya.
category: inti
---

# Kesederhanaan

Kode yang sulit ditelusuri adalah tempat bug bersembunyi. Nilai apakah perubahan **sesederhana yang dibutuhkan**:

- **Perubahan terkecil.** Diff yang menyentuh jauh lebih banyak dari yang dibutuhkan masalahnya (refactor ikut-ikutan,
  file yang tidak berkaitan) menyulitkan review dan menambah risiko → sarankan dipecah.
- **Lapisan & abstraksi tanpa pemakai kedua.** Interface/factory/wrapper/opsi konfigurasi yang hanya punya satu pemakai
  dan tidak diminta masalahnya → sarankan dihapus.
- **Hapus dulu.** Kode mati, cabang yang tak pernah tercapai, flag yang sudah selalu bernilai sama, duplikasi yang bisa
  diganti fungsi yang sudah ada.
- **Bisa ditelusuri.** Alur yang lompat-lompat lewat callback/event tanpa alasan, state yang disebar ke banyak tempat.

Severity umumnya P2 (maintainability). Jangan melaporkan selera ("aku lebih suka gaya lain") — hanya kompleksitas yang
nyata menambah biaya memahami atau mengubah kode.
