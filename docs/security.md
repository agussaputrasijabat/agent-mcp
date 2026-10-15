# Keamanan dan model kepercayaan

**Agent MCP memberi klien AI kemampuan menjalankan perintah dan memodifikasi file pada host.** Pasang dan jalankan hanya untuk klien, operator, dan perangkat yang kamu percayai.

## Apa yang dilindungi server?

- Endpoint `/mcp` memerlukan API key valid atau token OAuth. API key bisa dicabut lewat dashboard.
- Dashboard memakai sesi login operator dan membatasi percobaan login berulang.
- Query token OAuth (`?token=` atau `?access_token=`) ditolak.
- Query `?api_key=` lewat HTTP publik ditolak; HTTPS diwajibkan, kecuali untuk `localhost` atau `127.0.0.1`.
- `web_fetch` membatasi skema URL dan memblokir alamat yang terdeteksi privat atau loopback untuk mengurangi risiko SSRF.
- Argumen yang disimpan di audit menjalani peredaksian kredensial tertentu.

Ini **bukan** isolasi sistem operasi. `read_file`, `write_file`, `edit_file`, dan `shell` dijalankan dengan izin user yang menjalankan proses Bun. `project_path` hanya memberi konteks kepada klien dan tidak membatasi jangkauan tool.

## Approval tidak ditegakkan server

Template instruksi proyek meminta klien chat meminta izin sebelum operasi berbahaya, seperti penghapusan data atau perintah Git tertentu. **Server tidak memeriksa bukti persetujuan itu.** Setelah panggilan MCP lolos autentikasi, tool akan menjalankan aksi sesuai implementasinya.

Jangan menganggap prompt sebagai pengganti pembatasan akses OS, firewall, atau perlindungan kredensial.

## Rekomendasi deployment

- Jalankan layanan dengan **akun OS khusus** yang tidak mempunyai akses ke file rahasia atau proyek lain yang tidak diperlukan.
- Gunakan HTTPS untuk semua akses dari jaringan publik; biarkan server Bun terikat ke loopback di belakang reverse proxy/tunnel.
- Lindungi dashboard dengan password unik. Gunakan `BETTER_AUTH_SECRET` yang acak dan jangan membagikannya.
- Pilih OAuth atau header untuk API key. Hindari `?api_key=` jika ada pilihan lain: query string mungkin tercatat dalam log proxy, riwayat, atau tangkapan layar.
- Cabut key yang tidak digunakan. Jangan tempel API key, cookie, token, atau `.env` ke issue dan log publik.
- Jangan aktifkan `TRUST_PROXY=true` kecuali header forwarding berasal dari proxy yang kamu kendalikan.
- Pertahankan permission minimum pada SQLite dan backup. Periksa konfigurasi reverse proxy agar direktori database tidak disajikan sebagai aset statis.
- Buat backup serta rencana pemulihan sebelum menggunakan tool yang bisa menimpa atau menghapus data.

## Audit dan rahasia

Feed dan SQLite menyimpan nama tool, waktu, argumen, hasil, serta status error. Peredaksian berupaya menyembunyikan API key request dan nama parameter tertentu. Namun, perintah shell dan output tool masih bisa memuat rahasia lain (misalnya isi berkas konfigurasi). Anggap database audit sebagai data sensitif.

## Jaringan dan `web_fetch`

`web_fetch` berjalan di host, bukan dari browser operator. Implementasi saat ini memblokir alamat privat, loopback, dan bentuk alamat tertentu yang tidak aman. Karena itu, instruksi yang menyarankan `web_fetch` untuk localhost/LAN belum sesuai dengan perilaku tool sekarang. Jangan membuka akses jaringan privat hanya untuk mengatasi pesan `fetch_blocked` tanpa meninjau risiko SSRF.

## Laporan kerentanan

Lihat [SECURITY.md](../SECURITY.md) untuk cara menyampaikan laporan keamanan tanpa mengungkap detail eksploitasi secara publik.
