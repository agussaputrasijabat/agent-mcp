/** Oldest built-in plan body still stored on existing databases. */
export const olderPlanBody = "# Rencana sebelum eksekusi\n\nTulis rencana singkat di chat. Setelah pengguna menjawab GO, kerjakan langkah itu berurutan. Sebelum GO, jangan menulis kode dan jangan mengubah file.\n\n## 1. Pahami permintaan\n\nUlangi permintaan dalam 2 sampai 3 kalimat. Sebut hasil yang dianggap selesai. Sebut fakta yang sudah ada di pesan pengguna, supaya hal itu tidak ditanya lagi.\n\n## 2. Tanya hanya keputusan yang mengubah rencana\n\nAjukan pertanyaan yang mengubah urutan, scope, atau cara kerja. Lewati hal yang sudah terjawab.\n\nMaksimal 4 pertanyaan. Tiap pertanyaan punya satu rekomendasi.\n\nJika tidak ada keputusan yang mengubah rencana, tulis Tidak ada pertanyaan. Lanjut ke rencana.\n\n## 3. Sebut asumsi\n\nKeputusan yang kamu ambil tanpa jawaban pengguna diberi tag [ASUMSI].\n\n## 4. Tulis langkah berurutan\n\nTiap langkah muat satu sesi kerja. Sebut apa yang diubah, di file atau area mana, lalu cara cek yang konkret. Cara cek berupa perintah, contoh request, atau langkah UI.\n\n## 5. Sebut yang di luar scope\n\nTuliskan hal yang tidak dikerjakan. Tiap butir disertai alasan singkat.\n\n## 6. Tunggu GO\n\nAkhiri dengan kalimat ini.\n\nBalas GO untuk mulai. Sebut bagian yang ingin diubah jika rencana ini belum pas.\n\nEksekusi baru boleh dimulai setelah pengguna menyetujui rencana. Kata GO, atau kalimat yang secara jelas menyuruh mulai, adalah persetujuan. Jawaban atas pertanyaan di langkah 2 belum berarti GO. Jika pengguna merevisi, perbarui rencana, lalu minta GO lagi.\n\n## Bentuk\n\nTujuan\nSatu kalimat.\n\nAsumsi\nButir dengan tag [ASUMSI], atau tulis tidak ada.\n\nLangkah\n1. Pekerjaan, file atau area.\n   Cek: cara verifikasi konkret.\n2. Langkah berikut, dengan cek yang sama.\n\nDi luar scope\nButir plus alasan.\n\nSelesai bila\nChecklist yang bisa dicek.\n\n## Batas\n\nJangan membuat file PRD.\nJangan membuat scorecard.\nJangan menyusun template PRD 14 bagian.\nJangan bertanya hal yang tidak mengubah langkah.\nJangan menambah scope diam-diam. Scope tambahan diajukan sebagai pertanyaan, atau ditandai [ASUMSI].\nNama tool dan identifier tetap bahasa Inggris.\n";

