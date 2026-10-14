# Menjalankan agent-mcp

Salin `.env.example` menjadi `.env`. Isi `DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD` (minimal 12 karakter), dan `BETTER_AUTH_SECRET` (minimal 32 karakter). `PUBLIC_BASE_URL` adalah asal yang dipakai metadata OAuth. Bun memuat `.env` sendiri.

`bun install` sekali. `bun run start` membangun dashboard lalu menjalankan proses yang sama.

## Laptop

`HOST=127.0.0.1` membuat proses hanya menerima koneksi di antarmuka loopback. Port tidak menerima koneksi dari antarmuka lain.

```bash
HOST=127.0.0.1 PORT=3000 PUBLIC_BASE_URL=http://127.0.0.1:3000 bun run start
```

## Tunnel

Server tetap di laptop, pada `127.0.0.1:3000`. OpenAI Secure MCP Tunnel memakai `tunnel-client`: klien itu membuka HTTPS keluar ke OpenAI dan meneruskan permintaan MCP ke URL lokal. Ambil `tunnel_id` dari Platform tunnel settings, lalu jalankan klien di mesin yang sudah bisa mencapai server.

```bash
tunnel-client init --profile agent-mcp --tunnel-id "$TUNNEL_ID" --mcp-server-url http://127.0.0.1:3000/mcp && tunnel-client run --profile agent-mcp
```

Di ChatGPT, tambahkan MCP kustom dengan koneksi Tunnel dan `tunnel_id` yang sama.

## VPS

Proses duduk di belakang reverse proxy. Proxy meneruskan ke `127.0.0.1`. `TRUST_PROXY=true` membuat protokol dan IP klien dibaca dari header proxy. `PUBLIC_BASE_URL` harus `https://` dan sama dengan nama host publik.

```bash
HOST=127.0.0.1 PORT=3000 TRUST_PROXY=true PUBLIC_BASE_URL=https://mcp.example.com bun run start
```

Cloudflare Access tidak boleh membatasi `/mcp` ke perangkat operator saja. Pemanggil tool adalah server OpenAI atau Anthropic, bukan browser operator.
