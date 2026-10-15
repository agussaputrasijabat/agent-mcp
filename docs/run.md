# Instalasi dan deployment

Pilih cara menjalankan berdasarkan lokasi host. Semua pilihan memakai proses Bun yang sama dan endpoint MCP `/mcp`.

## CLI standalone tanpa `.env`

Distribusi npm publik belum dirilis; untuk menguji paket global khusus OS host dari repository:

```bash
bun install
bun run package:npm
npm pack ./dist/npm/package --pack-destination ./dist/npm
npm install -g ./dist/npm/agent-mcp-1.0.0.tgz
agent-mcp
```

Pengguna paket global hanya memerlukan Node.js untuk launcher npm; runtime Bun sudah disertakan di executable. Pada saat **pertama dijalankan** (bukan saat `npm install`), masukkan email serta password operator minimal 12 karakter dan ulangi password. CLI membuat `BETTER_AUTH_SECRET` secara kriptografis, menyimpan hash password di SQLite, dan menulis konfigurasi privat ke direktori data aplikasi. Tidak ada kredensial default atau file `.env` yang harus dibuat.

Preferensi port CLI baru adalah **47831**. Bila port tersebut sedang dipakai, CLI otomatis memilih port kosong lain sekali pada setup pertama, kemudian menyimpannya agar tetap stabil pada restart. Nomor lama di konfigurasi existing tidak diubah. Jika port bentrok belakangan, hentikan proses yang terkait atau gunakan `agent-mcp config set port auto`. Jangan ubah port ketika server masih berjalan.

```bash
agent-mcp start
agent-mcp status
agent-mcp open
agent-mcp config show
agent-mcp config get port
agent-mcp config set port 47832
agent-mcp auth reset-password
agent-mcp logs
agent-mcp stop
```

`config show` menyembunyikan auth secret. `auth reset-password` meminta password baru secara interaktif dan konfirmasi. Akun tetap dapat login selama menggunakan database dan secret yang sama. Jangan bagikan file `config.json` atau database operator.

Lokasi penyimpanan: `~/Library/Application Support/agent-mcp/` pada macOS, `%APPDATA%\\agent-mcp\\` pada Windows, atau `~/.local/share/agent-mcp/` pada Linux. Variabel `AGENT_MCP_HOME` dapat mengubahnya secara eksplisit. CLI lokal hanya mendengarkan pada `127.0.0.1`; koneksi ChatGPT/Claude dari cloud membutuhkan tunnel HTTPS terpisah. Paket uji lokal hanya berisi binary untuk platform saat build, belum rilis npm multi-platform.

## Persiapan

