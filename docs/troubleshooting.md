# Troubleshooting

Mulai dari perintah sederhana di mesin yang menjalankan server:

```bash
bun run build
bun test
curl http://127.0.0.1:3000/health
```

Jika server menggunakan port berbeda, sesuaikan URL health check. `bun test` dan `bun run build` tidak memerlukan server HTTP yang sudah berjalan.

| Gejala | Yang perlu diperiksa |
| --- | --- |
| Proses berhenti dengan `operator_env_missing` | Isi `DASHBOARD_EMAIL` dan `DASHBOARD_PASSWORD`. |
| `password_too_short` | Kata sandi operator minimal 12 karakter. |
| `auth_secret_missing` | `BETTER_AUTH_SECRET` minimal 32 karakter. |
| `invalid_port` | `PORT` harus bilangan bulat 1–65535. |
| `database_path_not_writable` | Periksa lokasi dan izin tulis direktori `DATABASE_PATH`. |
| Dashboard menampilkan “Dashboard build is missing” | Jalankan `bun run build` dari root repository. |
| `/mcp` mengembalikan `401 missing_credentials` | Tambahkan API key valid atau sambungkan lewat OAuth. |
| `401 invalid_api_key` | Pastikan key belum dicabut; periksa format header/URL dan buat key baru bila secret hilang. |
| `400 https_required` | Jangan kirim `?api_key=` melalui HTTP pada hostname publik. Pakai HTTPS atau header autentikasi. |
| Login menghasilkan `429 rate_limited` | Terlalu banyak percobaan gagal dari IP tersebut; hentikan percobaan berulang dan periksa kredensial. |
| `shell_busy` | Semua slot shell sedang dipakai; periksa proses aktif atau sesuaikan batas konkurensi. |
| `shell_timeout` / `invalid_timeout` | Periksa durasi kerja serta batas timeout di menu Pengaturan. |
| `path_not_absolute` | Gunakan path absolut mesin tempat Agent MCP berjalan, bukan path laptop lain atau lokasi browser. |
| `edit_not_unique` | String target muncul lebih dari sekali; gunakan teks konteks lebih spesifik. |
| `fetch_blocked` pada localhost/LAN | `web_fetch` memang memblokir target privat dan loopback. |
| `repo_skill_readonly` | Skill dari repository tidak bisa diubah melalui `skill_save` atau `skill_delete`. Edit file `SKILL.md` sumbernya. |

## Server hidup tetapi klien tidak terhubung

1. Uji `/health` dari host.
2. Periksa apakah konektor menggunakan URL dengan akhiran `/mcp`.
3. Bila klien berjalan di layanan cloud, pastikan tunnel atau HTTPS publik dapat dijangkau dari luar; `127.0.0.1` di mesin sendiri tidak dapat diakses oleh server cloud.
4. Pastikan autentikasi yang dikirim cocok dengan jenis koneksi: key `amcp_` atau bearer OAuth.
5. Untuk OAuth, pastikan `PUBLIC_BASE_URL` sesuai origin yang digunakan klien. Jika domain berubah, restart dengan environment baru dan sambungkan ulang.
6. Tinjau konfigurasi `Host`, `Origin`, `ALLOWED_HOSTS`, dan proxy. Hindari `ALLOWED_HOSTS` terlalu luas.

## Dashboard tidak bisa login

Periksa email/password yang dipakai ketika akun operator pertama kali dibuat. Mengganti `DASHBOARD_PASSWORD` di environment tidak otomatis memperbarui akun lama. Gunakan `bun run operator:reset-password` dengan konfigurasi database yang benar, seperti dijelaskan di [konfigurasi](configuration.md#mengubah-kata-sandi-operator).

## Feed kosong

Feed hanya menampilkan panggilan tool yang benar-benar sampai ke server. Periksa apakah klien sudah memanggil tool, bukan sekadar menjawab tanpa konektor. Sesi operator dashboard juga harus aktif. Jika daftar kosong tetapi klien menerima respons, cek database mana yang sedang dipakai (`DATABASE_PATH` lokal vs produksi).

## Masih bermasalah?

Saat membuka issue, sertakan cara reproduksi, sistem operasi host, versi Bun, langkah yang sudah dicoba, dan potongan log **setelah menghapus** key, token, cookie, alamat internal yang sensitif, serta data pengguna. Untuk dugaan kerentanan, ikuti [kebijakan keamanan](../SECURITY.md) dan jangan memublikasikan reproduksi eksploitasi.
