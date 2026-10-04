// Uji deteksi kotak foto tanpa browser. Jalankan: node test-detect.js
// Membuat frame tiruan (interior bernuansa warna + sticker putih yang menimpa kotak),
// lalu memastikan deteksi menemukan semua kotak dengan posisi yang benar.
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
const s0 = src.indexOf('  const COMBOS');
const s1 = src.indexOf('  // ================= Komposisi strip');
if (s0 < 0 || s1 < 0) { console.error('Gagal menemukan blok deteksi di app.js'); process.exit(1); }

const W = 512, H = 1536;
const data = new Uint8ClampedArray(W * H * 4);
const set = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };

// Latar krem bergaris (menyentuh tepi gambar -> harus diabaikan)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, (x % 24 === 0 || y % 24 === 0) ? [246, 240, 228] : [253, 247, 237]);

// 4 kotak foto. Interiornya BERNUANSA warna, bukan putih murni — inilah yang dulu
// membuat hanya 2 kotak terdeteksi.
const SLOTS = [
  { r: [70, 90, 370, 270],   border: [185, 160, 235], fill: [250, 247, 255] }, // ungu
  { r: [75, 440, 360, 250],  border: [246, 168, 196], fill: [255, 248, 251] }, // pink
  { r: [68, 790, 372, 260],  border: [255, 214, 107], fill: [255, 253, 246] }, // kuning
  { r: [72, 1140, 366, 255], border: [143, 217, 198], fill: [248, 255, 253] }, // mint
];
for (const { r: [sx, sy, sw, sh], border, fill } of SLOTS) {
  for (let y = sy - 18; y < sy + sh + 18; y++) for (let x = sx - 18; x < sx + sw + 18; x++) {
    const wave = Math.round(5 * Math.sin(x / 12));
    const inside = x >= sx && x < sx + sw && y >= sy + wave && y < sy + sh + wave;
    set(x, y, inside ? fill : border);
  }
}
// Sticker putih yang MENIMPA kotak foto (seperti kucing/kelinci di frame asli)
for (let y = 60; y < 130; y++) for (let x = 30; x < 110; x++) set(x, y, [255, 255, 255]);
for (let y = 1100; y < 1160; y++) for (let x = 400; x < 470; x++) set(x, y, [254, 254, 254]);

// Lingkungan tiruan untuk canvas
const imgData = { data, width: W, height: H };
const ctx = { drawImage() {}, getImageData: () => imgData, putImageData() {} };
global.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
global.window = { PHOTOBOOTH_CONFIG: { maxOutputWidth: 1200 } };
const CFG = global.window.PHOTOBOOTH_CONFIG;
eval(src.slice(s0, s1));

const t = Date.now();
const f = processFrame({ id: 'uji', slotCount: 4 }, { naturalWidth: W, naturalHeight: H });
const ms = Date.now() - t;
const alpha = (x, y) => data[(y * W + x) * 4 + 3];

const checks = [];
const add = (name, pass, detail = '') => checks.push({ name, pass, detail });

add('semua 4 kotak terdeteksi', f.slots.length === 4 && f.detected, `${f.slots.length}/4`);
f.slots.forEach((s, i) => {
  const [ax, ay, aw, ah] = SLOTS[i].r;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  add(`kotak ${i + 1} posisinya pas`,
    near(s.y, ay, 14) && near(s.h, ah, 20) && near(s.x, ax, 14) && near(s.w, aw, 20),
    `dapat x=${s.x} y=${s.y} w=${s.w} h=${s.h} | asli x=${ax} y=${ay} w=${aw} h=${ah}`);
});
add('interior kotak jadi transparan', [200, 550, 900, 1250].every((y) => alpha(250, y) === 0));
add('garis border tetap utuh', alpha(250, 75) === 255 && alpha(250, 1130) === 255);
add('sticker putih tetap utuh (tidak ikut terhapus)', alpha(60, 100) === 255 && alpha(455, 1130) === 255);
add('latar krem tetap utuh', alpha(5, 5) === 255 && alpha(250, 20) === 255);

console.log(`deteksi selesai dalam ${ms}ms\n`);
let fail = 0;
for (const c of checks) {
  console.log(`${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
  if (!c.pass) fail++;
}
console.log(fail ? `\n${fail} pemeriksaan GAGAL` : '\nSemua pemeriksaan lulus');
process.exit(fail ? 1 : 0);
