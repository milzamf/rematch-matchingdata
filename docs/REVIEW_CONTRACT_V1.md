# RE-MATCH review contract v1 — Tahap 1

Tanggal: 2026-10-13. Implementasi terbatas pada compatibility, atribusi aktor baru,
dan definisi statistik. Tidak membuat tabel, menjalankan migrasi, merekonstruksi
data historis, atau mengubah algoritma similarity.

## Status dan compatibility mapping

Status efektif adalah `ReviewItem.status`, berasal dari keputusan aktif terbaru
(`new_result_type`) atau hasil matching existing. Badge `display_status` menjelaskan
asal keputusan; bukan sumber klasifikasi filter atau jumlah status.

| Keputusan | Status efektif | Badge | Makna |
| --- | --- | --- | --- |
| Tanpa keputusan; engine matched | matched | auto_matched | Match dari engine |
| Tanpa keputusan; engine possible_match | possible_match | need_review | Masih perlu review |
| Tanpa keputusan; engine unmatched | unmatched | unmatched | Tidak menemukan match |
| accept_match | matched | manual_accepted | Reviewer menerima kandidat |
| select_candidate | matched | manual_accepted | Reviewer memilih kandidat, termasuk rank 2/3 |
| reject_match | possible_match | manual_rejected | Menolak kandidat; belum menyatakan input tidak punya pasangan |
| mark_unmatched | unmatched | confirmed_unmatched | Reviewer menyatakan input belum punya pasangan |

Undo memakai jalur existing: mengembalikan status sebelumnya dan menandai audit
`undone_at`. Tidak mengganti keputusan asal, key, atau skor. Aturan Undo konkuren
dan version checking belum diimplementasikan pada tahap ini.

Frontend mengutamakan status server, termasuk jika badge berbeda. Untuk payload
lama yang hanya memiliki badge, mapping mengikuti tabel di atas. Status asing
menghasilkan unknown, tidak otomatis dianggap unmatched. Status baru seperti
duplicate/reference_conflict tidak dikirim, tidak diterima sebagai aksi, dan tidak
disimpan pada Tahap 1.

Ekspor frontend mempertahankan kategori audit `rejected` bagi `manual_rejected`;
ini kategori aksi, bukan status input. Preset frontend `pending_review` existing
masih memakai kategori `pending` dan tidak mencakup `rejected`. Ekspor server
`pending_review` memakai status efektif possible_match sehingga mencakup penolakan
kandidat, tetapi label baris CSV tetap REJECTED sesuai aksi historis. Perbedaan
preset lama ini dinyatakan eksplisit dan tidak diubah diam-diam.
Ekspor master server tidak menjadikan reject_match sebagai NEW_ENTITY. Tidak ada
perubahan format ekspor atau histori lama.

## Key dan lineage

- Identitas input: pasangan `(matching_job_id, input_record_key)`. Key string opaque;
  `001` berbeda dari `1`. Jangan cast ke angka, trim, lowercase, rekey berdasarkan
  nomor baris file, atau menyimpulkan identitas perusahaan dari key.
- Identitas kandidat: ID MatchingResult; reference key berada dalam namespace dataset
  acuan job. Key acuan saja bukan ID global perusahaan.
- API keputusan existing tetap membatasi key 100 karakter, database existing 255;
  Tahap 1 tidak memperluas/mempersempit validasi atau mengganti kolasi database.
  Perbedaan case/trailing spaces pada MySQL belum dijamin oleh kontrak implementasi.
- `total_unique_input` adalah hasil deduplikasi penyimpanan kerja, bukan jumlah
  perusahaan unik yang sudah diverifikasi. Baris asal yang hilang dari representasi
  kerja tidak boleh dibuat ulang tanpa bukti.
- Jumlah preprocessing yang tercatat boleh dilaporkan, tetapi tidak membuktikan
  lineage. File hilang atau rekonstruksi tidak terbukti: lineage unverified, simpan
  identitas existing, jangan menciptakan source-row link. Tahap ini tidak membaca
  ulang file atau menjalankan backfill.
