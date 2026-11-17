// Halaman pembukuan (hanya untuk peran admin dan akuntan).
// Memakai api(), $, rp, esc dari script.js. Data dihitung di database (lihat backend/pembukuan.sql).

const hariIni = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const awalBulan = () => hariIni().slice(0, 8) + '01';
const awalTahun = () => hariIni().slice(0, 5) + '01-01';
const tgl = s => (s ? s.split('-').reverse().join('/') : '');
const rpn = n => (Number(n) < 0 ? `(${rp(-Number(n))})` : rp(n));
const jum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const selisih = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const HALAMAN = {
  jurnal: ['Jurnal Umum', halamanJurnal],
  bukubesar: ['Buku Besar', halamanBukuBesar],
  neracasaldo: ['Neraca Saldo', halamanNeracaSaldo],
  labarugi: ['Laporan Laba Rugi', halamanLabaRugi],
  neraca: ['Neraca', halamanNeraca]
};

const lapSaldo = (dari, sampai) => api('POST', 'rpc/lap_neraca_saldo', { p_dari: dari || null, p_sampai: sampai });

/* ------------------------------------------------------------------ */
/* Jurnal umum                                                         */
/* ------------------------------------------------------------------ */
async function halamanJurnal() {
  const akun = await api('GET', 'akun?select=id,kode,nama&is_aktif=eq.true&order=kode');
  const opsiAkun = `<option value="">Pilih akun...</option>` + akun.map(a => `<option value="${esc(a.kode)}">${esc(a.kode)} - ${esc(a.nama)}</option>`).join('');
  const bulanIni = hariIni().slice(0, 7);

  $('#app').innerHTML = `
    <section class="panel" style="margin-bottom:14px">
      <div class="panel__head"><h3>Jurnal baru</h3><small>Total debit harus sama dengan total kredit</small></div>
      <div class="jform">
        <div class="jform__atas">
          <label>Tanggal<input id="jTgl" type="date" value="${hariIni()}"></label>
          <label class="jform__ket">Keterangan<input id="jKet" type="text" placeholder="Contoh: Setoran modal awal"></label>
        </div>
        <div class="tabel">
          <table class="jlines">
            <thead><tr><th>Akun</th><th class="angka">Debit</th><th class="angka">Kredit</th><th></th></tr></thead>
            <tbody id="jBaris"></tbody>
            <tfoot><tr><td>Total <span id="jStatus" class="jstatus"></span></td><td class="angka" id="jTD"></td><td class="angka" id="jTK"></td><td></td></tr></tfoot>
          </table>
        </div>
        <div class="jform__aksi">
          <button type="button" class="kecil" id="jTambah">Tambah baris</button>
          <button type="button" class="utama" id="jSimpan" disabled>Simpan jurnal</button>
        </div>
        <div id="jPesan" class="info-box" hidden></div>
      </div>
    </section>

    <section class="panel" style="margin-bottom:14px">
      <div class="panel__head"><h3>Penyusutan bulanan</h3><small>Garis lurus, satu kali per bulan</small></div>
      <div class="jform__atas">
        <label>Periode<input id="pBulan" type="month" value="${bulanIni}"></label>
        <button type="button" class="utama" id="pPosting">Posting penyusutan</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h3>Daftar jurnal</h3><small id="jJumlah"></small></div>
      <div class="filter-row">
        <label>Dari<input id="fDari" type="date"></label>
        <label>Sampai<input id="fSampai" type="date"></label>
        <label class="filter-row__cari">Cari<input id="fCari" placeholder="No. bukti atau keterangan..."></label>
      </div>
      <div class="tabel"><table id="jDaftar"><thead><tr><th>Tanggal</th><th>No. bukti</th><th>Akun / keterangan</th><th class="angka">Debit</th><th class="angka">Kredit</th><th></th></tr></thead>
      <tbody id="jDaftarBody"></tbody></table></div>
    </section>`;

  const baris = $('#jBaris');
  const tambahBaris = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><select class="j-akun">${opsiAkun}</select></td>
      <td><input class="j-debit angka" type="number" min="0" step="any" inputmode="decimal"></td>
      <td><input class="j-kredit angka" type="number" min="0" step="any" inputmode="decimal"></td>
      <td><button type="button" class="kecil" data-hapus-baris>Hapus</button></td>`;
    baris.appendChild(tr);
  };
  tambahBaris(); tambahBaris();

  const ambilBaris = () => [...baris.querySelectorAll('tr')].map(tr => ({
    kode: tr.querySelector('.j-akun').value,
    debit: Number(tr.querySelector('.j-debit').value) || 0,
    kredit: Number(tr.querySelector('.j-kredit').value) || 0
  }));

  const hitung = () => {
    const b = ambilBaris().filter(x => x.kode && (x.debit || x.kredit));
    const td = jum(b, x => x.debit), tk = jum(b, x => x.kredit);
    $('#jTD').textContent = rp(td); $('#jTK').textContent = rp(tk);
    const seimbang = b.length >= 2 && td > 0 && selisih(td, tk);
    const st = $('#jStatus');
    st.textContent = !b.length ? '' : seimbang ? 'Seimbang' : td === tk ? 'Minimal 2 baris' : `Selisih ${rp(Math.abs(td - tk))}`;
    st.className = 'jstatus ' + (seimbang ? 'jstatus--ok' : 'jstatus--no');
    $('#jSimpan').disabled = !seimbang || !$('#jKet').value.trim();
  };
  const tampilPesan = (teks, galat) => { const p = $('#jPesan'); p.textContent = teks; p.className = 'info-box' + (galat ? ' info-box--err' : ''); p.hidden = false; };

  baris.oninput = e => {
    const tr = e.target.closest('tr');
    if (e.target.classList.contains('j-debit') && e.target.value) tr.querySelector('.j-kredit').value = '';
    if (e.target.classList.contains('j-kredit') && e.target.value) tr.querySelector('.j-debit').value = '';
    hitung();
  };
  baris.onchange = hitung;
  $('#jKet').oninput = hitung;
  $('#jTambah').onclick = tambahBaris;

  async function muatDaftar() {
    let q = 'select=*,jurnal_detail(debit,kredit,akun(kode,nama))&order=tanggal.desc,id.desc&limit=300';
    if ($('#fDari').value) q += '&tanggal=gte.' + $('#fDari').value;
    if ($('#fSampai').value) q += '&tanggal=lte.' + $('#fSampai').value;
    const rows = await api('GET', 'jurnal?' + q);
    const dibalik = new Set(rows.filter(r => r.membalik_id).map(r => r.membalik_id));
    $('#jJumlah').textContent = `${rows.length} jurnal${rows.length === 300 ? ' (300 terbaru)' : ''}`;
    $('#jDaftarBody').innerHTML = rows.map(r => {
      const det = (r.jurnal_detail || []).slice().sort((a, b) => (Number(b.debit) > 0) - (Number(a.debit) > 0));
      const status = r.membalik_id ? '<span class="badge badge--balik">Pembalik</span>' : dibalik.has(r.id) ? '<span class="badge badge--balik">Sudah dibalik</span>' : '';
      const bisaBalik = !r.membalik_id && !dibalik.has(r.id);
      return `<tr class="jh"><td>${tgl(r.tanggal)}</td><td>${esc(r.no_bukti)}</td>
        <td>${esc(r.keterangan)} <span class="badge">${esc(r.sumber)}</span> ${status}</td><td></td><td></td>
        <td>${bisaBalik ? `<button class="kecil" data-balik="${r.id}" data-no="${esc(r.no_bukti)}">Balik</button>` : ''}</td></tr>` +
        det.map(d => `<tr class="jd"><td></td><td></td>
          <td class="jd__akun${Number(d.kredit) > 0 ? ' jd__akun--kredit' : ''}">${esc(d.akun.kode)} - ${esc(d.akun.nama)}</td>
          <td class="angka">${Number(d.debit) > 0 ? rp(d.debit) : ''}</td><td class="angka">${Number(d.kredit) > 0 ? rp(d.kredit) : ''}</td><td></td></tr>`).join('');
    }).join('') || `<tr><td colspan="6" class="empty">Belum ada jurnal pada rentang ini.</td></tr>`;
    terapkanCari();
  }
  function terapkanCari() {
    const q = $('#fCari').value.toLowerCase();
    let tampil = true;
    document.querySelectorAll('#jDaftarBody tr').forEach(tr => {
      if (tr.classList.contains('jh')) tampil = !q || tr.textContent.toLowerCase().includes(q);
      tr.style.display = tampil ? '' : 'none';
    });
  }
  $('#fCari').oninput = terapkanCari;
  $('#fDari').onchange = $('#fSampai').onchange = () => muatDaftar().catch(e => tampilPesan(e.message, true));

  $('#app').onclick = async e => {
    const t = e.target;
    if (t.matches('[data-hapus-baris]')) {
      if (baris.children.length > 2) { t.closest('tr').remove(); hitung(); }
      return;
    }
    if (t.id === 'jSimpan') {
      const detail = ambilBaris().filter(x => x.kode && (x.debit || x.kredit));
      t.disabled = true;
      try {
        await api('POST', 'rpc/buat_jurnal', { p_tanggal: $('#jTgl').value || hariIni(), p_keterangan: $('#jKet').value.trim(), p_detail: detail });
        baris.innerHTML = ''; tambahBaris(); tambahBaris();
        $('#jKet').value = ''; hitung();
        tampilPesan('Jurnal tersimpan.', false);
        await muatDaftar();
      } catch (er) { tampilPesan('Jurnal belum tersimpan: ' + er.message, true); hitung(); }
      return;
    }
    if (t.id === 'pPosting') {
      const [th, bl] = ($('#pBulan').value || '').split('-').map(Number);
      if (!th || !bl) { tampilPesan('Pilih periode penyusutan terlebih dahulu.', true); return; }
      if (!confirm(`Posting penyusutan kendaraan untuk periode ${String(bl).padStart(2, '0')}/${th}?`)) return;
      try {
        await api('POST', 'rpc/posting_penyusutan', { p_tahun: th, p_bulan: bl });
        tampilPesan('Penyusutan berhasil diposting.', false);
        await muatDaftar();
      } catch (er) { tampilPesan(er.message, true); }
      return;
    }
    if (t.dataset.balik) {
      if (!confirm(`Buat jurnal pembalik untuk ${t.dataset.no}? Jurnal asli tetap tersimpan.`)) return;
      try {
        await api('POST', 'rpc/balik_jurnal', { p_id: Number(t.dataset.balik) });
        tampilPesan('Jurnal pembalik dibuat.', false);
        await muatDaftar();
      } catch (er) { tampilPesan(er.message, true); }
    }
  };

  hitung();
  await muatDaftar();
}

/* ------------------------------------------------------------------ */
/* Buku besar                                                          */
/* ------------------------------------------------------------------ */
async function halamanBukuBesar() {
  const akun = await api('GET', 'akun?select=id,kode,nama&order=kode');
  if (!akun.length) { $('#app').innerHTML = `<div class="info-box">Belum ada akun. Tambahkan akun di menu Daftar akun.</div>`; return; }

  $('#app').innerHTML = `
    <div class="filter-row filter-row--atas">
      <label>Akun<select id="bbAkun">${akun.map(a => `<option value="${a.id}">${esc(a.kode)} - ${esc(a.nama)}</option>`).join('')}</select></label>
      <label>Dari<input id="bbDari" type="date" value="${awalTahun()}"></label>
      <label>Sampai<input id="bbSampai" type="date" value="${hariIni()}"></label>
    </div>
    <section class="panel"><div class="tabel"><table>
      <thead><tr><th>Tanggal</th><th>No. bukti</th><th>Keterangan</th><th class="angka">Debit</th><th class="angka">Kredit</th><th class="angka">Saldo</th></tr></thead>
      <tbody id="bbBody"></tbody><tfoot id="bbFoot"></tfoot></table></div></section>`;

  async function tampil() {
    const id = $('#bbAkun').value, dari = $('#bbDari').value, sampai = $('#bbSampai').value || hariIni();
    let q = `select=*&akun_id=eq.${id}&tanggal=lte.${sampai}&order=tanggal,jurnal_id,id`;
    if (dari) q += '&tanggal=gte.' + dari;
    const [rows, awal] = await Promise.all([
      api('GET', 'v_buku_besar?' + q),
      dari ? api('GET', `v_buku_besar?select=saldo&akun_id=eq.${id}&tanggal=lt.${dari}&order=tanggal.desc,jurnal_id.desc,id.desc&limit=1`) : Promise.resolve([])
    ]);
    const saldoAwal = awal.length ? Number(awal[0].saldo) : 0;
    const akhir = rows.length ? Number(rows[rows.length - 1].saldo) : saldoAwal;
    $('#bbBody').innerHTML =
      (dari ? `<tr class="sub"><td colspan="5">Saldo awal</td><td class="angka">${rpn(saldoAwal)}</td></tr>` : '') +
      (rows.map(r => `<tr><td>${tgl(r.tanggal)}</td><td>${esc(r.no_bukti)}</td><td>${esc(r.keterangan)}</td>
        <td class="angka">${Number(r.debit) > 0 ? rp(r.debit) : ''}</td><td class="angka">${Number(r.kredit) > 0 ? rp(r.kredit) : ''}</td><td class="angka">${rpn(r.saldo)}</td></tr>`).join('')
        || `<tr><td colspan="6" class="empty">Belum ada transaksi pada akun ini.</td></tr>`);
    $('#bbFoot').innerHTML = `<tr><td colspan="3">Total / saldo akhir</td><td class="angka">${rp(jum(rows, x => Number(x.debit)))}</td><td class="angka">${rp(jum(rows, x => Number(x.kredit)))}</td><td class="angka">${rpn(akhir)}</td></tr>`;
  }
  const muat = () => tampil().catch(e => { $('#bbBody').innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; });
  $('#bbAkun').onchange = $('#bbDari').onchange = $('#bbSampai').onchange = muat;
  await tampil();
}

/* ------------------------------------------------------------------ */
/* Neraca saldo                                                        */
/* ------------------------------------------------------------------ */
async function halamanNeracaSaldo() {
  $('#app').innerHTML = `
    <div class="filter-row filter-row--atas"><label>Per tanggal<input id="nsSampai" type="date" value="${hariIni()}"></label></div>
    <section class="panel"><div class="tabel"><table>
      <thead><tr><th>Kode</th><th>Nama akun</th><th class="angka">Debit</th><th class="angka">Kredit</th></tr></thead>
      <tbody id="nsBody"></tbody><tfoot id="nsFoot"></tfoot></table></div></section>`;

  async function tampil() {
    const r = (await lapSaldo(null, $('#nsSampai').value || hariIni())).filter(x => Number(x.total_debit) || Number(x.total_kredit));
    const net = x => Number(x.total_debit) - Number(x.total_kredit);
    const td = jum(r, x => (net(x) > 0 ? net(x) : 0)), tk = jum(r, x => (net(x) < 0 ? -net(x) : 0));
    $('#nsBody').innerHTML = r.map(x => `<tr><td>${esc(x.kode)}</td><td>${esc(x.nama)}</td>
      <td class="angka">${net(x) > 0 ? rp(net(x)) : ''}</td><td class="angka">${net(x) < 0 ? rp(-net(x)) : ''}</td></tr>`).join('')
      || `<tr><td colspan="4" class="empty">Belum ada jurnal sampai tanggal ini.</td></tr>`;
    $('#nsFoot').innerHTML = `<tr><td colspan="2">Total ${selisih(td, tk) ? '<span class="jstatus jstatus--ok">Seimbang</span>' : '<span class="jstatus jstatus--no">Tidak seimbang</span>'}</td><td class="angka">${rp(td)}</td><td class="angka">${rp(tk)}</td></tr>`;
  }
  $('#nsSampai').onchange = () => tampil().catch(e => { $('#nsBody').innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message)}</td></tr>`; });
  await tampil();
}

