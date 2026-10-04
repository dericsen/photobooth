// Pengaturan photobooth. Ubah sesuai kebutuhan.
window.PHOTOBOOTH_CONFIG = {
  eventName: 'Photobooth',
  countdownSeconds: 3,      // hitung mundur sebelum tiap jepretan
  pauseBetweenShots: 1200,  // ms jeda setelah jepret sebelum hitung mundur berikutnya
  idleResetSeconds: 12,     // layar "terkirim" kembali ke awal setelah sekian detik
  maxOutputWidth: 1200,     // lebar maksimal hasil strip (px)
  jpegQuality: 0.92,
  mirror: true,             // efek cermin (seperti kamera selfie)

  // Frame. Taruh gambarnya di public/frames/.
  // Area foto (kotak putih) dideteksi OTOMATIS. Kalau hasil deteksi meleset,
  // isi `slots` manual dalam pecahan 0..1: { x, y, w, h } relatif terhadap ukuran gambar.
  // Cek hasil deteksi dengan membuka  http://localhost:3000/?debug=1
  frames: [
    { id: 'goodvibes', name: 'Good Vibes', src: 'frames/frame1.png', slots: null },
    { id: 'cute',      name: 'Cute Pastel', src: 'frames/frame2.png', slots: null },
  ],
};