- Pengelompokan acuan satu perusahaan hanya berdasarkan verifikasi eksplisit pada
  tahap selanjutnya. Unique reference assignment dan unique entity-group assignment
  per job tetap rancangan berikutnya; tidak ditambahkan sekarang.

## Aktor

`decision.actors` juga tersedia pada histori. Tidak melakukan join user per baris.

| Field | Kontrak Tahap 1 |
| --- | --- |
| reviewer_user_id | Pengguna terautentikasi yang membuat keputusan; ditulis ke FK existing untuk keputusan baru |
| proposed_by_user_id | null; editor usulan belum diimplementasikan |
| approved_by_user_id | null; approval belum diimplementasikan |
| last_modified_by_user_id | Reviewer untuk audit aktif; aktor Undo dari metadata undone_by_user_id untuk audit yang dibatalkan |
| attribution | authenticated jika reviewer FK tersedia; unknown_legacy jika tidak |

Last modifier berlaku untuk audit keputusan ini, bukan klaim adanya review_states.
Undo tidak menimpa reviewer_user_id. Pada Undo historis tanpa metadata aktor, last
modifier tetap null. Label lama reviewer/local_frontend dipertahankan demi
kompatibilitas dan tidak digunakan sebagai identitas pengguna. FK null akibat
penghapusan pengguna juga berarti atribusi tidak lagi tersedia.

Kontrak rancangan approval berikutnya: reviewer sebelumnya, editor pengusul,
approver, dan last modifier harus terpisah. Approval tidak menjadikan approver
sebagai reviewer atau memberi editor hak revisi langsung atas state terlindungi.
Workspace Sharing dan aturan kewenangan baru belum diaktifkan.

## Statistik

Field summary lama tetap tersedia dengan fallback existing. Tambahan
`summary.accounting` tidak memakai fallback yang tidak dapat dibuktikan:

| Field | Definisi |
| --- | --- |
| source_row_count | total_raw_input yang tercatat; null bila tidak tercatat |
| unique_input_record_count | total_unique_input preprocessing yang tercatat; null bila tidak tercatat |
| deduplicated_input_row_count | total_duplicates preprocessing yang tercatat; null bila tidak tercatat |
| matched_input_record_count | Jumlah input berstatus efektif matched, termasuk penerimaan manual |
| verified_duplicate_entity_count | null; duplicate resolution bisnis belum tersedia |
| matched_entity_count | null; one-to-one dan identitas perusahaan terverifikasi belum tersedia |
| lineage_status | unverified; tidak mengklaim rekonstruksi sumber telah diverifikasi |

Matched + possible_match + unmatched menghitung input, bukan kandidat rank 1/2/3
dan bukan jumlah entitas perusahaan. Jumlah ini seluruh job, bukan halaman/filter.
`auto_matched` lama tetap count hasil dasar; dapat overlap dengan count aksi manual,
sehingga tidak boleh dijumlahkan untuk memperoleh matched. `reviewed` menghitung
input dengan keputusan aktif. `manual_rejected` menghitung aksi penolakan kandidat
dan tidak ditambahkan ke unmatched.

## Rekonsiliasi dan batas tahap

Kontrak ready untuk tahap berikutnya: state/key, atribusi yang tersedia, dan
penugasan aktif konsisten; konflik integritas migrasi ditahan secara eksplisit.
Need Review dan konflik kandidat bisnis biasa tidak memblokir seluruh workspace.
Lineage parsial tetap diberi tanda, tidak dibuat seolah lengkap. Ready/write gating,
CAS/versioning, idempotency, reference uniqueness, pencabutan membership, approval,
dan autosave versioning memerlukan persetujuan tahap selanjutnya. Implementasi
Tahap 1 tidak memberikan jaminan concurrency baru.

## Verifikasi

Regresi memakai SQLite `:memory:` dengan konfigurasi testing yang dipaksa di
Tests/TestCase.php, bukan MySQL lokal. Meliputi mapping, statistik tanpa bukti,
aktor legacy, reviewer/Undo berbeda, key 001/1, bulk safety, pemilihan rank 2,
pagination/filter kelompok dan ekspor. Frontend: Node test helper, TypeScript,
production build. Tidak menyimpan keputusan pada workspace pengguna.
