# Referensi tool MCP

Seluruh tool di bawah ini tersedia melalui `/mcp`. Path file dan direktori harus absolut jika suatu parameter meminta path. `project_path` pada memori/skill adalah konteks pencarian, **bukan pembatas akses file atau shell**.

## File dan pencarian

| Tool | Input | Perilaku |
| --- | --- | --- |
| `read_file` | `path`, opsional `offset` (baris awal, mulai 1), `limit` (maks. 2000) | Membaca teks UTF-8. Berkas PNG/JPEG/GIF/WebP yang didukung dapat dikirim sebagai gambar. |
| `write_file` | `path`, `contents` | Membuat direktori induk bila perlu; **menimpa seluruh isi** jika file sudah ada. Maks. 1 juta karakter. |
| `edit_file` | `path`, `old_string`, `new_string` | Mengganti satu kecocokan persis. Gagal jika tidak ada atau ada lebih dari satu kecocokan. |
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

Gunakan `edit_file` untuk perubahan kecil. Periksa isi file sebelum mengubahnya agar `old_string` tidak ambigu.

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
- Kode keluar dan output dikembalikan sebagai teks. Kesalahan validasi dan timeout menghasilkan error tool.

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
| `memory_forget` | `key` | Menghapus catatan berdasarkan key. |

Key memori menggunakan huruf kecil, angka, dan tanda hubung (maksimum 64 karakter). Isi maksimum 8.000 karakter, dengan batas 1.000 catatan di database. `project_path` harus absolut jika dipakai.

```json
{
  "key": "conventions",
  "body": "Gunakan Bun untuk build dan test.",
  "project_path": "/home/user/project"
}
```

**Catatan:** `key` unik secara global. Menyimpan `conventions` lagi untuk proyek lain akan memperbarui catatan sebelumnya, bukan membuat dua entri dengan key sama.

## Skill

| Tool | Input | Keterangan |
| --- | --- | --- |
| `skill_list` | Opsional `project_path` | Mendaftar skill database; dengan path proyek, juga menampilkan skill repository. |
| `skill_read` | `name`, opsional `source`, `project_path` | Membaca skill database; untuk skill repo gunakan `source: "repo"` dan `project_path`. |
| `skill_save` | `name`, `description`, `body`, opsional `project_path` | Membuat atau memperbarui skill database. |
| `skill_delete` | `name`, opsional `project_path` | Menghapus skill database. |

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
