-- Vilza VVIP Rental Transport - Pembukuan (akuntansi double-entry)
-- Jalankan di Supabase: SQL Editor > New query > Run
-- URUTAN: schema.sql -> policy.sql -> auth.sql -> pembukuan.sql
--
-- Isi:
--   * akun (daftar akun/COA), jurnal + jurnal_detail (jurnal umum)
--   * Jurnal otomatis: sewa "Selesai" -> pendapatan, pemeliharaan -> beban
--   * Penyusutan bulanan (garis lurus) dengan satu klik dari aplikasi
--   * Jurnal manual lewat fungsi buat_jurnal (dijamin debit = kredit)
--   * Jurnal tidak bisa diubah/dihapus; koreksi memakai jurnal pembalik
--   * v_buku_besar dan lap_neraca_saldo (dasar neraca saldo, laba rugi, neraca)

-- 1) Tabel ----------------------------------------------------------------
create table if not exists public.akun (
  id bigint generated always as identity primary key,
  kode text not null unique,
  nama text not null,
  tipe text not null check (tipe in ('Aset', 'Kewajiban', 'Ekuitas', 'Pendapatan', 'Beban')),
  saldo_normal text not null check (saldo_normal in ('Debit', 'Kredit')),
  is_aktif boolean not null default true
);

create sequence if not exists public.jurnal_no_seq;

create table if not exists public.jurnal (
  id bigint generated always as identity primary key,
  no_bukti text unique,
  tanggal date not null default current_date,
  keterangan text not null,
  sumber text not null default 'Manual' check (sumber in ('Manual', 'Sewa', 'Pemeliharaan', 'Penyusutan')),
  sumber_id bigint,                                   -- id sewa/pemeliharaan, atau tahun*100+bulan untuk penyusutan
  membalik_id bigint references public.jurnal(id),    -- terisi bila ini jurnal pembalik
  dibuat_oleh uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_jurnal_membalik on public.jurnal(membalik_id) where membalik_id is not null;
create index if not exists ix_jurnal_sumber on public.jurnal(sumber, sumber_id);
create index if not exists ix_jurnal_tanggal on public.jurnal(tanggal);

create table if not exists public.jurnal_detail (
  id bigint generated always as identity primary key,
  jurnal_id bigint not null references public.jurnal(id) on delete cascade,
  akun_id bigint not null references public.akun(id),
  debit numeric(15,2) not null default 0 check (debit >= 0),
  kredit numeric(15,2) not null default 0 check (kredit >= 0),
  check ((debit = 0) <> (kredit = 0))                 -- tepat salah satu terisi
);
create index if not exists ix_jurnal_detail_jurnal on public.jurnal_detail(jurnal_id);
create index if not exists ix_jurnal_detail_akun on public.jurnal_detail(akun_id);

-- 2) Daftar akun awal (bisa ditambah dari menu "Daftar akun") -------------
insert into public.akun (kode, nama, tipe, saldo_normal) values
  ('1101', 'Kas',                               'Aset',       'Debit'),
  ('1102', 'Bank',                              'Aset',       'Debit'),
  ('1201', 'Kendaraan',                         'Aset',       'Debit'),
  ('1202', 'Akumulasi Penyusutan Kendaraan',    'Aset',       'Kredit'),
  ('2101', 'Utang Usaha',                       'Kewajiban',  'Kredit'),
  ('3101', 'Modal Pemilik',                     'Ekuitas',    'Kredit'),
  ('4101', 'Pendapatan Sewa',                   'Pendapatan', 'Kredit'),
  ('5101', 'Beban Pemeliharaan',                'Beban',      'Debit'),
  ('5201', 'Beban Penyusutan Kendaraan',        'Beban',      'Debit'),
  ('5301', 'Beban Operasional Lain',            'Beban',      'Debit')
on conflict (kode) do nothing;

-- 3) Fungsi internal (tidak bisa dipanggil dari browser) ------------------

