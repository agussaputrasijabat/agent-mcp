# Referensi tool MCP

Seluruh tool di bawah ini tersedia melalui `/mcp`. Path file dan direktori harus absolut jika suatu parameter meminta path. `project_path` pada memori/skill adalah konteks pencarian, **bukan pembatas akses file atau shell**.

## File dan pencarian

| Tool | Input | Perilaku |
| --- | --- | --- |
| `read_file` | `path`, opsional `offset`, `limit`, `include_hash` | Membaca UTF-8 atau gambar. `include_hash: true` menambahkan SHA-256 untuk mengamankan edit berikutnya. |
| `write_file` | `path`, `contents`, opsional `expected_hash` | Menulis melalui temp file dan atomic rename. `expected_hash` menolak file yang berubah; nilai `absent` berarti file harus belum ada. |
| `edit_file` | `path`, `old_string`, `new_string`, opsional `expected_hash` | Exact match unik, penulisan atomik, dan pemeriksaan versi opsional. Menolak perubahan terhadap symlink. |
| `glob` | `pattern`, opsional `path` | Mencari path sesuai glob; maksimum 200 hasil. |
| `grep` | `pattern` (regex), opsional `path`, `glob` | Mencari baris teks; maksimum 100 kecocokan. |

Pencarian file melewati `node_modules`, `.git`, dan `dist`. Untuk `grep`, pemindaian dibatasi hingga 5.000 file dan kedalaman 20 direktori. Tanpa parameter `path`, pencarian dimulai dari working directory proses server.

Contoh argumen `read_file`:

```json
{
  "path": "/home/user/project/src/index.ts",
  "offset": 1,
  "limit": 80
}
```

Gunakan `read_file` dengan `include_hash: true` lalu teruskan SHA-256 yang dikembalikan ke `expected_hash` pada `edit_file` atau `write_file`. Server menolak hash yang tidak cocok dengan kode `file_changed`. Pemeriksaan versi tetap opt-in untuk kompatibilitas klien lama. Penulisan lewat Agent MCP diserialkan dengan direktori lock per file (lintas proses); konflik mengembalikan `file_busy`. File lock yang tertinggal setelah crash harus diperiksa operator sebelum dibersihkan. Proses lain yang tidak mematuhi lock tetap bisa mengubah file. Hashing sinkron dibatasi sampai 8 MiB.

## Eksekusi dan HTTP

### `shell`

Menjalankan `bash -lc` pada host.

```json
{
  "command": "git status --short",
  "cwd": "/home/user/project",
  "timeout_ms": 30000
}
```

- `command` wajib, maksimum 10.000 karakter; `cwd` opsional dan harus absolut.
- Timeout default 120.000 ms, minimum 1.000 ms, maksimum default 600.000 ms. Operator dapat mengubah batasnya di Pengaturan.
- Maksimum 32 perintah shell berjalan bersamaan secara default. Perintah berikutnya mengembalikan `shell_busy` jika batas tercapai.
- Kode keluar dan output dikembalikan sebagai teks. Pembacaan stdout/stderr dibatasi selama proses berjalan sehingga output besar tidak dibuffer seluruhnya di RAM. Saat timeout, server mencoba menghentikan process group pada macOS/Linux.
- Konfirmasi penggunaan shell dilakukan melalui antarmuka izin tool bawaan klien. Pilihan tombol dan frekuensi dialog bergantung pada aplikasi ChatGPT atau Claude, bukan server.

### Persetujuan bawaan klien

Agent MCP menandai tool yang bisa mengubah data dengan anotasi MCP seperti `readOnlyHint: false` dan `destructiveHint: true`. ChatGPT/Claude dapat menampilkan dialog konfirmasi sebelum pemanggilan tool. Tidak ada langkah `approval_id`, persetujuan lewat dashboard, atau MCP Elicitation dari server.

**Penting:** Anotasi adalah petunjuk bagi klien, bukan jaminan dialog. Klien dapat menyimpan izin untuk percakapan atau memanggil tool tanpa bertanya, tergantung pengaturan dan kebijakan. Jika membutuhkan izin setiap kali, atur di aplikasi klien. Server tetap membatasi akses lewat API key/OAuth, hak akses OS, dan validasi input.

### `web_fetch`

```json
{ "url": "https://example.com" }
```

Mengambil HTTP/HTTPS dari **mesin host**, dengan timeout 20 detik dan maksimum tiga redirect. Implementasi sekarang memblokir alamat loopback dan jaringan privat sebagai perlindungan terhadap SSRF. Jadi walaupun URL tersebut dapat dibuka secara lokal di host, `web_fetch` tidak bisa dipakai untuk mengakses `http://localhost` atau alamat LAN.

