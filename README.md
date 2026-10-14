# agent-mcp

Server MCP remote untuk ChatGPT, Claude, dan AI web lain. Model tetap di klien chat. Proses ini menjalankan tool file, shell, memori, dan skill di host. Ini bukan CLI seperti Claude Code.

## Apa ini

Klien chat memanggil endpoint `/mcp` dan memilih tool di sana. Proses di host menjalankan tool itu, lalu menyimpan jejak panggilan di SQLite.

Tool file membaca, menulis, mengedit, dan mencari berkas. `shell` menjalankan perintah di host. Memori menyimpan catatan yang tetap ada setelah proses dijalankan ulang. Skill menyimpan prosedur yang bisa dibaca lagi pada permintaan berikutnya. `web_fetch` mengambil URL dari host.

Spesifikasi ada di [docs/PRD.md](docs/PRD.md).

## Konsol operator

Feed menampilkan panggilan tool. Halaman Kunci membuat dan mencabut kunci API untuk konektor. Halaman Setup mengisi path absolut proyek dan nama MCP, lalu menghasilkan teks instruksi proyek untuk ditempel ke custom instructions ChatGPT atau Claude.

## Cara pakai

```bash
bun install
cp .env.example .env
bun run dev
```

Salin `.env.example` menjadi `.env`, lalu isi nilai yang diminta berkas itu. `DASHBOARD_PASSWORD` minimal 12 karakter. `BETTER_AUTH_SECRET` minimal 32 karakter. `PUBLIC_BASE_URL` adalah asal yang dipakai metadata OAuth. Bun memuat `.env` sendiri. `bun run dev` membangun dashboard, lalu menjalankan `src/index.ts` dengan watch.

Buka konsol operator di origin proses itu. Feed menampilkan panggilan tool.

Endpoint untuk konektor adalah `/mcp`.

Buat kunci di halaman Kunci. Kunci berawalan `amcp_` dan hanya ditampilkan sekali. Claude mengirim kunci lewat header `X-Api-Key`, atau lewat header `Authorization` dengan Bearer dan kunci `amcp_`. Query `?api_key=` pada URL endpoint juga diterima. Konektor tanpa kolom OAuth menaruh kunci di query `?api_key=`. Query `api_key` di host publik harus lewat HTTPS. `localhost` dan `127.0.0.1` boleh HTTP.

Konektor yang minta URL server memakai origin situs ditambah `/mcp`. Alamat yang sedang terbuka ada di halaman Setup.

Di halaman Setup, isi path absolut proyek di mesin MCP dan nama MCP yang sama dengan nama di konektor. Salin teks yang dihasilkan, lalu tempel ke custom instructions proyek di ChatGPT atau Claude.

OAuth masuk lewat `/login`. Halaman `/consent` punya tombol Izinkan dan Tolak. Resource OAuth sama dengan `PUBLIC_BASE_URL` ditambah `/mcp`.

## Pengembangan

```bash
bun install
cp .env.example .env
bun run dev
```

Salin `.env.example` menjadi `.env`, lalu isi nilai yang diminta berkas itu. `bun run dev` membangun dashboard, lalu menjalankan `src/index.ts` dengan watch. Bun memuat `.env` sendiri.

## Menghubungkan dari laptop

Perintah laptop, tunnel, dan VPS yang lebih panjang ada di [docs/run.md](docs/run.md).

`HOST=127.0.0.1` membuat proses hanya menerima koneksi di antarmuka loopback. Port tidak menerima koneksi dari antarmuka lain.

```bash
HOST=127.0.0.1 PORT=3000 PUBLIC_BASE_URL=http://127.0.0.1:3000 bun run start
```

`bun run start` membangun dashboard, lalu menjalankan proses yang sama. Skrip `start` di `package.json` menjalankan `bun run build`, lalu `bun src/index.ts`.

### Hostname publik

