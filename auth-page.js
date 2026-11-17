// Perilaku halaman login.html dan signup.html (memakai auth.js).
(() => {
  const $ = s => document.querySelector(s);
  const pesan = $('#pesan');
  const tombol = $('#kirim');
  const emailValid = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  function tampilPesan(teks, jenis) {
    pesan.textContent = teks;
    pesan.className = 'alert alert--' + jenis;
    pesan.hidden = false;
  }
  function galat(id, teks) {
    const el = $('#' + id + 'Err');
    if (el) el.textContent = teks || '';
    const input = $('#' + id);
    if (input) input.setAttribute('aria-invalid', teks ? 'true' : 'false');
    return !teks;
  }
  function sibuk(ya, label) {
    tombol.disabled = ya;
    tombol.textContent = ya ? 'Memproses...' : label;
  }

  // Tampilkan / sembunyikan kata sandi
  document.querySelectorAll('.sandi__toggle').forEach(b => {
    b.onclick = () => {
      const input = document.getElementById(b.dataset.target);
      const buka = input.type === 'password';
      input.type = buka ? 'text' : 'password';
      b.textContent = buka ? 'Sembunyikan' : 'Tampilkan';
    };
  });

  const login = $('#loginForm');
  if (login) {
    login.onsubmit = async e => {
      e.preventDefault();
      pesan.hidden = true;
      const email = $('#email').value.trim();
      const sandi = $('#sandi').value;
      const ok = [
        galat('email', !email ? 'Email wajib diisi.' : !emailValid(email) ? 'Format email belum benar.' : ''),
        galat('sandi', sandi ? '' : 'Kata sandi wajib diisi.')
      ].every(Boolean);
      if (!ok) return;

      sibuk(true, 'Masuk');
      try {
        await Auth.masuk(email, sandi);
        location.replace('index.html');
      } catch (er) {
        tampilPesan(er.message, 'error');
        sibuk(false, 'Masuk');
        $('#sandi').select();
      }
    };
  }

  const daftar = $('#signupForm');
  if (daftar) {
    daftar.onsubmit = async e => {
      e.preventDefault();
      pesan.hidden = true;
      const nama = $('#nama').value.trim();
      const email = $('#email').value.trim();
      const hp = $('#hp').value.trim();
      const sandi = $('#sandi').value;
      const sandi2 = $('#sandi2').value;

      const ok = [
        galat('nama', nama.length < 2 ? 'Nama lengkap wajib diisi.' : ''),
        galat('email', !email ? 'Email wajib diisi.' : !emailValid(email) ? 'Format email belum benar.' : ''),
        galat('hp', hp && !/^[0-9+\-\s()]{8,20}$/.test(hp) ? 'Nomor HP tidak valid.' : ''),
        galat('sandi', sandi.length < 8 ? 'Minimal 8 karakter.' : !/[A-Za-z]/.test(sandi) || !/[0-9]/.test(sandi) ? 'Gunakan kombinasi huruf dan angka.' : ''),
        galat('sandi2', sandi2 !== sandi ? 'Kata sandi tidak sama.' : '')
      ].every(Boolean);
      if (!ok) return;

      sibuk(true, 'Buat akun');
      try {
        const hasil = await Auth.daftar({ email, sandi, nama, hp });
        if (!hasil.perluKonfirmasi) { location.replace('index.html'); return; }
        daftar.reset();
        tampilPesan(`Akun dibuat. Kami mengirim tautan konfirmasi ke ${email}. Buka tautan tersebut, lalu masuk.`, 'ok');
        sibuk(false, 'Buat akun');
      } catch (er) {
        tampilPesan(er.message, 'error');
        sibuk(false, 'Buat akun');
      }
    };
  }
})();