/** Previous built-in plan body. Compared only so an unedited row can be upgraded. */
export const previousPlanBody = `# Rencana sebelum eksekusi

Pakai skill ini saat pengguna minta rencana sebelum eksekusi. Pertanyaan, pilihan, dan rencana terjadi di chat ChatGPT atau Claude, memakai tool tanya dan balas milik klien itu. Jangan mengarang tool MCP untuk bertanya. Jangan memanggil tool MCP memory, skill, file, atau shell untuk wawancara maupun untuk menulis rencana.

Tool MCP baru dipakai setelah pengguna menjawab GO, dan hanya bila rencana butuh mesin ini. Sebelum GO, jangan menulis kode dan jangan mengubah file.

## 1. Pahami permintaan

Ulangi permintaan dalam 2 sampai 3 kalimat di chat. Sebut hasil yang dianggap selesai. Sebut fakta yang sudah ada di pesan pengguna, supaya hal itu tidak ditanya lagi.

## 2. Tanya hanya keputusan yang mengubah rencana

Ajukan pertanyaan yang mengubah urutan, scope, atau cara kerja. Lewati hal yang sudah terjawab.

Pakai tool pertanyaan milik klien bila ada. Contohnya AskUserQuestion di Claude Code, ask_user_input di Claude, atau tool pertanyaan bawaan ChatGPT. Tiap pertanyaan punya 2 sampai 4 pilihan yang saling eksklusif. Tandai satu pilihan sebagai rekomendasi. Jika tool itu tidak ada, tulis pertanyaan bernomor di balasan chat.

Maksimal 4 pertanyaan. Selama wawancara, jangan panggil memory_search, memory_save, memory_forget, skill_list, skill_read, skill_save, skill_delete, read_file, write_file, edit_file, glob, grep, atau shell.

Jika tidak ada keputusan yang mengubah rencana, tulis Tidak ada pertanyaan. Lanjut ke rencana.

## 3. Sebut asumsi

Keputusan yang kamu ambil tanpa jawaban pengguna diberi tag [ASUMSI]. Tulis asumsi di chat.

## 4. Tulis langkah berurutan

Tulis rencana sebagai balasan chat di ChatGPT atau Claude. Tiap langkah muat satu sesi kerja. Sebut apa yang diubah, di file atau area mana, lalu cara cek yang konkret. Cara cek berupa perintah, contoh request, atau langkah UI.

## 5. Sebut yang di luar scope

Tuliskan hal yang tidak dikerjakan. Tiap butir disertai alasan singkat.

## 6. Tunggu GO

Akhiri dengan kalimat ini.

Balas GO untuk mulai. Sebut bagian yang ingin diubah jika rencana ini belum pas.

Eksekusi baru boleh dimulai setelah pengguna menyetujui rencana. Kata GO, atau kalimat yang secara jelas menyuruh mulai, adalah persetujuan. Jawaban atas pertanyaan di langkah 2 belum berarti GO. Jika pengguna merevisi, perbarui rencana di chat, lalu minta GO lagi.

Setelah GO, tool MCP boleh dipakai untuk langkah yang memang butuh mesin. Langkah rencana sendiri tetap di chat.

## Bentuk

Tujuan
Satu kalimat.

Asumsi
Butir dengan tag [ASUMSI], atau tulis tidak ada.

Langkah
1. Pekerjaan, file atau area.
   Cek: cara verifikasi konkret.
2. Langkah berikut, dengan cek yang sama.

Di luar scope
Butir plus alasan.

Selesai bila
Checklist yang bisa dicek.

## Batas

Jangan membuat file PRD.
Jangan membuat scorecard.
Jangan menyusun template PRD 14 bagian.
Jangan bertanya hal yang tidak mengubah langkah.
Jangan menambah scope diam-diam. Scope tambahan diajukan sebagai pertanyaan, atau ditandai [ASUMSI].
Jangan mengarang tool MCP untuk bertanya.
Jangan memakai tool MCP memory, skill, file, atau shell selama wawancara dan penulisan rencana.
Nama tool dan identifier tetap bahasa Inggris.
`;