/* ------------------------------------------------------------------ */
/* Laporan keuangan: laba rugi dan neraca                              */
/* ------------------------------------------------------------------ */
const barisLaporan = (items, nilai) => items.map(x => `<tr><td class="lap__indent">${esc(x.kode)} - ${esc(x.nama)}</td><td class="angka">${rpn(nilai(x))}</td></tr>`).join('');
const bagianLaporan = (judul, items, nilai, total, teksTotal) => `
  <tr class="lap__judul"><td colspan="2">${judul}</td></tr>
  ${barisLaporan(items, nilai) || `<tr><td class="lap__indent empty-inline" colspan="2">Belum ada transaksi</td></tr>`}
  <tr class="sub"><td>${teksTotal}</td><td class="angka">${rpn(total)}</td></tr>`;

async function halamanLabaRugi() {
  $('#app').innerHTML = `
    <div class="filter-row filter-row--atas">
      <label>Dari<input id="lrDari" type="date" value="${awalTahun()}"></label>
      <label>Sampai<input id="lrSampai" type="date" value="${hariIni()}"></label>
    </div>
    <section class="panel lap"><div class="tabel"><table><tbody id="lrBody"></tbody></table></div></section>`;

  async function tampil() {
    const dari = $('#lrDari').value, sampai = $('#lrSampai').value || hariIni();
    const r = await lapSaldo(dari, sampai);
    const pend = r.filter(x => x.tipe === 'Pendapatan' && Number(x.saldo) !== 0);
    const beban = r.filter(x => x.tipe === 'Beban' && Number(x.saldo) !== 0);
    const tp = jum(pend, x => Number(x.saldo)), tb = jum(beban, x => Number(x.saldo)), laba = tp - tb;
    $('#lrBody').innerHTML =
      `<tr class="lap__kop"><td colspan="2">Laporan laba rugi, ${tgl(dari)} sampai ${tgl(sampai)}</td></tr>` +
      bagianLaporan('Pendapatan', pend, x => Number(x.saldo), tp, 'Total pendapatan') +
      bagianLaporan('Beban', beban, x => Number(x.saldo), tb, 'Total beban') +
      `<tr class="grand ${laba < 0 ? 'grand--rugi' : ''}"><td>${laba < 0 ? 'Rugi bersih' : 'Laba bersih'}</td><td class="angka">${rpn(laba)}</td></tr>`;
  }
  $('#lrDari').onchange = $('#lrSampai').onchange = () => tampil().catch(e => { $('#lrBody').innerHTML = `<tr><td class="empty">${esc(e.message)}</td></tr>`; });
  await tampil();
}

