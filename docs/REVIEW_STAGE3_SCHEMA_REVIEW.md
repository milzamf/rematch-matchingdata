# Tahap 3 — validasi schema dan perubahan yang memerlukan persetujuan

2026-10-13. Usulan ini disetujui pengguna: **“Setujui usulan skema dan scope dataset.”**
Implementasi/pengujian hanya pada MySQL terisolasi selesai; database utama tidak diubah.
Laporan final: [REVIEW_BACKFILL_STAGE3.md](REVIEW_BACKFILL_STAGE3.md).

## Scope kelompok entitas acuan

Tahap 2 memakai `reference_entity_groups.reference_dataset_id`, bukan job_id.
Ini berbeda dari usulan job-scoped sebelumnya. Identitas record acuan memang
berada dalam namespace dataset, sehingga dataset-scoped dapat digunakan apabila
verifikasi perusahaan dimaksudkan sebagai pengetahuan bersama tentang dataset
yang sama. Unique assignment di review_states tetap per matching_job_id.

Konsekuensi: group terverifikasi akan dipakai setiap job/workspace yang menggunakan
dataset tersebut. Acuan sama boleh diklaim satu input pada masing-masing job;
bukan satu klaim global lintas job. Verifikasi group harus dilakukan oleh aktor
berwenang pada dataset, bukan otomatis oleh setiap editor workspace. Perubahan
membership tidak boleh diam-diam mengubah state job yang telah di-backfill.
Audit/backfill perlu snapshot version/fingerprint membership dan menolak resume
yang snapshot-nya berubah. Dataset-scoped tidak memperluas hak akses workspace.

Alternatif job-scoped memerlukan perubahan PK/FK/unique/membership dan verifikasi
terpisah per job. Rekomendasi: pertahankan scope dataset dengan kebijakan snapshot
di atas, tetapi konfirmasikan karena ruang berlaku verifikasi berbeda dari draft lama.

## Gap integrity hold — memerlukan schema tambahan

Generated assignment Tahap 2 mengaktifkan unique key ketika status matched **atau
integrity_status held**. Dua input yang sama-sama harus ditahan karena mengklaim
acuan yang sama tidak dapat disimpan: kedua hold tetap bertabrakan pada unique key.

Menyimpan hanya salah satunya berarti memilih pemenang. Mengosongkan acuan atau
mengubah matched menjadi unmatched menghilangkan makna keputusan historis.
Melepas seluruh klaim tanpa reservasi juga membuat acuan konflik dapat dipakai
record lain. Ketiganya bertentangan dengan persyaratan Tahap 3.

Usulan satu migration baru, tanpa mengedit migration Tahap 2 atau mengubah data:

1. `review_reconciliation_issues`: UUID PK; job FK; input key string/binary;
   reason_code; evidence/checkpoint fingerprint; status open/resolved; waktu dan
   resolving actor nullable. Unique job/input/reason untuk idempotent issue.
   Evidence merujuk artifact audit, bukan menyalin dataset atau seluruh histori.
2. `review_reference_holds`: UUID PK; job/dataset FK; reference key nullable;
   verified entity group nullable; reason/status; snapshot fingerprint. Minimal
   satu resource harus diisi. Generated active keys + unique per job menjadikan
   satu reservasi netral untuk setiap resource konflik, tanpa memilih input owner.
   Satu hold group dapat terpisah dari hold record-key para anggotanya.
3. Ubah generated active keys pada review_states menjadi aktif hanya jika
   `status = matched AND integrity_status = consistent`. Held states menyimpan
   selected key/status historis, tetapi tidak mempublikasikan assignment aktif.
4. Longgarkan CHECK integrity untuk menahan status lain yang integritasnya tidak
   pasti. Matched tanpa key hanya boleh berupa held, dengan issue missing-assignment;
   matched consistent tetap wajib mempunyai key. Canonical/duplicate FK tetap berlaku.

Hold per-record disimpan pada review_states + issue; reservasi per-resource ada
di ledger hold. Future write service wajib memeriksa/lock ledger hold dalam
transaksi selain unique state assignment. Unique lintas dua tabel tidak otomatis
memberi jaminan concurrency; implementasi itu tetap tahap berikutnya.

Backfill Tahap 3 harus merencanakan semua collision terlebih dahulu, menahan
seluruh input terdampak, membuat reservasi netral, lalu memasukkan state aman dan
held. Tidak membuat input fiktif sebagai pemilik acuan. Histori lama tidak berubah.
Ordinary Need Review/reference candidate conflict tidak memblokir input aman.

## Lineage — batas bukti existing

DatasetInspectionService tidak menyimpan checksum input historis. Engine juga
menyimpan lean input snapshot sehingga sebagian kolom sumber bisa tidak tersimpan.
Daftar duplicate_details hanya maksimum 100 kelompok dan bukan lineage lengkap.

Engine streaming menggabungkan baris berdasarkan seluruh kolom dengan trim/lower
untuk string, lalu memberi key pada urutan record komputasi unik, bukan nomor
baris sumber. Draft lama memakai hash MD5 atas normalisasi serupa. Tidak boleh
mengubah key historis menjadi nomor baris file atau membuat key 001 menjadi 1.

Lineage akan disimpan dalam artifact SQLite per-run: file hash/metadata parser,
source ordinal, fingerprint, computation key jika terbukti, tingkat bukti dan
alasan ketidakpastian. Tidak menyalin seluruh payload source. File tidak tersedia:
tidak menciptakan source rows; status unverified. Hash file yang dihitung hari ini
tidak membuktikan file sama dengan saat matching. Snapshot lean atau format/versi
parser yang tidak terbukti hanya menghasilkan partial/unmapped, bukan verified.
Preprocessing duplicate tidak menghasilkan keputusan bisnis Duplicate Input.

## Persetujuan yang telah diberikan

Pengguna menyetujui group dataset-scoped dengan verifikasi/snapshot bersama,
migration issue/hold serta perubahan generated assignment/CHECK di atas. Batas izin
tetap MySQL terisolasi; bukan izin migrasi/backfill database utama atau cutover.

## Pekerjaan independen yang sudah disiapkan

`HistoricalReviewResolver.php` adalah proposal rekonstruksi read-only per input,
tidak dipanggil API existing dan tidak menulis DB. Identitas job/key diperiksa
secara string, timestamp diurutkan deterministik, tetapi tie/lebih dari satu
keputusan aktif tidak diputuskan dengan UUID atau similarity. Single active
decision harus cocok dengan kandidat tersimpan; single Undo harus terbukti sudah
memulihkan snapshot. Histori complex/invalid menghasilkan issue, bukan keputusan.
Reviewer NULL tetap NULL. Penanganan kompleks sengaja konservatif dan belum
merupakan resolver final untuk seluruh variasi histori.

Verifikasi final: Tahap 3 MySQL 8.0.46/InnoDB 55 assertions, regresi skema Tahap 2
94 assertions, backend 30 tests / 217 assertions dan frontend contract 3 tests lulus.
Lineage artifact, backfill/neutral holds dan ready validation hanya diuji disposable.
Benchmark fixture 2.000 input: 6,030 detik, peak PHP 12 MiB; belum benchmark 300k.
Tidak ada concurrency service, approval/sharing atau cutover yang diaktifkan.
