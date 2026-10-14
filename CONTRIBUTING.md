# Kontribusi

Perubahan masuk lewat pull request. Penyiapan lingkungan ada di [README.md](README.md).

## Lingkungan

Salin `.env.example` menjadi `.env`. Jangan memasukkan `.env`, `.env.production`, atau rahasia lain ke git.

```bash
bun install
bun run dev
bun test
```

`bun test` harus lulus sebelum pull request dibuka.

## Pesan commit

Tulis pesan commit dalam bahasa Inggris.

## Batas

Satu proses Bun menjalankan server dan konsol operator. Perintah di repo ini memakai `bun`, termasuk `bun install`, `bun run`, dan `bun test`.
