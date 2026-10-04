// Uji deteksi kotak foto tanpa browser. Jalankan: node test-detect.js
// Tiap kasus meniru kondisi nyata yang pernah membuat deteksi gagal.
const path = require('node:path');

// --- Lingkungan tiruan untuk canvas ---
let CURRENT = null; // { data, W, H }
function fakeCanvas() {
  const c = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage(img, _x, _y, w, h) {
        // Skala gambar sumber ke ukuran target dengan nearest-neighbour
        const src = img.pixels ? img : CURRENT;
        if (!src || !src.pixels) return;
        const tw = w || src.W, th = h || src.H;
        const out = new Uint8ClampedArray(tw * th * 4);
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
          const sx = Math.min(src.W - 1, Math.floor(x * src.W / tw));
          const sy = Math.min(src.H - 1, Math.floor(y * src.H / th));
          const si = (sy * src.W + sx) * 4, di = (y * tw + x) * 4;
          out[di] = src.pixels[si]; out[di + 1] = src.pixels[si + 1];
          out[di + 2] = src.pixels[si + 2]; out[di + 3] = src.pixels[si + 3];
        }
        c._data = { data: out, width: tw, height: th };
      },
      getImageData: () => c._data,
      putImageData(d) { c._data = d; },
      fillRect() {}, fillText() {}, save() {}, restore() {}, translate() {}, scale() {},
      set fillStyle(_v) {}, set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {},
    }),
  };
  return c;
}
global.document = { createElement: () => fakeCanvas() };
global.window = {};
const FrameLib = require(path.join(__dirname, 'public/frame-lib.js'));

// --- Pembuat frame tiruan ---
function makeFrame({ W, H, bg, slots, stickers = [], leaks = [] }) {
  const pixels = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    set(x, y, (x % 24 === 0 || y % 24 === 0) ? [246, 240, 228] : bg);
  }
  for (const s of slots) {
    const [sx, sy, sw, sh] = s.r;
    const bw = s.borderWidth ?? 18;
    for (let y = sy - bw; y < sy + sh + bw; y++) for (let x = sx - bw; x < sx + sw + bw; x++) {
      const wave = Math.round(5 * Math.sin(x / 12));
      const inside = x >= sx && x < sx + sw && y >= sy + wave && y < sy + sh + wave;
      set(x, y, inside ? s.fill : s.border);
    }
  }
  // "Celah" di garis frame: antialias terang yang menyambungkan interior ke latar
  for (const [x0, y0, w, h, color] of leaks) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, color);
  }
  for (const [x0, y0, w, h, color] of stickers) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, color);
  }
  return { pixels, W, H, naturalWidth: W, naturalHeight: H };
}

const checks = [];
const add = (n, pass, d = '') => { checks.push({ n, pass, d }); };

function run(name, frame, def, expect) {
  CURRENT = frame;
  const t = Date.now();
  const f = FrameLib.processFrame(def, frame, { maxWidth: 1200, detectWidth: 320 });
  const ms = Date.now() - t;
  console.log(`\n── ${name}  (${ms}ms)`);
  add(`${name}: ${expect.slots.length} kotak terdeteksi`, f.slots.length === expect.slots.length,
    `dapat ${f.slots.length}, harap ${expect.slots.length}`);
  if (f.slots.length === expect.slots.length) {
    f.slots.forEach((s, i) => {
      const [ax, ay, aw, ah] = expect.slots[i];
      const tol = expect.tol || 22;
      const ok = Math.abs(s.x - ax) <= tol && Math.abs(s.y - ay) <= tol &&
                 Math.abs(s.w - aw) <= tol * 2 && Math.abs(s.h - ah) <= tol * 2;
      add(`${name}: posisi kotak ${i + 1}`, ok,
        `dapat x=${s.x} y=${s.y} w=${s.w} h=${s.h} | harap x=${ax} y=${ay} w=${aw} h=${ah}`);
    });
  }
  return f;
}

const W = 420, H = 1400;
const SLOT_GEOM = [[60, 80, 300, 230], [60, 400, 300, 230], [60, 720, 300, 230], [60, 1040, 300, 230]];

// KASUS 1 — interior bernuansa warna (ungu/pink/kuning/mint), latar krem.
// Inilah yang bikin hanya sebagian kotak terdeteksi di versi sebelumnya.
const f1 = run('interior bernuansa warna',
  makeFrame({
    W, H, bg: [253, 247, 237],
    slots: [
      { r: SLOT_GEOM[0], border: [185, 160, 235], fill: [247, 243, 255] },
      { r: SLOT_GEOM[1], border: [246, 168, 196], fill: [255, 245, 250] },
      { r: SLOT_GEOM[2], border: [255, 214, 107], fill: [255, 252, 243] },
      { r: SLOT_GEOM[3], border: [143, 217, 198], fill: [244, 255, 251] },
    ],
  }),
  { id: 'nuansa', slotCount: 4 },
  { slots: SLOT_GEOM });

