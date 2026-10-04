// Pengaturan photobooth. Ubah sesuai kebutuhan.
window.PHOTOBOOTH_CONFIG = {
  eventName: 'Photobooth',

  totalShots: 6,            // jumlah jepretan
  countdownFirst: 8,        // hitung mundur sebelum foto PERTAMA (detik) — waktu bersiap
  countdownNext: 4,         // hitung mundur sebelum foto ke-2 sampai terakhir (detik)
  pauseBetweenShots: 1500,  // ms jeda setelah jepret sebelum hitung mundur berikutnya
  idleResetSeconds: 15,     // layar "terkirim" kembali ke awal setelah sekian detik

  maxOutputWidth: 1200,     // lebar maksimal hasil strip (px)
  jpegQuality: 0.92,
  mirror: true,             // efek cermin (seperti kamera selfie)
  autoSave: true,           // simpan otomatis semua foto ke folder photos/

  // Frame. Taruh gambarnya di public/frames/.
  // slotCount = jumlah kotak foto yang seharusnya ada di frame (dipakai untuk mengecek deteksi).
  //
  // Area foto dideteksi OTOMATIS. Kalau hasilnya meleset, paling gampang atur lewat
  // editor visual di  http://localhost:3000/slots  (hasilnya tersimpan ke slots.json
  // dan otomatis dipakai, tanpa perlu mengubah file ini).
  // Bisa juga diisi di sini sebagai pecahan 0..1: slots: [{ x, y, w, h }, ...]
  frames: [
    { id: 'goodvibes', name: 'Good Vibes',  src: 'frames/frame1.png', slotCount: 4, slots: null },
    { id: 'cute',      name: 'Cute Pastel', src: 'frames/frame2.png', slotCount: 4, slots: null },
    { id: 'playful',   name: 'Playful',     src: 'frames/frame3.png', slotCount: 4, slots: null },
  ],
};