Tool ini bukan mesin pencari web. Untuk pencarian situs atau dokumentasi publik, gunakan alat bawaan klien ChatGPT atau Claude.

Instruksi dari `get_instructions` menyuruh model memakai fetch bawaan ChatGPT atau Claude untuk URL publik. `web_fetch` hanya dipakai kalau halaman harus diambil dari host, misalnya fetch bawaan klien gagal menjangkaunya, dan model menyebut alasannya dalam satu kalimat.

## Filesystem dan metadata

| Tool | Fungsi |
| --- | --- |
| `list_directory` | Listing rekursif dengan `depth`, `offset`, `limit`, tanpa mengikuti symlink |
| `create_directory` | Membuat direktori dengan opsi `recursive` |
| `move_path` | Memindahkan file/direktori tanpa overwrite (exclusive copy lalu hapus sumber); untuk direktori operasi tidak atomik. Jika gagal saat penyalinan, sumber tetap ada dan tujuan parsial dilaporkan. |
| `stat_path` | Ukuran, tipe, permission, created/modified/accessed time |

## Sesi proses dan eksekusi kode

| Tool | Fungsi |
| --- | --- |
| `start_process` | Menjalankan perintah host dan mengembalikan `session_id` dan PID |
| `read_process_output` | Membaca output dengan `offset` dan `length`, status, exit code, `next_offset` |
| `write_process_input` | Mengirim teks stdin (opsional tutup input) |
| `list_processes` | Daftar sesi milik identitas MCP aktif, bukan semua proses host |
| `terminate_process` | Hentikan sesi serta grup prosesnya |
| `execute_code` | Jalankan Python, JavaScript (Node), atau R tanpa file script, runtime harus tersedia di host |

Sesi dibatasi 16 aktif, 1 juta karakter output per sesi, timeout maksimum 1 jam, output setiap read maksimum 29 ribu karakter, dan sesi selesai disimpan 15 menit. Output lama bisa di-evict. Mekanisme stdin/stdout/stderr memakai pipe, **bukan PTY penuh**, sehingga editor terminal fullscreen belum didukung. Polling output tersedia, tetapi streaming notification khusus belum dibuat.

## Spreadsheet dan analisis data

| Tool | Fungsi |
| --- | --- |
| `read_spreadsheet` | Baca workbook, sheets, rentang baris |
| `create_spreadsheet` | Buat file XLSX baru |
| `edit_spreadsheet` | Edit sel XLSX melalui peta alamat ke nilai |
| `search_spreadsheet` | Cari nilai sel di semua sheet |
| `analyze_data` | Ringkas CSV, JSON array, XLSX dan XLSM, statistik angka dan nilai kosong |

**Batas:** maksimal 20 MiB per input. Dokumen ZIP Office diperiksa sebelum dekompresi terhadap jumlah entri, ukuran hasil, dan rasio kompresi. Hasil pembacaan spreadsheet besar tetap JSON valid dengan pagination `row_offset`/`next_row_offset`. Format `.xls` binary lama belum tersedia di parser, sehingga memerlukan konversi ke `.xlsx`. `.xlsm` hanya untuk baca/cari/analisis karena menulis ulang dapat menghilangkan VBA/macro. Formula ditampilkan sebagai formula dan cached result; tidak dihitung server.

## PDF dan DOCX

| Tool | Fungsi |
| --- | --- |
| `read_pdf` | Ekstrak teks PDF per halaman, hingga 40 halaman per permintaan |
| `create_pdf` | PDF dari Markdown dasar, hanya font Latin-1 |
| `edit_pdf` | Tambah halaman dari PDF lain, hapus, atau putar halaman |
| `read_docx` | Baca teks paragraf Word |
| `create_docx` | DOCX dari paragraf dan heading Markdown |
| `edit_docx` | Ganti unik teks yang berada di satu XML `w:t` run |
| `search_docx` | Temukan teks dalam paragraf DOCX |

Pengeditan dokumen memakai lock lintas proses Agent MCP dan pemeriksaan versi agar penyimpanan tidak menghapus perubahan paralel. PDF hasil scan belum ditangani OCR. Editing PDF belum mendukung penggantian arbitrer konten teks. Editing DOCX menolak penggantian teks yang melintasi XML runs, supaya elemen dokumen lain tetap dipertahankan.

## MCP Apps File Preview

