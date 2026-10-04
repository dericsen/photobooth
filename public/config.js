// Pengaturan photobooth. Ubah sesuai kebutuhan.
window.PHOTOBOOTH_CONFIG = {
  eventName: 'Photobooth',

  totalShots: 6,            // jumlah jepretan
  countdownSeconds: 8,      // hitung mundur sebelum tiap jepretan (detik)
  pauseBetweenShots: 1500,  // ms jeda setelah jepret sebelum hitung mundur berikutnya
  idleResetSeconds: 15,     // layar "terkirim" kembali ke awal setelah sekian detik

  maxOutputWidth: 1200,     // lebar maksimal hasil strip (px)
  jpegQuality: 0.92,
  mirror: true,             // efek cermin (seperti kamera selfie)
  autoSave: true,           // simpan otomatis semua foto ke folder photos/

  // Frame. Taruh gambarnya di public/frames/.
  // slotCount = jumlah kotak foto yang seharusnya ada di frame (dipakai untuk mengecek deteksi).
  // Area foto dideteksi OTOMATIS. Kalau hasil deteksi meleset, isi `slots` manual
  // dalam pecahan 0..1: [{ x, y, w, h }, ...]
  // Cek hasil deteksi di  http://localhost:3000/?debug=1
  frames: [
    { id: 'goodvibes', name: 'Good Vibes',  src: 'frames/frame1.png', slotCount: 4, slots: null },
    { id: 'cute',      name: 'Cute Pastel', src: 'frames/frame2.png', slotCount: 4, slots: null },
  ],
};
