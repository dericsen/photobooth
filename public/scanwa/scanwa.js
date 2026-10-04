(() => {
  const $ = (s) => document.querySelector(s);
  let lastQr = null;
  let qrShownAt = 0;

  const TEXT = {
    starting: 'Menyiapkan koneksi...',
    connecting: 'Menyambungkan ke WhatsApp...',
    qr: 'Scan QR ini dengan WhatsApp di HP kamu',
    connected: 'WhatsApp tersambung!',
    logged_out: 'Sesi sudah logout. Scan QR lagi untuk menyambung.',
    error: 'Ada masalah saat menyambung.',
  };

  function setVisible(el, show) { el.classList.toggle('hidden', !show); }

  async function poll() {
    try {
      const r = await fetch('/api/wa/status', { cache: 'no-store' });
      const s = await r.json();

      if (!s.enabled) {
        $('#state-text').textContent = `Provider WhatsApp saat ini "${s.provider}", bukan "web".`;
        $('#error-text').textContent = 'Ubah WA_PROVIDER=web di file .env lalu jalankan ulang server.';
        setVisible($('#spinner'), false);
        setVisible($('#steps'), false);
        return;
      }

      const connected = s.state === 'connected';
      const hasQr = s.state === 'qr' && !!s.qr;

      $('#state-text').textContent = TEXT[s.state] || s.state;
      $('#error-text').textContent = s.error || '';
      setVisible($('#qr-box'), hasQr);
      setVisible($('#spinner'), !connected && !hasQr && s.state !== 'error');
      setVisible($('#connected-box'), connected);
      setVisible($('#steps'), !connected);
      setVisible($('#btn-logout'), connected);

      if (hasQr) {
        if (s.qr !== lastQr) {
          lastQr = s.qr;
          qrShownAt = Date.now();
          $('#qr-img').src = s.qr;
        }
        // QR WhatsApp hanya berlaku ~60 detik; server otomatis membuat yang baru
        setVisible($('#qr-expired'), Date.now() - qrShownAt > 62_000);
      } else {
        lastQr = null;
      }

      if (connected) {
        $('#connected-name').textContent = s.me?.name
          ? `${s.me.name} (+${String(s.me.id || '').split(':')[0]})`
          : `+${String(s.me?.id || '').split(':')[0]}`;
      }

      if (s.needsInstall) {
        $('#error-text').textContent = 'Dependency belum terpasang. Jalankan: npm install';
      }
    } catch (e) {
      $('#error-text').textContent = 'Tidak bisa menghubungi server. Pastikan server masih jalan.';
    }
  }

  $('#btn-logout').onclick = async () => {
    if (!confirm('Putuskan sambungan WhatsApp? Nanti harus scan QR lagi.')) return;
    $('#btn-logout').disabled = true;
    await fetch('/api/wa/logout', { method: 'POST' }).catch(() => {});
    lastQr = null;
    setTimeout(() => { $('#btn-logout').disabled = false; poll(); }, 1500);
  };

  poll();
  setInterval(poll, 1500);
})();
