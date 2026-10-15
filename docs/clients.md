# Menghubungkan klien MCP

Agent MCP menyediakan endpoint `/mcp` berbasis Streamable HTTP. ChatGPT dan Claude berperan sebagai **klien**; file, proses shell, memori, dan skill berada di komputer atau server yang menjalankan Agent MCP.

Panduan ini menjelaskan sisi server. Nama menu dan dukungan jenis koneksi di ChatGPT atau Claude dapat berubah menurut produk dan paket akun.

## Pilih jalur koneksi

| Kondisi | Jalur |
| --- | --- |
| Server ada di laptop dan klien membutuhkan endpoint yang dapat diakses dari internet | Tunnel yang didukung klien, atau tunnel HTTPS publik |
| Server ada di VPS dengan domain | Reverse proxy HTTPS ke port lokal Agent MCP |
| Klien mendukung OAuth remote MCP | Koneksi OAuth ke `https://domain/mcp` |
| Klien mendukung API key dalam header | `X-Api-Key` atau `Authorization: Bearer amcp_...` |
| Klien hanya menerima URL tanpa field autentikasi | `https://domain/mcp?api_key=...` (opsi terakhir; baca catatan keamanan) |

Sebaiknya gunakan OAuth atau header API key. Kredensial di query URL dapat tertinggal di history, log proxy, dan tangkapan layar. URL publik wajib HTTPS jika memakai `?api_key=`.

## Menyiapkan server

1. Ikuti [instalasi](run.md) dan pastikan `/health` merespons.
2. Untuk URL publik, set `PUBLIC_BASE_URL=https://domain-kamu` di lingkungan proses. Jangan tambahkan `/mcp` ke variabel ini.
3. Pastikan konektor dapat mencapai `https://domain-kamu/mcp` dari luar. Server yang hanya terikat ke `127.0.0.1` memerlukan tunnel atau reverse proxy.
4. Login ke dashboard menggunakan email dan password operator.

## API key

Buka halaman **Kunci** (`/keys`), buat key dengan nama yang mudah dikenali, lalu salin secret `amcp_...` saat tampil. Nilai lengkap hanya ditampilkan sekali. Jika hilang, cabut key lama dan buat yang baru.

Jika klien mendukung custom header:

```http
X-Api-Key: amcp_CONTOH_JANGAN_DIGUNAKAN
```

Atau:

```http
Authorization: Bearer amcp_CONTOH_JANGAN_DIGUNAKAN
```

Jika konektor hanya mendukung URL, backend juga menerima `?api_key=` pada endpoint. Gunakan cara tersebut hanya lewat HTTPS publik atau loopback HTTP. Hindari menyalin URL berkredensial ke issue, chat publik, atau log.

## OAuth

Agent MCP memakai Better Auth untuk login operator dan alur izin konektor. Untuk klien yang mendukung OAuth:

1. Masukkan URL MCP `https://domain-kamu/mcp`.
2. Ikuti alur login operator pada `/login`.
3. Tinjau permintaan akses di `/consent`, lalu pilih **Izinkan** atau **Tolak**.
4. Setelah terhubung, lakukan panggilan tool uji.

Resource OAuth yang digunakan adalah `PUBLIC_BASE_URL + "/mcp"`. Server memublikasikan metadata di `/.well-known/oauth-protected-resource` dan `/.well-known/oauth-authorization-server`. Perubahan domain memerlukan pembaruan environment, restart, dan koneksi ulang sesuai kebutuhan klien.

## OpenAI Secure MCP Tunnel

Bila fitur tunnel tersedia di akun/platform yang dipakai, jalankan Agent MCP di laptop dengan `127.0.0.1:3000`. Dari pengaturan tunnel OpenAI, dapatkan `tunnel_id` dan instal `tunnel-client` sesuai panduan produk tersebut.

```bash
tunnel-client init --profile agent-mcp --tunnel-id "$TUNNEL_ID" --mcp-server-url http://127.0.0.1:3000/mcp
tunnel-client run --profile agent-mcp
```