async function halamanNeraca() {
  $('#app').innerHTML = `
    <div class="filter-row filter-row--atas"><label>Per tanggal<input id="nrSampai" type="date" value="${hariIni()}"></label></div>
    <section class="panel lap"><div class="tabel"><table><tbody id="nrBody"></tbody></table></div></section>`;

  async function tampil() {
    const sampai = $('#nrSampai').value || hariIni();
    const r = await lapSaldo(null, sampai);
    const debitNet = x => Number(x.total_debit) - Number(x.total_kredit);
    const aset = r.filter(x => x.tipe === 'Aset' && debitNet(x) !== 0);
    const kew = r.filter(x => x.tipe === 'Kewajiban' && debitNet(x) !== 0);
    const eku = r.filter(x => x.tipe === 'Ekuitas' && debitNet(x) !== 0);
    const laba = jum(r.filter(x => x.tipe === 'Pendapatan'), x => -debitNet(x)) - jum(r.filter(x => x.tipe === 'Beban'), x => debitNet(x));

    const ta = jum(aset, debitNet), tk = jum(kew, x => -debitNet(x)), te = jum(eku, x => -debitNet(x)) + laba;
    const seimbang = selisih(ta, tk + te);

    $('#nrBody').innerHTML =
      `<tr class="lap__kop"><td colspan="2">Neraca per ${tgl(sampai)}</td></tr>` +
      bagianLaporan('Aset', aset, debitNet, ta, 'Total aset') +
      bagianLaporan('Kewajiban', kew, x => -debitNet(x), tk, 'Total kewajiban') +
      `<tr class="lap__judul"><td colspan="2">Ekuitas</td></tr>` +
      barisLaporan(eku, x => -debitNet(x)) +
      `<tr><td class="lap__indent">Laba (rugi) berjalan</td><td class="angka">${rpn(laba)}</td></tr>
       <tr class="sub"><td>Total ekuitas</td><td class="angka">${rpn(te)}</td></tr>
       <tr class="grand"><td>Total kewajiban dan ekuitas ${seimbang ? '' : '<span class="jstatus jstatus--no">Tidak sama dengan total aset</span>'}</td><td class="angka">${rpn(tk + te)}</td></tr>`;
  }
  $('#nrSampai').onchange = () => tampil().catch(e => { $('#nrBody').innerHTML = `<tr><td class="empty">${esc(e.message)}</td></tr>`; });
  await tampil();
}
