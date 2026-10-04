(() => {
  const CFG = window.PHOTOBOOTH_CONFIG;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const state = {
    frames: [],        // frame yang sudah diproses: { id, name, img, overlay, slots, width, height }
    frame: null,       // frame terpilih
    shots: [],         // canvas tiap jepretan
    resultDataUrl: null,
    stream: null,
    busy: false,
    resetTimer: null,
  };

  // ---------------- Navigasi layar ----------------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  }

  // ---------------- Pemrosesan frame ----------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Gagal memuat ${src}`));
      img.src = src;
    });
  }

  // Deteksi kotak putih (area foto) pada frame, lalu buat overlay dengan area itu dibuat transparan.
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

    const isWhite = (i) => {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
      if (a < 200) return true; // area transparan juga dianggap slot
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      return mn >= 240 && mx - mn <= 10; // putih bersih, bukan krem latar
    };

    const mask = new Uint8Array(N); // 1 = bagian slot (dibuat transparan)
    let slots = [];

    if (Array.isArray(def.slots) && def.slots.length) {
      // Slot manual: semua piksel putih di dalam kotak dianggap slot
      slots = def.slots.map((s) => ({
        x: Math.round(s.x * W), y: Math.round(s.y * H), w: Math.round(s.w * W), h: Math.round(s.h * H),
      }));
      for (const s of slots) {
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
          const i = y * W + x; if (isWhite(i)) mask[i] = 1;
        }
      }
    } else {
      // Deteksi otomatis: connected component dari piksel putih
      const label = new Int32Array(N).fill(-1);
      const comps = [];
      const stack = new Int32Array(N);
      for (let start = 0; start < N; start++) {
        if (label[start] !== -1 || !isWhite(start)) continue;
        const id = comps.length;
        let sp = 0, size = 0, minX = W, minY = H, maxX = 0, maxY = 0;
        stack[sp++] = start; label[start] = id;
        while (sp) {
          const i = stack[--sp]; size++;
          const x = i % W, y = (i / W) | 0;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (x > 0)     { const j = i - 1; if (label[j] === -1 && isWhite(j)) { label[j] = id; stack[sp++] = j; } }
          if (x < W - 1) { const j = i + 1; if (label[j] === -1 && isWhite(j)) { label[j] = id; stack[sp++] = j; } }
          if (y > 0)     { const j = i - W; if (label[j] === -1 && isWhite(j)) { label[j] = id; stack[sp++] = j; } }
          if (y < H - 1) { const j = i + W; if (label[j] === -1 && isWhite(j)) { label[j] = id; stack[sp++] = j; } }
        }
        comps.push({ id, size, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
      for (let i = 0; i < N; i++) if (label[i] === -1) label[i] = -2; // non-putih
      const picked = comps
        .filter((k) => k.size > N * 0.015 && k.w < W * 0.95 && k.h < H * 0.45 && k.size / (k.w * k.h) > 0.5 &&
          k.x > 0 && k.y > 0 && k.x + k.w < W && k.y + k.h < H) // slot tidak menyentuh tepi gambar
        .sort((a, b) => b.size - a.size)
        .slice(0, 4)
        .sort((a, b) => a.y - b.y);
      if (picked.length < 4) {
        console.warn(`[${def.id}] hanya terdeteksi ${picked.length} slot. Isi "slots" manual di config.js.`);
      }
      const ids = new Set(picked.map((k) => k.id));
      for (let i = 0; i < N; i++) if (ids.has(label[i])) mask[i] = 1;
      slots = picked.map(({ x, y, w, h }) => ({ x, y, w, h }));
    }

    // Lebarkan mask 2px supaya tepi antialias putih tidak tersisa
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
          // hanya hapus piksel yang cukup terang (tepi antialias), bukan garis frame
          const mn = Math.min(px[j * 4], px[j * 4 + 1], px[j * 4 + 2]);
          if (mn > 170) dil[j] = 1;
        }
      }
    }
    for (let i = 0; i < N; i++) if (dil[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imgData, 0, 0);

    // Kotak gambar foto sedikit diperbesar agar menutup tepi
    const pad = R + 2;
    const photoRects = slots.map((s) => ({ x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 }));

    return { id: def.id, name: def.name, src: def.src, img, overlay: c, slots: photoRects, width: W, height: H };
  }

  // ---------------- Komposisi strip ----------------
  function drawCover(ctx, src, sw, sh, r) {
    const s = Math.max(r.w / sw, r.h / sh);
    const w = sw * s, h = sh * s;
    ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  }

  function composeStrip(canvas, frame, shots, liveVideo) {
    canvas.width = frame.width; canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    frame.slots.forEach((r, i) => {
      if (shots[i]) {
        drawCover(ctx, shots[i], shots[i].width, shots[i].height, r);
      } else if (liveVideo && i === shots.length && liveVideo.videoWidth) {
        ctx.save();
        if (CFG.mirror) { ctx.translate(r.x * 2 + r.w, 0); ctx.scale(-1, 1); }
        drawCover(ctx, liveVideo, liveVideo.videoWidth, liveVideo.videoHeight, r);
        ctx.restore();
        ctx.fillStyle = '#ffffff55'; ctx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        ctx.fillStyle = '#f2eef7'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#c9bfd8';
        ctx.font = `bold ${Math.round(r.h * 0.3)}px Fredoka, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h / 2);
      }
    });
    ctx.drawImage(frame.overlay, 0, 0);
  }

  // ---------------- Kamera ----------------
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

  function captureShot(slot) {
    const v = $('#video');
    // potong video sesuai rasio slot, resolusi 2x slot agar tajam
    const targetW = Math.round(slot.w * 2), targetH = Math.round(slot.h * 2);
    const c = document.createElement('canvas');
    c.width = targetW; c.height = targetH;
    const ctx = c.getContext('2d');
    if (CFG.mirror) { ctx.translate(targetW, 0); ctx.scale(-1, 1); }
    drawCover(ctx, v, v.videoWidth, v.videoHeight, { x: 0, y: 0, w: targetW, h: targetH });
    return c;
  }

  function setCameraAspect(slot) {
    $('#camera-box').style.aspectRatio = slot ? `${slot.w} / ${slot.h}` : '4 / 3';
  }

  // ---------------- Bunyi ----------------
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

  // ---------------- Alur foto ----------------
  let liveLoop = 0;
  function startLivePreview() {
    cancelAnimationFrame(liveLoop);
    const canvas = $('#live-strip'), v = $('#video');
    const tick = () => {
      if (!$('#screen-shoot').classList.contains('active')) return;
      composeStrip(canvas, state.frame, state.shots, v);
      liveLoop = requestAnimationFrame(tick);
    };
    tick();
  }

  async function openShoot(frame) {
    state.frame = frame;
    state.shots = [];
    $('#btn-start').disabled = false;
    $('#btn-start').textContent = 'Mulai Foto!';
    $('#shot-label').textContent = '';
    $('#countdown').textContent = '';
    setCameraAspect(frame.slots[0]);
    $('#camera-box').classList.toggle('mirror', !!CFG.mirror);
    show('shoot');
    try {
      await startCamera();
    } catch (e) {
      $('#home-error').textContent = `Kamera tidak bisa dibuka: ${e.message}`;
      show('home');
      return;
    }
    startLivePreview();
  }

  async function runSequence() {
    if (state.busy) return;
    state.busy = true;
    $('#btn-start').disabled = true;
    $('#btn-back-home').disabled = true;
    state.shots = [];
    const total = state.frame.slots.length;
    const cd = $('#countdown');
    for (let i = 0; i < total; i++) {
      const slot = state.frame.slots[i];
      setCameraAspect(slot);
      $('#shot-label').textContent = `Foto ${i + 1} / ${total}`;
      for (let n = CFG.countdownSeconds; n > 0; n--) {
        cd.textContent = n; cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
        beep(660, 0.1);
        await sleep(1000);
      }
      cd.textContent = '';
      state.shots.push(captureShot(slot));
      beep(1320, 0.25, 0.2);
      const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      await sleep(CFG.pauseBetweenShots);
    }
    $('#shot-label').textContent = '';
    state.busy = false;
    $('#btn-back-home').disabled = false;
    finishShoot();
  }

  function finishShoot() {
    const out = document.createElement('canvas');
    composeStrip(out, state.frame, state.shots, null);
    state.resultDataUrl = out.toDataURL('image/jpeg', CFG.jpegQuality);
    $('#result-img').src = state.resultDataUrl;
    $('#phone-thumb').src = state.resultDataUrl;
    $('#btn-download').href = state.resultDataUrl;
    $('#btn-download').download = `photobooth-${Date.now()}.jpg`;
    show('review');
  }

  // ---------------- Nomor telepon ----------------
  function normalizePhone(raw) {
    let p = String(raw).replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    else if (p.startsWith('0')) p = '62' + p.slice(1);
    else if (p.startsWith('8')) p = '62' + p;
    return /^\d{10,15}$/.test(p) ? p : null;
  }

  function formatPhone(raw) {
    const d = raw.replace(/\D/g, '').slice(0, 15);
    return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
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
        body: JSON.stringify({ phone, image: state.resultDataUrl, frameId: state.frame.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      $('#done-icon').classList.remove('spin'); $('#done-icon').textContent = '🎉';
      $('#done-title').textContent = 'Foto terkirim!';
      let left = CFG.idleResetSeconds;
      const upd = () => { $('#done-text').textContent = `Cek WhatsApp kamu di +${phone} 💌 — kembali ke awal dalam ${left} detik`; };
      upd();
      $('#done-actions').classList.remove('hidden');
      $('#btn-retry').classList.add('hidden'); $('#btn-edit-phone').classList.add('hidden');
      $('#btn-scanwa').classList.add('hidden');
      clearInterval(state.resetTimer);
      state.resetTimer = setInterval(() => { left--; if (left <= 0) resetAll(); else upd(); }, 1000);
    } catch (e) {
      $('#done-icon').classList.remove('spin'); $('#done-icon').textContent = '😢';
      $('#done-title').textContent = 'Gagal mengirim';
      $('#done-text').textContent = e.message;
      $('#done-actions').classList.remove('hidden');
      $('#btn-retry').classList.remove('hidden'); $('#btn-edit-phone').classList.remove('hidden');
      // Kalau penyebabnya WhatsApp belum login, tawarkan tombol ke halaman scan QR
      $('#btn-scanwa').classList.toggle('hidden', !/scanwa|belum login|belum siap/i.test(e.message));
    }
  }

  function resetAll() {
    clearInterval(state.resetTimer);
    state.shots = []; state.resultDataUrl = null; state.frame = null;
    $('#phone-input').value = '';
    stopCamera();
    show('home');
  }

  // ---------------- Init ----------------
  function bindEvents() {
    $('#btn-start').onclick = runSequence;
    $('#btn-back-home').onclick = () => { stopCamera(); show('home'); };
    $('#btn-retake').onclick = () => openShoot(state.frame);
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
    // Spasi/Enter untuk mulai foto (bisa pakai tombol remote/keyboard)
    document.addEventListener('keydown', (e) => {
      if ($('#screen-shoot').classList.contains('active') && (e.code === 'Space' || e.key === 'Enter')) {
        e.preventDefault(); runSequence();
      }
    });
  }

  // Pantau koneksi WhatsApp Web, tampilkan banner di layar awal kalau belum siap
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
    c.width = frames.reduce((s, f) => s + f.width + gap, 0); c.height = Math.max(...frames.map((f) => f.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, c.width, c.height); // magenta = area slot (transparan)
    let x = 0;
    for (const f of frames) {
      ctx.drawImage(f.overlay, x, 0);
      ctx.strokeStyle = '#00c'; ctx.lineWidth = 4;
      f.slots.forEach((s, i) => {
        ctx.strokeRect(x + s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#00c'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(i + 1, x + s.x + 10, s.y + 45);
      });
      console.log(`[debug] ${f.id} slots (pecahan):`, JSON.stringify(f.slots.map((s) => ({
        x: +(s.x / f.width).toFixed(4), y: +(s.y / f.height).toFixed(4), w: +(s.w / f.width).toFixed(4), h: +(s.h / f.height).toFixed(4),
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
        card.innerHTML = `<img src="${def.src}" alt=""><span>${def.name}</span>`;
        card.onclick = () => { $('#home-error').textContent = ''; openShoot(frame); };
      } catch (e) {
        card.classList.add('missing');
        card.innerHTML = `⚠️ Frame <b>${def.name}</b> tidak ditemukan.<br>Simpan gambarnya di <code>public/${def.src}</code>`;
      }
      list.appendChild(card);
    }
    if (DEBUG && state.frames.length) showDebug(state.frames);
  }

  init();
})();