Tambahkan koneksi Tunnel di ChatGPT menggunakan `tunnel_id` yang sama. Ini tidak sama dengan menerbitkan URL publik sendiri. Lihat [run.md](run.md#tunnel) untuk penjelasan jaringan.

## Instruksi proyek di ChatGPT atau Claude

Setelah konektor berhasil dibuat:

1. Buka halaman **Setup** (`/setup`) pada dashboard.
2. Pilih mode **Coding** (kerja di repo) atau **Non-coding** (dokumen, spreadsheet, riset, olah data).
3. Masukkan **nama MCP** persis seperti yang digunakan saat membuat konektor.
4. Masukkan **path absolut folder proyek di host**. Contoh: `/Users/operator/Repository/my-app`. Untuk Non-coding, path boleh kosong.
5. Opsional: isi catatan proyek, misalnya perintah tes atau gaya penulisan.
6. Salin teks yang dihasilkan ke custom instructions proyek ChatGPT atau Claude. Penghitung karakter menjaga teks di bawah batas 8.000 karakter ChatGPT.

Teks yang ditempel hanya berisi nama konektor, folder, mode, dan catatan (template: [`prompts/project-stub.md`](../prompts/project-stub.md)). Teks itu menyuruh model memanggil tool `get_instructions` di awal tiap chat. Tool tersebut mengembalikan instruksi lengkap dari [`prompts/packs/`](../prompts/packs/) sesuai versi server yang sedang jalan, jadi update agent-mcp tidak perlu mengedit ulang proyek. Tempel ulang hanya kalau nama MCP, path, mode, atau catatan berubah.

Kalau tool tidak tersedia, model diarahkan membuka URL cadangan `PUBLIC_BASE_URL/instructions/<mode>.md`. URL ini publik tanpa login karena isinya generik dan tidak memuat path, nama, atau kunci. URL cadangan hanya berguna kalau origin bisa dijangkau dari internet.

Kenapa tidak memakai field `instructions` MCP saja: Claude.ai web tidak memasukkan field itu ke konteks model (anthropics/claude-ai-mcp#93), dan ChatGPT hanya memakai 512 karakter pertama. Field itu tetap diisi dan menunjuk ke `get_instructions`.

Path proyek membantu AI menentukan lokasi file; ini bukan sandbox atau pembatas akses.

## Konfirmasi tool langsung di ChatGPT atau Claude

Server tidak meminta persetujuan dari halaman dashboard. Tool yang bisa mengubah data, terutama `shell`, `write_file`, `edit_file`, `memory_forget`, dan `skill_delete`, diberi anotasi MCP sebagai tindakan berpotensi destruktif. Jika klien menampilkan dialog izin pemanggilan tool, tinjau argumen lalu pilih izinkan atau tolak **di aplikasi klien**. Tidak ada langkah ulang dengan `approval_id`.

ChatGPT menentukan permintaan konfirmasi berdasarkan izin aplikasi dan konteks; Claude juga dapat mengatur izin per tool. Perilakunya tidak selalu sama dan tidak bisa dipaksakan oleh server hanya melalui anotasi. Hindari pengaturan "selalu izinkan" bila menghubungkan host berisi data sensitif, dan jalankan server menggunakan akun OS dengan hak akses minimal.

## Uji koneksi

Minta klien:

> Gunakan konektor Agent MCP untuk membaca file README di path absolut repository, lalu tampilkan judulnya.

Periksa halaman Feed. Bila tidak ada panggilan, pastikan konektor aktif dan klien mendukung endpoint remote MCP yang dipilih. Bila ada respons `401`, periksa key atau alur OAuth. Lihat [troubleshooting](troubleshooting.md).

**Catatan jaringan:** Cloudflare Access yang hanya mengizinkan browser/perangkat operator dapat memblokir `/mcp`, sebab permintaan berasal dari server OpenAI/Anthropic. Pertahankan autentikasi MCP, tetapi pastikan jalur klien benar-benar dapat menjangkaunya.
