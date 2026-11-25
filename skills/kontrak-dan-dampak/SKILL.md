---
name: kontrak-dan-dampak
description: Perubahan yang melewati batas sistem — kontrak API & klien versi lama, data & konkurensi (atomisitas, idempotensi, transisi status), migrasi, waktu.
category: inti
---

# Kontrak & dampak lintas batas

Bug paling mahal ada di batas: antara backend & app, antara dua aktor yang berjalan bersamaan, antara data lama & kode baru.

## Kontrak
- **Klien tidak di-update serentak.** App mobile versi lama tetap dipakai berminggu-minggu. Rename/hapus field, ubah tipe,
  ubah wajib/opsional, hapus endpoint → versi lama rusak (P1; P0 bila login/pembayaran). Beri masa transisi.
- **Nilai enum baru** dari server: klien tanpa fallback untuk nilai tak dikenal bisa crash.
- **Field wajib baru** dari klien: request versi lama tidak mengirimnya → server butuh default.
- **Perubahan semantik diam-diam**: field sama, arti beda (satuan, zona waktu, sen vs rupiah).
- Temukan **semua** konsumen kontrak (app, service lain, job) lewat code map; di monorepo, cek paket yang bergantung.

## Data & konkurensi
- **Read-check-write tanpa atomisitas** → duplikat, saldo negatif. Butuh transaksi/constraint unik.
- **Transisi status** harus dicek atomik terhadap status lama.
- **Idempotensi**: retry, webhook terkirim ulang, job diulang, tombol ditekan dua kali → harus aman diulang.
- **Setengah jalan**: operasi multi-langkah gagal di tengah → data tidak konsisten tanpa rollback/rekonsiliasi.
- **Konvergen setelah crash/restart**: operasi harus aman dijalankan ulang dari titik mana pun.

## Migrasi & waktu
- Migrasi skema/data tanpa jalan balik; penghapusan tanpa filter; induk dihapus tanpa menangani anak.
- Zona waktu tercampur, batas hari/bulan, jam perangkat pengguna dipercaya untuk hal penting.
