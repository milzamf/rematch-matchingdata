# RE-MATCH

Aplikasi pencocokan data perusahaan dari Excel/CSV ke dataset acuan, dengan review manual dan ekspor hasil.

## Alur penggunaan

1. **Persiapan Data** — unggah acuan dan input, periksa profil data, lalu pasangkan kolom.
2. **Aturan Pencocokan** — pilih konfigurasi dan bobot, kemudian jalankan matching.
3. **Review & Hasil** — periksa kelompok kasus atau semua record, ambil keputusan, lalu ekspor.

Workspace menyimpan progres. Fitur berbagi menambahkan akses Editor/Viewer pada alur tersebut; tampilan tiga langkah tetap dipertahankan.

## Fitur

- Normalisasi nama, badan usaha, alamat, serta kode provinsi/kabupaten/kota melalui MFD.
- Strict Exact Pass dan pencarian kandidat Meilisearch, dilanjutkan similarity per kolom, WLS, serta verifikasi konflik.
- Kelompok kasus, pencarian, filter wilayah/skor, dan sorting similarity.
- Pilihan kolom pembanding per job. Default: nama perusahaan, badan usaha, alamat, dan kabupaten/kota. Semua kolom default dapat disembunyikan.
- Keputusan versioned, one-to-one assignment, Undo per operasi, usulan revisi, dan approval Owner/Admin.
- Ekspor CSV dan Excel. **Format data acuan + audit matching** menghasilkan dua sheet:
  - `Data Acuan`: hanya pasangan efektif Matched, dengan nama/urutan kolom dan nilai asli acuan. Tidak melakukan enrichment.
  - `Audit Matching`: seluruh input beserta status, keputusan, key acuan, versi, WLS, dan similarity per pasangan kolom.

Skor similarity bukan probabilitas bahwa dua perusahaan pasti sama. Akurasi nyata belum dapat dinyatakan sebelum sampel diverifikasi petugas.

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Frontend | React 19, TypeScript, TanStack Start/Router/Query, Vite 8, Tailwind CSS |
| Backend | PHP 8.3+, Laravel 13, Sanctum |
| Database | MySQL 8 / InnoDB |
| Pencarian | Meilisearch |
| Penyimpanan kerja | SQLite untuk spill/cache/checkpoint, file sumber di storage backend |
| Eksekusi | Docker Compose, queue worker |

## Menjalankan pengembangan lokal

Prasyarat: Docker Desktop/Compose dan Node.js yang kompatibel dengan dependency proyek. Untuk pengembangan tanpa container backend, diperlukan PHP 8.3+, Composer, MySQL, serta ekstensi PHP yang digunakan proyek.

```sh
npm ci
```

Gunakan `.env.example` dan `backend/.env.example` sebagai referensi konfigurasi. Atur kredensial lokal sendiri; jangan commit `.env`, dump database, backup, atau token.

```sh
docker compose up -d --build
```

Alamat bawaan:

- Aplikasi: http://localhost:8090
- API backend: http://localhost:8000/api

Untuk frontend lokal di luar container:

```sh
# Atur VITE_API_PROXY_TARGET=http://localhost:8000 pada lingkungan lokal.
npm run dev
```

Jangan menjalankan migrasi/backfill pada database berisi data pengguna sebagai bagian dari setup otomatis. Deployment Workspace Sharing menggunakan guard, readiness, drain writer, dan bukti recovery yang dijelaskan pada dokumentasi cutover.

## Review dan keamanan data

Ketika sharing aktif, tampilan review menggunakan `review_states` sebagai satu-satunya sumber keputusan efektif. `review_decisions` tetap menjadi histori append-only. Penulisan memakai versi yang ditampilkan kepada pengguna, pemeriksaan akses, dan constraint assignment acuan. Konflik tidak di-retry otomatis.

Operasi kolektif versioned dibatasi **50 record per operasi**, sesuai kontrak concurrency service. Undo memulihkan satu operasi lengkap dan menolak operasi yang sudah ditimpa keputusan baru. Keputusan reviewer lain menggunakan usulan revisi.

Ketika flag nonaktif, jalur legacy tetap tersedia sesuai konfigurasi deployment. Jangan mencampur writer legacy dan versioned, melewati integrity hold, atau mengaktifkan sharing untuk job yang belum ready.

## Efisiensi matching dan penyimpanan

- Jumlah kandidat yang dicari terpisah dari jumlah kandidat yang disimpan. Pool awal dibatasi; pencarian diperluas untuk hasil yang belum meyakinkan dan terpotong oleh limit.
- Pruning hanya boleh mengabaikan satu kandidat jika batas atas WLS membuktikan kandidat tersebut tidak dapat masuk top N. Skor kandidat awal tidak menghentikan seluruh pencarian.
- Cache memasukkan nilai normalisasi dan identitas hasil ekstraksi, sehingga nama berbeda tidak memakai cache kosong yang sama.
- Migrasi additive `2026_10_19_000001_create_matching_record_snapshots.php` menyediakan snapshot acuan berbasis hash. Setelah tersedia, hasil baru menyimpan acuan sekali dan input pada kandidat utama. Pembaca tetap mendukung format lama.
- Migrasi ini tidak memadatkan hasil historis secara otomatis. Angka penghematan produksi dan waktu matching penuh harus diukur tersendiri; tidak dijamin oleh fixture kecil.
- Kolom historis yang tidak tersimpan ditandai pada review. Ekspor acuan memeriksa file sumber jika snapshot lama tidak lengkap, dan menolak ekspor bila baris asli tidak dapat dibuktikan.

## Pemeriksaan terarah

```sh
node scripts/test-workflow-route.mjs
npx tsc --noEmit
npm run build

docker exec rematch-backend php artisan test --compact --filter='MatchingCandidateRecallTest|AddressNormalizationTest|MatchingPayloadCodecTest|ReviewContractTest|TabularWorkbookTest'
```

Tes unit di atas menggunakan konfigurasi `backend/phpunit.xml` dengan SQLite memory. `backend/scripts/test_review_refresh_mysql.php` hanya menerima host/database fixture yang telah ditentukan dan menguji integrasi pada MySQL terisolasi. Jangan mengarahkannya ke database utama.

`backend/scripts/prepare_manual_matching_sample.php` menyediakan ekstraksi read-only maksimal 50 pasangan dari job ready. Label petugas selalu kosong. File sampel dan data hasil ekstraksi disimpan lokal, tidak dipublikasikan ke Git.

## Dokumentasi

- [Kontrak review](docs/REVIEW_CONTRACT_V1.md)
- [Skema review](docs/REVIEW_SCHEMA_STAGE2.md)
- [Sesi pengembangan terakhir](docs/SESSION.md)
- [Status implementasi](docs/IMPLEMENTATION_STATUS.md)
- [Catatan perubahan](docs/CHANGELOG.md)

Repository terhubung dengan Lovable. Hindari force push atau menulis ulang histori commit yang sudah dipublikasikan.
