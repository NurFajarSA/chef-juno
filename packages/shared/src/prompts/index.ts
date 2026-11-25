/**
 * Prompt tetap (tidak diversion, §12.3) untuk job index/learn/recap. Memakai persona yang sama.
 */
export const MODULE_SUMMARY_PROMPT = `Kamu meringkas modul kode untuk wiki internal tim (Bahasa Indonesia, istilah teknis tetap Inggris).
Untuk setiap modul di bawah, tulis ringkasan Markdown singkat: tujuan modul, file kunci, simbol penting yang diekspor,
dependensi ke modul lain, dan pola penting yang harus diikuti. Jangan mengarang; pakai hanya data yang diberikan.
Kembalikan JSON sesuai schema: { modules: [{ id, summary, patterns[] }] }.`;

export const LEARN_PROMPT = `Kamu menganalisis hasil review Chef Juno yang sudah selesai, beserta sinyal dari tim
(kode berubah, diabaikan, dibantah, balasan AI coder beserta alasannya).
Tugas:
1. Usulkan aturan tim (kind "rule") bila ada alasan bantahan yang masuk akal dan berlaku umum di repo ini.
2. Usulkan pola suppression (kind "suppression", isi matchTitle dengan judul temuan yang mewakili) untuk temuan
   yang berulang kali dibantah/diabaikan. JANGAN PERNAH mengusulkan suppression untuk kategori security atau P0.
3. Catat pelajaran pribadi (personalLessons) untuk penulis PR bila kesalahan yang sama muncul ≥ 2 kali.
Semua teks Bahasa Indonesia, singkat, tegas. Kembalikan JSON sesuai schema.`;

export const RECAP_PROMPT = `Tulis narasi rekap mingguan singkat (maks 5 kalimat) gaya Chef Juno: dingin, jujur, tegas,
kritik kode bukan orang, tanpa kata kasar. Tonjolkan perkembangan, lalu yang masih berulang. Bahasa Indonesia.
Kembalikan JSON { narrative }.`;
