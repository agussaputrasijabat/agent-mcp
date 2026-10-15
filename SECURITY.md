# Kebijakan Keamanan

Agent MCP menjalankan perintah shell dan mengakses file pada komputer tempat proses berjalan. Kerentanan autentikasi, kebocoran credential, atau akses tanpa izin dapat berdampak langsung pada host tersebut.

## Melaporkan kerentanan

**Jangan buka issue publik yang berisi detail eksploitasi, token, atau langkah pengambilalihan host.**

Jika repository GitHub ini menyediakan fitur *Private vulnerability reporting*, gunakan fitur **Report a vulnerability** pada tab **Security** repository untuk mengirim laporan ke maintainer. Jika fitur tersebut tidak tersedia, hubungi maintainer melalui kanal privat yang tercantum pada profil atau halaman repository sebelum mengirim rincian teknis.

Sertakan deskripsi dampak, komponen dan versi terkait, langkah reproduksi minimum, serta saran mitigasi bila ada. Hindari pengiriman data nyata milik pengguna.

## Ruang lingkup

Area yang terutama perlu diperhatikan:

- Endpoint MCP `/mcp`, API key, OAuth, dan sesi dashboard.
- Eksekusi `shell` serta akses file pada host.
- Pembatasan origin/host, proxy, dan penanganan URL.
- Penyimpanan serta peredaksian kredensial pada audit.
- Akses tidak sah ke SQLite, memori, atau skill.

Belum ada jadwal dukungan atau SLA respons keamanan yang dipublikasikan. Jangan menganggap versi tertentu telah diaudit secara independen.

## Praktik penggunaan aman

Baca [docs/security.md](docs/security.md) sebelum deployment publik. Gunakan akun OS dengan izin minimum, HTTPS, credential unik, dan backup. Instruksi persetujuan di chat tidak ditegakkan oleh server sebagai mekanisme keamanan.
