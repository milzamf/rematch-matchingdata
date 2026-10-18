# RE-MATCH — Sesi pengembangan

## Pekerjaan saat ini — 19 Oktober 2026

- Eksekusi final disetujui dan selesai pada release 7ed3f86: migrasi snapshot utama berhasil (InnoDB), lima workspace existing ready, guard sharing/review production aktif, layanan normal dan freeze dicabut. Histori 1.309 keputusan beserta digest, operasi, membership dan konfigurasi matching identik sebelum/sesudah; threshold tidak berubah. Snapshot masih kosong, siap untuk hasil baru; tidak backfill hasil historis.
- Smoke singkat: sesi Admin, membership, approval inbox dan review HTTP 200; dialog akses di Workspace/Matching, tombol Administrasi dan workflow tiga langkah tersedia; ekspor acuan XLSX job kecil berhasil. Tidak membuat keputusan atau anggota tes pada utama. Penulisan review/approval memakai bukti tes terisolasi terdahulu, tidak diulang. Writer matching/config legacy tetap tertutup. Bukti privat: backend/storage/app/private/final-snapshot-7ed3f86/completed.json. Catatan batas deployment di bawah mencatat kondisi sebelum izin final.

- Kelanjutan a290b9a: integrasi snapshot dibatch per halaman dan koneksi model; tidak memakai cache global lintas database/transaksi. Overlay generated menjaga acuan asli, checkpoint menolak dependensi hilang, batas dekompresi dan rollback skema dilindungi. Migrasi snapshot tetap hanya disiapkan, memakai InnoDB.
- Ambiguitas exact lebih dari satu acuan tetap Need Review meski top N = 1; memoization mengikuti status tersebut. Checkpoint klasifikasi baru memakai versi v4, hasil/checkpoint lama tidak dihapus.
- Evaluator CSV/XLSX offline maksimal 50 pasangan tersedia di backend/scripts/evaluate_manual_matching_sample.php. Parser mendukung namespace prefix dan header row yang didahului baris kosong tanpa elemen XML. Sampel aktual terbaca 50 pasangan/0 label; tidak ada klaim akurasi atau perubahan threshold.
- Prosedur eksekusi final terpadu ada di docs/DEPLOYMENT.md. Tidak ada akses database utama, perubahan flag, UAT besar, matching ulang atau benchmark pada kelanjutan ini.

- Pulihkan navigasi ke workflow tiga langkah dan tabel workspace lama; tambahkan pengelolaan akses tanpa mengganti layout utama.
- Tampilan review lama membaca state versioned ketika sharing aktif. Accept, status/filter, kandidat pilihan, bulk, dan Undo memakai versi dari snapshot yang dilihat pengguna. Writer legacy tetap tertutup.
- Tambahkan pilihan kolom pembanding per job/browser dan ekspor Excel berformat acuan asli Matched + audit seluruh input.
- Sampel lokal 50 pasangan sudah diambil read-only dari hasil tersimpan: 12 exact sistem, 14 fuzzy, 12 perlu cek salah cocok, 12 konflik referensi. Semua label petugas kosong. Jangan commit data sampel ke Git.
- Kandidat: pisahkan pool pencarian dari top N tersimpan, perluas pool yang belum meyakinkan, ganti penghentian global dengan batas atas WLS per kandidat, benahi cache kolom generated, dan tangani skor seri secara deterministik.
- Alamat: pertahankan kesetaraan JL/Jalan dan 14A/14 A, termasuk No14A. Nomor berbeda tetap konflik. Threshold global tidak dikalibrasi tanpa label nyata.
- Penyimpanan baru: migrasi additive snapshot acuan berdasarkan hash, input sekali pada kandidat utama, pembaca kompatibel format lama. Evidence lengkap dan skor tetap dipertahankan. Migrasi belum diterapkan pada database utama; tidak ada pemadatan/backfill historis.

## Verifikasi

- Kelanjutan: 18 tes kecil / 88 assertion lulus (snapshot/checkpoint/rollback, codec, evaluator, parser workbook); MySQL fixture 4 input lulus 25 assertion reader/Undo/filter/sort/ekspor, tabel snapshot InnoDB. Evaluator offline membaca sampel existing 50 pasangan, label tetap kosong. Tidak ada frontend yang diubah, sehingga build sebelumnya tidak diulang.

- Unit terarah: 14 tes / 73 assertion lulus; navigasi: 4 tes lulus; MySQL terisolasi: 25 assertion lulus. TypeScript dan production build client/SSR akhir lulus. Browser menunjukkan workspace tabel lama dan workflow tiga langkah; GET review job kecil terautentikasi menghasilkan HTTP 200, source review_states, versi aktual dan role admin. Tidak membuat keputusan pada database utama.
- Tidak menjalankan ulang matching utama, UAT besar, benchmark 300 ribu record, backup, atau restore.
- File Excel manual berada di outputs/manual-review-20261019/sampel-review-matching.xlsx. File ini bukan bukti akurasi sampai diisi petugas.

## Batas deployment

- Database utama, keputusan historis, dan feature flag tidak diubah pada pekerjaan ini.
- Terapkan migrasi snapshot hanya melalui prosedur deployment yang disetujui. Snapshot yang sudah direferensikan tidak boleh di-drop sembarangan.
- Ekspor historis memerlukan snapshot lengkap atau file acuan asli yang konsisten; kolom yang tidak tersimpan tidak boleh direka.
- Bukti UAT/cutover terdahulu tetap berada pada dokumentasi yang sudah ada. Jangan mengulang pengujian besar untuk melanjutkan pekerjaan ini.
