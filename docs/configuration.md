# Konfigurasi

**CLI standalone:** pengguna tidak perlu membuat `.env`. Pada eksekusi pertama, CLI meminta email/password operator dan membuat secret otomatis, menyimpannya di direktori data per pengguna. Preferensi port awal **47831**, dan jika bentrok saat setup CLI memilih port kosong lain. Setelahnya gunakan `agent-mcp config show`, `agent-mcp config set port <port|auto>`, atau `agent-mcp auth reset-password`. Binary kompilasi tidak memuat `.env` dan `bunfig.toml` secara otomatis.

**Menjalankan server langsung dari source (Bun/PM2):** pengaturan dibaca dari variabel lingkungan saat server menyala, dan Bun membaca `.env` pada instalasi development. Untuk PM2, gunakan `.env.production` sesuai [panduan deployment](run.md#pm2). Nilai default `PORT=3000` dalam tabel di bawah hanya berlaku pada mode server langsung, **bukan** pada CLI standalone.

## Variabel lingkungan

| Variabel | Default di kode | Keterangan |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Antarmuka tempat server mendengarkan. |
| `PORT` | `3000` | Port HTTP, harus bilangan bulat 1 sampai 65535. |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:3000` | Origin eksternal untuk metadata OAuth, **tanpa** `/mcp`. Gunakan HTTPS pada host publik. |
| `DATABASE_PATH` | `./data/agent.sqlite` | Lokasi file SQLite. Path relatif dihitung dari working directory proses. |
| `DASHBOARD_EMAIL` | Tidak ada | Email operator, wajib saat proses diinisialisasi. |
| `DASHBOARD_PASSWORD` | Tidak ada | Kata sandi awal operator, minimum 12 karakter. |
| `BETTER_AUTH_SECRET` | Tidak ada | Secret Better Auth, minimum 32 karakter. |
| `TRUST_PROXY` | `false` | `true` jika reverse proxy tepercaya meneruskan alamat klien untuk pembatasan login. |
| `ALLOWED_HOSTS` | Tidak ada | Tambahan hostname yang diterima pada header Host/Origin, dipisahkan koma. |

`.env.example` juga mencantumkan `LOG_LEVEL`, tetapi saat ini server tidak menggunakannya untuk mengatur level log. Jangan mengandalkan variabel tersebut untuk menyembunyikan output sensitif.

Contoh pengaturan lokal:

```dotenv
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=http://127.0.0.1:3000
DATABASE_PATH=./data/agent.sqlite
DASHBOARD_EMAIL=operator@example.com
DASHBOARD_PASSWORD=isi-password-acak-minimal-12-karakter
BETTER_AUTH_SECRET=isi-secret-acak-minimal-32-karakter
TRUST_PROXY=false
```

**Jangan commit `.env` atau `.env.production`.** Nilai kata sandi dan secret di atas hanya petunjuk format, bukan kredensial siap pakai.

## Pengaturan di dashboard

Menu **Pengaturan** menyimpan nilai berikut ke SQLite:

| Field | Nilai awal | Rentang / aturan |
| --- | --- | --- |
| `public_base_url` | Mengikuti `PUBLIC_BASE_URL` saat seed pertama | URL HTTPS; HTTP hanya untuk `localhost` atau `127.0.0.1` |
| `shell_concurrency_limit` | `32` | 1–128 per proses |
| `shell_timeout_ms` | `120000` | Minimum 1000 ms dan tidak melebihi batas maksimum |
| `shell_timeout_max_ms` | `600000` | Minimum 1000 ms |
| `output_char_limit` | `30000` | Ada di database, belum dapat diubah lewat form |

Perubahan batas shell dipakai pada panggilan berikutnya. Perubahan URL di dashboard **tidak otomatis memperbarui `PUBLIC_BASE_URL` pada proses yang sedang berjalan**: metadata OAuth dan resource URL dibuat dari variabel lingkungan ketika aplikasi dimulai. Untuk mengganti domain, sesuaikan juga konfigurasi proses, restart server, dan sambungkan ulang klien OAuth.

## File dan migrasi database

- Server menggunakan `bun:sqlite`, satu file database dengan mode WAL.
- Migrasi SQL dalam `migrations/` dijalankan saat database dibuka; skema Better Auth juga dikelola ketika aplikasi dibuat.
- Data operator, API key, audit panggilan, memori, skill, dan pengaturan tersimpan dalam SQLite.
- Untuk backup yang konsisten saat server aktif, gunakan mekanisme backup SQLite, bukan menyalin file `.sqlite` saja tanpa mempertimbangkan file WAL.
- Jangan letakkan file database atau backup pada direktori yang dapat diakses publik lewat HTTP.

## Mengubah kata sandi operator

Variabel `DASHBOARD_PASSWORD` dipakai untuk membuat akun awal. Mengganti nilainya setelah akun ada **tidak otomatis** mengganti password di database. Gunakan:

```bash
bun run operator:reset-password
```

Perintah tersebut memakai email, password baru, secret, dan database dari environment proses. Jalankan dengan environment instalasi yang benar, terutama jika memakai `.env.production`.

Baca juga [keamanan](security.md) sebelum menyiapkan akses publik.