export const planSkill = {
  name: "plan",
  description: "Rencana eksekusi sebelum kerja: wawancara singkat, lalu pilihan Implementasikan, Revisi, atau Batal.",
  body: `# Rencana sebelum eksekusi

Pakai skill ini saat pengguna minta rencana sebelum kerja. Ini rencana eksekusi, bukan dokumen PRD.

Kamu menyusun langkah yang bisa dikerjakan. Tantang asumsi yang lemah. Pangkas kerja yang tidak mengubah hasil. Rekomendasikan satu pilihan beserta alasan satu kalimat. Jangan menambah scope diam-diam.

Isi rencana bahasa Indonesia. Nama tool, nama file, identifier, perintah, dan path tetap bahasa Inggris.

## Tool

Pertanyaan, pilihan, dan rencana terjadi di ChatGPT atau Claude, memakai tool pertanyaan milik klien itu (AskUserQuestion, ask_user_input, atau tool pertanyaan ChatGPT). Jika tool itu tidak ada, tulis pertanyaan bernomor di balasan.

Jangan mengarang tool MCP untuk bertanya.

Jangan panggil tool MCP memory, skill, file, atau shell selama wawancara maupun saat menulis rencana. Termasuk memory_search, memory_save, memory_forget, skill_list, skill_read, skill_save, skill_delete, read_file, write_file, edit_file, glob, grep, dan shell.

Tool MCP boleh dipakai hanya setelah pengguna memilih Implementasikan, dan hanya untuk langkah yang butuh mesin. Sebelum pilihan itu, jangan menulis kode dan jangan mengubah file.

Jawaban wawancara bukan Implementasikan.

## 1. Pahami permintaan

Ulangi permintaan dalam 2 sampai 3 kalimat. Sebut hasil yang dianggap selesai. Sebut fakta yang sudah ada di pesan, supaya hal itu tidak ditanya lagi.

Petakan yang sudah diketahui dan yang masih mengubah urutan, file, atau cara cek. Lanjut ke wawancara di balasan yang sama bila ada keputusan yang belum jatuh.

## 2. Wawancara

Tanya hanya keputusan yang mengubah rencana: urutan, file yang disentuh, pendekatan, batas scope, atau cara cek selesai. Lewati yang sudah terjawab.

Jika tidak ada keputusan yang mengubah rencana, tulis Tidak ada pertanyaan. Lanjut ke rencana.

Pakai tool pertanyaan klien. Tiap pertanyaan punya 2 sampai 4 pilihan yang saling eksklusif. Tandai satu pilihan sebagai (Rekomendasi), plus alasan satu kalimat. Jangan memakai pilihan ganda. Jika beberapa hal bisa sama-sama masuk, tanyakan postur scope, jangan daftar centang.

Jika tool itu tidak ada, tulis pertanyaan bernomor. Tiap nomor punya pilihan eksklusif dan satu (Rekomendasi). Pengguna boleh menjawab per nomor, atau menulis pakai semua rekomendasi.

Maksimal 4 pertanyaan dalam satu panggilan. Jika jawaban membuka keputusan baru yang mengubah langkah, boleh satu panggilan lagi, lalu berhenti. Lewati pertanyaan yang sudah terjawab. Keputusan yang tersisa dan mudah dibalik ditandai [ASUMSI] dengan pilihan rekomendasi. Jangan mengasumsikan keputusan yang menghapus data, mengubah API publik, atau menyentuh file di luar permintaan. Itu tetap ditanya.

Jangan mulai menulis rencana final sebelum jawaban wawancara masuk, kecuali tidak ada pertanyaan.

Jika jawaban saling bertentangan atau memperbesar scope, tantang singkat dan tawarkan pilihan yang lebih kecil.

Bank pertanyaan, pilih yang relevan, jangan tanyakan semuanya:

A. Selesai. Apa yang harus benar saat kerja berhenti? Perintah tes, tampilan UI, atau perilaku API?

B. Scope. Kerjakan permintaan yang tertulis, tanpa tambahan. Rekomendasi ini dipakai bila pengguna sudah menyebut pekerjaannya. Opsi lain hanya bila pengguna memang ingin memperluas, dan tiap tambahan adalah pertanyaan sendiri.

C. Pendekatan. Jika ada dua cara yang mengubah file atau urutan, sajikan keduanya. Satu dengan komponen paling sedikit, satu yang paling cocok dengan kode yang sudah ada. Tandai satu (Rekomendasi) beserta alasan. Jika hanya satu cara yang masuk akal, tulis kenapa cara lain gugur. Jangan mengarang alternatif palsu.

D. Batas. File, folder, atau perilaku yang tidak boleh disentuh? Repo sudah punya stack dan perintah tes: rekomendasi adalah ikut itu. Tanya hanya bila ada dua pilihan yang benar-benar mengubah file.

E. Verifikasi. Cek mana yang dipakai: tes yang sudah ada, perintah yang sudah dipakai repo, atau langkah UI?

Jangan tanya persona, monetisasi, atau visi produk bila itu tidak mengubah langkah.

## 3. Asumsi

Keputusan tanpa jawaban pengguna diberi tag [ASUMSI]. Tulis di chat, jangan disembunyikan di dalam langkah.

Jangan menulis TBD pada langkah yang akan dikerjakan. Jika sebuah fakta file belum ada di pesan, jangan memanggil read_file untuk mencarinya. Tandai path yang ditebak sebagai [ASUMSI], atau tanyakan bila path itu mengubah langkah.

## 4. Langkah berurutan

Tulis rencana di chat. Tiap langkah muat satu sesi kerja. Sebut apa yang diubah, di file atau area mana, lalu cara cek yang konkret. Cara cek berupa perintah, contoh request, atau langkah UI. Bukan kalimat pastikan berjalan baik.

Urutkan sesuai ketergantungan. Langkah berikut tidak digambarkan seolah bisa mulai sebelum cek langkah sebelumnya jelas.

Kata samar seperti cepat, aman, atau rapi hanya boleh dipakai bila ada ukuran atau contoh yang bisa dicek.

## 5. Di luar scope

Sebut yang tidak dikerjakan. Tiap butir plus alasan singkat: tidak diminta, bisa menyusul, atau tidak perlu untuk hasil ini. Untuk kerja yang menyentuh lebih dari satu area, minimal 3 butir. Jangan mengarang batas palsu untuk tugas satu baris.

## 6. Selesai bila

Checklist yang bisa dicentang. Tiap butir lulus atau gagal. Tiap butir berupa perintah, contoh request, atau langkah UI.

## 7. Cek sebelum bertanya

Sebelum gerbang pilihan, perbaiki rencana bila ada yang gagal. Jangan memberi skor.

- Tiap langkah punya file atau area dan cara cek.
- Tidak ada kata samar tanpa ukuran.
- Di luar scope terisi.
- Selesai bila bisa dicentang.
- Tidak ada file PRD dan tidak ada scorecard.

## 8. Gerbang pilihan

Setelah rencana lengkap, tanya dengan tool pertanyaan klien. Tiga pilihan saling eksklusif:

1. Implementasikan
2. Revisi
3. Batal

Jangan menandai Implementasikan sebagai rekomendasi. Jangan menandai Revisi atau Batal sebagai rekomendasi. Jika tool memaksa satu opsi rekomendasi, jangan pakai tool itu untuk gerbang ini. Tulis tiga pilihan bernomor di balasan.

Implementasikan: mulai rencana. Tool MCP boleh dipakai untuk langkah yang butuh mesin.
Revisi: perbarui rencana di chat, lalu tanyakan tiga pilihan yang sama lagi. Jangan mulai kerja.
Batal: berhenti. Jangan mengubah file.

Hanya jawaban Implementasikan yang memulai kerja. Jawaban wawancara bukan Implementasikan. Komentar atas rencana bukan Implementasikan. Permintaan mengubah rencana diperlakukan sebagai Revisi: perbarui rencana, lalu tanya tiga pilihan lagi.

## Bentuk

Tujuan
Satu kalimat.

Asumsi
Butir dengan tag [ASUMSI], atau tulis tidak ada.

Pendekatan
Satu atau dua kalimat: cara yang dipilih dan kenapa.

Langkah
1. Pekerjaan, file atau area.
   Cek: cara verifikasi konkret.
2. Langkah berikut, dengan cek yang sama.

Di luar scope
Butir plus alasan.

Selesai bila
Checklist yang bisa dicek.

## Batas

Jangan membuat file PRD.
Jangan membuat scorecard.
Jangan menyusun template PRD 14 bagian.
Jangan bertanya hal yang tidak mengubah langkah.
Jangan menambah scope diam-diam. Scope tambahan diajukan sebagai pertanyaan, atau ditandai [ASUMSI].
Jangan mengarang tool MCP untuk bertanya.
Jangan memakai tool MCP memory, skill, file, atau shell selama wawancara dan penulisan rencana.
Nama tool dan identifier tetap bahasa Inggris.
`,
} as const;