Server tetap di laptop, pada `127.0.0.1:3000`. Kalau dashboard atau klien dibuka dari origin publik, set `PUBLIC_BASE_URL` ke origin `https://` itu dan arahkan tunnel ke port lokal. Konektor chat yang minta URL server memakai `https://host/mcp`. `host` pada URL itu adalah hostname `PUBLIC_BASE_URL`.

Hostname publik itu boleh berasal dari Cloudflare. Repo ini tidak menuliskan perintah untuk membuat tunnel tersebut. Setelah hostname hidup, isi `PUBLIC_BASE_URL` seperti di atas.

Kalau header `Host` berbeda dari hostname origin itu, isi `ALLOWED_HOSTS` dengan hostname tersebut, dipisah koma bila ada lebih dari satu. Daftar yang sama dipakai untuk header `Host` dan `Origin`, jadi `/assets` dan favicon bisa dimuat tanpa sesi dashboard. `TRUST_PROXY=true` membuat IP klien dibaca dari header proxy untuk batas percobaan login.

Cloudflare Access tidak boleh membatasi `/mcp` ke perangkat operator saja. Pemanggil tool adalah server OpenAI atau Anthropic, bukan browser operator.

### OpenAI Secure MCP Tunnel

OpenAI Secure MCP Tunnel memakai `tunnel-client`. Klien itu membuka HTTPS keluar ke OpenAI dan meneruskan permintaan MCP ke URL lokal. Ambil `tunnel_id` dari Platform tunnel settings, lalu jalankan klien di mesin yang sudah bisa mencapai server.

```bash
tunnel-client init --profile agent-mcp --tunnel-id "$TUNNEL_ID" --mcp-server-url http://127.0.0.1:3000/mcp && tunnel-client run --profile agent-mcp
```

Di ChatGPT, tambahkan MCP kustom dengan koneksi Tunnel dan `tunnel_id` yang sama.

## Menghubungkan di VPS

Jalankan proyek ini di server. `bun` harus ada di PATH. `bun install` sekali. Nama domain atau subdomain adalah hostname publik. Reverse proxy meneruskan ke `127.0.0.1`. `PUBLIC_BASE_URL` harus `https://` dan sama dengan nama host publik. `TRUST_PROXY=true` membuat protokol dan IP klien dibaca dari header proxy.

```bash
HOST=127.0.0.1 PORT=3000 TRUST_PROXY=true PUBLIC_BASE_URL=https://mcp.example.com bun run start
```

Ganti `mcp.example.com` dengan domain atau subdomain server. Perintah itu memakai skrip `start` di `package.json`. Konektor memakai `https://host/mcp` dengan hostname yang sama.

Cloudflare Access tidak boleh membatasi `/mcp` ke perangkat operator saja. Pemanggil tool adalah server OpenAI atau Anthropic, bukan browser operator.

### PM2

`.env.production` terpisah dari `.env`. `bun run dev` tetap memakai `.env`.

Salin `.env.production.example` menjadi `.env.production`, lalu isi nilainya. `DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD` minimal 12 karakter, dan `BETTER_AUTH_SECRET` minimal 32 karakter wajib diisi. Contoh `DATABASE_PATH` adalah `./data/prod.sqlite`. Operator boleh mengganti path itu. Isi `PUBLIC_BASE_URL` dengan origin HTTPS publik. `TRUST_PROXY=true` bila proses di belakang tunnel atau reverse proxy.

`ecosystem.config.json` menjalankan `bun --no-env-file --env-file=.env.production run start:prod`. Skrip `start:prod` di `package.json` membangun dashboard tanpa memuat `.env` dev, lalu menjalankan `src/index.ts` dengan `.env.production`.

```bash
pm2 start ecosystem.config.json
pm2 reload ecosystem.config.json
pm2 logs agent-mcp
```

## Lisensi

Lisensi MIT. Teks lengkap ada di [LICENSE](LICENSE).

## Kontribusi

Cara mengubah kode ada di [CONTRIBUTING.md](CONTRIBUTING.md).
