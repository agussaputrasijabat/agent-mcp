# Berkontribusi ke Agent MCP

Terima kasih sudah meluangkan waktu untuk memperbaiki Agent MCP. Perubahan kecil, dokumentasi yang lebih jelas, laporan bug yang bisa direproduksi, dan pengujian semuanya berguna.

Baca [README](README.md) untuk gambaran proyek dan [arsitektur](docs/architecture.md) sebelum mengubah bagian yang memengaruhi autentikasi atau eksekusi tool.

## Sebelum membuat issue atau pull request

Buka [halaman Issues](https://github.com/agussaputrasijabat/agent-mcp/issues/new/choose) dan pilih formulir yang sesuai:

- **Laporan Bug:** langkah reproduksi, hasil aktual dan yang diharapkan, lingkungan host, serta log yang sudah disamarkan.
- **Usulan Fitur:** kebutuhan yang belum terpenuhi, solusi yang diusulkan, dan alternatif bila ada.
- **Perbaikan Dokumentasi:** halaman yang bermasalah dan perubahan yang diperlukan.

Cari issue serupa sebelum membuat yang baru. Formulir tersedia di [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE/).

**Masalah keamanan:** jangan sertakan exploit atau kredensial dalam issue publik. Ikuti [SECURITY.md](SECURITY.md) untuk pelaporan privat. Untuk perubahan fitur yang besar, diskusikan rancangan melalui issue lebih dulu.

## Menyiapkan lingkungan

Prasyarat: Bun dan Bash.

```bash
git clone https://github.com/agussaputrasijabat/agent-mcp.git
cd agent-mcp
bun install
cp .env.example .env
```

Isi `.env` dengan data operator lokal. Password minimal 12 karakter dan `BETTER_AUTH_SECRET` minimal 32 karakter. Jangan commit file environment, database SQLite, log berisi rahasia, atau API key.

```bash
bun run dev
```

`dev` membangun UI dan menjalankan server dengan watch. Dashboard berada di `http://127.0.0.1:3000/login` bila memakai konfigurasi default.

## Struktur kode

- `src/app.ts` untuk route dan integrasi HTTP.
- `src/mcp/` untuk pendaftaran tool dan konteks permintaan MCP.
- `src/tools/` untuk implementasi tool.
- `src/auth/` untuk otorisasi dan login.
- `src/db/` serta `migrations/` untuk penyimpanan.
- `web/src/` untuk dashboard React.
- `test/` untuk tes.
- `docs/` untuk panduan pengguna dan referensi teknis.

Jaga perubahan tetap terfokus. Hindari refactor di luar issue yang sedang dikerjakan.

## Tes dan pemeriksaan

Sebelum pull request:

```bash
bun test
bun run build
```

Jika mengubah definisi tool MCP atau schema input, jalankan juga:

```bash
bun run schema:tokens
```

Untuk bug, tambahkan tes yang gagal sebelum perbaikan dan lulus setelahnya jika memungkinkan. Perubahan docs-only tidak memerlukan tes baru, tetapi tetap periksa contoh perintah, path, dan tautan.

## Gaya kontribusi

- Gunakan **Bun** untuk perintah proyek; hindari mencampur lockfile package manager lain.
- Ikuti gaya TypeScript/React yang sudah ada, bukan memperkenalkan konvensi baru tanpa alasan.
- Simpan rahasia di environment, jangan di source code atau fixture yang dikomit.
- Jelaskan perubahan perilaku autentikasi, jaringan, atau akses file di dokumentasi.
- Tulis pesan commit singkat dalam bahasa Inggris. Format seperti `docs: clarify OAuth setup` atau `fix: handle invalid tool path` dianjurkan.

## Checklist pull request

- [ ] Scope PR jelas dan tidak mencampur perubahan tidak terkait.
- [ ] `bun test` lulus (atau alasan kegagalan dicantumkan).
- [ ] `bun run build` lulus (atau alasan kegagalan dicantumkan).
- [ ] Dokumentasi dan tes diperbarui jika perilaku berubah.
- [ ] Tidak ada API key, password, token, database, atau data pribadi dalam perubahan.

Saat membuka PR, gunakan template yang tersedia di `.github/pull_request_template.md`. GitHub Actions menjalankan `bun test` dan `bun run build` pada setiap pull request ke `main`; pastikan keduanya lulus sebelum merge. Sertakan screenshot hanya bila UI berubah. Maintainer dapat meminta perbaikan sebelum merge.

Proyek menggunakan [lisensi MIT](LICENSE). Dengan mengajukan kontribusi, kamu menyetujui distribusinya sesuai lisensi repository.
