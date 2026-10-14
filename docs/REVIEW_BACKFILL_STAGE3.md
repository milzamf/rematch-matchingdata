# RE-MATCH — Tahap 3: rekonsiliasi dan backfill shadow state

Status 2026-10-13: implementasi dan pengujian terisolasi selesai. **Belum diterapkan
ke database utama dan belum merupakan izin cutover.** Persetujuan pengguna mencakup
scope dataset dan perubahan hold/schema dalam REVIEW_STAGE3_SCHEMA_REVIEW.md.

## 1. File dan batas implementasi

Ditambahkan:

- `backend/database/migrations/2026_10_13_000003_create_review_reconciliation_holds.php`
- `backend/app/Services/Matching/Reconciliation/HistoricalReviewResolver.php`
- `backend/app/Services/Matching/Reconciliation/ReviewStateBackfill.php`
- `backend/tests/Unit/HistoricalReviewResolverTest.php`
- `backend/scripts/test_review_backfill_mysql.php`
- `docs/REVIEW_STAGE3_SCHEMA_REVIEW.md` dan dokumen ini.

Diubah: runner MySQL Tahap 2 melewati migration Tahap 3 agar kontrak skema lama
tetap dapat diuji independen; DATABASE, SESSION, CHANGELOG, IMPLEMENTATION_STATUS.
Migration Tahap 2, API/UI, algoritma similarity, dan jalur review existing tidak diubah.
Tidak ada route, command produksi, queue dispatch, atau pembacaan review_states oleh UI.

Writer `apply` dan `rollback` ditolak kecuali database **rematch_stage3_test**, MySQL
(untuk apply), dan environment **REMATCH_BACKFILL_TEST=isolated-stage3**. Runner
memakai Capsule dengan koneksi localhost/database tetap; tidak memuat `.env` aplikasi.
Kode/backend/vendor dipasang read-only; sumber fixture/artifact berada di `/tmp`.
MySQL 8.0.46 berjalan di container sementara tanpa jaringan luar/volume utama,
data tmpfs 1 GiB, limit RAM 768 MiB, buffer pool 128 MiB; runner PHP limit 384 MiB.

## 2. Skema dan scope verifikasi

Kelompok entitas tetap **dataset-scoped**, assignment unik tetap **job-scoped**.
Dataset sama pada dua job memakai pengetahuan entitas yang sama, tetapi masing-masing
job boleh mempunyai satu assignment entitas tersebut. Verifikasi bukan hasil similarity
nama. Snapshot audit memasukkan membership, verifier, waktu, catatan dan versi grup;
perubahan membuat resume ditolak, bukan menerapkan membership baru diam-diam.

Migration baru membuat:

- `review_reconciliation_issues`: identitas job/input/reason, fingerprint bukti,
  status open/resolved dan aktor/waktu penyelesaian nullable; indeks inbox.
- `review_reference_holds`: reservasi netral key acuan atau grup terverifikasi,
  FK job/dataset dan group/dataset, fingerprint, status/aktor; generated active keys
  unik per job. CHECK mewajibkan resource dan status yang valid.

Generated assignment review_states aktif hanya untuk `matched AND consistent`.
Held match tetap menyimpan status/key historis jika dapat dibuktikan; tidak diterbitkan
sebagai assignment aktif. Matched tanpa key hanya boleh held. Status lain juga boleh
held; FK canonical Duplicate Input dan unique active assignment tetap berlaku.
Migration menolak konversi jika sudah ada held states tanpa rekonsiliasi; down menolak
jika ledger terisi atau held states masih ada. Tidak mengedit migration lama.

Unique lintas state dan ledger hold tidak dapat dijamin oleh constraint dua tabel.
Service concurrency berikutnya wajib memeriksa/lock resource hold dan assignment
dalam transaksi yang sama. Tahap 3 tidak mengklaim keamanan concurrent live writes.

## 3. Rekonstruksi lineage dan accounting

Audit memeriksa path di bawah source root, ukuran, SHA-256, format/header/sheet dan
jumlah baris. CSV/TSV/XLSX memakai parser existing, tanpa normalisasi similarity baru.
Fingerprint seluruh kolom memakai trim/lower pada string dan urutan key, sesuai
deduplikasi preprocessing. Hanya satu key historis dengan snapshot kolom lengkap
yang cocok yang dapat dipetakan; generated/internal fields dikeluarkan.
Lean snapshots atau dua key dengan fingerprint identik tidak ditebak/rekey.

SQLite menyimpan setiap ordinal baris yang benar-benar dibaca, fingerprint, key jika
terbukti dan confidence; payload sumber tidak digandakan. Baris sumber identik tetap
memiliki ordinal terpisah dan dapat menunjuk satu record komputasi. Tidak menciptakan
source rows ketika file hilang. Histori tanpa kandidat adalah issue, bukan input fiktif.