-- Membuat satu jurnal lengkap + baris detailnya secara atomik.
-- p_detail: [{"kode":"1101","debit":100000,"kredit":0}, {"kode":"4101","debit":0,"kredit":100000}]
create or replace function public.fn_posting(
  p_tanggal date, p_keterangan text, p_sumber text, p_sumber_id bigint,
  p_detail jsonb, p_membalik bigint default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_row jsonb; v_akun bigint; v_prefix text;
  v_debit numeric; v_kredit numeric;
  v_td numeric := 0; v_tk numeric := 0; v_n int := 0;
begin
  if p_keterangan is null or trim(p_keterangan) = '' then
    raise exception 'Keterangan jurnal wajib diisi';
  end if;
  if p_detail is null or jsonb_typeof(p_detail) <> 'array' then
    raise exception 'Detail jurnal tidak valid';
  end if;

  v_prefix := case
    when p_membalik is not null then 'JB'
    else case p_sumber when 'Sewa' then 'JS' when 'Pemeliharaan' then 'JP' when 'Penyusutan' then 'JD' else 'JU' end
  end;

  insert into jurnal (no_bukti, tanggal, keterangan, sumber, sumber_id, membalik_id)
  values (
    v_prefix || '-' || to_char(p_tanggal, 'YYMM') || '-' || lpad(nextval('public.jurnal_no_seq')::text, 4, '0'),
    p_tanggal, trim(p_keterangan), p_sumber, p_sumber_id, p_membalik
  ) returning id into v_id;

  for v_row in select value from jsonb_array_elements(p_detail) loop
    v_akun := null;
    select id into v_akun from akun where kode = v_row->>'kode' and is_aktif;
    if v_akun is null then
      raise exception 'Akun % tidak ditemukan atau tidak aktif', coalesce(v_row->>'kode', '(kosong)');
    end if;

    v_debit  := coalesce(nullif(v_row->>'debit', '')::numeric, 0);
    v_kredit := coalesce(nullif(v_row->>'kredit', '')::numeric, 0);
    if v_debit = 0 and v_kredit = 0 then continue; end if;
    if v_debit < 0 or v_kredit < 0 then raise exception 'Nominal tidak boleh negatif'; end if;
    if v_debit > 0 and v_kredit > 0 then
      raise exception 'Satu baris tidak boleh berisi debit dan kredit sekaligus';
    end if;

    insert into jurnal_detail (jurnal_id, akun_id, debit, kredit) values (v_id, v_akun, v_debit, v_kredit);
    v_td := v_td + v_debit; v_tk := v_tk + v_kredit; v_n := v_n + 1;
  end loop;

  if v_n < 2 then raise exception 'Jurnal minimal terdiri dari 2 baris'; end if;
  if v_td <> v_tk then
    raise exception 'Jurnal tidak seimbang: total debit % berbeda dengan total kredit %', v_td, v_tk;
  end if;
  return v_id;
end $$;

-- Membuat jurnal pembalik (debit <-> kredit) untuk mengoreksi jurnal.
create or replace function public.fn_balik_jurnal(p_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare j jurnal; v_detail jsonb;
begin
  select * into j from jurnal where id = p_id;
  if not found then raise exception 'Jurnal tidak ditemukan'; end if;
  if j.membalik_id is not null then raise exception 'Jurnal pembalik tidak dapat dibalik lagi'; end if;
  if exists (select 1 from jurnal where membalik_id = p_id) then
    raise exception 'Jurnal % sudah pernah dibalik', j.no_bukti;
  end if;

  select jsonb_agg(jsonb_build_object('kode', a.kode, 'debit', d.kredit, 'kredit', d.debit))
    into v_detail
  from jurnal_detail d join akun a on a.id = d.akun_id
  where d.jurnal_id = p_id;

  return fn_posting(current_date, 'Pembalik ' || j.no_bukti || ' - ' || j.keterangan,
                    j.sumber, j.sumber_id, v_detail, p_id);
end $$;

-- Membalik semua jurnal aktif milik satu sumber (dipakai saat sewa/pemeliharaan diubah/dihapus).
create or replace function public.fn_balik_sumber(p_sumber text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select j.id from jurnal j
    where j.sumber = p_sumber and j.sumber_id = p_id and j.membalik_id is null
      and not exists (select 1 from jurnal x where x.membalik_id = j.id)
  loop
    perform fn_balik_jurnal(r.id);
  end loop;
end $$;

-- Jurnal pendapatan sewa: Dr Kas, Cr Pendapatan Sewa (hanya bila status Selesai)
create or replace function public.fn_post_sewa(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select w.id, w.status, w.total_sewa, w.tgl_selesai, k.plat, p.nama
    into s
  from sewa w
  join kendaraan k on k.id = w.kendaraan_id
  join pelanggan p on p.id = w.pelanggan_id
  where w.id = p_id;

  if not found or s.status <> 'Selesai' or coalesce(s.total_sewa, 0) <= 0 then return; end if;

  if exists (select 1 from jurnal j
             where j.sumber = 'Sewa' and j.sumber_id = p_id and j.membalik_id is null
               and not exists (select 1 from jurnal x where x.membalik_id = j.id)) then
    return;  -- sudah pernah diposting
  end if;

  perform fn_posting(
    s.tgl_selesai, 'Pendapatan sewa ' || s.plat || ' - ' || s.nama, 'Sewa', p_id,
    jsonb_build_array(
      jsonb_build_object('kode', '1101', 'debit', s.total_sewa, 'kredit', 0),
      jsonb_build_object('kode', '4101', 'debit', 0, 'kredit', s.total_sewa)
    )
  );
end $$;

-- Jurnal biaya pemeliharaan: Dr Beban Pemeliharaan, Cr Kas
create or replace function public.fn_post_pemeliharaan(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select pm.id, pm.tanggal, pm.biaya, pm.jenis, k.plat
    into m
  from pemeliharaan pm join kendaraan k on k.id = pm.kendaraan_id
  where pm.id = p_id;

  if not found or coalesce(m.biaya, 0) <= 0 then return; end if;

  perform fn_posting(
    m.tanggal, 'Pemeliharaan ' || m.plat || ' - ' || m.jenis, 'Pemeliharaan', p_id,
    jsonb_build_array(
      jsonb_build_object('kode', '5101', 'debit', m.biaya, 'kredit', 0),
      jsonb_build_object('kode', '1101', 'debit', 0, 'kredit', m.biaya)
    )
  );
end $$;

revoke all on function
  public.fn_posting(date, text, text, bigint, jsonb, bigint),
  public.fn_balik_jurnal(bigint),
  public.fn_balik_sumber(text, bigint),
  public.fn_post_sewa(bigint),
  public.fn_post_pemeliharaan(bigint)
from public, anon, authenticated;

-- 4) Trigger: jurnal otomatis dari transaksi ------------------------------
create or replace function public.trg_jurnal_sewa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform fn_balik_sumber('Sewa', old.id);
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status
       and old.total_sewa is not distinct from new.total_sewa
       and old.tgl_selesai is not distinct from new.tgl_selesai then
      return new;
    end if;
    perform fn_balik_sumber('Sewa', new.id);   -- koreksi: balik jurnal lama, posting ulang bila perlu
  end if;
  perform fn_post_sewa(new.id);
  return new;
end $$;

drop trigger if exists trg_jurnal_sewa on public.sewa;
create trigger trg_jurnal_sewa after insert or update or delete on public.sewa
  for each row execute function public.trg_jurnal_sewa();

create or replace function public.trg_jurnal_pemeliharaan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform fn_balik_sumber('Pemeliharaan', old.id);
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.biaya is not distinct from new.biaya
       and old.tanggal is not distinct from new.tanggal
       and old.jenis is not distinct from new.jenis
       and old.kendaraan_id is not distinct from new.kendaraan_id then
      return new;
    end if;
    perform fn_balik_sumber('Pemeliharaan', new.id);
  end if;
  perform fn_post_pemeliharaan(new.id);
  return new;
end $$;

drop trigger if exists trg_jurnal_pemeliharaan on public.pemeliharaan;
create trigger trg_jurnal_pemeliharaan after insert or update or delete on public.pemeliharaan
  for each row execute function public.trg_jurnal_pemeliharaan();

-- 5) Fungsi yang dipanggil dari aplikasi (hanya admin & akuntan) ----------

create or replace function public.buat_jurnal(p_tanggal date, p_keterangan text, p_detail jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_boleh_akuntansi() then
    raise exception 'Anda tidak memiliki akses untuk membuat jurnal';
  end if;
  return fn_posting(coalesce(p_tanggal, current_date), p_keterangan, 'Manual', null, p_detail);
end $$;

create or replace function public.balik_jurnal(p_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_boleh_akuntansi() then
    raise exception 'Anda tidak memiliki akses untuk membalik jurnal';
  end if;
  return fn_balik_jurnal(p_id);
end $$;

-- Penyusutan garis lurus untuk satu bulan: Dr Beban Penyusutan, Cr Akumulasi Penyusutan.
create or replace function public.posting_penyusutan(p_tahun int, p_bulan int)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_akhir date; v_total numeric; v_kunci bigint;
begin
  if not public.fn_boleh_akuntansi() then
    raise exception 'Anda tidak memiliki akses untuk memposting penyusutan';
  end if;
  if p_bulan not between 1 and 12 or p_tahun not between 2000 and 2100 then
    raise exception 'Periode tidak valid';
  end if;

  v_kunci := p_tahun * 100 + p_bulan;
  v_akhir := (make_date(p_tahun, p_bulan, 1) + interval '1 month' - interval '1 day')::date;

  if exists (select 1 from jurnal j
             where j.sumber = 'Penyusutan' and j.sumber_id = v_kunci and j.membalik_id is null
               and not exists (select 1 from jurnal x where x.membalik_id = j.id)) then
    raise exception 'Penyusutan periode %-% sudah diposting', p_tahun, lpad(p_bulan::text, 2, '0');
  end if;

  select coalesce(sum(round((harga_perolehan - nilai_residu) / umur_ekonomis / 12.0, 2)), 0)
    into v_total
  from kendaraan
  where tgl_perolehan <= v_akhir
    and (extract(year from age(v_akhir, tgl_perolehan)) * 12
         + extract(month from age(v_akhir, tgl_perolehan))) < umur_ekonomis * 12;

  if v_total <= 0 then
    raise exception 'Tidak ada kendaraan yang perlu disusutkan pada periode ini';
  end if;

  return fn_posting(
    v_akhir, 'Penyusutan kendaraan ' || to_char(v_akhir, 'MM/YYYY'), 'Penyusutan', v_kunci,
    jsonb_build_array(
      jsonb_build_object('kode', '5201', 'debit', v_total, 'kredit', 0),
      jsonb_build_object('kode', '1202', 'debit', 0, 'kredit', v_total)
    )
  );
end $$;

-- 6) Laporan --------------------------------------------------------------

-- Buku besar: tiap baris jurnal per akun beserta saldo berjalan.
create or replace view public.v_buku_besar with (security_invoker = true) as
select d.id, d.akun_id, a.kode, a.nama as nama_akun,
       j.id as jurnal_id, j.tanggal, j.no_bukti, j.keterangan,
       d.debit, d.kredit,
       sum(case when a.saldo_normal = 'Debit' then d.debit - d.kredit else d.kredit - d.debit end)
         over (partition by d.akun_id order by j.tanggal, j.id, d.id) as saldo
from jurnal_detail d
join jurnal j on j.id = d.jurnal_id
join akun a on a.id = d.akun_id;

-- Saldo semua akun pada rentang tanggal. p_dari NULL = sejak awal.
-- Dipakai untuk neraca saldo, laba rugi (dengan p_dari), dan neraca (tanpa p_dari).
create or replace function public.lap_neraca_saldo(p_dari date default null, p_sampai date default current_date)
returns table (
  akun_id bigint, kode text, nama text, tipe text, saldo_normal text,
  total_debit numeric, total_kredit numeric, saldo numeric
) language sql stable as $$
  select a.id, a.kode, a.nama, a.tipe, a.saldo_normal,
         coalesce(sum(m.debit), 0), coalesce(sum(m.kredit), 0),
         case when a.saldo_normal = 'Debit'
              then coalesce(sum(m.debit), 0) - coalesce(sum(m.kredit), 0)
              else coalesce(sum(m.kredit), 0) - coalesce(sum(m.debit), 0) end
  from akun a
  left join (
    select d.akun_id, d.debit, d.kredit
    from jurnal_detail d join jurnal j on j.id = d.jurnal_id
    where j.tanggal <= p_sampai and (p_dari is null or j.tanggal >= p_dari)
  ) m on m.akun_id = a.id
  where a.is_aktif or m.akun_id is not null
  group by a.id
  order by a.kode
$$;

-- 7) Hak akses & RLS: hanya admin dan akuntan --------------------------------
alter table public.akun enable row level security;
alter table public.jurnal enable row level security;
alter table public.jurnal_detail enable row level security;

revoke all on public.akun, public.jurnal, public.jurnal_detail, public.v_buku_besar from anon, authenticated;
revoke all on sequence public.jurnal_no_seq from anon, authenticated;

grant select, insert, update on public.akun to authenticated;
grant select on public.jurnal, public.jurnal_detail, public.v_buku_besar to authenticated;
-- jurnal & jurnal_detail sengaja tanpa insert/update/delete: penulisan hanya lewat fungsi di atas.

drop policy if exists "akun: baca" on public.akun;
drop policy if exists "akun: tambah" on public.akun;
drop policy if exists "akun: ubah" on public.akun;
create policy "akun: baca"   on public.akun for select to authenticated using (public.fn_boleh_akuntansi());
create policy "akun: tambah" on public.akun for insert to authenticated with check (public.fn_boleh_akuntansi());
create policy "akun: ubah"   on public.akun for update to authenticated using (public.fn_boleh_akuntansi()) with check (public.fn_boleh_akuntansi());

drop policy if exists "jurnal: baca" on public.jurnal;
create policy "jurnal: baca" on public.jurnal for select to authenticated using (public.fn_boleh_akuntansi());

drop policy if exists "jurnal_detail: baca" on public.jurnal_detail;
create policy "jurnal_detail: baca" on public.jurnal_detail for select to authenticated using (public.fn_boleh_akuntansi());

revoke all on function
  public.buat_jurnal(date, text, jsonb),
  public.balik_jurnal(bigint),
  public.posting_penyusutan(int, int),
  public.lap_neraca_saldo(date, date)
from public, anon, authenticated;
grant execute on function
  public.buat_jurnal(date, text, jsonb),
  public.balik_jurnal(bigint),
  public.posting_penyusutan(int, int),
  public.lap_neraca_saldo(date, date)
to authenticated;

-- 8) Jurnal untuk data yang SUDAH ada sebelum file ini dijalankan -----------
do $$
declare r record;
begin
  for r in select id from public.sewa where status = 'Selesai' order by id loop
    perform public.fn_post_sewa(r.id);
  end loop;
  for r in select id from public.pemeliharaan order by id loop
    if not exists (select 1 from public.jurnal where sumber = 'Pemeliharaan' and sumber_id = r.id) then
      perform public.fn_post_pemeliharaan(r.id);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------------
-- Catatan pemakaian:
--  * Saldo awal / pembelian kendaraan / setoran modal dicatat lewat Jurnal Umum manual,
--    mis. Dr 1201 Kendaraan, Cr 3101 Modal Pemilik (atau Cr 1102 Bank).
--  * Penyusutan: menu Jurnal umum > "Posting penyusutan" (satu kali per bulan).
--  * Salah catat? Gunakan tombol "Balik" lalu buat jurnal yang benar.
-- ------------------------------------------------------------------------
