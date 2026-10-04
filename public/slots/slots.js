(() => {
  const CFG = window.PHOTOBOOTH_CONFIG;
  const Lib = window.FrameLib;
  const $ = (s) => document.querySelector(s);

  const st = {
    defs: CFG.frames,
    idx: 0,
    img: null,       // gambar frame yang sedang dibuka
    rects: [],       // pecahan 0..1: { x, y, w, h }
    active: -1,
    saved: {},       // slots.json dari server
  };

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const def = () => st.defs[st.idx];

  // ---------- Tab frame ----------
  function renderTabs() {
    const tabs = $('#frame-tabs');
    tabs.innerHTML = '';
    st.defs.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'frame-tab' + (i === st.idx ? ' active' : '');
      const mark = st.saved[d.id] ? ' ✓' : '';
      b.innerHTML = `${d.name}<span class="badge">${mark}</span>`;
      b.onclick = () => openFrame(i);
      tabs.appendChild(b);
    });
  }

  // ---------- Muat frame ----------
  async function openFrame(i) {
    st.idx = i;
    st.active = -1;
    renderTabs();
    $('#save-msg').textContent = '';
    const d = def();
    $('#frame-img').src = d.src;
    try {
      st.img = await Lib.loadImage(d.src);
    } catch {
      st.img = null;
      setStatus(`Gambar frame tidak ditemukan: public/${d.src}`, 'warn');
      st.rects = [];
      renderRects();
      return;
    }
    if (st.saved[d.id]?.length) {
      st.rects = st.saved[d.id].map((r) => ({ ...r }));
      setStatus(`Memakai pengaturan tersimpan: ${st.rects.length} kotak.`, 'good');
    } else {
      autoDetect(true);
    }
    renderRects();
  }

  function autoDetect(quiet) {
    if (!st.img) return;
    const d = def();
    const f = Lib.processFrame({ id: d.id, slotCount: d.slotCount || 4, slots: null }, st.img,
      { maxWidth: CFG.maxOutputWidth, detectWidth: 520 });
    st.rects = f.fractions.map((r) => ({ ...r }));
    const want = d.slotCount || 4;
    if (st.rects.length === want) setStatus(`Deteksi otomatis menemukan ${want} kotak. Periksa posisinya, lalu Simpan.`, 'good');
    else setStatus(`Deteksi otomatis cuma menemukan ${st.rects.length} dari ${want} kotak. Tambah atau geser kotak secara manual, lalu Simpan.`, 'warn');
    if (!quiet) $('#save-msg').textContent = '';
    renderRects();
  }

  function setStatus(text, kind) {
    const el = $('#status');
    el.textContent = text;
    el.className = 'editor-status' + (kind ? ' ' + kind : '');
  }

  // ---------- Gambar kotak ----------
  function renderRects() {
    const host = $('#rects');
    host.innerHTML = '';
    st.rects.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'rect' + (i === st.active ? ' active' : '');
      el.style.left = r.x * 100 + '%';
      el.style.top = r.y * 100 + '%';
      el.style.width = r.w * 100 + '%';
      el.style.height = r.h * 100 + '%';
      el.innerHTML = `<span class="num">${i + 1}</span>
        <span class="h nw" data-h="nw"></span><span class="h ne" data-h="ne"></span>
        <span class="h sw" data-h="sw"></span><span class="h se" data-h="se"></span>`;
      el.addEventListener('pointerdown', (e) => startDrag(e, i));
      host.appendChild(el);
    });
    $('#btn-del').disabled = st.active < 0;
    sortAndNumber();
    updatePreview();
    $('#json-out').value = JSON.stringify(st.rects.map((r) => ({
      x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4),
    })), null, 2);
  }

  function sortAndNumber() {
    // urutkan atas ke bawah supaya nomornya sesuai urutan di strip
    const activeRect = st.active >= 0 ? st.rects[st.active] : null;
    st.rects.sort((a, b) => a.y - b.y);
    if (activeRect) st.active = st.rects.indexOf(activeRect);
    document.querySelectorAll('#rects .rect').forEach((el, i) => {
      const n = el.querySelector('.num');
      if (n) n.textContent = i + 1;
    });
  }

  // ---------- Geser & ubah ukuran ----------
  function startDrag(e, i) {
    e.preventDefault();
    e.stopPropagation();
    st.active = i;
    renderRects();
    const handle = e.target.dataset?.h || null;
    const stage = $('#stage').getBoundingClientRect();
    const start = { ...st.rects[i] };
    const x0 = e.clientX, y0 = e.clientY;
    const MIN = 0.04;

    const move = (ev) => {
      const dx = (ev.clientX - x0) / stage.width;
      const dy = (ev.clientY - y0) / stage.height;
      const r = { ...start };
      if (!handle) {
        r.x = clamp01(start.x + dx); r.y = clamp01(start.y + dy);
        r.x = Math.min(r.x, 1 - start.w); r.y = Math.min(r.y, 1 - start.h);
      } else {
        if (handle.includes('w')) { const nx = Math.min(start.x + dx, start.x + start.w - MIN); r.w = start.w + (start.x - nx); r.x = nx; }
        if (handle.includes('e')) { r.w = Math.max(MIN, Math.min(start.w + dx, 1 - start.x)); }
        if (handle.includes('n')) { const ny = Math.min(start.y + dy, start.y + start.h - MIN); r.h = start.h + (start.y - ny); r.y = ny; }
        if (handle.includes('s')) { r.h = Math.max(MIN, Math.min(start.h + dy, 1 - start.y)); }
        r.x = clamp01(r.x); r.y = clamp01(r.y);
      }
      st.rects[st.active] = r;
      const el = document.querySelectorAll('#rects .rect')[st.active];
      if (el) {
        el.style.left = r.x * 100 + '%'; el.style.top = r.y * 100 + '%';
        el.style.width = r.w * 100 + '%'; el.style.height = r.h * 100 + '%';
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderRects();
      $('#save-msg').textContent = 'Ada perubahan yang belum disimpan.';
      $('#save-msg').className = 'editor-msg';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- Pratinjau ----------
  let previewTimer = null;
  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!st.img || !st.rects.length) {
        const c = $('#preview'); c.width = 10; c.height = 10;
        c.getContext('2d').clearRect(0, 0, 10, 10);
        return;
      }
      const d = def();
      const f = Lib.processFrame({ id: d.id, slotCount: d.slotCount || 4, slots: st.rects }, st.img,
        { maxWidth: 700, detectWidth: 520 });
      const c = $('#preview');
      c.width = f.width; c.height = f.height;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      if ($('#chk-holes').checked) {
        ctx.fillStyle = '#ff00ff';
        f.slots.forEach((s) => ctx.fillRect(s.x, s.y, s.w, s.h));
      }
      ctx.drawImage(f.overlay, 0, 0);
    }, 120);
  }

  // ---------- Simpan ----------
  async function save() {
    const d = def();
    const msg = $('#save-msg');
    if (!st.rects.length) { msg.textContent = 'Belum ada kotak untuk disimpan.'; msg.className = 'editor-msg bad'; return; }
    const want = d.slotCount || 4;
    if (st.rects.length !== want &&
        !confirm(`Kotak yang ada ${st.rects.length}, bukan ${want}. Tetap simpan?`)) return;
    $('#btn-save').disabled = true;
    try {
      const r = await fetch('/api/slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameId: d.id, slots: st.rects }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'gagal menyimpan');
      st.saved[d.id] = st.rects.map((x) => ({ ...x }));
      msg.textContent = `Tersimpan ✓ (${st.rects.length} kotak). Muat ulang halaman photobooth untuk memakainya.`;
      msg.className = 'editor-msg ok';
      renderTabs();
    } catch (e) {
      msg.textContent = `Gagal menyimpan: ${e.message}`;
      msg.className = 'editor-msg bad';
    } finally {
      $('#btn-save').disabled = false;
    }
  }

  async function resetFrame() {
    const d = def();
    if (!confirm(`Hapus pengaturan manual untuk "${d.name}" dan kembali ke deteksi otomatis?`)) return;
    try {
      await fetch('/api/slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameId: d.id, slots: null }),
      });
      delete st.saved[d.id];
      renderTabs();
      autoDetect();
      $('#save-msg').textContent = 'Pengaturan manual dihapus, kembali ke otomatis.';
      $('#save-msg').className = 'editor-msg ok';
    } catch (e) {
      $('#save-msg').textContent = `Gagal: ${e.message}`;
      $('#save-msg').className = 'editor-msg bad';
    }
  }

  // ---------- Init ----------
  function bind() {
    $('#btn-detect').onclick = () => autoDetect();
    $('#btn-add').onclick = () => {
      st.rects.push({ x: 0.15, y: 0.4, w: 0.7, h: 0.15 });
      st.active = st.rects.length - 1;
      renderRects();
    };
    $('#btn-del').onclick = () => {
      if (st.active < 0) return;
      st.rects.splice(st.active, 1);
      st.active = -1;
      renderRects();
    };
    $('#btn-save').onclick = save;
    $('#btn-reset').onclick = resetFrame;
    $('#chk-holes').onchange = updatePreview;
    $('#stage').addEventListener('pointerdown', (e) => {
      if (e.target.id === 'frame-img' || e.target.id === 'rects') { st.active = -1; renderRects(); }
    });
    // Tombol panah untuk menggeser halus; tahan Shift untuk mengubah ukuran
    window.addEventListener('keydown', (e) => {
      if (st.active < 0) return;
      const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const k = keys[e.key];
      if (!k) return;
      e.preventDefault();
      const step = e.altKey ? 0.0008 : 0.004;
      const r = st.rects[st.active];
      if (e.shiftKey) { r.w = Math.max(0.04, r.w + k[0] * step); r.h = Math.max(0.04, r.h + k[1] * step); }
      else { r.x = clamp01(r.x + k[0] * step); r.y = clamp01(r.y + k[1] * step); }
      renderRects();
      $('#save-msg').textContent = 'Ada perubahan yang belum disimpan.';
      $('#save-msg').className = 'editor-msg';
    });
  }

  async function init() {
    bind();
    try { st.saved = await (await fetch('/api/slots', { cache: 'no-store' })).json(); } catch { st.saved = {}; }
    if (!st.defs?.length) { setStatus('Tidak ada frame di config.js', 'warn'); return; }
    await openFrame(0);
  }

  init();
})();
