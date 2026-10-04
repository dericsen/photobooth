// Deteksi kotak foto pada frame + komposisi strip.
// Dipakai bersama oleh photobooth (app.js) dan editor kotak (/slots).
// Ditulis tanpa dependency agar bisa diuji di Node (lihat test-detect.js).
(() => {
  // Beberapa tingkat ambang, dari putih bersih sampai putih bernuansa warna.
  // Interior frame sering tidak putih murni (ada nuansa ungu/pink/krem).
  const COMBOS = [
    { bright: 240, sat: 12 },
    { bright: 232, sat: 20 },
    { bright: 224, sat: 30 },
    { bright: 214, sat: 42 },
    { bright: 202, sat: 55 },
  ];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Gagal memuat ${src}`));
      img.src = src;
    });
  }

  // Piksel "terang & nyaris tak berwarna" = kandidat area foto
  function buildLight(px, N, bright, sat) {
    const light = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (px[o + 3] < 200) { light[i] = 1; continue; } // transparan juga dianggap area foto
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      if (mn >= bright && mx - mn <= sat) light[i] = 1;
    }
    return light;
  }

  // Erosi (min filter) terpisah horizontal lalu vertikal.
  // Gunanya memutus "kebocoran" tipis antara interior kotak dan latar belakang
  // lewat celah/antialias di garis frame — penyebab utama kotak gagal terdeteksi.
  function erode(mask, W, H, r) {
    const tmp = new Uint8Array(W * H);
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let on = 1;
        for (let d = -r; d <= r; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= W || !mask[row + xx]) { on = 0; break; }
        }
        tmp[row + x] = on;
      }
    }
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let on = 1;
        for (let d = -r; d <= r; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= H || !tmp[yy * W + x]) { on = 0; break; }
        }
        out[row + x] = on;
      }
    }
    return out;
  }

  function labelMask(m, W, H) {
    const N = W * H;
    const label = new Int32Array(N).fill(-1);
    const stack = new Int32Array(N);
    const comps = [];
    for (let start = 0; start < N; start++) {
      if (label[start] !== -1 || !m[start]) continue;
      const id = comps.length;
      let sp = 0, size = 0, minX = W, minY = H, maxX = 0, maxY = 0;
      stack[sp++] = start; label[start] = id;
      while (sp) {
        const i = stack[--sp]; size++;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0)     { const j = i - 1; if (label[j] === -1 && m[j]) { label[j] = id; stack[sp++] = j; } }
        if (x < W - 1) { const j = i + 1; if (label[j] === -1 && m[j]) { label[j] = id; stack[sp++] = j; } }
        if (y > 0)     { const j = i - W; if (label[j] === -1 && m[j]) { label[j] = id; stack[sp++] = j; } }
        if (y < H - 1) { const j = i + W; if (label[j] === -1 && m[j]) { label[j] = id; stack[sp++] = j; } }
      }
      comps.push({ id, size, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
    return { label, comps };
  }

  // Bentuknya masuk akal sebagai kotak foto?
  function filterSlots(comps, W, H, margin) {
    const N = W * H;
    return comps.filter((k) => {
      if (k.size < N * 0.006) return false;                       // terlalu kecil (sticker)
      // menyentuh tepi gambar = latar belakang, bukan kotak foto
      if (k.x <= margin || k.y <= margin || k.x + k.w >= W - margin || k.y + k.h >= H - margin) return false;
      if (k.size / (k.w * k.h) < 0.55) return false;              // tidak padat = bukan kotak
      if (k.w < W * 0.25 || k.w > W * 0.97) return false;
      if (k.h < H * 0.03 || k.h > H * 0.45) return false;
      const ar = k.w / k.h;
      if (ar < 0.5 || ar > 4) return false;
      return true;
    });
  }

  // Rapikan bentuk: buang tonjolan tipis dari sticker putih yang menimpa kotak,
  // supaya sticker tetap tergambar di atas foto.
  function refineRect(label, id, k, W) {
    const rows = [];
    for (let y = k.y; y < k.y + k.h; y++) {
      let lo = -1, hi = -1;
      const row = y * W;
      for (let x = k.x; x < k.x + k.w; x++) if (label[row + x] === id) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) rows.push({ y, lo, hi });
    }
    if (!rows.length) return null;
    const median = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1]; };

    // 1) batas kiri-kanan yang tahan outlier
    const medLo = median(rows.map((r) => r.lo));
    const medHi = median(rows.map((r) => r.hi));
    const tol = Math.max(4, (medHi - medLo) * 0.05);
    const inside = rows.filter((r) => Math.abs(r.lo - medLo) <= tol && Math.abs(r.hi - medHi) <= tol);
    const x0 = inside.length ? Math.min(...inside.map((r) => r.lo)) : medLo;
    const x1 = inside.length ? Math.max(...inside.map((r) => r.hi)) : medHi;
    const fullW = x1 - x0 + 1;
    if (fullW < 8) return null;

    // 2) batas atas-bawah: baris berurutan terpanjang yang masih selebar kotak
    const clamped = rows.map((r) => {
      const lo = Math.max(r.lo, x0), hi = Math.min(r.hi, x1);
      return { y: r.y, w: hi - lo + 1 };
    });
    let best = null, cur = null;
    clamped.forEach((r, i) => {
      const contiguous = cur && clamped[i - 1] && clamped[i - 1].y === r.y - 1;
      if (r.w >= fullW * 0.72) {
        if (!cur || !contiguous) cur = { from: i, to: i };
        cur.to = i;
        if (!best || cur.to - cur.from > best.to - best.from) best = cur;
      } else cur = null;
    });
    if (!best) return null;
    const y0 = clamped[best.from].y, y1 = clamped[best.to].y;
    return { x: x0, y: y0, w: fullW, h: y1 - y0 + 1 };
  }

  // Kotak-kotak hasil deteksi wajar? (ukuran mirip, tidak saling tumpang tindih)
  function plausible(slots) {
    if (slots.length < 2) return true;
    const ws = slots.map((s) => s.w);
    if (Math.max(...ws) / Math.min(...ws) > 1.8) return false;
    for (let i = 1; i < slots.length; i++) {
      const a = slots[i - 1], b = slots[i];
      const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlap > Math.min(a.h, b.h) * 0.3) return false;
    }
    return true;
  }

  // Deteksi dijalankan pada versi kecil supaya cepat, hasilnya diskalakan kembali.
  function detect(px, W, H, want) {
    const r = Math.max(2, Math.round(W / 220));
    let best = null;
    for (const combo of COMBOS) {
      const light = buildLight(px, W * H, combo.bright, combo.sat);
      const { label, comps } = labelMask(erode(light, W, H, r), W, H);
      let cand = filterSlots(comps, W, H, r + 1).sort((a, b) => b.size - a.size);
      if (want && cand.length > want) cand = cand.slice(0, want);
      const rects = cand
        .map((k) => refineRect(label, k.id, k, W))
        .filter(Boolean)
        .map((s) => ({ x: s.x - r, y: s.y - r, w: s.w + r * 2, h: s.h + r * 2 }))
        .sort((a, b) => a.y - b.y);
      const good = plausible(rects);
      const res = { rects, combo, good };
      if (!best || rects.length > best.rects.length || (rects.length === best.rects.length && good && !best.good)) best = res;
      if (want && rects.length === want && good) return res;
    }
    return best || { rects: [], combo: COMBOS[0], good: false };
  }

  // Lubangi mask mengikuti piksel terang di dalam rect (otomatis).
  // Pakai deretan terpanjang per baris agar sticker di baris yang sama tidak ikut.
  function carveAuto(light, mask, rect, W, H) {
    const bb = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    const xStart = Math.max(0, rect.x), xEnd = Math.min(W, rect.x + rect.w);
    const minRun = Math.max(4, (xEnd - xStart) * 0.12);
    for (let y = Math.max(0, rect.y); y < Math.min(H, rect.y + rect.h); y++) {
      const row = y * W;
      let lo = -1, bestLo = -1, bestLen = 0;
      for (let x = xStart; x <= xEnd; x++) {
        const on = x < xEnd && light[row + x];
        if (on) { if (lo < 0) lo = x; }
        else if (lo >= 0) { const len = x - lo; if (len > bestLen) { bestLen = len; bestLo = lo; } lo = -1; }
      }
      if (bestLen < minRun) continue;
      for (let x = bestLo; x < bestLo + bestLen; x++) mask[row + x] = 1;
      if (bestLo < bb.x0) bb.x0 = bestLo;
      if (bestLo + bestLen - 1 > bb.x1) bb.x1 = bestLo + bestLen - 1;
      if (y < bb.y0) bb.y0 = y;
      if (y > bb.y1) bb.y1 = y;
    }
    return bb.x1 < 0 ? null : { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0 + 1, h: bb.y1 - bb.y0 + 1 };
  }

  // Kotak manual: lubangi seluruh rect, lalu rambat ke piksel terang yang menyambung
  // (dibatasi sedikit di luar rect) supaya sisa putih di tepi ikut bersih tanpa
  // menembus garis frame.
  function carveManual(light, mask, rect, W, H) {
    const pad = Math.round(Math.min(rect.w, rect.h) * 0.25);
    const bx0 = Math.max(0, rect.x - pad), by0 = Math.max(0, rect.y - pad);
    const bx1 = Math.min(W - 1, rect.x + rect.w - 1 + pad), by1 = Math.min(H - 1, rect.y + rect.h - 1 + pad);
    const bb = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    const stack = [];
    const touch = (x, y) => {
      mask[y * W + x] = 1;
      if (x < bb.x0) bb.x0 = x; if (x > bb.x1) bb.x1 = x;
      if (y < bb.y0) bb.y0 = y; if (y > bb.y1) bb.y1 = y;
    };
    for (let y = Math.max(0, rect.y); y < Math.min(H, rect.y + rect.h); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(W, rect.x + rect.w); x++) {
        touch(x, y);
        stack.push(y * W + x);
      }
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      const step = (xx, yy) => {
        if (xx < bx0 || yy < by0 || xx > bx1 || yy > by1) return;
        const j = yy * W + xx;
        if (mask[j] || !light[j]) return;
        touch(xx, yy);
        stack.push(j);
      };
      step(x - 1, y); step(x + 1, y); step(x, y - 1); step(x, y + 1);
    }
    return bb.x1 < 0 ? null : { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0 + 1, h: bb.y1 - bb.y0 + 1 };
  }

  // Lebarkan tepi lubang ke piksel terang di sekitarnya, supaya garis tipis sisa
  // antialias putih tidak tertinggal di pinggir foto.
  function dilateFringe(px, mask, W, H, R) {
    const out = mask.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const onEdge = (x > 0 && !mask[i - 1]) || (x < W - 1 && !mask[i + 1]) ||
        (y > 0 && !mask[i - W]) || (y < H - 1 && !mask[i + W]);
      if (!onEdge) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx, o = j * 4;
        const mn = Math.min(px[o], px[o + 1], px[o + 2]);
        if (mn > 165) out[j] = 1; // hanya piksel terang (tepi), bukan garis frame berwarna
      }
    }
    return out;
  }

  // def: { id, slotCount, slots } — `slots` dalam pecahan 0..1 kalau diatur manual
  // opts: { maxWidth, detectWidth }
  function processFrame(def, img, opts = {}) {
    const maxWidth = opts.maxWidth || 1200;
    const detectWidth = opts.detectWidth || 520;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H);
    const px = imgData.data;
    const N = W * H;
    const want = def.slotCount || 4;

    const manual = Array.isArray(def.slots) && def.slots.length > 0;
    let rects = [];
    let combo = COMBOS[COMBOS.length - 1];
    let autoFound = null;

    if (manual) {
      rects = def.slots.map((s) => ({
        x: Math.round(s.x * W), y: Math.round(s.y * H),
        w: Math.round(s.w * W), h: Math.round(s.h * H),
      }));
    } else {
      // Deteksi pada versi kecil supaya cepat
      const dw = Math.min(W, detectWidth);
      const dh = Math.max(1, Math.round(H * dw / W));
      const small = document.createElement('canvas');
      small.width = dw; small.height = dh;
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(img, 0, 0, dw, dh);
      const found = detect(sctx.getImageData(0, 0, dw, dh).data, dw, dh, want);
      combo = found.combo;
      autoFound = found.rects.length;
      const k = W / dw;
      rects = found.rects.map((s) => ({
        x: Math.round(s.x * k), y: Math.round(s.y * k),
        w: Math.round(s.w * k), h: Math.round(s.h * k),
      }));
    }

    // Lubangi area foto
    const light = buildLight(px, N, combo.bright, combo.sat);
    let mask = new Uint8Array(N);
    const photoRects = [];
    for (const rect of rects) {
      const bb = manual ? carveManual(light, mask, rect, W, H) : carveAuto(light, mask, rect, W, H);
      photoRects.push(bb || rect);
    }

    const R = Math.max(2, Math.round(W / 500));
    mask = dilateFringe(px, mask, W, H, R);
    for (let i = 0; i < N; i++) if (mask[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imgData, 0, 0);

    // Foto digambar sedikit lebih besar dari lubang, selisihnya tertutup frame
    const pad = R + 2;
    const slots = photoRects
      .map((s) => ({ x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 }))
      .sort((a, b) => a.y - b.y);

    return {
      id: def.id, name: def.name, src: def.src, overlay: canvas, slots,
      width: W, height: H, want, manual,
      detected: slots.length === want,
      autoFound: autoFound === null ? slots.length : autoFound,
      // pecahan 0..1, siap disimpan sebagai pengaturan manual
      fractions: slots.map((s) => ({
        x: +(s.x / W).toFixed(5), y: +(s.y / H).toFixed(5),
        w: +(s.w / W).toFixed(5), h: +(s.h / H).toFixed(5),
      })),
    };
  }

  // ---------- Komposisi strip ----------
  function drawCover(ctx, src, sw, sh, r) {
    const s = Math.max(r.w / sw, r.h / sh);
    const w = sw * s, h = sh * s;
    ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  }

  // shotsForSlots: array sepanjang slots, isinya canvas/null. scale<1 untuk pratinjau.
  function composeStrip(canvas, frame, shotsForSlots, scale = 1) {
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    frame.slots.forEach((r0, i) => {
      const r = scale === 1 ? r0 : { x: r0.x * scale, y: r0.y * scale, w: r0.w * scale, h: r0.h * scale };
      const shot = shotsForSlots[i];
      if (shot) {
        drawCover(ctx, shot, shot.width, shot.height, r);
      } else {
        ctx.fillStyle = '#f4f0f8'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#cfc5dd';
        ctx.font = `bold ${Math.round(r.h * 0.32)}px Fredoka, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h / 2);
      }
    });
    ctx.drawImage(frame.overlay, 0, 0, canvas.width, canvas.height);
  }

  const api = { loadImage, processFrame, detect, drawCover, composeStrip, COMBOS };
  if (typeof window !== 'undefined') window.FrameLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
