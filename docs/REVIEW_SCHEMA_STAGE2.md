# RE-MATCH — Tahap 2: schema additive

Tanggal: 2026-10-13. Kontrak dasar: [REVIEW_CONTRACT_V1.md](REVIEW_CONTRACT_V1.md).
Hanya struktur database dan pengujian; tidak ada cutover, backfill, fitur sharing,
approval, concurrency service, perubahan API/UI, atau perubahan similarity.

## File implementasi

- `backend/database/migrations/2026_10_13_000001_create_review_foundation_tables.php`
- `backend/database/migrations/2026_10_13_000002_add_review_audit_contract_columns.php`
- `backend/scripts/test_review_schema_mysql.php`

Tidak mengubah migration lama, model, service, controller, routes, atau frontend.

## Audit schema existing

Pemeriksaan read-only database utama: ID dataset/job/result/workspace adalah
CHAR(36) utf8mb4_unicode_ci; users.id adalah BIGINT UNSIGNED. Key existing adalah
VARCHAR(255) utf8mb4_unicode_ci. reviewer_user_id existing sudah nullable.
Migration Tahap 2 pada database utama belum diterapkan (0 migration rows).

UUID/FK baru memakai tipe yang kompatibel dengan parent existing. Record key baru
tetap VARCHAR(255), menggunakan utf8mb4_0900_bin (case-sensitive, NO PAD); tidak
mengubah kolasi atau identitas key lama. API existing tetap maksimum 100 karakter.
Migration MySQL mensyaratkan versi minimal 8.0.22, engine InnoDB. SQLite hanya
jalur regresi kompatibilitas, bukan bukti enforcement MySQL CHECK.

## Struktur baru

| Tabel | Struktur dan tujuan |
| --- | --- |
| review_states | Satu baris per job/input key; version; status; selected candidate/ref/entity; duplicate canonical; empat aktor terpisah; decision protection; integrity hold; lineage/count nullable; last operation |
| review_operations | Operation UUID, job, actor, idempotency key, request hash, status, response_summary kecil, timestamps microsecond |
| review_change_requests | State/job/dataset, expected version, proposal version, before/proposed scalar status/key, previous reviewer, proposer/approver/modifier, reason, resolution, applied operation |
| workspace_members | Workspace/user unik, viewer/editor, active/revoked, version, granting/revoking actors, revoked timestamp |
| reference_entity_groups | Entitas dalam satu dataset acuan, verification actor/time/note wajib, version |
| reference_entity_members | Anggota acuan yang diverifikasi, satu group per dataset/key, verification actor/time |

Semua tabel memakai UUID PK. Tidak menyalin JSON record, scores, dataset, atau
seluruh histori. `response_summary` hanya untuk acknowledgement ringkas; ukuran
dan isinya akan dibatasi di service pada tahap berikutnya.

Owner tetap `workspaces.user_id`. Membership tidak mempunyai role owner agar
tidak menciptakan dua sumber ownership. Membership kosong, tidak memberi akses.
Kelompok acuan tidak dibuat otomatis berdasarkan nama atau similarity.

## Kolom additive existing

| Tabel | Penambahan |
| --- | --- |
| workspaces | configuration_version UNSIGNED BIGINT default 1 |
| matching_jobs | review_state_readiness default pending; review_state_schema_version default 0; unique (id, reference_dataset_id) untuk composite FK |
| review_decisions | review_state_id, review_operation_id, change_request_id; state_version_before/after; proposed_by_user_id, approved_by_user_id, last_modified_by_user_id — semuanya nullable |

Tidak melakukan UPDATE/INSERT histori. FK reviewer existing dan metadata Undo
Tahap 1 dipertahankan. Job.status existing tidak berubah. Pending readiness
merupakan status persiapan schema, bukan status Need Review pengguna, dan belum
dipakai untuk menahan write existing.

## Constraint dan indeks