// KASUS 2 — interior PERSIS sewarna latar belakang, plus celah terang di garis frame
// yang menyambungkan interior ke latar. Tanpa erosi, kotak akan dianggap latar lalu dibuang.
run('interior sewarna latar + celah di garis frame',
  makeFrame({
    W, H, bg: [252, 248, 240],
    slots: SLOT_GEOM.map((r, i) => ({
      r, border: [[185, 160, 235], [246, 168, 196], [255, 214, 107], [143, 217, 198]][i], fill: [252, 248, 240],
    })),
    leaks: [
      [200, 62, 3, 20, [250, 247, 240]],   // celah 3px di atas kotak 1
      [58, 500, 20, 2, [251, 248, 241]],   // celah 2px di kiri kotak 2
      [300, 946, 4, 22, [252, 249, 242]],  // celah 4px di bawah kotak 3
    ],
  }),
  { id: 'bocor', slotCount: 4 },
  { slots: SLOT_GEOM });

// KASUS 3 — sticker putih menimpa kotak foto (seperti kucing/kelinci di frame asli).
// Sticker tidak boleh ikut dilubangi, dan tidak boleh melebarkan area foto.
const f3 = run('sticker putih menimpa kotak',
  makeFrame({
    W, H, bg: [253, 247, 237],
    slots: SLOT_GEOM.map((r, i) => ({
      r, border: [[185, 160, 235], [246, 168, 196], [255, 214, 107], [143, 217, 198]][i], fill: [255, 254, 252],
    })),
    stickers: [
      [20, 60, 70, 60, [255, 255, 255]],     // menimpa pojok kiri-atas kotak 1
      [330, 1030, 70, 55, [254, 254, 254]],  // menimpa pojok kanan-atas kotak 4
    ],
  }),
  { id: 'sticker', slotCount: 4 },
  { slots: SLOT_GEOM, tol: 26 });

// Periksa transparansi pada hasil KASUS 3
{
  const d = f3.overlay._data.data;
  const Wf = f3.width;
  const alpha = (x, y) => d[(y * Wf + x) * 4 + 3];
  const sc = Wf / W;
  const at = (x, y) => alpha(Math.round(x * sc), Math.round(y * sc));
  add('sticker: interior kotak jadi transparan', [195, 515, 835, 1155].every((y) => at(210, y) === 0));
  add('sticker: badan sticker tetap utuh', at(40, 90) === 255 && at(390, 1055) === 255);
  add('sticker: latar belakang tetap utuh', at(6, 6) === 255 && at(210, 20) === 255);
  add('sticker: garis frame tetap utuh', at(210, 68) === 255);
}

// KASUS 4 — kotak diatur manual lewat pecahan 0..1
{
  CURRENT = makeFrame({
    W, H, bg: [253, 247, 237],
    slots: SLOT_GEOM.map((r) => ({ r, border: [120, 120, 120], fill: [255, 255, 255] })),
  });
  const fr = FrameLib.processFrame({
    id: 'manual', slotCount: 4,
    slots: SLOT_GEOM.map(([x, y, w, h]) => ({ x: x / W, y: y / H, w: w / W, h: h / H })),
  }, CURRENT, { maxWidth: 1200, detectWidth: 320 });
  console.log('\n── kotak manual');
  add('manual: 4 kotak dipakai apa adanya', fr.slots.length === 4 && fr.manual === true);
  const okPos = fr.slots.every((s, i) => {
    const sc = fr.width / W;
    return Math.abs(s.x - SLOT_GEOM[i][0] * sc) <= 24 && Math.abs(s.y - SLOT_GEOM[i][1] * sc) <= 24;
  });
  add('manual: posisi sesuai yang diminta', okPos,
    fr.slots.map((s) => `${s.x},${s.y}`).join(' | '));
  add('manual: pecahan ikut dilaporkan untuk disimpan',
    fr.fractions.length === 4 && fr.fractions.every((f) => f.x > 0 && f.w > 0));
}

// KASUS 5 — frame tanpa kotak foto sama sekali: harus melaporkan 0, bukan menebak
{
  CURRENT = makeFrame({ W: 300, H: 900, bg: [253, 247, 237], slots: [] });
  const fr = FrameLib.processFrame({ id: 'kosong', slotCount: 4 }, CURRENT, { maxWidth: 1200, detectWidth: 320 });
  console.log('\n── frame tanpa kotak');
  add('kosong: tidak ada kotak palsu', fr.slots.length === 0 && fr.detected === false, `dapat ${fr.slots.length}`);
}

console.log('');
let fail = 0;
for (const c of checks) {
  console.log(`${c.pass ? '✅' : '❌'} ${c.n}${c.d ? '  — ' + c.d : ''}`);
  if (!c.pass) fail++;
}
console.log(fail ? `\n${fail} dari ${checks.length} pemeriksaan GAGAL` : `\nSemua ${checks.length} pemeriksaan lulus`);
process.exit(fail ? 1 : 0);
