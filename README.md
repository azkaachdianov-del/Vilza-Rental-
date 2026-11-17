# Vilza VVIP Rental Transport

Aplikasi web untuk pengelolaan rental kendaraan, persediaan armada, dan pembukuan menggunakan HTML, CSS, JavaScript, dan Supabase. Tidak memakai Node.js maupun npm.

## Struktur

```text
vilza-rental/
├── frontend/
│   ├── login.html        # halaman masuk
│   ├── signup.html       # halaman daftar
│   ├── auth.css          # gaya halaman login/sign up
│   ├── auth.js           # konfigurasi Supabase + fungsi login, daftar, keluar
│   ├── auth-page.js      # perilaku formulir login/sign up
│   ├── index.html        # dashboard (wajib login)
│   ├── script.js         # dashboard + data operasional
│   ├── pembukuan.js      # jurnal, buku besar, neraca saldo, laba rugi, neraca
│   └── style.css
├── backend/
│   ├── schema.sql        # 1. tabel operasional
│   ├── policy.sql        # 2. policy sementara (diganti oleh auth.sql)
│   ├── auth.sql          # 3. login, profil, peran, RLS
│   ├── pembukuan.sql     # 4. akun, jurnal, penyusutan, laporan
│   └── app.js            # arsip
└── README.md
```

## Menjalankan proyek

1. Buat project di Supabase.
2. Di **SQL Editor**, jalankan berurutan: `schema.sql`, `policy.sql`, `auth.sql`, `pembukuan.sql`.
3. Pastikan `SUPABASE_URL` dan **publishable key** di `frontend/auth.js` sesuai project Anda.
4. Di Supabase: **Authentication > URL Configuration**, tambahkan alamat aplikasi ke *Redirect URLs* (contoh Live Server: `http://127.0.0.1:5500/frontend/login.html`) agar tautan konfirmasi email kembali ke halaman login.
5. Buka `frontend/login.html` lewat Live Server atau static hosting.
6. Daftar akun pertama: akun ini otomatis menjadi **admin**.

Untuk mencoba tanpa email konfirmasi, matikan **Confirm email** di *Authentication > Sign In / Providers > Email* (hanya untuk pengembangan).

## Peran pengguna

| Peran | Hak akses |
| --- | --- |
| admin | Semua fitur, termasuk menghapus data dan pembukuan |
| staf | Kelola pelanggan, kendaraan, sewa, pemeliharaan |
| akuntan | Baca data operasional, kelola seluruh pembukuan |

Akun baru selalu menjadi staf (kecuali yang pertama). Mengubah peran dilakukan admin lewat SQL Editor:

```sql
update public.profiles set role = 'akuntan'
where id = (select id from auth.users where email = 'akuntan@contoh.com');
```

## Pembukuan

- **Jurnal otomatis**: sewa berstatus *Selesai* menjadi Dr Kas / Cr Pendapatan Sewa; biaya pemeliharaan menjadi Dr Beban Pemeliharaan / Cr Kas. Jika transaksi diubah atau dihapus, jurnal lama otomatis dibalik.
- **Jurnal manual**: untuk modal awal, pembelian kendaraan, beban lain. Sistem menolak jurnal yang debit dan kreditnya tidak sama.
- **Penyusutan**: tombol *Posting penyusutan* di Jurnal umum, satu kali per bulan.
- **Koreksi**: jurnal tidak dapat diubah atau dihapus; gunakan tombol *Balik*.
- **Laporan**: buku besar, neraca saldo, laba rugi, dan neraca.

Contoh jurnal awal: `Dr 1201 Kendaraan, Cr 3101 Modal Pemilik` sebesar harga kendaraan, supaya neraca menampilkan aset armada.

## Keamanan

- Gunakan **publishable key** (`sb_publishable_...`) di browser. **Jangan** memasukkan `service_role`/secret key ke repository.
- Setelah `auth.sql`, role `anon` tidak punya akses ke tabel; semua data hanya untuk pengguna yang login, dibatasi per peran lewat Row Level Security.
- Peran tidak dapat diubah dari browser.
- Pastikan data pada `schema.sql` adalah data dummy sebelum repository dibuat publik.

## Catatan lisensi

Proyek ini belum menetapkan lisensi open-source. Tambahkan file `LICENSE` jika repository akan dibagikan sebagai proyek open-source.
