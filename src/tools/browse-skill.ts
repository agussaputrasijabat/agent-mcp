export const browseSkill = {
  name: "browse",
  description: "Pakai saat pengguna ingin membuka atau mengemudikan browser lokal dari host MCP.",
  body: `# Browser lokal di host MCP

Pakai skill ini saat pengguna ingin membuka atau mengemudikan browser dari mesin tempat MCP berjalan.

Jalankan CLI browse lewat tool shell. Jangan menambah tool MCP baru. Jangan memanggil layanan cloud. Jangan memakai --remote, browse cloud, atau browse functions.

## 1. Cek perintah

Lewat shell, jalankan:

command -v browse

Jika perintah itu mengembalikan path, browse sudah ada. Lanjut ke langkah 3. Jangan beralih ke endpoint cloud.

Jika perintah tidak ada, lanjut ke langkah 2.

## 2. Instal hanya setelah ya

Berhenti. Jangan menginstal sebelum ada jawaban ya yang jelas.

Tanya di chat apakah browse boleh dipasang di host MCP. Sebut perintah ini persis:

npm install -g browse

Kerja proyek biasa tidak perlu pertanyaan. Instalasi ini yang perlu ya. Jawaban selain ya berarti belum boleh instal.

Setelah ya, jalankan hanya perintah itu lewat shell. Jangan memasang paket lain. Setelah perintah selesai, lanjut ke langkah 3.

## 3. Mode lokal

Default tanpa flag adalah browser lokal, tetapi berubah menjadi browser remote bila BROWSERBASE_API_KEY terpasang. CLI juga bisa memuat kunci itu dari .env. Jangan mengandalkan default.

Setiap perintah driver memakai flag --local. Flag itu memaksa browser lokal di host ini. --headed menampilkan jendela. --headless menyembunyikannya. Keduanya tetap lokal.

Jangan memakai --remote. Jangan mengisi BROWSERBASE_API_KEY untuk tugas ini.

Contoh:

browse open https://example.com --local
browse snapshot --local
browse click @0-12 --local
browse fill @0-8 "hello" --local
browse get title --local
browse screenshot --path page.png --local
browse stop

browse snapshot mencetak ref seperti @0-12. Perintah elemen memakai ref itu, XPath, atau CSS selector.

browse stop menutup daemon sesi. Pakai setelah tugas selesai.

## Batas

Jangan menginstal browse sebelum ya.
Jangan memakai cloud Browserbase.
Jangan menambah tool MCP.
Nama perintah tetap bahasa Inggris.
`,
} as const;
