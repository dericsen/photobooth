// Uji komposisi strip: foto harus digambar pas di kotaknya, baik ukuran penuh
// maupun pratinjau yang diperkecil. Jalankan: node test-compose.js
const path = require('node:path');

const calls = [];
const ctx = {
  fillStyle: '', font: '', textAlign: '', textBaseline: '',
  fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h }); },
  fillText(t, x, y) { calls.push({ op: 'fillText', t, x, y }); },
  drawImage(img, x, y, w, h) { calls.push({ op: 'drawImage', img: img.tag || 'overlay', x, y, w, h }); },
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData() {}, save() {}, restore() {}, translate() {}, scale() {},
};
const canvas = { width: 0, height: 0, getContext: () => ctx };
global.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
global.window = {};
const { composeStrip } = require(path.join(__dirname, 'public/frame-lib.js'));

// Frame 1000x3000 dengan 4 kotak, plus foto 800x600 (rasio 4:3)
const frame = {
  width: 1000, height: 3000, overlay: { tag: 'overlay' },
  slots: [
    { x: 50, y: 100, w: 400, h: 300 },
    { x: 50, y: 800, w: 400, h: 300 },
    { x: 50, y: 1500, w: 400, h: 300 },
    { x: 50, y: 2200, w: 400, h: 300 },
  ],
};
const shot = (tag) => ({ tag, width: 800, height: 600 });

const checks = [];
const add = (n, pass, d = '') => checks.push({ n, pass, d });
const near = (a, b) => Math.abs(a - b) < 0.01;

// --- ukuran penuh, 4 foto urut A,B,C,D ---
calls.length = 0;
composeStrip(canvas, frame, [shot('A'), shot('B'), shot('C'), shot('D')], 1);
add('kanvas ukuran penuh', canvas.width === 1000 && canvas.height === 3000, `${canvas.width}x${canvas.height}`);
const draws = calls.filter((c) => c.op === 'drawImage');
add('4 foto + 1 overlay digambar', draws.length === 5, `${draws.length} drawImage`);
add('urutan foto sesuai slot', draws.slice(0, 4).map((d) => d.img).join('') === 'ABCD',
  draws.slice(0, 4).map((d) => d.img).join(''));
add('foto pas di kotak 1', near(draws[0].x, 50) && near(draws[0].y, 100) && near(draws[0].w, 400) && near(draws[0].h, 300),
  `x=${draws[0].x} y=${draws[0].y} w=${draws[0].w} h=${draws[0].h}`);
add('foto pas di kotak 4', near(draws[3].x, 50) && near(draws[3].y, 2200), `x=${draws[3].x} y=${draws[3].y}`);
add('overlay frame digambar penuh di atas', draws[4].img === 'overlay' && near(draws[4].w, 1000) && near(draws[4].h, 3000),
  `${draws[4].img} ${draws[4].w}x${draws[4].h}`);

// --- pratinjau diperkecil 0.45 ---
calls.length = 0;
composeStrip(canvas, frame, [shot('A'), shot('B'), shot('C'), shot('D')], 0.45);
const pdraws = calls.filter((c) => c.op === 'drawImage');
add('kanvas pratinjau ikut diperkecil', canvas.width === 450 && canvas.height === 1350, `${canvas.width}x${canvas.height}`);
add('posisi foto pratinjau ikut skala',
  near(pdraws[0].x, 22.5) && near(pdraws[0].y, 45) && near(pdraws[0].w, 180) && near(pdraws[0].h, 135),
  `x=${pdraws[0].x} y=${pdraws[0].y} w=${pdraws[0].w} h=${pdraws[0].h}`);
add('overlay pratinjau ikut diperkecil', near(pdraws[4].w, 450) && near(pdraws[4].h, 1350),
  `${pdraws[4].w}x${pdraws[4].h}`);

// --- slot kosong harus tampil placeholder bernomor, bukan error ---
calls.length = 0;
composeStrip(canvas, frame, [shot('A'), null, null, shot('D')], 1);
const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.t);
add('slot kosong diberi nomor', texts.join(',') === '2,3', texts.join(','));
add('slot terisi tetap digambar', calls.filter((c) => c.op === 'drawImage' && c.img !== 'overlay').length === 2);

// --- foto dengan rasio beda harus dipotong (cover), tidak gepeng ---
calls.length = 0;
composeStrip(canvas, frame, [{ tag: 'wide', width: 1600, height: 600 }, null, null, null], 1);
const d = calls.find((c) => c.op === 'drawImage' && c.img === 'wide');
add('foto rasio beda tidak gepeng (cover)', near(d.w / d.h, 1600 / 600) && d.w >= 400 && d.h >= 300,
  `w=${d.w.toFixed(1)} h=${d.h.toFixed(1)} rasio=${(d.w / d.h).toFixed(2)}`);
add('foto rasio beda tetap terpusat di kotak',
  near(d.x + d.w / 2, 250) && near(d.y + d.h / 2, 250), `pusat=(${(d.x + d.w / 2).toFixed(1)},${(d.y + d.h / 2).toFixed(1)})`);

let fail = 0;
for (const c of checks) {
  console.log(`${c.pass ? '✅' : '❌'} ${c.n}${c.d ? '  — ' + c.d : ''}`);
  if (!c.pass) fail++;
}
console.log(fail ? `\n${fail} pemeriksaan GAGAL` : `\nSemua ${checks.length} pemeriksaan lulus`);
process.exit(fail ? 1 : 0);