`preview_file({path})` membaca file sebagai teks/gambar untuk klien umum dan mengiklankan resource `ui://agent-mcp/file-preview` (`text/html;profile=mcp-app`) untuk klien MCP Apps. View merender Markdown, gambar, tabel spreadsheet, halaman PDF, dan paragraf DOCX; editor Markdown hanya aktif untuk file yang dapat dibaca lengkap dan menulis dengan `expected_hash` untuk menghindari konflik versi. File besar hanya dapat dipreview, bukan disimpan dari preview terpotong.

`open_in_folder({path})` membuka/reveal file memakai desktop file manager pada **host Agent MCP**. Tidak akan membuka folder pada komputer klien remote; server tanpa sesi GUI mungkin tidak bisa menampilkan window.

## Memori

| Tool | Input | Keterangan |
| --- | --- | --- |
| `memory_search` | `query` (1–200 karakter), opsional `project_path` | Mencari sampai 20 catatan yang cocok. |
| `memory_save` | `key`, `body`, opsional `project_path` | Menambah atau mengganti catatan dengan key yang sama. |
| `memory_forget` | `key`, opsional `project_path` | Menghapus catatan pada scope yang tepat (global bila `project_path` tidak diberikan). Konfirmasi diatur oleh klien. |

Key memori menggunakan huruf kecil, angka, dan tanda hubung (maksimum 64 karakter). Isi maksimum 8.000 karakter, dengan batas 1.000 catatan di database. `project_path` harus absolut jika dipakai.

```json
{
  "key": "conventions",
  "body": "Gunakan Bun untuk build dan test.",
  "project_path": "/home/user/project"
}
```

**Scope memori:** Proyek berbeda kini dapat menyimpan `key` yang sama tanpa saling menimpa. Pencarian proyek juga mencakup memori global. Catatan lama tetap dapat dibaca setelah migrasi; untuk menghapus memori scoped, sertakan `project_path` yang benar.

## Skill

| Tool | Input | Keterangan |
| --- | --- | --- |
| `skill_list` | Opsional `project_path` | Mendaftar skill database; dengan path proyek, juga menampilkan skill repository. |
| `skill_read` | `name`, opsional `source`, `project_path` | Membaca skill database; untuk skill repo gunakan `source: "repo"` dan `project_path`. |
| `skill_save` | `name`, `description`, `body`, opsional `project_path` | Membuat atau memperbarui skill database. |
| `skill_delete` | `name`, opsional `project_path` | Menghapus skill database; konfirmasi diatur oleh klien. |

Skill database dibatasi 200 entri. Nama skill memakai huruf kecil, angka, dan tanda hubung. Deskripsi maksimum 200 karakter dan body maksimum 32.000 karakter.

Untuk skill repository, server memeriksa:

```text
.agents/skills/<nama>/SKILL.md
.claude/skills/<nama>/SKILL.md
.codex/skills/<nama>/SKILL.md
.opencode/commands/<nama>.md
```

Skill repository harus memiliki format metadata yang bisa dibaca dan bersifat **read-only** dari tool database. Jika `skill_list` memuat nama dari kedua sumber, gunakan `source: "repo"` untuk memilih versi repository.

Contoh membaca skill repository:

```json
{
  "name": "my-skill",
  "source": "repo",
  "project_path": "/home/user/project"
}
```

## Instruksi

| Tool | Input | Keterangan |
| --- | --- | --- |
| `get_instructions` | `mode`: `"coding"` atau `"general"` (default `"general"`) | Mengembalikan instruksi kerja lengkap beserta versinya. Dipanggil model di awal tiap chat sesuai instruksi proyek dari halaman Setup. |

Isi instruksi berasal dari `prompts/packs/<mode>.md` ditambah `prompts/packs/shared.md`. Versi adalah 12 karakter pertama SHA-256 isinya, jadi berubah otomatis saat file diedit. Isi yang sama tersedia sebagai MCP prompt `coding` dan `general`, dan lewat HTTP publik di `/instructions/coding.md` dan `/instructions/general.md` (dengan `ETag`). Tes `test/instruction-packs.test.ts` gagal kalau ada tool terdaftar yang tidak disebut di pack.

## Pencatatan dan batas output

Panggilan tool dicatat dalam tabel `tool_calls`, termasuk durasi, nama tool, hasil, dan status error. Server meredaksi sejumlah bentuk kredensial pada salinan audit, tetapi **jangan menganggap audit sebagai sistem penyaring semua rahasia**. Output teks panjang dapat dipotong; batas umum awalnya 30.000 karakter, sedangkan konten gambar ditangani berbeda.

Bila tool gagal, hasil dapat memuat kode seperti `path_not_absolute`, `edit_not_unique`, `shell_busy`, atau `fetch_blocked`. Langkah pemeriksaan ada di [troubleshooting](troubleshooting.md).
