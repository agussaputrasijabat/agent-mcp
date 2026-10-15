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

## Approval yang ditegakkan server

Server kini memiliki gerbang approval untuk perintah shell yang terdeteksi berisiko, perubahan file sensitif, serta penghapusan memori atau skill lewat MCP. Panggilan pertama menghasilkan `approval_required` tanpa melakukan eksekusi. Operator harus menyetujui tindakan dari halaman `/approvals`, kemudian klien mengulang argumen identik dengan `approval_id`. Persetujuan terikat pada identitas klien dan hash argumen, dapat digunakan sekali, dan kedaluwarsa setelah lima menit. Persetujuan di chat saja **bukan** bukti approval server.

Mode shell default `strict` meminta persetujuan operator pada **setiap** perintah shell. Mode `risky` hanya tersedia sebagai opt-in di Pengaturan dan menggunakan deteksi pola yang **tidak dapat mencegah semua bentuk perintah berbahaya** (script, encoding, alias, interpreter, atau shell tidak langsung). Set `AGENT_MCP_SHELL_POLICY=strict` untuk memaksakan mode ketat. Kebijakan ini tidak membatasi hak OS maupun menjadikan server sandbox. Penulisan file biasa tetap diizinkan dalam konteks hak OS server; `expected_hash` adalah mekanisme konflik opsional.

Jangan menganggap approval atau prompt sebagai pengganti pembatasan akses OS, firewall, atau perlindungan kredensial.

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

Feed dan SQLite menyimpan nama tool, waktu, argumen, hasil, serta status error. Audit meredaksi kredensial koneksi yang diketahui, isi perubahan file sensitif, dan hasil `read_file` pada path sensitif. Isi perintah shell serta output-nya tidak disimpan mentah di tabel audit maupun approval. Pratinjau perintah hanya tersedia sementara di memori server untuk operator terautentikasi. Respons ke klien tetap berisi hasil tool yang sebenarnya. Shell arbitrer masih dapat mengeluarkan rahasia dengan bentuk yang tidak dikenali penyaring; jangan menganggap audit telah bebas dari seluruh informasi sensitif. Lindungi database SQLite dan backup-nya.

## Jaringan dan `web_fetch`

`web_fetch` berjalan di host, bukan dari browser operator. Implementasi saat ini memblokir alamat privat, loopback, dan bentuk alamat tertentu yang tidak aman. Karena itu, instruksi yang menyarankan `web_fetch` untuk localhost/LAN belum sesuai dengan perilaku tool sekarang. Jangan membuka akses jaringan privat hanya untuk mengatasi pesan `fetch_blocked` tanpa meninjau risiko SSRF.

## Laporan kerentanan

Lihat [SECURITY.md](../SECURITY.md) untuk cara menyampaikan laporan keamanan tanpa mengungkap detail eksploitasi secara publik.
