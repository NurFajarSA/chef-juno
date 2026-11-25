---
name: akar-masalah
description: Satu temuan adalah satu kelas cacat — telusuri sampai penyebabnya, cari saudaranya di pemanggil & tempat lain (code map), nilai dari kasus terburuk.
category: inti
---

# Akar masalah & kelas cacat

Sebelum menulis temuan, tanya: *kenapa* ini salah, dan *di mana lagi* pola yang sama terjadi?

1. **Akar, bukan gejala.** Telusuri sampai penyebabnya (data yang salah bentuk, aturan yang dipakai di tempat yang salah,
   asumsi yang tidak dijaga). Perbaikan di gejala yang membiarkan penyebabnya hidup = temuan.
2. **Saudara sejenis.** Cari pola yang sama di pintu masuk lain: route, handler, worker, cron, layar lain, helper kembaran.
   Pakai "Konteks dari peta kode" dan tool code map (`find_symbol`, `get_callers`, `get_callees`, `get_impact`), lalu Read/Grep.
3. **Pemanggil.** PR mengubah signature, nilai kembali, atau perilaku → periksa **setiap** pemanggil. Yang tidak ikut diubah
   dan jadi salah = temuan (sebut file & fungsinya).
4. **Satu temuan per kelas.** Nilai keparahan dari saudara terburuk; sebut saudara lainnya di `what`, jangan pecah jadi banyak
   temuan.

## Selalu P0

Tiga kelas ini P0 di mana pun, tidak boleh diturunkan:
- **Kehilangan/kerusakan data** (hapus/tulis ulang tanpa syarat, migrasi tanpa jalan balik).
- **Bypass batas kepercayaan**: auth, otorisasi, tenancy, security rules, verifikasi webhook, sandbox, redaksi data dilewati
  (termasuk cache baru di depan panggilan yang dijaga).
- **Biaya tanpa batas**: panggilan berbayar, retry, atau loop tanpa batas atas.
