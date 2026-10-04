// Koneksi WhatsApp Web (Baileys) — login dengan scan QR, sesi disimpan di folder wa-auth/
// Dipakai saat WA_PROVIDER=web. Module Baileys baru di-load kalau provider ini dipilih,
// jadi provider lain tetap bisa jalan tanpa `npm install`.
const fs = require('node:fs');
const path = require('node:path');

const AUTH_DIR = path.join(__dirname, 'wa-auth');

// Logger minimal agar tidak perlu dependency `pino`.
const silentLogger = {
  level: 'silent',
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
};

const status = {
  state: 'starting',   // starting | qr | connecting | connected | logged_out | error
  qr: null,            // data URL gambar QR
  qrExpiresAt: null,
  me: null,            // { id, name }
  error: null,
  attempts: 0,
};

let sock = null;
let baileys = null;
let qrcode = null;
let starting = false;

function requireDeps() {
  if (baileys) return;
  try {
    baileys = require('@whiskeysockets/baileys');
  } catch {
    throw new Error('Dependency belum terpasang. Jalankan: npm install');
  }
  try { qrcode = require('qrcode'); } catch { qrcode = null; }
}

async function start() {
  if (starting) return;
  starting = true;
  try {
    requireDeps();
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    status.state = fs.existsSync(path.join(AUTH_DIR, 'creds.json')) ? 'connecting' : 'qr';
    status.error = null;

    sock = makeWASocket({
      auth: state,
      logger: silentLogger,
      browser: Browsers ? Browsers.appropriate('Photobooth') : ['Photobooth', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        status.state = 'qr';
        status.qrExpiresAt = Date.now() + 60_000;
        if (qrcode) {
          try {
            status.qr = await qrcode.toDataURL(qr, { margin: 1, width: 420 });
            console.log('[wa] QR baru siap — buka http://localhost:' + (process.env.PORT || 3000) + '/scanwa');
          } catch (e) { status.qr = null; console.error('[wa] gagal render QR:', e.message); }
          try { console.log(await qrcode.toString(qr, { type: 'terminal', small: true })); } catch { /* abaikan */ }
        } else {
          status.qr = null;
          console.log('[wa] paket "qrcode" belum terpasang, QR tidak bisa ditampilkan. Jalankan: npm install');
        }
      }

      if (connection === 'connecting') {
        if (status.state !== 'qr') status.state = 'connecting';
      }

      if (connection === 'open') {
        status.state = 'connected';
        status.qr = null;
        status.qrExpiresAt = null;
        status.attempts = 0;
        status.error = null;
        status.me = { id: sock.user?.id, name: sock.user?.name || sock.user?.verifiedName || null };
        console.log(`[wa] tersambung sebagai ${status.me.name || ''} ${status.me.id || ''}`.trim());
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        sock = null;
        starting = false;

        if (loggedOut) {
          status.state = 'logged_out';
          status.me = null;
          status.qr = null;
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          console.log('[wa] sesi dilogout dari HP. Scan QR lagi di /scanwa');
          start();
          return;
        }

        status.attempts++;
        const delay = Math.min(30_000, 2000 * status.attempts);
        status.state = 'connecting';
        console.log(`[wa] koneksi tertutup (${code || '?'}), coba sambung ulang dalam ${delay / 1000}s`);
        setTimeout(start, delay);
      }
    });
  } catch (e) {
    starting = false;
    status.state = 'error';
    status.error = e.message;
    console.error('[wa] gagal start:', e.message);
  }
}

function getStatus() {
  return {
    state: status.state,
    qr: status.qr,
    me: status.me,
    error: status.error,
    needsInstall: status.error?.includes('npm install') || false,
  };
}

async function logout() {
  try { await sock?.logout(); } catch { /* abaikan */ }
  sock = null;
  starting = false;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  status.state = 'qr';
  status.me = null;
  status.qr = null;
  await start();
}

// Kirim gambar ke nomor. `phone` berupa digit internasional tanpa + (mis. 6281234567890)
async function sendImage({ phone, buffer, caption }) {
  if (status.state !== 'connected' || !sock) {
    const hint = status.state === 'qr' || status.state === 'logged_out'
      ? 'WhatsApp belum login — scan QR di halaman /scanwa'
      : `WhatsApp belum siap (${status.state})`;
    throw new Error(hint);
  }

  // Pastikan nomornya terdaftar di WhatsApp
  let jid = `${phone}@s.whatsapp.net`;
  try {
    const found = await sock.onWhatsApp(phone);
    const hit = Array.isArray(found) ? found.find((f) => f?.exists) : null;
    if (Array.isArray(found) && found.length && !hit) {
      throw new Error('Nomor ini tidak terdaftar di WhatsApp');
    }
    if (hit?.jid) jid = hit.jid;
  } catch (e) {
    if (e.message.includes('tidak terdaftar')) throw e;
    // kalau pengecekan gagal (mis. timeout), tetap lanjut kirim
  }

  const sent = await sock.sendMessage(jid, { image: buffer, caption, mimetype: 'image/jpeg' });
  return { ok: true, info: { id: sent?.key?.id, jid } };
}

module.exports = { start, getStatus, logout, sendImage, AUTH_DIR };
