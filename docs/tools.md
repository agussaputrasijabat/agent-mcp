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

## Pencatatan dan batas output

Panggilan tool dicatat dalam tabel `tool_calls`, termasuk durasi, nama tool, hasil, dan status error. Server meredaksi sejumlah bentuk kredensial pada salinan audit, tetapi **jangan menganggap audit sebagai sistem penyaring semua rahasia**. Output teks panjang dapat dipotong; batas umum awalnya 30.000 karakter, sedangkan konten gambar ditangani berbeda.

Bila tool gagal, hasil dapat memuat kode seperti `path_not_absolute`, `edit_not_unique`, `shell_busy`, atau `fetch_blocked`. Langkah pemeriksaan ada di [troubleshooting](troubleshooting.md).
