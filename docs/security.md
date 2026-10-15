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

## Konfirmasi tool oleh ChatGPT / Claude

Agent MCP mengirim anotasi MCP `readOnlyHint`, `destructiveHint`, dan `openWorldHint`. Konfirmasi dilakukan oleh **aplikasi klien** (ChatGPT atau Claude) sebelum tool dipanggil, sesuai pengaturan izin dan kebijakan klien. Server tidak meminta `approval_id`, tidak menyediakan persetujuan terpisah, dan tidak memaksa operator membuka dashboard.

Tool `shell`, `start_process`, `execute_code`, `write_file`, `edit_file`, `move_path`, operasi penulisan dokumen, `terminate_process`, `memory_forget`, dan `skill_delete` ditandai berpotensi destruktif. Penulisan memori/skill juga ditandai sebagai operasi perubahan data; operasi baca memiliki `readOnlyHint: true`.

**Batas keamanan:** Anotasi MCP adalah petunjuk, bukan mekanisme otorisasi. Tidak semua klien atau konfigurasi akan memunculkan dialog; izin yang disimpan/diingat oleh klien juga bisa meniadakan dialog berikutnya. Jika klien mengirim pemanggilan tool yang sudah diizinkan oleh autentikasi MCP, server menjalankannya dengan hak akses OS proses. Periksa izin tool klien dan gunakan akun OS dengan hak minimum. Konfirmasi klien bukan sandbox.

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

Feed dan SQLite menyimpan nama tool, waktu, argumen, hasil, serta status error. Audit meredaksi kredensial koneksi yang diketahui, isi perubahan file sensitif, dan hasil `read_file` pada path sensitif. Isi perintah shell, perintah sesi proses, source code, input interaktif, isi Markdown, nilai penggantian DOCX, serta data sel/row tidak disimpan mentah di tabel audit; respons pembacaan dokumen dan output proses juga tidak dicatat mentah. Tabel approval dari versi terdahulu tetap berada dalam skema SQLite untuk kompatibilitas, tetapi tidak lagi digunakan untuk pemanggilan tool. Respons ke klien tetap berisi hasil tool yang sebenarnya. Shell arbitrer masih dapat mengeluarkan rahasia dengan bentuk yang tidak dikenali penyaring; jangan menganggap audit telah bebas dari seluruh informasi sensitif. Lindungi database SQLite dan backup-nya.

## Jaringan dan `web_fetch`

`web_fetch` berjalan di host, bukan dari browser operator. Implementasi saat ini memblokir alamat privat, loopback, dan bentuk alamat tertentu yang tidak aman. Karena itu, instruksi yang menyarankan `web_fetch` untuk localhost/LAN belum sesuai dengan perilaku tool sekarang. Jangan membuka akses jaringan privat hanya untuk mengatasi pesan `fetch_blocked` tanpa meninjau risiko SSRF.

## Laporan kerentanan

Lihat [SECURITY.md](../SECURITY.md) untuk cara menyampaikan laporan keamanan tanpa mengungkap detail eksploitasi secara publik.
