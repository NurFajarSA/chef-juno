---
name: desain-dari-domain
description: Tipe & struktur data mengikuti domain — validasi di batas sistem, state yang mustahil tidak bisa direpresentasikan, aturan bisnis di satu tempat.
category: inti
---

# Desain dari domain

Banyak bug lahir dari data yang bentuknya mengizinkan keadaan mustahil.

- **Validasi di batas sistem**, bukan di dalam: input dari luar (request, Firestore, JSON, deep link) diparse & divalidasi
  sekali di tepi, lalu kode di dalam memakai tipe yang sudah pasti. Validasi yang hilang di batas = temuan; validasi
  berulang di dalam karena tipe longgar = tanda desain bocor.
- **State mustahil tidak bisa direpresentasikan.** Kombinasi flag/opsional yang membuka keadaan tidak masuk akal
  (mis. `isPaid=false` tapi `paidAt` terisi) → usulkan tipe yang mengunci keadaan sah (enum/sealed class/union).
- **Aturan bisnis di satu tempat.** Aturan yang sama (mis. "jawaban benar = skor tertinggi") dihitung ulang di beberapa
  tempat dengan cara sedikit berbeda → temuan; arahkan ke satu fungsi sumber kebenaran.
- **Nama mengikuti bahasa domain** tim, bukan istilah teknis acak; nama yang menyesatkan arti data = temuan maintainability.
- **Nilai khusus** (nol, kosong, seri, varian/segmen/mode lain) harus ditangani eksplisit oleh tipe atau kode, bukan
  kebetulan.
