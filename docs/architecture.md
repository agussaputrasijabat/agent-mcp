# Arsitektur Agent MCP

Agent MCP menjalankan satu proses Bun untuk HTTP, endpoint MCP, API dashboard, dan aset antarmuka. Proses itu memakai SQLite serta akses file system dan Bash milik user OS yang menjalankannya.

## Alur permintaan

```mermaid
flowchart TD
    client["ChatGPT / Claude MCP client"] --> http["Hono + MCP HTTP"]
    browser["Browser operator"] --> dashboard["Dashboard + API"]
    http --> auth["API key / OAuth"]
    auth --> handler["MCP handler: 38 tool"]
    handler --> host["File system / Bash / HTTP fetch"]
    handler --> audit[("SQLite: tool_calls")]
    handler --> library[("SQLite: memory dan skill")]
    dashboard --> operator["Better Auth session"]
    operator --> database[("SQLite")]
    dashboard --> database
```

1. Klien mengirim permintaan Streamable HTTP ke `/mcp`.
2. Middleware memeriksa API key atau mengarahkan bearer OAuth ke validasi Better Auth.
3. Handler MCP membuat server untuk permintaan tersebut dan mendaftarkan 38 tool beserta resource MCP Apps untuk File Preview.
4. Tool dieksekusi di host. Panggilan dicatat di tabel `tool_calls` saat dimulai dan diperbarui setelah selesai.
5. Klien menerima hasil; operator dapat melihatnya melalui Feed dan halaman Sesi.

Server tidak menjalankan model bahasa. Pilihan tool, konfirmasi user di chat, serta penalaran dilakukan oleh klien AI.

## Komponen utama

| Lokasi | Tanggung jawab |
| --- | --- |
| `src/index.ts` | Membaca port, membuka database, lalu memulai `Bun.serve`. |
| `src/app.ts` | Menggabungkan route MCP, OAuth, login, sesi, dan health check. |
| `src/mcp/handler.ts` | Mendaftarkan 38 tool dan preview resource, lalu membungkus eksekusi dengan pencatatan audit. |
| `src/mcp/request-context.ts` | Membawa konteks autentikasi permintaan ke audit. |
| `src/tools/` | Implementasi file, shell, proses, spreadsheet, PDF, DOCX, preview, fetch, memori, dan skill. |
| `web/src/mcp-preview.ts` | View MCP Apps untuk preview dan editor Markdown. |
| `scripts/build-mcp-preview.ts` | Mengemas view menjadi HTML mandiri untuk server dan binary. |
| `src/auth/` | API key, autentikasi operator, OAuth, dan pembatasan login. |
| `src/db/` dan `migrations/` | Database, pengaturan, riwayat tool, dan migrasi. |
| `src/http/` | API serta penyajian dashboard. |
| `web/src/` | Halaman React dan komponen UI. |
| `prompts/` | Instruksi server dan generator instruksi proyek. |
| `test/` | Tes integrasi dan pengujian tool. |

## Penyimpanan

SQLite menyimpan identitas dan sesi operator, kredensial API key dalam bentuk yang diperlukan untuk verifikasi, data OAuth, panggilan tool, memori, skill, dan pengaturan. Skill bawaan di-seed saat database dibuka. Skill repository dibaca langsung dari direktori konvensional dan diperlakukan sebagai **read-only**.

Memori dapat diberi `project_path`. Pencarian dengan path proyek menampilkan memori global serta memori untuk path yang sama; pencarian tanpa path hanya melihat memori global. Data lama dipertahankan pada tabel `memories`, sedangkan catatan baru pada scope yang berbeda memakai tabel `project_memories` dengan constraint unik `(project_path, key)`. Key sama pada dua proyek tidak lagi saling menimpa.

## Batas proses

Shell dijalankan dengan `bash -lc` via `Bun.spawn`. Batas konkurensi dan waktu eksekusi dibaca dari pengaturan SQLite. Output proses dibaca secara bertahap dengan batas buffer; saat timeout, server berusaha menghentikan process group di sistem POSIX. Panggilan shell tidak diantrikan setelah batas konkurensi tercapai; tool mengembalikan `shell_busy`.

Konfirmasi tool ditangani oleh klien ChatGPT atau Claude berdasarkan metadata MCP. Server tidak menjalankan approval terpisah. Anotasi `destructiveHint` bukan pengganti kontrol akses OS. Operasi file memakai lock direktori sementara per path lintas-proses, lalu temp file dan atomic rename; pemeriksaan `expected_hash` opsional menolak versi lama. Hashing dibatasi 8 MiB. Lock ini hanya berlaku bagi proses yang mengikuti protokol Agent MCP; aplikasi eksternal tetap bisa mengubah file tanpa lock.

Akses file tidak dibatasi otomatis ke `project_path`. Untuk membatasi dampak kompromi, jalankan server memakai akun OS dengan hak akses sesedikit mungkin. Lihat [keamanan](security.md).

## Endpoint penting

| Endpoint | Akses | Fungsi |
| --- | --- | --- |
| `GET /health` | Publik | Pemeriksaan kesehatan server dan SQLite |
| `/mcp` | API key atau OAuth | Protokol MCP Streamable HTTP |
| `/.well-known/oauth-authorization-server` | Publik | Metadata OAuth authorization server |
| `/.well-known/oauth-protected-resource` | Publik | Metadata resource OAuth |
| `/login`, `/consent` | Alur operator/OAuth | Login dan persetujuan klien |
| `/api/*` | Sesi operator, kecuali route autentikasi | Operasi dashboard |
| `/`, `/sessions`, `/keys`, `/settings`, dll. | Sesi operator | Dashboard |

Tidak ada endpoint `/mcp/library` terpisah pada implementasi saat ini. Semua tool tersedia melalui `/mcp`.
