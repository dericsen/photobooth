# 📸 Photobooth → WhatsApp

Photobooth berbasis web: pilih frame → **6 jepretan** otomatis (hitung mundur **8 detik**) → **pilih 4 foto terbaik** → hasil strip → masukkan nomor WA → foto langsung terkirim. Semua foto otomatis tersimpan di komputer.

Pengiriman memakai **WhatsApp Web**: login sekali dengan scan QR, gratis tanpa API berbayar. Butuh **Node.js 20.12+**.

## Cara pakai

1. Simpan 2 gambar frame ke `public/frames/frame1.png` dan `public/frames/frame2.png`.
2. `npm install`
3. `cp .env.example .env` (bawaannya sudah `WA_PROVIDER=web`, tinggal pakai).
4. `npm start`
5. Buka **`http://localhost:3000/scanwa`** lalu scan QR-nya:
   WhatsApp di HP → **Titik tiga** (Android) atau **Pengaturan** (iPhone) → **Perangkat tertaut** → **Tautkan perangkat**.
6. Setelah statusnya "tersambung", buka `http://localhost:3000` untuk mulai photobooth (F11 untuk layar penuh).

Sesi login disimpan di folder `wa-auth/`, jadi **tidak perlu scan ulang** setiap server dinyalakan.

> Kamera hanya bisa dibuka lewat `localhost` atau **HTTPS**. Kalau tablet/HP membuka dari laptop lain, pakai HTTPS (mis. lewat `ngrok` / Cloudflare Tunnel).

## Alur untuk tamu

1. **Pilih frame** — 2 pilihan.
2. **Ambil foto** — 6 jepretan, tiap jepretan diawali hitung mundur 8 detik (bunyi hanya 3 detik terakhir). Jepretan yang sudah diambil muncul sebagai deretan thumbnail di bawah kamera.
3. **Pilih foto** — 6 foto ditampilkan, ketuk untuk memilih 4. Angka di foto menunjukkan urutannya di strip, dan pratinjau strip ikut berubah langsung. 2 foto yang tidak dipilih tetap tersimpan di komputer.
4. **Review** → **masukkan nomor** (ada tombol angka di layar) → **terkirim**.

Jumlah jepretan dan lama hitung mundur bisa diubah di `public/config.js` (`totalShots`, `countdownSeconds`).

## Semua foto otomatis tersimpan

Tiap sesi dapat satu folder di `photos/`:

```
photos/
  20261004-203015/
    shot-01.jpg ... shot-06.jpg   <- semua jepretan, termasuk yang tidak dipakai
    strip.jpg                     <- hasil strip
    strip-628xxxx.jpg             <- strip yang dikirim, dengan nomor tujuan
  log.jsonl                       <- catatan tiap sesi dan status pengiriman
```

Strip selalu disimpan **sebelum** dikirim, jadi kalau WhatsApp gagal fotonya tetap aman. Matikan dengan `autoSave: false` di `public/config.js`.

## Area foto dideteksi otomatis

Kotak foto di dalam frame dideteksi otomatis, lalu foto ditaruh *di bawah* frame. Hasilnya, sticker yang menimpa frame (kucing, kelinci, kamera) tetap tampil di atas foto, dan tepi frame yang bergelombang tetap rapi.

Deteksinya mencoba beberapa tingkat ambang warna, karena interior frame sering tidak putih murni (ada nuansa ungu/pink), lalu merapikan bentuknya supaya sticker putih yang menimpa kotak tidak ikut dianggap area foto.

Kalau jumlah kotak yang terdeteksi tidak sesuai `slotCount`, kartu frame di layar awal menampilkan peringatan. Untuk memeriksa, buka **`http://localhost:3000/?debug=1`**: area magenta adalah tempat foto, kotak biru artinya deteksi lengkap, merah artinya kurang. Nilai koordinatnya juga dicetak di console browser, siap ditempel ke `slots` di `public/config.js` kalau mau diatur manual.

Jalankan `npm test` untuk menguji deteksi dan komposisi strip tanpa perlu browser.

## Halaman scan QR: `/scanwa`

| Alamat | Fungsi |
|---|---|
| `/scanwa` | Halaman QR + status koneksi, auto-refresh. Ada tombol "Putuskan sambungan" untuk ganti nomor pengirim. |
| `/api/wa/status` | Status koneksi dalam JSON: `qr`, `connecting`, `connected`, `logged_out`, `error`. |

QR WhatsApp hanya berlaku sekitar 1 menit; server otomatis membuat yang baru dan halamannya ikut memperbarui sendiri. Kalau koneksi terputus, server menyambung ulang otomatis.

Kalau WhatsApp belum tersambung, layar awal photobooth menampilkan banner kuning, dan kalau pengiriman gagal karena belum login, muncul tombol langsung ke halaman scan QR.

## Pilihan provider lain (`WA_PROVIDER` di `.env`)

| Provider | Keterangan |
|---|---|
| `web` | **Bawaan.** WhatsApp Web lewat [Baileys](https://github.com/WhiskeySockets/Baileys). Gratis, scan QR di `/scanwa`. Ini cara tidak resmi, jadi pakai nomor khusus acara, bukan nomor pribadi utama. |
| `mock` | Untuk uji coba. Foto hanya disimpan, tidak dikirim. Tidak butuh `npm install`. |
| `fonnte` | [Fonnte](https://fonnte.com): daftar, scan QR di dashboard mereka, salin token ke `FONNTE_TOKEN`. Lebih stabil untuk acara besar. |
| `cloud` | WhatsApp Cloud API resmi dari Meta. Ke nomor yang belum pernah chat duluan, WA **wajib** memakai template yang sudah di-approve dengan header **IMAGE** (isi `WA_CLOUD_TEMPLATE_NAME`). |

## Pengaturan lain (`public/config.js`)

Nama event, jumlah jepretan, lama hitung mundur, efek cermin, kualitas JPEG, simpan otomatis, dan waktu kembali otomatis ke layar awal.
Tombol **Spasi/Enter** juga bisa dipakai untuk mulai foto, jadi bisa pakai remote/keyboard.
