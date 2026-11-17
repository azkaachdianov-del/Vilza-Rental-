-- Vilza VVIP Rental Transport - Login & Sign Up (Supabase Auth)
-- Jalankan di Supabase: SQL Editor > New query > Run
-- URUTAN: schema.sql -> policy.sql -> auth.sql -> pembukuan.sql
-- File ini aman dijalankan ulang.
--
-- Peran (role):
--   admin   : akses penuh (termasuk hapus data)
--   staf    : kelola pelanggan, kendaraan, sewa, pemeliharaan
--   akuntan : baca data operasional + kelola pembukuan
-- Pengguna PERTAMA yang mendaftar otomatis menjadi admin; selanjutnya menjadi staf.

-- 1) Tabel profil: satu baris per akun di auth.users ---------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nama_lengkap text not null,
  no_hp text,
  role text not null default 'staf' check (role in ('admin','akuntan','staf')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 2) Profil dibuat otomatis saat sign up ---------------------------------
-- Role TIDAK diambil dari data yang dikirim browser, sehingga tidak bisa dipalsukan.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nama_lengkap, no_hp, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nama_lengkap'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'no_hp'), ''),
    case when exists (select 1 from public.profiles) then 'staf' else 'admin' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Untuk akun yang SUDAH ada sebelum file ini dijalankan
insert into public.profiles (id, nama_lengkap, role)
select u.id, split_part(u.email, '@', 1),
       case when row_number() over (order by u.created_at) = 1 then 'admin' else 'staf' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
  and not exists (select 1 from public.profiles);
insert into public.profiles (id, nama_lengkap, role)
select u.id, split_part(u.email, '@', 1), 'staf'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- 3) Fungsi bantu peran (dipakai oleh policy) ----------------------------
create or replace function public.fn_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.fn_boleh_akuntansi()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_role() in ('admin', 'akuntan'), false)
$$;

revoke all on function public.fn_role(), public.fn_boleh_akuntansi() from public, anon, authenticated;
grant execute on function public.fn_role(), public.fn_boleh_akuntansi() to authenticated;

-- 4) Hak akses & policy tabel profiles -----------------------------------
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nama_lengkap, no_hp) on public.profiles to authenticated;  -- role tidak bisa diubah dari browser

drop policy if exists "profil: baca" on public.profiles;
create policy "profil: baca" on public.profiles
  for select to authenticated using (id = auth.uid() or public.fn_role() = 'admin');

drop policy if exists "profil: ubah milik sendiri" on public.profiles;
create policy "profil: ubah milik sendiri" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 5) Kunci tabel operasional: anon dicabut, hanya yang sudah login -------
revoke all on public.pelanggan, public.kendaraan, public.sewa, public.pemeliharaan from anon;
revoke all on public.v_persediaan from anon;
alter view public.v_persediaan set (security_invoker = true);  -- view ikut aturan RLS pemanggil

grant select, insert, update, delete on public.pelanggan, public.kendaraan, public.sewa, public.pemeliharaan to authenticated;
grant select on public.v_persediaan to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pelanggan', 'kendaraan', 'sewa', 'pemeliharaan'] loop
    -- policy lama dari policy.sql (akses terbuka untuk anon)
    execute format('drop policy if exists %I on public.%I', 'akses ' || t, t);
    -- policy baru
    execute format('drop policy if exists %I on public.%I', 'baca ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'tambah ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ubah ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'hapus ' || t, t);

    execute format('create policy %I on public.%I for select to authenticated using (public.fn_role() is not null)', 'baca ' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fn_role() in (''admin'', ''staf''))', 'tambah ' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_role() in (''admin'', ''staf'')) with check (public.fn_role() in (''admin'', ''staf''))', 'ubah ' || t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_role() = ''admin'')', 'hapus ' || t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------------
-- Mengubah peran pengguna (jalankan manual di SQL Editor, contoh):
--   update public.profiles set role = 'akuntan'
--   where id = (select id from auth.users where email = 'akuntan@contoh.com');
-- ------------------------------------------------------------------------