Hash hari ini tidak membuktikan kesamaan dengan sumber historis. `verified` memerlukan
attestation historis `source_sha256_at_match`, parser `rematch-stream-v1`, hash cocok
dan jumlah cocok. Kode ini **tidak menambahkan attestation pada data lama**. File
tanpa bukti tetap partial/unverified. Hash mismatch tidak dipetakan. Acuan tanpa bukti
sumber/ordinal valid membuat assignment held, tanpa menolak seluruh input aman.

Report membedakan total source historis (NULL jika belum terbukti), source yang diamati,
input komputasi unik, duplikasi preprocessing, business Duplicate Input terverifikasi,
safe matched assignments dan verified entity claims. Total entitas match tetap NULL
jika identitas sebagian acuan belum terverifikasi; jumlah assignment tidak disamakan
dengan jumlah perusahaan unik. Preprocessing duplicate tidak menghasilkan keputusan
bisnis. State Duplicate Input manual dengan reviewer teridentifikasi yang sudah ada
dipertahankan, tidak dibuat dari kesamaan nama atau kandidat.

## 4. Histori keputusan efektif dan aktor

Histori diurutkan timestamp dengan UUID sebagai penentu urutan laporan. UUID dan skor
tidak dijadikan bukti kausal/pemenang. Timestamp tie, beberapa keputusan aktif, beberapa
Undo yang hubungan kausalnya tidak terbukti, timestamp/status/identitas invalid,
snapshot berbeda, atau limit histori menghasilkan issue dan hold.

Satu keputusan aktif hanya diproyeksikan bila cocok dengan kandidat/status/acuan
tersimpan. Accept/select -> matched; reject_match -> possible_match;
mark_unmatched -> unmatched. Single Undo harus terbukti telah memulihkan snapshot
previous_result_type; keputusan yang dibatalkan tidak diaplikasikan ulang.
Snapshot reviewed tanpa histori tidak diasumsikan sebagai Auto Match.

Reviewer NULL tetap NULL; label frontend tidak menjadi user ID. Aktor Undo masuk
last_modified_by, bukan mengganti reviewer lama. Proposer/approver tidak dikarang.
Kolom aktor/version/approval Tahap 2 ikut diaudit; histori yang telah memakai workflow
versioned ditahan untuk rekonsiliasi, tanpa ditafsirkan ulang sebagai legacy atau
dicampur dengan sumber status baru.
Proyeksi histori dan fingerprint tersimpan di artifact untuk audit; metadata yang
melewati admission limit ditandai, bukan dipercaya sebagai bukti lengkap. Payload
original tetap di tabel lama yang tidak ditulis oleh backfill.

## 5. Deteksi konflik dan laporan rekonsiliasi

Semua matched claims diperiksa, termasuk auto dan manual. SQLite mengelompokkan key
acuan dan grup terverifikasi sebelum insert. Seluruh claimant pada collision ditahan.
Untuk histori ambigu, semua klaim matched yang mungkin dicadangkan, tanpa memilih
kandidat dengan skor tertinggi. Antrean berbasis disk mempropagasi hold ke klaim yang
terhubung, lalu satu reservasi netral dibuat per resource.

Artifact memisahkan `plans`, `issues`, `claims`, `holds`, source lineage dan events.
Report berisi jumlah issue per alasan; tabel issues menyediakan key per-input untuk
ditinjau Owner/Admin dan fingerprint menghubungkan bukti artifact. Tidak ada UI
rekonsiliasi atau keputusan penyelesaian otomatis pada tahap ini. Bukti yang meragukan
tetap ditahan sampai diputuskan secara eksplisit pada tahap selanjutnya.

## 6. Chunk, checkpoint, retry dan rollback

`prepare(job, artifact, root, chunk)` melakukan dry-run, bukan backfill DB. Snapshot
dibaca dengan keyset ID/rank; digest awal/akhir harus sama. Rencana hanya menjadi
`planned` setelah audit lengkap; kegagalan prepare membatalkan transaksi sidecar dan
prepare dapat diulang. Capture awal belum mempunyai checkpoint per sumber CSV/XLSX;
retry mengulang capture. Tidak ada OFFSET atau pemuatan seluruh dataset ke array.

`apply` memakai chunk 1–256 (default 64), ID state/issue/hold deterministik, transaksi
singkat per chunk/reservasi, serta checkpoint `next_seq` sesudah commit. Kegagalan
sesudah MySQL commit sebelum checkpoint di-replay sebagai insert-identical. Perbedaan
state yang sudah ada ditolak, tidak ditimpa. Snapshot/file dicek sebelum dan setelah
backfill; perubahan grup, histori, kandidat atau file memerlukan audit baru.

