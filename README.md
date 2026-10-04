# 📸 Photobooth → WhatsApp

Aplikasi photobooth berbasis web: pilih frame → 4 jepretan otomatis (dengan countdown) → hasil strip → masukkan nomor WA → foto langsung terkirim ke WhatsApp.

Tidak perlu `npm install` (tanpa dependency). Butuh **Node.js 20.12+**.

## Cara pakai

1. Simpan 2 gambar frame ke `public/frames/frame1.png` dan `public/frames/frame2.png`.
2. `cp .env.example .env` lalu isi provider WhatsApp (lihat di bawah).
3. Jalankan `npm start`, lalu buka `http://localhost:3000` di Chrome (mode layar penuh: F11).

> Kamera hanya bisa dibuka lewat `localhost` atau **HTTPS**. Kalau tablet/HP membuka dari laptop lain, pakai HTTPS (mis. lewat `ngrok` / Cloudflare Tunnel).

## Area foto dideteksi otomatis

Kotak putih di dalam frame dideteksi otomatis, lalu foto ditaruh *di bawah* frame. Hasilnya, sticker yang menimpa frame (kucing, kelinci, dll.) tetap tampil di atas foto.
Buka `http://localhost:3000/?debug=1` untuk melihat hasil deteksi. Area magenta adalah tempat foto, dan kotak biru adalah slot 1 sampai 4.
Kalau hasilnya meleset, isi `slots` secara manual di `public/config.js`. Nilai pecahan hasil deteksi juga dicetak di console browser.

## Provider WhatsApp (`WA_PROVIDER` di `.env`)

| Provider | Keterangan |
|---|---|
| `mock` | Untuk uji coba. Foto hanya disimpan, tidak dikirim. |
| `fonnte` | [Fonnte](https://fonnte.com): daftar, scan QR pakai nomor WA kamu, lalu salin token ke `FONNTE_TOKEN`. Paling gampang. Pastikan paketnya mendukung kirim file/gambar. |
| `cloud` | WhatsApp Cloud API resmi dari Meta. Ke nomor yang belum pernah chat duluan, WA **wajib** memakai template yang sudah di-approve. Buat template dengan header **IMAGE** lalu isi `WA_CLOUD_TEMPLATE_NAME`. |

Semua foto juga disimpan di folder `photos/`, dengan log di `photos/log.jsonl`, sebagai cadangan kalau pengiriman gagal.

## Pengaturan lain (`public/config.js`)

Nama event, lama countdown, efek cermin, kualitas JPEG, dan waktu kembali otomatis ke layar awal.
Tombol **Spasi/Enter** juga bisa dipakai untuk mulai foto, jadi bisa pakai remote/keyboard.
