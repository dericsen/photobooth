// Uji urutan hitung mundur: foto pertama lebih lama, sisanya lebih cepat.
// Menjalankan runSequence() yang asli dari app.js dengan timer & DOM tiruan.
// Jalankan: node test-countdown.js
const fs = require('node:fs');
const path = require('node:path');

// --- Timer tiruan: langsung lanjut, tapi catat berapa lama yang diminta ---
const waits = [];
global.setTimeout = (fn, ms) => { waits.push(ms); Promise.resolve().then(fn); return 0; };
global.clearTimeout = () => {};
global.setInterval = () => 0;
global.clearInterval = () => {};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

// --- DOM tiruan ---
const log = [];       // catatan teks hitung mundur & label
const els = {};
function el(id) {
  if (els[id]) return els[id];
  const e = {
    id, _text: '', _html: '', disabled: false, style: {}, dataset: {}, href: '', src: '', download: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    getContext: () => fakeCtx, toDataURL: () => 'data:image/jpeg;base64,AAAA',
    width: 0, height: 0, offsetWidth: 1, videoWidth: 640, videoHeight: 480,
    get textContent() { return this._text; },
    set textContent(v) {
      this._text = v;
      if (id === 'countdown' && v !== '') log.push(`cd:${v}`);
      if (id === 'shot-label' && v !== '') log.push(`label:${v}`);
      if (id === 'shoot-hint' && v !== '') log.push(`hint:${v}`);
    },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    play: async () => {}, srcObject: null,
  };
  els[id] = e;
  return e;
}
const fakeCtx = {
  drawImage() {}, fillRect() {}, fillText() {}, clearRect() {}, translate() {}, scale() {},
  save() {}, restore() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {},
  set fillStyle(_v) {}, set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {},
};
global.document = {
  querySelector: (s) => el(s.replace('#', '')),
  querySelectorAll: () => [],
  createElement: () => el('tmp-' + Math.random()),
  addEventListener() {},
};
global.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } };
global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, saved: [], dir: 'photos/x' }) });
global.location = { search: '' };
global.URLSearchParams = class { has() { return false; } };
global.console.log = () => {};  // kurangi kebisingan dari app.js

// --- Muat config + app.js ---
global.window = {};
const cfgSrc = fs.readFileSync(path.join(__dirname, 'public/config.js'), 'utf8');
eval(cfgSrc);
const CFG = global.window.PHOTOBOOTH_CONFIG;
global.window.FrameLib = {
  drawCover() {}, composeStrip() {}, loadImage: async () => ({}), processFrame: () => ({}),
};

// Ambil fungsi yang perlu diuji dari app.js dengan membocorkannya lewat window
let appSrc = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
appSrc = appSrc.replace('  init();\n})();', '  window.__test = { runSequence, openShoot, state };\n})();');
eval(appSrc);
const T = global.window.__test;

const frame = { id: 'uji', slots: [{ x: 0, y: 0, w: 400, h: 300 }, { x: 0, y: 400, w: 400, h: 300 },
  { x: 0, y: 800, w: 400, h: 300 }, { x: 0, y: 1200, w: 400, h: 300 }] };

(async () => {
  const checks = [];
  const add = (n, pass, d = '') => checks.push({ n, pass, d });

  await T.openShoot(frame);
  const hint = log.find((l) => l.startsWith('hint:')) || '';
  log.length = 0;
  waits.length = 0;
  await T.runSequence();

  // Kumpulkan deretan angka hitung mundur per foto
  const seqs = [];
  let cur = null;
  for (const entry of log) {
    if (entry.startsWith('label:')) { cur = []; seqs.push(cur); }
    else if (entry.startsWith('cd:') && cur) cur.push(Number(entry.slice(3)));
  }

  add('ada 6 sesi hitung mundur', seqs.length === CFG.totalShots, `${seqs.length} sesi`);
  add('foto 1 hitung mundur dari 8', JSON.stringify(seqs[0]) === JSON.stringify([8, 7, 6, 5, 4, 3, 2, 1]),
    `[${seqs[0]}]`);
  for (let i = 1; i < seqs.length; i++) {
    add(`foto ${i + 1} hitung mundur dari 4`, JSON.stringify(seqs[i]) === JSON.stringify([4, 3, 2, 1]), `[${seqs[i]}]`);
  }
  add('label foto 1 memberi aba-aba bersiap', (log[0] || '').includes('siap-siap'), log[0]);
  add('hint menyebut 8 detik lalu 4 detik', hint.includes('8 detik') && hint.includes('4 detik'), hint);

  // Total waktu: 8 + 5x4 detik hitung mundur + 6 jeda antar foto
  const detik = waits.filter((ms) => ms === 1000).length;
  const jeda = waits.filter((ms) => ms === CFG.pauseBetweenShots).length;
  add('total detik hitung mundur = 28', detik === 28, `${detik} detik`);
  add('jeda antar foto 6 kali', jeda === CFG.totalShots, `${jeda} jeda`);
  add('6 foto diambil', T.state.shots.length === CFG.totalShots, `${T.state.shots.length} foto`);
  add('6 thumbnail dibuat', T.state.thumbs.length === CFG.totalShots, `${T.state.thumbs.length} thumbnail`);

  let fail = 0;
  for (const c of checks) {
    process.stdout.write(`${c.pass ? '✅' : '❌'} ${c.n}${c.d ? '  — ' + c.d : ''}\n`);
    if (!c.pass) fail++;
  }
  process.stdout.write(fail ? `\n${fail} pemeriksaan GAGAL\n` : `\nSemua ${checks.length} pemeriksaan lulus\n`);
  process.exit(fail ? 1 : 0);
})();
