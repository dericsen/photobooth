// Photobooth server — tanpa dependency (Node.js >= 20)
// Menyajikan file statis di /public dan endpoint /api/send untuk kirim foto ke WhatsApp.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (fs.existsSync(path.join(__dirname, '.env'))) {
  process.loadEnvFile(path.join(__dirname, '.env'));
}

const PORT = Number(process.env.PORT || 3000);
const PROVIDER = (process.env.WA_PROVIDER || 'web').toLowerCase(); // web | mock | fonnte | cloud
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '62';
const CAPTION = process.env.WA_CAPTION || 'Terima kasih sudah mampir ke photobooth kami! 📸✨';
const PUBLIC_DIR = path.join(__dirname, 'public');
const PHOTO_DIR = path.join(__dirname, 'photos');
const SLOTS_FILE = path.join(__dirname, 'slots.json');
const MAX_BODY = 80 * 1024 * 1024; // cukup untuk 6 foto sekaligus

fs.mkdirSync(PHOTO_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

// ---------- Utils ----------
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = DEFAULT_CC + p.slice(1);
  else if (p.startsWith('8') && DEFAULT_CC === '62') p = '62' + p;
  p = p.replace(/\D/g, '');
  return /^\d{10,15}$/.test(p) ? p : null;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Ukuran foto terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function timestamp() {
  const d = new Date(); const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// Hanya izinkan huruf/angka/dash agar tidak bisa keluar dari folder photos/
function safeSessionId(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  return s || timestamp();
}

function sessionDir(sessionId) {
  const dir = path.join(PHOTO_DIR, safeSessionId(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function decodeJpegDataUrl(dataUrl) {
  const m = /^data:image\/jpe?g;base64,(.+)$/.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

function appendLog(entry) {
  fs.appendFileSync(path.join(PHOTO_DIR, 'log.jsonl'), JSON.stringify(entry) + '\n');
}

// ---------- Pengaturan kotak foto (dari editor /slots) ----------
function readSlots() {
  try { return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf8')); } catch { return {}; }
}

// Terima hanya 4 angka pecahan 0..1 per kotak, abaikan sisanya
function sanitizeSlots(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, 12)) {
    const n = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
    const x = n(s?.x), y = n(s?.y);
    if (x === null || y === null || n(s?.w) === null || n(s?.h) === null) continue;
    // lebar/tinggi dipotong agar tidak melewati batas gambar, lalu dicek lagi
    const w = Math.min(n(s.w), 1 - x), h = Math.min(n(s.h), 1 - y);
    if (w <= 0.01 || h <= 0.01) continue;
    out.push({ x, y, w, h });
  }
  return out.length ? out : null;
}

// ---------- WhatsApp providers ----------
const providers = {
  // WhatsApp Web (Baileys) — login sekali dengan scan QR di halaman /scanwa
  async web({ phone, buffer, filename }) {
    return waWeb.sendImage({ phone, buffer, caption: CAPTION, filename });
  },

  // Tidak mengirim apa-apa, hanya menyimpan file. Untuk uji coba.
  async mock({ phone, file }) {
    console.log(`[mock] pura-pura kirim ${path.basename(file)} ke ${phone}`);
    return { ok: true, info: 'mock' };
  },

  // Fonnte (https://fonnte.com) — gateway WA populer di Indonesia. Scan QR di dashboard Fonnte.
  async fonnte({ phone, buffer, filename }) {
    const token = process.env.FONNTE_TOKEN;
    if (!token) throw new Error('FONNTE_TOKEN belum diisi di .env');
    const form = new FormData();
    form.append('target', phone);
    form.append('message', CAPTION);
    form.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);
    const r = await fetch('https://api.fonnte.com/send', {
      method: 'POST', headers: { Authorization: token }, body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.status === false) throw new Error(`Fonnte: ${data.reason || data.detail || r.status}`);
    return { ok: true, info: data };
  },

  // WhatsApp Cloud API resmi (Meta).
  async cloud({ phone, buffer, filename }) {
    const token = process.env.WA_CLOUD_TOKEN;
    const phoneId = process.env.WA_CLOUD_PHONE_NUMBER_ID;
    const ver = process.env.WA_CLOUD_API_VERSION || 'v23.0';
    if (!token || !phoneId) throw new Error('WA_CLOUD_TOKEN / WA_CLOUD_PHONE_NUMBER_ID belum diisi di .env');
    const base = `https://graph.facebook.com/${ver}/${phoneId}`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) Upload media
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/jpeg');
    form.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);
    const up = await fetch(`${base}/media`, { method: 'POST', headers: auth, body: form });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok || !upData.id) throw new Error(`Cloud API upload: ${upData.error?.message || up.status}`);

    // 2) Kirim pesan. Ke nomor yang belum pernah chat duluan, WA mewajibkan template.
    const tpl = process.env.WA_CLOUD_TEMPLATE_NAME;
    const msg = tpl
      ? {
          messaging_product: 'whatsapp', to: phone, type: 'template',
          template: {
            name: tpl,
            language: { code: process.env.WA_CLOUD_TEMPLATE_LANG || 'id' },
            components: [{ type: 'header', parameters: [{ type: 'image', image: { id: upData.id } }] }],
          },
        }
      : { messaging_product: 'whatsapp', to: phone, type: 'image', image: { id: upData.id, caption: CAPTION } };
    const s = await fetch(`${base}/messages`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
    });
    const sData = await s.json().catch(() => ({}));
    if (!s.ok) throw new Error(`Cloud API send: ${sData.error?.message || s.status}`);
    return { ok: true, info: sData };
  },
};

if (!providers[PROVIDER]) {
  console.error(`WA_PROVIDER tidak dikenal: ${PROVIDER}. Pilih: ${Object.keys(providers).join(', ')}`);
  process.exit(1);
}

// Hanya load modul WhatsApp Web kalau provider ini yang dipakai
let waWeb = null;
if (PROVIDER === 'web') {
  waWeb = require('./wa-web');
  waWeb.start();
}

// ---------- Handlers ----------
async function parseJsonBody(req, res) {
  try { return JSON.parse((await readBody(req)).toString('utf8')); }
  catch (e) { sendJson(res, 400, { ok: false, error: e.message || 'Body tidak valid' }); return null; }
}

// Simpan otomatis ke folder lokal: photos/<sessionId>/
// shots = semua jepretan mentah (termasuk yang tidak dipakai), strip = hasil akhir
async function handleSave(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;

  const sessionId = safeSessionId(body.sessionId);
  const dir = sessionDir(sessionId);
  const saved = [];

  if (Array.isArray(body.shots)) {
    body.shots.forEach((d, i) => {
      const buf = decodeJpegDataUrl(d);
      if (!buf) return;
      const name = `shot-${String(i + 1).padStart(2, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, name), buf);
      saved.push(name);
    });
  }

  if (body.strip) {
    const buf = decodeJpegDataUrl(body.strip);
    if (buf) {
      fs.writeFileSync(path.join(dir, 'strip.jpg'), buf);
      saved.push('strip.jpg');
    }
  }

  if (!saved.length) return sendJson(res, 400, { ok: false, error: 'Tidak ada foto yang bisa disimpan' });

  appendLog({
    time: new Date().toISOString(), event: 'save', session: sessionId,
    frame: body.frameId || null, picked: body.picked || null, files: saved,
  });
  console.log(`[save] ${sessionId}: ${saved.join(', ')}`);
  sendJson(res, 200, { ok: true, sessionId, saved, dir: path.relative(__dirname, dir) });
}

async function handleSlots(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;

  const frameId = String(body.frameId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!frameId) return sendJson(res, 400, { ok: false, error: 'frameId tidak valid' });

  const all = readSlots();
  const slots = sanitizeSlots(body.slots);
  if (slots) all[frameId] = slots; else delete all[frameId]; // slots null = kembali ke otomatis

  try {
    fs.writeFileSync(SLOTS_FILE, JSON.stringify(all, null, 2));
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: `Gagal menulis slots.json: ${e.message}` });
  }
  console.log(`[slots] ${frameId}: ${slots ? slots.length + ' kotak disimpan' : 'kembali ke deteksi otomatis'}`);
  sendJson(res, 200, { ok: true, frameId, slots: slots || null });
}

async function handleSend(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;

  const phone = normalizePhone(body.phone);
  if (!phone) return sendJson(res, 400, { ok: false, error: 'Nomor WhatsApp tidak valid' });

  const buffer = decodeJpegDataUrl(body.image);
  if (!buffer) return sendJson(res, 400, { ok: false, error: 'Foto tidak valid' });

  // Strip selalu disimpan dulu, jadi kalau pengiriman gagal fotonya tetap ada
  const sessionId = safeSessionId(body.sessionId);
  const dir = sessionDir(sessionId);
  const filename = `strip-${phone}.jpg`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, buffer);

  const log = {
    time: new Date().toISOString(), event: 'send', session: sessionId, phone,
    file: path.join(sessionId, filename), frame: body.frameId || null, provider: PROVIDER,
  };
  try {
    await providers[PROVIDER]({ phone, buffer, filename, file });
    appendLog({ ...log, status: 'sent' });
    sendJson(res, 200, { ok: true, phone });
  } catch (e) {
    console.error('[send error]', e.message);
    appendLog({ ...log, status: 'failed', error: e.message });
    sendJson(res, 502, { ok: false, error: e.message, savedAs: log.file });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  // /scanwa  ->  /scanwa/index.html
  if (!path.extname(filePath) && fs.existsSync(path.join(filePath, 'index.html'))) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/send') return handleSend(req, res);
  if (req.method === 'POST' && req.url === '/api/save') return handleSave(req, res);

  // Pengaturan kotak foto hasil editor /slots
  if (req.method === 'GET' && req.url === '/api/slots') return sendJson(res, 200, readSlots());
  if (req.method === 'POST' && req.url === '/api/slots') return handleSlots(req, res);

  if (req.method === 'GET' && req.url === '/api/health') {
    return sendJson(res, 200, { ok: true, provider: PROVIDER, wa: waWeb ? waWeb.getStatus().state : null });
  }

  // Status koneksi WhatsApp Web (dipolling halaman /scanwa dan layar kirim)
  if (req.method === 'GET' && req.url === '/api/wa/status') {
    if (!waWeb) return sendJson(res, 200, { enabled: false, provider: PROVIDER });
    return sendJson(res, 200, { enabled: true, provider: PROVIDER, ...waWeb.getStatus() });
  }

  if (req.method === 'POST' && req.url === '/api/wa/logout') {
    if (!waWeb) return sendJson(res, 400, { ok: false, error: 'WA_PROVIDER bukan "web"' });
    waWeb.logout().catch(() => {});
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => {
  console.log(`📸 Photobooth jalan di http://localhost:${PORT}  (provider WA: ${PROVIDER})`);
  if (PROVIDER === 'web') console.log(`🔗 Scan QR WhatsApp di http://localhost:${PORT}/scanwa`);
});