Rollback hanya menghapus shadow rows milik run, mempertahankan semua ID preexisting.
Preflight menolak state versi berubah/operation terisi atau bukti hold yang sudah
diselesaikan. FK tetap aktif. Cleanup dalam transaksi kecil, dapat diulang setelah
gangguan, lalu mengembalikan readiness awal; tidak menghapus histori/results/source.
Sidecar dan WAL harus dipertahankan sebagai unit audit/checkpoint, bukan diedit manual.

## 7. Hasil pengujian

| Pengujian | Hasil |
| --- | --- |
| MySQL 8.0.46/InnoDB Tahap 3 | 55 assertions lulus |
| MySQL skema Tahap 2 independen | 94 assertions lulus |
| Backend contract/history/review/export, SQLite :memory: | 30 tests / 217 assertions lulus |
| Frontend contract Node | 3 tests lulus |
| PHP formatting | Pint pada file Tahap 3 lulus |

Fixture meliputi normal auto/manual match, multiple active decisions, Undo, source
preprocessing duplicate, verified business duplicate, record/entity collisions,
partial/missing source, key `001`/`1`, NULL reviewer, idempotence, chunk pause dan
crash sesudah commit. Tambahan: stale source/verification ditolak, unknown entity
counts tidak dikarang, rollback state terpakai ditolak sebelum delete, unique/CHECK
tetap berlaku, schema down/reapply, legacy table snapshot tidak berubah, dan grup
dataset dapat dipakai job lain. Semua tulisan berada di DB disposable.

Uji 2.000 input: **6,030 detik**, peak alokasi PHP **12 MiB**, SQLite main artifact
**2,63 MiB** (tidak termasuk WAL/RSS/MySQL). Total runner sekitar 11,868 detik.
Ini fixture kecil satu kandidat/input; bukan benchmark 133k/306k atau matching penuh.
Frontend/API tidak berubah sehingga build/UI browser tidak diulang pada milestone ini.

## 8. Memori/performa dan risiko tersisa

Cache SQLite 8 MiB; buffer DB chunk 64; histori maksimal 2.000 event/input,
metadata event 32 KiB, input snapshot 256 KiB, admission candidate total 8 MiB/input
dan maksimal 1.000 kandidat/input. Limit menyebabkan issue/refusal yang eksplisit,
tidak menghilangkan histori. XLSX sharedStrings >8 MiB tidak direkonstruksi sebagai
verified karena parser existing memuat sharedStrings ke RAM; XLS belum didukung.
Ukuran satu row CSV ekstrem belum diuji; parser tetap membaca per record.

Performa tumbuh dengan jumlah kandidat/histori/source dan beberapa full digest scan,
serta query validasi per input. Disk sidecar tumbuh O(data audit), RAM tidak menyimpan
seluruh job. Belum ada benchmark ratusan ribu input, budget disk/RSS aktual, atau
uji konkurensi live. Tidak menjanjikan durasi dari fixture ini.

Legacy attestation/kolom lineage sering tidak tersedia; kelengkapan lineage tidak
boleh diklaim. Histori kompleks sengaja konservatif, membutuhkan rekonsiliasi manual.
Existing shadow state yang berbeda ditolak; tidak ada resolver otomatis. MySQL DDL
implicit commit: kegagalan deployment schema membutuhkan inspeksi sebelum retry.

## 9. Kesiapan dan syarat cutover berikutnya

Validasi test menetapkan ready hanya setelah semua input terbukti mendapat shadow
state/preserved resolution atau issue orphan yang eksplisit, tidak ada assignment
aktif ganda/overlap hold, FK/lineage konsisten sesuai tingkat bukti, dan snapshot stabil.
Need Review biasa tidak memblokir ready. Issue integritas lokal boleh tetap ada bila
seluruh input/resource terdampak ditahan; input lain aman. Snapshot berubah atau
gagal validasi menahan publikasi; tidak melakukan pemilihan pemenang.

**Ready shadow bukan aktivasi fitur/cutover dan belum cukup menjamin live writes.**
Sebelum cutover produksi diperlukan persetujuan terpisah, backup/rollout schema,
audit data nyata, run manifest terkendali, jendela sumber stabil atau fencing,
concurrency service/version/idempotency/resource locks, izin aktor/revocation dan
bulk/Undo/approval/autosave regression. Sumber status tidak boleh dicampur.

## 10. Database utama dan berhenti

Pemeriksaan SELECT-only pada database `rematch`: migration `2026_10_13%` **0**;
tabel review_states/review_reference_holds/review_reconciliation_issues **0**.
Tidak ada migration/backfill/status ready pada database utama. Container pengujian
sementara dibersihkan setelah selesai. Berhenti Tahap 3; sharing, approval,
concurrency service dan cutover tetap menunggu persetujuan berikutnya.