Pastikan [Bun](https://bun.sh/) dan `bash` tersedia. Untuk membuat pratinjau gambar besar melalui `read_file`, instal **FFmpeg** pada Linux (misalnya `sudo apt install ffmpeg`). Di macOS, `sips` bawaan sistem juga bisa digunakan sebagai alternatif.

Dari root repository:

```bash
bun install
cp .env.example .env
```

Isi `.env` dengan `DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD` (minimum 12 karakter), `BETTER_AUTH_SECRET` (minimum 32 karakter), `PUBLIC_BASE_URL`, dan konfigurasi host/database yang diperlukan. Bun membaca file `.env` secara otomatis saat perintah biasa dijalankan.

- `bun run dev`: build dashboard lalu jalankan server dengan watch.
- `bun run start`: build dashboard lalu jalankan server tanpa watch.
- `bun run build`: hanya build dashboard.
- `bun test`: jalankan tes.
- `bun run operator:reset-password`: ganti password operator yang sudah ada memakai variabel lingkungan aktif.

Konfigurasi semua variabel dijelaskan di [configuration.md](configuration.md).

## Laptop

Untuk penggunaan lokal, jalankan dengan loopback:

```bash
HOST=127.0.0.1 PORT=3000 PUBLIC_BASE_URL=http://127.0.0.1:3000 bun run start
```

`127.0.0.1` tidak menerima sambungan langsung dari perangkat lain. Login dashboard berada di `http://127.0.0.1:3000/login`. Uji kesehatan:

```bash
curl http://127.0.0.1:3000/health
```

Endpoint MCP berada di `http://127.0.0.1:3000/mcp`, tetapi mengaksesnya tanpa autentikasi akan menghasilkan `401`. Ini normal.

## Tunnel

Server tetap berjalan pada loopback laptop. Pilih salah satu pendekatan berikut sesuai fitur yang tersedia pada klien.

### OpenAI Secure MCP Tunnel

Jika akun/platform menyediakan koneksi Tunnel, ambil `tunnel_id` dari pengaturannya. Jalankan `tunnel-client` resmi yang sudah dipasang di mesin yang dapat mengakses Agent MCP:

```bash
tunnel-client init --profile agent-mcp --tunnel-id "$TUNNEL_ID" --mcp-server-url http://127.0.0.1:3000/mcp
tunnel-client run --profile agent-mcp
```

Lalu gunakan identitas tunnel yang sama pada konektor ChatGPT. Cara ini memakai koneksi keluar HTTPS dari mesin host.

### Tunnel dengan hostname HTTPS publik

Jika memakai Cloudflare Tunnel atau penyedia tunnel lain, teruskan hostname HTTPS publik ke `http://127.0.0.1:3000`. Set `PUBLIC_BASE_URL` ke origin publik tersebut, misalnya `https://mcp.example.com`. Endpoint klien menjadi `https://mcp.example.com/mcp`.

Jika header `Host` atau `Origin` berbeda dari hostname di `PUBLIC_BASE_URL`, tambahkan hostname yang memang diperlukan ke `ALLOWED_HOSTS` (pisah koma). Jangan izinkan sembarang host. Atur `TRUST_PROXY=true` hanya jika proxy yang meneruskan header memang tepercaya.

Cloudflare Access yang membatasi `/mcp` ke perangkat operator saja dapat memutus koneksi ChatGPT atau Claude, karena pemanggilnya adalah layanan cloud mereka.

## VPS

Jalankan Agent MCP pada antarmuka loopback, dengan reverse proxy HTTPS (misalnya Nginx atau Caddy) di depan server:

```bash
HOST=127.0.0.1 PORT=3000 TRUST_PROXY=true PUBLIC_BASE_URL=https://mcp.example.com bun run start
```

Konfigurasikan reverse proxy agar `https://mcp.example.com` diteruskan ke `http://127.0.0.1:3000`. Pastikan TLS aktif dan proxy mendukung koneksi HTTP yang diperlukan oleh MCP Streamable HTTP. Jangan mengekspos port Bun mentah ke internet apabila reverse proxy sudah digunakan.

Gunakan akun OS khusus dengan izin minimal, jaga file SQLite tetap privat, dan aktifkan pencadangan. Baca [security.md](security.md) sebelum memublikasikan endpoint.

## PM2

Contoh `ecosystem.config.json` tersedia di root repository. Konfigurasi ini memakai environment produksi, terpisah dari `.env` pengembangan.

```bash
cp .env.production.example .env.production
```

Isi `.env.production` dengan kredensial kuat, `DATABASE_PATH` produksi, dan origin HTTPS publik yang benar. PM2 harus dapat menemukan executable `bun` di PATH.

```bash
pm2 start ecosystem.config.json
pm2 reload ecosystem.config.json
pm2 logs agent-mcp
```

Skrip `start:prod` membangun dashboard lalu menjalankan backend dengan `.env.production`. Perintah tersebut menggunakan opsi `--no-env-file` untuk mencegah pemuatan `.env` pengembangan. Reload setelah mengganti konfigurasi produksi.

## Setelah server berjalan

1. Buka `/health` untuk memeriksa server dan database.
2. Login ke dashboard di `/login`.
3. Buat API key atau sambungkan lewat OAuth.
4. Buka **Setup**, salin instruksi proyek, lalu uji panggilan `read_file` dari klien.
5. Periksa hasil dan error di Feed.

[Konfigurasi](configuration.md) · [Koneksi klien](clients.md) · [Troubleshooting](troubleshooting.md)
