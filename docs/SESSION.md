# RE-MATCH — Sesi pengembangan

## Pekerjaan saat ini — 19 Oktober 2026

- Pulihkan navigasi ke workflow tiga langkah dan tabel workspace lama; tambahkan pengelolaan akses tanpa mengganti layout utama.
- Tampilan review lama membaca state versioned ketika sharing aktif. Accept, status/filter, kandidat pilihan, bulk, dan Undo memakai versi dari snapshot yang dilihat pengguna. Writer legacy tetap tertutup.
- Tambahkan pilihan kolom pembanding per job/browser dan ekspor Excel berformat acuan asli Matched + audit seluruh input.
- Sampel lokal 50 pasangan sudah diambil read-only dari hasil tersimpan: 12 exact sistem, 14 fuzzy, 12 perlu cek salah cocok, 12 konflik referensi. Semua label petugas kosong. Jangan commit data sampel ke Git.
- Kandidat: pisahkan pool pencarian dari top N tersimpan, perluas pool yang belum meyakinkan, ganti penghentian global dengan batas atas WLS per kandidat, benahi cache kolom generated, dan tangani skor seri secara deterministik.
- Alamat: pertahankan kesetaraan JL/Jalan dan 14A/14 A, termasuk No14A. Nomor berbeda tetap konflik. Threshold global tidak dikalibrasi tanpa label nyata.
- Penyimpanan baru: migrasi additive snapshot acuan berdasarkan hash, input sekali pada kandidat utama, pembaca kompatibel format lama. Evidence lengkap dan skor tetap dipertahankan. Migrasi belum diterapkan pada database utama; tidak ada pemadatan/backfill historis.

## Verifikasi

- Unit terarah: 14 tes / 73 assertion lulus; navigasi: 4 tes lulus; MySQL terisolasi: 25 assertion lulus. TypeScript dan production build client/SSR akhir lulus. Browser menunjukkan workspace tabel lama dan workflow tiga langkah; GET review job kecil terautentikasi menghasilkan HTTP 200, source review_states, versi aktual dan role admin. Tidak membuat keputusan pada database utama.
- Tidak menjalankan ulang matching utama, UAT besar, benchmark 300 ribu record, backup, atau restore.
- File Excel manual berada di outputs/manual-review-20261019/sampel-review-matching.xlsx. File ini bukan bukti akurasi sampai diisi petugas.

## Batas deployment

- Database utama, keputusan historis, dan feature flag tidak diubah pada pekerjaan ini.
- Terapkan migrasi snapshot hanya melalui prosedur deployment yang disetujui. Snapshot yang sudah direferensikan tidak boleh di-drop sembarangan.
- Ekspor historis memerlukan snapshot lengkap atau file acuan asli yang konsisten; kolom yang tidak tersimpan tidak boleh direka.
- Bukti UAT/cutover terdahulu tetap berada pada dokumentasi yang sudah ada. Jangan mengulang pengujian besar untuk melanjutkan pekerjaan ini.
