# agent-mcp

Server MCP remote untuk ChatGPT, Claude, dan AI web lain. Model tetap di klien chat. Proses ini menjalankan tool file, shell, memori, dan skill di host. Ini bukan CLI seperti Claude Code.

## Apa ini

Klien chat memanggil endpoint `/mcp` dan memilih tool di sana. Proses di host menjalankan tool itu, lalu menyimpan jejak panggilan di SQLite.

Tool file membaca, menulis, mengedit, dan mencari berkas. `shell` menjalankan perintah di host. Memori menyimpan catatan yang tetap ada setelah proses dijalankan ulang. Skill menyimpan prosedur yang bisa dibaca lagi pada permintaan berikutnya. `web_fetch` mengambil URL dari host.

Spesifikasi ada di [docs/PRD.md](docs/PRD.md).

## Konsol operator

Feed menampilkan panggilan tool. Halaman Kunci membuat dan mencabut kunci API untuk konektor. Halaman Setup mengisi path absolut proyek dan nama MCP, lalu menghasilkan teks instruksi proyek untuk ditempel ke custom instructions ChatGPT atau Claude.

## Pengembangan

```bash
bun install
cp .env.example .env
bun run dev
```

Salin `.env.example` menjadi `.env`, lalu isi nilai yang diminta berkas itu. `bun run dev` membangun dashboard, lalu menjalankan `src/index.ts` dengan watch. Bun memuat `.env` sendiri.

## Produksi

Produksi memakai `.env.production` dan `ecosystem.config.json`. Laptop, tunnel, dan VPS ada di [docs/run.md](docs/run.md).

## Lisensi

Lisensi MIT. Teks lengkap ada di [LICENSE](LICENSE).

## Kontribusi

Cara mengubah kode ada di [CONTRIBUTING.md](CONTRIBUTING.md).