- Unique `(job, input_record_key)` pada state; string 001 dan 1 tidak digabung.
- Generated STORED `active_reference_record_key` dan `active_reference_entity_group_id`:
  selected value jika matched atau integrity held, selain itu NULL. Unique per job
  mencegah dua klaim aktif; NULL memungkinkan banyak state yang belum matched.
- Composite FK job/dataset memastikan namespace acuan state benar. Composite FK
  dataset/group/key memastikan selected group benar-benar memiliki key tersebut.
- Hold hanya untuk konflik integritas, bukan konflik kandidat bisnis biasa. Held
  selected ref tetap mencadangkan assignment; tidak mengubah hasil historis.
- Duplicate Input harus mempunyai canonical key, tidak boleh punya selected ref/
  group. CHECK melarang self-link. Generated canonical/target guard + self composite
  FK hanya mengizinkan target non-duplicate pada job yang sama. Rantai/siklus tidak
  dapat terbentuk; canonical yang masih dirujuk tidak bisa diubah menjadi duplicate.
- Unique `(job, actor, idempotency_key)` untuk operation; tidak mengaktifkan retry
  logic. Service berikutnya harus membandingkan request hash, permission, dan hasil.
- Satu pending request per state melalui generated nullable pending_guard. Request
  terminal dipertahankan; proposal baru boleh dibuat setelah proposal lama terminal.
- Version positif; audit versioned harus mempunyai state/operation serta after =
  before + 1. Unique `(review_state_id, state_version_after)` mencegah audit ganda.
- FK state/request/operation/audit mencocokkan job. Actor FK tidak saling menimpa.
- Indeks state job/status/key, inbox job/status/time, proposer/status/time,
  membership user/status/workspace, verified members dataset/key, serta idempotency.
- RESTRICT pada referensi audit/state/entity menjaga konteks. Membership memakai
  CASCADE workspace/user, dan grant/revoke actor nullable SET NULL. Tidak menonaktifkan
  foreign_key_checks saat migrasi/rollback.

## Batas jaminan Tahap 2

Constraint hanya melindungi tabel baru ketika nanti diisi. Aplikasi masih sepenuhnya
membaca/menulis hasil dan keputusan dari alur lama. Belum ada jaminan one-to-one
menyeluruh untuk job historis maupun runtime existing.

FK membership memvalidasi group **bila group diberikan**. Karena selected group
nullable untuk acuan yang belum dikelompokkan, service berikutnya wajib mencari
keanggotaan terverifikasi dan mengisi group pada setiap assignment. Omission group
belum dicegah otomatis oleh database; menambah/verifikasi membership ketika ada
assignment juga harus direkonsiliasi dalam tahap berikutnya. Tidak ada trigger
yang secara diam-diam melakukan entity resolution.

Selected matching_result_id memiliki FK existence; kesesuaian kandidat dengan
input/job perlu diperiksa service nanti. Audit nullable state link memvalidasi job,
tetapi tidak mengubah kolasi key audit lama; equality key/state harus divalidasi
secara string pada backfill/write berikutnya. Tidak menambah index besar pada
matching_results hanya untuk mengikat kandidat, demi scope additive minimal.

Version adalah tempat penyimpanan, bukan implementasi CAS. Pending proposals
tidak mengubah state otomatis. Approval privilege, protected revisions, revoke
permission, append-only enforcement, bulk/Undo version checks, autosave versioning,
dan ready/cutover memerlukan implementasi berikutnya yang belum disetujui.

## Rollback dan rollout

Urutan rollback: migration audit dahulu, kemudian foundation. Guard menolak jika
kolom audit baru berisi data, tabel baru tidak kosong, atau version/readiness telah
digunakan. Foundation juga menolak rollback sebelum dependensi audit dilepas.
Tidak memaksa drop populated tables. Rollback setelah fitur aktif memerlukan
arsip/rekonsiliasi dan persetujuan tersendiri.

