(() => {
  const CFG = window.PHOTOBOOTH_CONFIG;
  const Lib = window.FrameLib;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const state = {
    frames: [],        // hasil Lib.processFrame
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
    Lib.drawCover(ctx, v, v.videoWidth, v.videoHeight, { x: 0, y: 0, w: targetW, h: targetH });
    return c;
  }

  // Thumbnail dibuat sekali saja, supaya layar pilih foto tetap responsif saat diketuk
  function makeThumb(shot, width = 420) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * shot.height / shot.width);
    c.getContext('2d').drawImage(shot, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  function pickedCanvases() {
    return state.frame.slots.map((_, i) => {
      const idx = state.picked[i];
      return idx === undefined ? null : state.shots[idx];
    });
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
      console.log('[save]', d.dir, d.saved.join(', '));
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
      if (state.thumbs[i]) {
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
    const first = CFG.countdownFirst ?? CFG.countdownSeconds ?? 8;
    const next = CFG.countdownNext ?? CFG.countdownSeconds ?? 4;
    $('#shoot-hint').textContent =
      `${CFG.totalShots} foto berturut-turut — ${first} detik untuk bersiap, lalu ${next} detik tiap foto. ` +
      `Nanti kamu pilih ${frame.slots.length} yang terbaik.`;
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
    // Foto pertama diberi waktu lebih lama untuk bersiap, sisanya lebih cepat
    const first = CFG.countdownFirst ?? CFG.countdownSeconds ?? 8;
    const next = CFG.countdownNext ?? CFG.countdownSeconds ?? 4;
    for (let i = 0; i < total; i++) {
      $('#shot-label').textContent = i === 0
        ? `Foto 1 dari ${total} — siap-siap ya!`
        : `Foto ${i + 1} dari ${total}`;
      for (let n = i === 0 ? first : next; n > 0; n--) {
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
    Lib.composeStrip($('#select-strip'), state.frame, pickedCanvases(), 0.45);
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
    Lib.composeStrip(out, state.frame, pickedCanvases(), 1);
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
    state.shots = []; state.thumbs = []; state.picked = [];
    state.resultDataUrl = null; state.frame = null; state.sessionId = null;
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
    const gap = 24;
    c.width = frames.reduce((s, f) => s + f.width + gap, 0);
    c.height = Math.max(...frames.map((f) => f.height)) + 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, c.width, c.height); // magenta = area foto
    let x = 0;
    for (const f of frames) {
      ctx.drawImage(f.overlay, x, 40);
      ctx.fillStyle = '#000'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${f.id}: ${f.slots.length}/${f.want} ${f.manual ? '(manual)' : '(otomatis)'}`, x + 8, 30);
      ctx.strokeStyle = f.detected ? '#0033cc' : '#cc0000'; ctx.lineWidth = 4;
      f.slots.forEach((s, i) => {
        ctx.strokeRect(x + s.x, s.y + 40, s.w, s.h);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(i + 1, x + s.x + 10, s.y + 85);
      });
      console.log(`[debug] ${f.id}: ${f.slots.length}/${f.want} kotak ${f.manual ? '(manual)' : '(otomatis)'}. Nilai untuk config.js:`,
        JSON.stringify(f.fractions));
      x += f.width + gap;
    }
    c.onclick = () => c.classList.add('hidden');
  }

  async function init() {
    $('#event-name').textContent = CFG.eventName;
    document.title = CFG.eventName;
    bindEvents();
    watchWaStatus();

    // Pengaturan kotak manual dari editor /slots (kalau ada)
    let saved = {};
    try { saved = await (await fetch('/api/slots', { cache: 'no-store' })).json(); } catch { /* abaikan */ }

    const list = $('#frame-list');
    list.innerHTML = '<p class="subtitle">Menyiapkan frame...</p>';
    const cards = [];
    for (const def of CFG.frames) {
      const card = document.createElement('div');
      card.className = 'frame-card';
      try {
        const img = await Lib.loadImage(def.src);
        const frame = Lib.processFrame(
          { ...def, slots: saved[def.id]?.length ? saved[def.id] : def.slots },
          img, { maxWidth: CFG.maxOutputWidth, detectWidth: 520 },
        );
        state.frames.push(frame);
        const warn = frame.detected ? '' :
          `<a class="frame-warn" href="/slots">⚠️ ${frame.slots.length}/${frame.want} kotak terdeteksi — ketuk untuk mengatur manual</a>`;
        card.innerHTML = `<img src="${def.src}" alt=""><span>${def.name}</span>${warn}`;
        if (frame.slots.length) {
          card.onclick = (e) => {
            if (e.target.closest('.frame-warn')) return; // biarkan tautan editor bekerja
            $('#home-error').textContent = '';
            openShoot(frame);
          };
        } else {
          card.onclick = (e) => {
            if (e.target.closest('.frame-warn')) return;
            $('#home-error').innerHTML = `Frame "${def.name}" belum ada kotak foto. Atur manual di <a href="/slots">halaman /slots</a>.`;
          };
        }
      } catch {
        card.classList.add('missing');
        card.innerHTML = `⚠️ Frame <b>${def.name}</b> tidak ditemukan.<br>Simpan gambarnya di <code>public/${def.src}</code>`;
      }
      cards.push(card);
    }
    list.innerHTML = '';
    cards.forEach((c) => list.appendChild(c));

    if (DEBUG && state.frames.length) showDebug(state.frames);
  }

  init();
})();
