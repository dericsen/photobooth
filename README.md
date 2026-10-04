# 📸 Photobooth → WhatsApp

Aplikasi photobooth berbasis web: pilih frame → 4 jepretan otomatis (dengan countdown) → hasil strip → masukkan nomor WA → foto langsung terkirim ke WhatsApp.

Pengiriman memakai **WhatsApp Web**: login sekali dengan scan QR, tanpa biaya dan tanpa API berbayar. Butuh **Node.js 20.12+**.

## Cara pakai

1. Simpan 2 gambar frame ke `public/frames/frame1.png` dan `public/frames/frame2.png`.
2. `npm install`
3. `cp .env.example .env` (bawaannya sudah `WA_PROVIDER=web`, tinggal pakai).
4. `npm start`
5. Buka **`http://localhost:3000/scanwa`** lalu scan QR-nya:
   WhatsApp di HP → **Titik tiga** (Android) atau **Pengaturan** (iPhone) → **Perangkat tertaut** → **Tautkan perangkat**.
6. Setelah statusnya "tersambung", buka `http://localhost:3000` untuk mulai photobooth (F11 untuk layar penuh).

Sesi login disimpan di folder `wa-auth/`, jadi **tidak perlu scan ulang** setiap server dinyalakan. HP pengirim boleh offline setelah tertaut, tapi jangan sampai perangkat tertautnya dihapus dari WhatsApp.

Kalau WhatsApp belum tersambung, layar awal photobooth menampilkan banner kuning sebagai pengingat, dan kalau pengiriman gagal karena belum login, muncul tombol langsung ke halaman scan QR.

> Kamera hanya bisa dibuka lewat `localhost` atau **HTTPS**. Kalau tablet/HP membuka dari laptop lain, pakai HTTPS (mis. lewat `ngrok` / Cloudflare Tunnel).

## Halaman scan QR: `/scanwa`

| Alamat | Fungsi |
|---|---|
| `/scanwa` | Halaman QR + status koneksi, auto-refresh. Ada tombol "Putuskan sambungan" untuk ganti nomor pengirim. |
| `/api/wa/status` | Status koneksi dalam JSON: `qr`, `connecting`, `connected`, `logged_out`, `error`. |

QR WhatsApp hanya berlaku sekitar 1 menit; server otomatis membuat yang baru dan halamannya ikut memperbarui sendiri. Kalau koneksi terputus, server menyambung ulang otomatis dengan jeda yang makin panjang.

## Area foto dideteksi otomatis

Kotak putih di dalam frame dideteksi otomatis, lalu foto ditaruh *di bawah* frame. Hasilnya, sticker yang menimpa frame (kucing, kelinci, dll.) tetap tampil di atas foto.
Buka `http://localhost:3000/?debug=1` untuk melihat hasil deteksi. Area magenta adalah tempat foto, dan kotak biru adalah slot 1 sampai 4.
Kalau hasilnya meleset, isi `slots` secara manual di `public/config.js`. Nilai pecahan hasil deteksi juga dicetak di console browser.

## Pilihan provider lain (`WA_PROVIDER` di `.env`)

| Provider | Keterangan |
|---|---|
| `web` | **Bawaan.** WhatsApp Web lewat [Baileys](https://github.com/WhiskeySockets/Baileys). Gratis, scan QR di `/scanwa`. Ini cara tidak resmi, jadi pakai nomor khusus acara, bukan nomor pribadi utama. |
| `mock` | Untuk uji coba. Foto hanya disimpan, tidak dikirim. Tidak butuh `npm install`. |
| `fonnte` | [Fonnte](https://fonnte.com): daftar, scan QR di dashboard mereka, salin token ke `FONNTE_TOKEN`. Lebih stabil untuk acara besar. |
| `cloud` | WhatsApp Cloud API resmi dari Meta. Ke nomor yang belum pernah chat duluan, WA **wajib** memakai template yang sudah di-approve dengan header **IMAGE** (isi `WA_CLOUD_TEMPLATE_NAME`). |

Semua foto juga disimpan di folder `photos/`, dengan log di `photos/log.jsonl`, sebagai cadangan kalau pengiriman gagal.

## Pengaturan lain (`public/config.js`)

Nama event, lama countdown, efek cermin, kualitas JPEG, dan waktu kembali otomatis ke layar awal.
Tombol **Spasi/Enter** juga bisa dipakai untuk mulai foto, jadi bisa pakai remote/keyboard.