MySQL DDL tidak menjadi satu transaksi untuk seluruh dua migration. Rollout utama
nanti perlu backup/schema snapshot, verifikasi engine/collation, jendela metadata
lock, dan strategi pemulihan partial DDL. Belum mengukur ALTER pada dataset besar.
Migrasi utama, historical backfill, maupun cutover **belum dijalankan**.

## Pengujian terisolasi

Runner mandiri memakai Capsule; tidak boot Laravel atau membaca .env/config DB
aplikasi. Host fixed localhost, DB fixed rematch_stage2_test, wajib flag
REMATCH_SCHEMA_TEST=isolated-stage2 dan database kosong sebelum memulai.

Container MySQL menggunakan image mysql:8.0 yang sudah tersedia, --network none,
tanpa host port/volume produksi, /var/lib/mysql tmpfs 1 GiB, RAM 768 MiB, buffer
128 MiB. Container PHP berbagi namespace network container test, source/vendor
read-only, RAM 384 MiB. Setelah uji, container test dihapus; tidak meninggalkan
volume database. Tidak melakukan restart container utama.

Runner menjalankan migration existing pada DB kosong, memasukkan fixture lama,
lalu menjalankan up Tahap 2, constraint writes, rollback guard, down dalam urutan
dependensi setelah fixture baru dibersihkan, dan reapply. Snapshot data/kolom/indeks
lama dibandingkan; tidak memakai dataset pengguna.

Perintah runner (hanya setelah membuat container terisolasi):

```powershell
docker run --detach --name rematch-stage2-mysql --network none --memory 768m --cpus 2 --tmpfs /var/lib/mysql:rw,size=1073741824 --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=rematch_stage2_test mysql:8.0 --innodb-buffer-pool-size=134217728 --skip-log-bin
docker exec rematch-stage2-mysql mysqladmin ping --silent
docker run --rm --network container:rematch-stage2-mysql --memory 384m --cpus 2 --mount 'type=bind,source=D:/Ilzam/Code/Codex/Latsar/batchmatch/backend,target=/var/www/html,readonly' --mount 'type=volume,source=rematch_backend_vendor,target=/var/www/html/vendor,readonly' --env REMATCH_SCHEMA_TEST=isolated-stage2 --workdir /var/www/html --entrypoint php batchmatch-backend scripts/test_review_schema_mysql.php
docker rm --force rematch-stage2-mysql
```

Tunggu ping berhasil sebelum runner. Name harus baru; jangan memakai server
existing atau menjalankan runner terhadap DB yang sudah berisi data.

Hasil final: **94 assertions lulus pada MySQL 8.0.46 / InnoDB**. Up dari schema
existing, unique reference/entity assignment, key 001/1/case/trailing space,
FK cross-job/dataset, positive versions, Duplicate Input star, pending proposal,
idempotency namespace, guard rollback, pemulihan data/kolom/indeks existing dan
reapply tanpa backfill semuanya lulus. Snapshot hanya membuktikan preservasi
fixture terisolasi, bukan benchmark dataset pengguna atau transaksi concurrency.

Tahap 1: **19 backend tests / 189 assertions lulus**, **3 frontend contract tests
lulus**. Tidak ada perubahan frontend sehingga build/TypeScript tidak diulang
pada tahap schema ini. Tidak ada migrasi pada database utama.

Regresi Tahap 1: `php artisan test --filter='ReviewContractTest|ReviewResultsTest|MatchingExport'`
dengan Tests/TestCase memaksa SQLite :memory:, serta
`node --test scripts/review-contract.test.mjs`. Tidak ada frontend edit.

Referensi MySQL: [generated columns dan batas FK](https://dev.mysql.com/doc/refman/8.0/en/create-table-generated-columns.html),
[collation utf8mb4_0900_bin / NO PAD](https://dev.mysql.com/doc/refman/8.0/en/charset-mysql.html).
