export const planSkill = {
  name: "plan",
  description: "Pakai saat pengguna minta rencana sebelum kerja dimulai.",
  body: `# Rencana sebelum eksekusi

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
`,
} as const;
