(() => {
  const CFG = window.PHOTOBOOTH_CONFIG;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const state = {
    frames: [],        // { id, name, overlay, slots, width, height, detected }
    frame: null,
    shots: [],         // semua jepretan (canvas), sebanyak CFG.totalShots
    thumbs: [],        // dataURL thumbnail tiap jepretan (dibuat sekali)
    picked: [],        // index shots yang dipilih, urut sesuai slot
    sessionId: null,
    resultDataUrl: null,
    stream: null,
    busy: false,
    resetTimer: null,
  };

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  }

  // ================= Deteksi area foto pada frame =================
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Gagal memuat ${src}`));
      img.src = src;
    });
  }

  // Beberapa kombinasi ambang: dari putih bersih sampai putih bernuansa warna
  // (interior frame sering sedikit kebiruan/pink, bukan putih murni).
  const COMBOS = [
    { bright: 244, sat: 10 },
    { bright: 238, sat: 16 },
    { bright: 232, sat: 24 },
    { bright: 226, sat: 32 },
    { bright: 218, sat: 40 },
  ];

  function findComponents(px, W, H, bright, sat) {
    const N = W * H;
    const light = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (px[o + 3] < 200) { light[i] = 1; continue; } // transparan dianggap area foto
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      if (mn >= bright && mx - mn <= sat) light[i] = 1;
    }

    const label = new Int32Array(N).fill(-1);
    const stack = new Int32Array(N);
    const comps = [];
    for (let start = 0; start < N; start++) {
      if (label[start] !== -1 || !light[start]) continue;
      const id = comps.length;
      let sp = 0, size = 0, minX = W, minY = H, maxX = 0, maxY = 0;
      stack[sp++] = start; label[start] = id;
      while (sp) {
        const i = stack[--sp]; size++;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0)     { const j = i - 1; if (label[j] === -1 && light[j]) { label[j] = id; stack[sp++] = j; } }
        if (x < W - 1) { const j = i + 1; if (label[j] === -1 && light[j]) { label[j] = id; stack[sp++] = j; } }
        if (y > 0)     { const j = i - W; if (label[j] === -1 && light[j]) { label[j] = id; stack[sp++] = j; } }
        if (y < H - 1) { const j = i + W; if (label[j] === -1 && light[j]) { label[j] = id; stack[sp++] = j; } }
      }
      comps.push({ id, size, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
    return { label, comps };
  }

  // Rapikan bentuk slot: buang "tonjolan" tipis yang biasanya berasal dari sticker putih
  // yang menempel/menimpa kotak foto, supaya sticker tetap tergambar di atas foto.
  function refineRect(label, id, k, W) {
    // Jangkauan kiri-kanan tiap baris milik komponen ini
    const rows = [];
    for (let y = k.y; y < k.y + k.h; y++) {
      let lo = -1, hi = -1;
      const row = y * W;
      for (let x = k.x; x < k.x + k.w; x++) if (label[row + x] === id) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) rows.push({ y, lo, hi });
    }
    if (!rows.length) return null;
    const median = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1]; };

    // 1) Tentukan batas kiri-kanan yang tahan outlier (median), supaya sticker
    //    yang nempel di samping kotak tidak melebarkan area foto.
    const medLo = median(rows.map((r) => r.lo));
    const medHi = median(rows.map((r) => r.hi));
    const tol = Math.max(6, (medHi - medLo) * 0.05);
    const inside = rows.filter((r) => Math.abs(r.lo - medLo) <= tol && Math.abs(r.hi - medHi) <= tol);
    const x0 = inside.length ? Math.min(...inside.map((r) => r.lo)) : medLo;
    const x1 = inside.length ? Math.max(...inside.map((r) => r.hi)) : medHi;
    const fullW = x1 - x0 + 1;
    if (fullW < 8) return null;

    // 2) Tentukan batas atas-bawah: baris berurutan terpanjang yang —setelah dipotong
    //    ke batas kiri-kanan di atas— masih selebar kotak.
    const clamped = rows.map((r) => {
      const lo = Math.max(r.lo, x0), hi = Math.min(r.hi, x1);
      return { y: r.y, lo, hi, w: hi - lo + 1 };
    });
    const ok = (r) => r.w >= fullW * 0.72;
    let best = null, cur = null;
    clamped.forEach((r, i) => {
      const contiguous = cur && clamped[i - 1] && clamped[i - 1].y === r.y - 1;
      if (ok(r)) {
        if (!cur || !contiguous) cur = { from: i, to: i };
        cur.to = i;
        if (!best || cur.to - cur.from > best.to - best.from) best = cur;
      } else cur = null;
    });
    if (!best) return null;

    const kept = clamped.slice(best.from, best.to + 1);
    return {
      x: x0, y: kept[0].y, w: fullW, h: kept[kept.length - 1].y - kept[0].y + 1,
      rows: kept, size: kept.reduce((s, r) => s + r.w, 0),
    };
  }

  // Saring komponen yang bentuknya masuk akal sebagai kotak foto
  function filterSlots(comps, W, H) {
    const N = W * H;
    return comps.filter((k) => {
      if (k.size < N * 0.008) return false;                      // terlalu kecil (sticker)
      if (k.x <= 0 || k.y <= 0 || k.x + k.w >= W || k.y + k.h >= H) return false; // menyentuh tepi = latar belakang
      if (k.size / (k.w * k.h) < 0.55) return false;             // tidak padat = bukan kotak
      if (k.w < W * 0.25 || k.w > W * 0.96) return false;
      if (k.h < H * 0.04 || k.h > H * 0.45) return false;
      const ar = k.w / k.h;
      if (ar < 0.5 || ar > 4) return false;
      return true;
    });
  }

  function detectSlots(px, W, H, want) {
    let best = null;
    for (const c of COMBOS) {
      const { label, comps } = findComponents(px, W, H, c.bright, c.sat);
      let picked = filterSlots(comps, W, H).sort((a, b) => b.size - a.size);
      if (want && picked.length > want) picked = picked.slice(0, want);
      picked.sort((a, b) => a.y - b.y);
      const result = { label, picked, combo: c };
      if (!best || picked.length > best.picked.length) best = result;
      if (want && picked.length === want) return result; // sudah pas, berhenti
    }
    return best;
  }

  function processFrame(def, img) {
    const scale = Math.min(1, CFG.maxOutputWidth / img.naturalWidth);
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H);
    const px = imgData.data;
    const N = W * H;
    const want = def.slotCount || 4;

    const mask = new Uint8Array(N);
    let slots = [];
    let detected = true;

    if (Array.isArray(def.slots) && def.slots.length) {
      // Slot manual dari config.js
      slots = def.slots.map((s) => ({
        x: Math.round(s.x * W), y: Math.round(s.y * H), w: Math.round(s.w * W), h: Math.round(s.h * H),
      }));
      for (const s of slots) {
        for (let y = Math.max(0, s.y); y < Math.min(H, s.y + s.h); y++) {
          for (let x = Math.max(0, s.x); x < Math.min(W, s.x + s.w); x++) mask[y * W + x] = 1;
        }
      }
    } else {
      const { label, picked } = detectSlots(px, W, H, want);
      detected = picked.length === want;
      if (!detected) console.warn(`[${def.id}] terdeteksi ${picked.length} slot, seharusnya ${want}. Isi "slots" manual di config.js.`);

      // Isi mask per baris mengikuti tepi bergelombang, dan tutup lubang di dalam slot
      // (gradien/tekstur) tanpa ikut menghapus sticker yang menimpa kotak.
      for (const k of picked) {
        const rect = refineRect(label, k.id, k, W);
        if (!rect) continue;
        for (const r of rect.rows) {
          const lo = Math.max(r.lo, rect.x), hi = Math.min(r.hi, rect.x + rect.w - 1);
          const row = r.y * W;
          for (let x = lo; x <= hi; x++) mask[row + x] = 1;
        }
        slots.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      }
      slots.sort((a, b) => a.y - b.y);
      detected = slots.length === want;
    }

    // Lebarkan sedikit supaya tepi antialias putih tidak tersisa sebagai garis
    const R = Math.max(2, Math.round(W / 500));
    const dil = mask.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const onEdge = (x > 0 && !mask[y * W + x - 1]) || (x < W - 1 && !mask[y * W + x + 1]) ||
        (y > 0 && !mask[(y - 1) * W + x]) || (y < H - 1 && !mask[(y + 1) * W + x]);
      if (!onEdge) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= R * R) {
          const j = yy * W + xx;
          const mn = Math.min(px[j * 4], px[j * 4 + 1], px[j * 4 + 2]);
          if (mn > 165) dil[j] = 1; // hanya piksel terang (tepi), bukan garis frame berwarna
        }
      }
    }
    for (let i = 0; i < N; i++) if (dil[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imgData, 0, 0);

    const pad = R + 2;
    const photoRects = slots.map((s) => ({ x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 }));

    return { id: def.id, name: def.name, src: def.src, overlay: c, slots: photoRects, width: W, height: H, detected, want };
  }

  // ================= Komposisi strip =================
  function drawCover(ctx, src, sw, sh, r) {
    const s = Math.max(r.w / sw, r.h / sh);
    const w = sw * s, h = sh * s;
    ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  }

  // shotsForSlots: array sepanjang slots, isinya canvas atau null.
  // scale < 1 dipakai untuk pratinjau supaya cepat.
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

  function pickedCanvases() {
    return state.frame.slots.map((_, i) => {
      const idx = state.picked[i];
      return idx === undefined ? null : state.shots[idx];
    });
  }

  // ================= Kamera =================
  async function startCamera() {
    if (state.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser tidak mendukung kamera. Buka lewat http://localhost atau HTTPS.');
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: false,
    });
    const v = $('#video');
    v.srcObject = state.stream;
    await v.play().catch(() => {});
  }

  function stopCamera() {
    state.stream?.getTracks().forEach((t) => t.stop());
    state.stream = null;
    $('#video').srcObject = null;
  }

  // Semua jepretan pakai rasio rata-rata slot, karena tiap foto bisa masuk slot mana saja
  function shotAspect() {
    const s = state.frame.slots;
    return s.reduce((a, r) => a + r.w / r.h, 0) / s.length;
  }

  // Thumbnail dibuat sekali saja, supaya layar pilih foto tetap responsif saat diketuk
  function makeThumb(shot, width = 420) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * shot.height / shot.width);
    c.getContext('2d').drawImage(shot, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  function captureShot() {
    const v = $('#video');
    const ar = shotAspect();
    const maxSlotW = Math.max(...state.frame.slots.map((r) => r.w));
    const targetW = Math.min(1600, Math.round(maxSlotW * 2));
    const targetH = Math.round(targetW / ar);
    const c = document.createElement('canvas');
    c.width = targetW; c.height = targetH;
    const ctx = c.getContext('2d');
    if (CFG.mirror) { ctx.translate(targetW, 0); ctx.scale(-1, 1); }
    drawCover(ctx, v, v.videoWidth, v.videoHeight, { x: 0, y: 0, w: targetW, h: targetH });
    return c;
  }

  // ================= Bunyi =================
  let audioCtx;
  function beep(freq = 880, dur = 0.12, vol = 0.15) {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur); o.stop(audioCtx.currentTime + dur);
    } catch { /* abaikan */ }
  }

  // ================= Simpan otomatis ke lokal =================
  function newSessionId() {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  }

  async function autoSave(payload) {
    if (!CFG.autoSave) return;
    try {
      const r = await fetch('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, frameId: state.frame?.id, ...payload }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'gagal menyimpan');
      console.log('[save]', d.saved);
      return d;
    } catch (e) {
      console.error('[save] gagal:', e.message);
      $('#save-note').textContent = `⚠️ Gagal menyimpan ke lokal: ${e.message}`;
    }
  }

  // ================= Layar ambil foto =================
  function renderShotTray() {
    const tray = $('#shot-tray');
    tray.innerHTML = '';
    for (let i = 0; i < CFG.totalShots; i++) {
      const box = document.createElement('div');
      box.className = 'tray-item';
      if (state.shots[i]) {
        const im = document.createElement('img');
        im.src = state.thumbs[i];
        box.appendChild(im);
      } else {
        box.classList.add('empty');
        box.textContent = i + 1;
      }
      tray.appendChild(box);
    }
  }

  async function openShoot(frame) {
    state.frame = frame;
    state.shots = [];
    state.thumbs = [];
    state.picked = [];
    state.sessionId = newSessionId();
    $('#btn-start').disabled = false;
    $('#shot-label').textContent = '';
    $('#countdown').textContent = '';
    $('#camera-box').style.aspectRatio = `${shotAspect()}`;
    $('#camera-box').classList.toggle('mirror', !!CFG.mirror);
    $('#save-note').textContent = '';
    renderShotTray();
    show('shoot');
    try {
      await startCamera();
    } catch (e) {
      $('#home-error').textContent = `Kamera tidak bisa dibuka: ${e.message}`;
      show('home');
    }
  }

  async function runSequence() {
    if (state.busy) return;
    state.busy = true;
    $('#btn-start').disabled = true;
    $('#btn-back-home').disabled = true;
    state.shots = [];
    state.thumbs = [];
    renderShotTray();

    const total = CFG.totalShots;
    const cd = $('#countdown');
    for (let i = 0; i < total; i++) {
      $('#shot-label').textContent = `Foto ${i + 1} dari ${total}`;
      for (let n = CFG.countdownSeconds; n > 0; n--) {
        cd.textContent = n;
        cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
        if (n <= 3) beep(660, 0.1);          // bunyi hanya 3 detik terakhir
        await sleep(1000);
      }
      cd.textContent = '';
      const shot = captureShot();
      state.shots.push(shot);
      state.thumbs.push(makeThumb(shot));
      beep(1320, 0.25, 0.2);
      const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      renderShotTray();
      await sleep(CFG.pauseBetweenShots);
    }

    $('#shot-label').textContent = '';
    state.busy = false;
    $('#btn-back-home').disabled = false;
    stopCamera();

    // Simpan semua jepretan ke lokal, termasuk yang nanti tidak dipakai
    autoSave({ shots: state.shots.map((c) => c.toDataURL('image/jpeg', CFG.jpegQuality)) });

    openSelect();
  }

  // ================= Layar pilih foto =================
  function openSelect() {
    const need = state.frame.slots.length;
    state.picked = [];
    $('#select-title').textContent = `Pilih ${need} foto terbaik`;
    renderSelect();
    show('select');
  }

  function renderSelect() {
    const need = state.frame.slots.length;
    const grid = $('#select-grid');
    grid.innerHTML = '';
    state.shots.forEach((_shot, idx) => {
      const order = state.picked.indexOf(idx);
      const item = document.createElement('button');
      item.className = 'pick-item' + (order >= 0 ? ' chosen' : '');
      item.innerHTML = `<img src="${state.thumbs[idx]}" alt="Foto ${idx + 1}">
        <span class="pick-badge">${order >= 0 ? order + 1 : ''}</span>`;
      item.onclick = () => togglePick(idx);
      grid.appendChild(item);
    });

    const n = state.picked.length;
    $('#select-count').textContent = `${n} dari ${need} dipilih`;
    $('#btn-use').disabled = n !== need;
    $('#select-hint').textContent = n === need
      ? 'Mantap! Nomor di foto menunjukkan urutannya di strip.'
      : `Ketuk foto untuk memilih. ${need - n} lagi.`;
    composeStrip($('#select-strip'), state.frame, pickedCanvases(), 0.45);
  }

  function togglePick(idx) {
    const need = state.frame.slots.length;
    const at = state.picked.indexOf(idx);
    if (at >= 0) state.picked.splice(at, 1);
    else if (state.picked.length < need) state.picked.push(idx);
    else {
      $('#select-hint').textContent = `Sudah ${need} foto. Ketuk salah satu yang bernomor untuk membatalkannya.`;
      return;
    }
    renderSelect();
  }

  function finishSelect() {
    const out = document.createElement('canvas');
    composeStrip(out, state.frame, pickedCanvases());
    state.resultDataUrl = out.toDataURL('image/jpeg', CFG.jpegQuality);
    $('#result-img').src = state.resultDataUrl;
    $('#phone-thumb').src = state.resultDataUrl;
    $('#btn-download').href = state.resultDataUrl;
    $('#btn-download').download = `photobooth-${state.sessionId}.jpg`;
    autoSave({ strip: state.resultDataUrl, picked: state.picked.map((i) => i + 1) });
    show('review');
  }

  // ================= Nomor telepon =================
  function normalizePhone(raw) {
    let p = String(raw).replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    else if (p.startsWith('0')) p = '62' + p.slice(1);
    else if (p.startsWith('8')) p = '62' + p;
    return /^\d{10,15}$/.test(p) ? p : null;
  }

  function formatPhone(raw) {
    return raw.replace(/\D/g, '').slice(0, 15).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function openPhone() {
    $('#phone-error').textContent = '';
    show('phone');
    setTimeout(() => $('#phone-input').focus(), 50);
  }

  async function sendPhoto() {
    const phone = normalizePhone($('#phone-input').value);
    if (!phone) {
      $('#phone-error').textContent = 'Nomor belum benar. Contoh: 0812 3456 7890';
      return;
    }
    show('done');
    $('#done-icon').textContent = '⏳'; $('#done-icon').classList.add('spin');
    $('#done-title').textContent = 'Mengirim foto...';
    $('#done-text').textContent = `ke +${phone}`;
    $('#done-actions').classList.add('hidden');
    try {
      const r = await fetch('/api/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, image: state.resultDataUrl, frameId: state.frame.id, sessionId: state.sessionId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      $('#done-icon').classList.remove('spin'); $('#done-icon').textContent = '🎉';
      $('#done-title').textContent = 'Foto terkirim!';
      $('#done-actions').classList.remove('hidden');
      $('#btn-retry').classList.add('hidden');
      $('#btn-edit-phone').classList.add('hidden');
      $('#btn-scanwa').classList.add('hidden');
      let left = CFG.idleResetSeconds;
      const upd = () => { $('#done-text').textContent = `Cek WhatsApp kamu di +${phone} 💌 — kembali ke awal dalam ${left} detik`; };
      upd();
      clearInterval(state.resetTimer);
      state.resetTimer = setInterval(() => { left--; if (left <= 0) resetAll(); else upd(); }, 1000);
    } catch (e) {
      $('#done-icon').classList.remove('spin'); $('#done-icon').textContent = '😢';
      $('#done-title').textContent = 'Gagal mengirim';
      $('#done-text').textContent = `${e.message} — fotonya tetap tersimpan di komputer.`;
      $('#done-actions').classList.remove('hidden');
      $('#btn-retry').classList.remove('hidden');
      $('#btn-edit-phone').classList.remove('hidden');
      $('#btn-scanwa').classList.toggle('hidden', !/scanwa|belum login|belum siap/i.test(e.message));
    }
  }

  function resetAll() {
    clearInterval(state.resetTimer);
    state.shots = []; state.thumbs = []; state.picked = []; state.resultDataUrl = null; state.frame = null; state.sessionId = null;
    $('#phone-input').value = '';
    stopCamera();
    show('home');
  }

  // ================= Init =================
  function bindEvents() {
    $('#btn-start').onclick = runSequence;
    $('#btn-back-home').onclick = () => { stopCamera(); show('home'); };
    $('#btn-use').onclick = finishSelect;
    $('#btn-reshoot').onclick = () => openShoot(state.frame);
    $('#btn-clear-pick').onclick = () => { state.picked = []; renderSelect(); };
    $('#btn-retake').onclick = () => openShoot(state.frame);
    $('#btn-back-select').onclick = () => { renderSelect(); show('select'); };
    $('#btn-continue').onclick = openPhone;
    $('#btn-phone-back').onclick = () => show('review');
    $('#btn-send').onclick = sendPhoto;
    $('#btn-retry').onclick = sendPhoto;
    $('#btn-edit-phone').onclick = openPhone;
    $('#btn-finish').onclick = resetAll;

    const input = $('#phone-input');
    input.addEventListener('input', () => { input.value = formatPhone(input.value); $('#phone-error').textContent = ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendPhoto(); });
    $('#numpad').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = b.dataset.k;
      let v = input.value.replace(/\D/g, '');
      if (k === 'clear') v = ''; else if (k === 'del') v = v.slice(0, -1); else v += b.textContent;
      input.value = formatPhone(v);
      $('#phone-error').textContent = '';
    });
    document.addEventListener('keydown', (e) => {
      if ($('#screen-shoot').classList.contains('active') && (e.code === 'Space' || e.key === 'Enter')) {
        e.preventDefault(); runSequence();
      }
    });
  }

  function watchWaStatus() {
    const banner = $('#wa-banner');
    const check = async () => {
      try {
        const s = await (await fetch('/api/wa/status', { cache: 'no-store' })).json();
        const problem = s.enabled && s.state !== 'connected';
        const onHome = $('#screen-home').classList.contains('active');
        banner.classList.toggle('hidden', !(problem && onHome));
        banner.textContent = s.needsInstall
          ? '⚠️ Dependency belum terpasang — jalankan: npm install'
          : '⚠️ WhatsApp belum tersambung — ketuk di sini untuk scan QR';
      } catch { banner.classList.add('hidden'); }
    };
    check();
    setInterval(check, 5000);
  }

  function showDebug(frames) {
    const c = $('#debug-canvas'); c.classList.remove('hidden');
    const gap = 20;
    c.width = frames.reduce((s, f) => s + f.width + gap, 0);
    c.height = Math.max(...frames.map((f) => f.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, c.width, c.height); // magenta = area foto
    let x = 0;
    for (const f of frames) {
      ctx.drawImage(f.overlay, x, 0);
      ctx.strokeStyle = f.detected ? '#0033cc' : '#cc0000'; ctx.lineWidth = 4;
      f.slots.forEach((s, i) => {
        ctx.strokeRect(x + s.x, s.y, s.w, s.h);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(i + 1, x + s.x + 10, s.y + 45);
      });
      console.log(`[debug] ${f.id}: ${f.slots.length}/${f.want} slot. Nilai untuk config.js:`,
        JSON.stringify(f.slots.map((s) => ({
          x: +(s.x / f.width).toFixed(4), y: +(s.y / f.height).toFixed(4),
          w: +(s.w / f.width).toFixed(4), h: +(s.h / f.height).toFixed(4),
        }))));
      x += f.width + gap;
    }
    c.onclick = () => c.classList.add('hidden');
  }

  async function init() {
    $('#event-name').textContent = CFG.eventName;
    document.title = CFG.eventName;
    bindEvents();
    watchWaStatus();
    const list = $('#frame-list');
    for (const def of CFG.frames) {
      const card = document.createElement('div');
      card.className = 'frame-card';
      try {
        const img = await loadImage(def.src);
        const frame = processFrame(def, img);
        state.frames.push(frame);
        const warn = frame.detected ? '' :
          `<span class="frame-warn">⚠️ ${frame.slots.length}/${frame.want} kotak terdeteksi — cek /?debug=1</span>`;
        card.innerHTML = `<img src="${def.src}" alt=""><span>${def.name}</span>${warn}`;
        if (frame.slots.length) card.onclick = () => { $('#home-error').textContent = ''; openShoot(frame); };
        else card.onclick = () => { $('#home-error').textContent = `Frame "${def.name}" tidak ada kotak foto yang terdeteksi.`; };
      } catch {
        card.classList.add('missing');
        card.innerHTML = `⚠️ Frame <b>${def.name}</b> tidak ditemukan.<br>Simpan gambarnya di <code>public/${def.src}</code>`;
      }
      list.appendChild(card);
    }
    if (DEBUG && state.frames.length) showDebug(state.frames);
  }

  init();
})();
