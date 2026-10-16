# Evaluasi perilaku instruksi Agent MCP

Suite ini menguji **perilaku agent yang benar-benar dijalankan**, bukan mencari frasa di jawaban atau menilai instruksi berdasarkan panjangnya. Berisi 20 skenario: 12 `coding`, 8 `general`, masing-masing dengan kriteria keberhasilan yang dapat diamati. Kriteria keamanan tertentu diberi `critical: true`.

## Menjalankan evaluasi

Jalankan perintah dari root repository:

```bash
bun run eval:instructions list
bun run eval:instructions list --mode coding
bun run eval:instructions template --model claude-sonnet --run-id baseline > baseline.json
bun run eval:instructions template --model claude-sonnet --run-id candidate > candidate.json
```

Template berisi seluruh skenario dengan `not_run`, bukan hasil pengujian. Untuk baseline, gunakan pack sebelum perubahan; isi versi pack yang **benar-benar** disajikan pada model tersebut, atau berikan `--coding-version <hash12>` dan `--general-version <hash12>` pada perintah `template`. Versi pack dapat dilihat dari respons `get_instructions`; `git show HEAD:prompts/packs/coding.md` juga dapat membantu melihat instruksi terdahulu tanpa mengubah working tree. Jangan menjalankan baseline dan candidate dengan dua versi instruksi yang sama lalu menganggapnya eksperimen.

1. Pilih model yang sama, pengaturan model yang sama, klien/izin tool yang sama, dan sumber data yang setara untuk kedua run. Mulai setiap skenario dalam konteks baru agar instruksi percobaan lain tidak terbawa.
2. Berikan *setup* dan *prompt* dari `cases.json` sebagai skenario uji. Jangan eksekusi tindakan destruktif terhadap sistem produksi; gunakan fixture atau lingkungan aman yang diizinkan.
3. Catat penilaian **setiap kriteria** sebagai `pass`, `fail`, atau `not_run`. Isi `evidence` dengan bukti yang benar-benar diperiksa, misalnya output tes, hasil baca file, screenshot, atau ID trace. Penilaian harus dilakukan oleh reviewer berdasarkan bukti, bukan berdasarkan klaim agent semata.
4. Jika tersedia, isi `metrics.tool_calls`, `metrics.tokens`, dan `metrics.latency_ms` dengan angka yang diamati. Kosongkan bila provider/klien tidak menyediakan metrik; jangan menebak.
5. Hitung skor dan bandingkan:

```bash
bun run eval:instructions score --run baseline.json
bun run eval:instructions score --run candidate.json
bun run eval:instructions compare --baseline baseline.json --candidate candidate.json
```

Bisa tambahkan `--mode general` atau `--mode coding` pada `score` dan `compare`. Perintah `compare` menghasilkan kode keluar nonnol bila ada regresi teramati, agar dapat dipakai sebagai quality gate. Keterangan `pack_versions` membantu mereproduksi perbandingan tetapi runner **tidak** memanggil ChatGPT/Claude untuk menjalankan tugas secara otomatis.

## Cara menghitung skor

- Skenario **pass** hanya bila semua kriteria diberi `pass` dengan bukti tertulis. Skenario **fail** bila ada kriteria `fail`; `critical_failed` menunjukkan kegagalan keamanan yang harus diutamakan.
- Kriteria hilang atau `not_run` membuat skenario **incomplete** (kecuali sudah ada kegagalan yang teramati). Kasus incomplete **tidak dihitung lulus**. `pass_rate` = total kasus lulus / total kasus terpilih; tidak menggunakan hanya sampel yang diuji sebagai penyebut.
- `compare` hanya mengidentifikasi peningkatan/regresi ketika kedua hasil sudah dinilai. Kasus yang belum dinilai di salah satu run dilaporkan sebagai `ungraded_cases`, bukan bukti peningkatan. Model yang berbeda ditolak supaya perbedaan instruksi tidak tercampur dengan perbedaan model.
- Rata-rata metrik dihitung hanya dari kasus yang memiliki angka terisi. Jangan membandingkan rata-rata waktu/token dari sampel yang berbeda tanpa meninjau cakupannya.
- Runner memvalidasi struktur, ID, dan keberadaan bukti; **runner tidak memverifikasi kebenaran bukti tersebut**. Audit hasil reviewer tetap diperlukan.

## Disiplin mengubah prompt

Gunakan `cases.json` sebagai tes regresi saat mengubah `prompts/packs/coding.md`, `prompts/packs/general.md`, atau `shared.md`. Simpan versi pack, model, hasil, dan alasan perubahan. Tambahkan kasus dari kegagalan nyata; jangan menambah aturan panjang untuk setiap kegagalan sebelum menguji apakah aturan itu benar-benar memperbaiki hasil.

Awali dengan baseline, ubah sesedikit mungkin, ulangi tugas yang sama pada versi baru, lalu kaji *pass rate*, regresi kritis, biaya token, dan waktu. Jika tidak ada bukti peningkatan, jangan klaim prompt lebih baik hanya karena tes TypeScript atau aplikasi lulus. Utamakan tool yang deterministik dan alur *Generate → Evaluate → Repair* hanya untuk tugas yang memerlukannya.

Jangan masukkan kredensial, konten pribadi lengkap, atau data produksi ke file rekaman evaluasi. Gunakan referensi artefak yang disanitasi untuk `evidence`. File hasil evaluasi lokal tidak otomatis diabaikan Git; pastikan memeriksanya sebelum staging atau gunakan direktori sementara di luar repository.
