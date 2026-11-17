// Autentikasi Supabase (GoTrue) lewat REST langsung dari browser.
// Tanpa Node.js, npm, maupun library tambahan.
// Gunakan publishable (anon) key, JANGAN gunakan secret/service-role key.
const SUPABASE_URL = 'https://qjnwpmzabwdojqobhxyu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OinbNXi6GRxzyjnX9S0Isg_mCOSoa3W';

const Auth = (() => {
  const KUNCI_SESI = 'vilza.session';
  let sedangSegarkan = null;
  let profilCache = null;

  const baca = () => {
    try { return JSON.parse(localStorage.getItem(KUNCI_SESI)); } catch { return null; }
  };
  const simpan = s => { try { localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); } catch {} };
  const bersihkan = () => {
    profilCache = null;
    try { localStorage.removeItem(KUNCI_SESI); } catch {}
  };
  const keLogin = () => {
    if (!/(login|signup)\.html$/.test(location.pathname)) location.replace('login.html');
  };

  function terjemah(d, status) {
    const kode = d && (d.error_code || d.code);
    const teks = (d && (d.msg || d.message || d.error_description || d.error)) || '';
    const peta = {
      invalid_credentials: 'Email atau kata sandi salah.',
      email_not_confirmed: 'Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk Anda.',
      user_already_exists: 'Email ini sudah terdaftar. Silakan masuk.',
      email_exists: 'Email ini sudah terdaftar. Silakan masuk.',
      weak_password: 'Kata sandi terlalu lemah. Gunakan minimal 8 karakter dengan kombinasi huruf dan angka.',
      signup_disabled: 'Pendaftaran akun baru sedang dinonaktifkan.',
      over_request_rate_limit: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
      over_email_send_rate_limit: 'Terlalu banyak email dikirim. Tunggu beberapa menit lalu coba lagi.',
      validation_failed: 'Format email atau data yang dimasukkan tidak valid.'
    };
    if (peta[kode]) return peta[kode];
    if (/invalid login credentials/i.test(teks)) return peta.invalid_credentials;
    if (/already registered/i.test(teks)) return peta.user_already_exists;
    if (status === 429) return peta.over_request_rate_limit;
    return teks || 'Permintaan gagal. Coba lagi.';
  }

  async function panggil(jalur, { body, token } = {}) {
    let r;
    try {
      r = await fetch(`${SUPABASE_URL}/auth/v1/${jalur}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('Tidak dapat terhubung ke Supabase. Periksa koneksi internet Anda.');
    }
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const err = new Error(terjemah(d, r.status));
      err.status = r.status;
      throw err;
    }
    return d;
  }

  const bentukSesi = d => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: d.user
  });

  async function masuk(email, sandi) {
    const d = await panggil('token?grant_type=password', { body: { email, password: sandi } });
    simpan(bentukSesi(d));
  }

  // Mengembalikan { perluKonfirmasi: true } bila Supabase meminta konfirmasi email.
  async function daftar({ email, sandi, nama, hp }) {
    const kembali = encodeURIComponent(new URL('login.html', location.href).href);
    const d = await panggil(`signup?redirect_to=${kembali}`, {
      body: { email, password: sandi, data: { nama_lengkap: nama, no_hp: hp || '' } }
    });
    const user = d.user || d;
    // Email sudah terdaftar: Supabase tidak mengirim error demi privasi, tetapi identities kosong.
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      throw new Error('Email ini sudah terdaftar. Silakan masuk.');
    }
    if (d.access_token) {
      simpan(bentukSesi(d));
      return { perluKonfirmasi: false };
    }
    return { perluKonfirmasi: true };
  }

  function segarkan() {
    if (!sedangSegarkan) {
      sedangSegarkan = (async () => {
        const s = baca();
        if (!s) { keLogin(); throw new Error('Sesi berakhir. Silakan masuk kembali.'); }
        try {
          const d = await panggil('token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } });
          const baru = bentukSesi(d);
          simpan(baru);
          return baru;
        } catch (e) {
          if (e.status === 400 || e.status === 401 || e.status === 403) { bersihkan(); keLogin(); }
          throw e;
        } finally {
          sedangSegarkan = null;
        }
      })();
    }
    return sedangSegarkan;
  }

  async function token() {
    const s = baca();
    if (!s) { keLogin(); throw new Error('Sesi berakhir. Silakan masuk kembali.'); }
    if (s.expires_at - 60 > Math.floor(Date.now() / 1000)) return s.access_token;
    return (await segarkan()).access_token;
  }

  async function keluar() {
    const s = baca();
    if (s) { try { await panggil('logout', { token: s.access_token }); } catch {} }
    bersihkan();
    location.replace('login.html');
  }

  async function muatProfil() {
    const s = baca();
    if (!s) return null;
    const t = await token();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,nama_lengkap,no_hp,role&id=eq.${s.user.id}&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + t }
    });
    if (!r.ok) throw new Error('Gagal memuat profil pengguna.');
    const baris = await r.json();
    profilCache = baris[0] ? { ...baris[0], email: s.user.email } : null;
    return profilCache;
  }

  return {
    ada: () => !!baca(),
    masuk, daftar, keluar, token, segarkan, muatProfil,
    profil: () => profilCache,
    // Halaman dashboard: tendang ke login bila belum masuk.
    wajibMasuk() { if (!baca()) keLogin(); },
    // Halaman login/sign up: lanjut ke dashboard bila sudah masuk.
    lewatiJikaMasuk() { if (baca()) location.replace('index.html'); }
  };
})();
