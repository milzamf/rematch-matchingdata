# Tahap 5C — Shared workspace reader dan versioned review API

Tanggal: 2026-10-13. Implementasi backend selesai dan diuji di lingkungan terisolasi. **Belum diaktifkan pada aplikasi utama; belum dihubungkan ke frontend.**

## 1. File dan ruang lingkup

Ditambahkan:

- `backend/app/Services/Workspace/SharedWorkspaceReader.php`: metadata, state efektif, kandidat, dan pratinjau dataset yang terotorisasi.
- `backend/app/Http/Controllers/Api/SharedWorkspaceReadController.php`: empat GET dan batas ukuran JSON.
- `backend/app/Http/Requests/SharedWorkspaceReadRequest.php`: validasi parameter, identitas string, pagination, filter, dan penolakan parameter aktor.
- `backend/tests/Feature/SharedWorkspaceReaderBoundaryTest.php`: autentikasi, guard, serta batas pagination/parameter.
- `backend/scripts/test_shared_reader_mysql.php`: fixture dan integrasi MySQL, termasuk writer/approval/Undo serta benchmark 300.000 state.
- `backend/scripts/test_shared_reader_edges_mysql.php`: pemeriksaan tambahan metadata, klaim kelompok entitas, hold, pointer kandidat invalid, dan benchmark sortir.
- `docs/REVIEW_STAGE5C_BENCHMARK.json` dan `docs/REVIEW_STAGE5C_EDGE_BENCHMARK.json`: hasil pengukuran aktual.

Diubah: `backend/routes/workspace_access.php` menambahkan GET di grup guard existing; `WorkspaceAccessService.php` menambahkan `owner_name` dan `access_role` pada katalog workspace terisolasi tanpa menghilangkan field lama. Dokumentasi API, arsitektur, changelog, status, dan sesi diperbarui.

Tidak mengubah reader legacy yang digunakan aplikasi utama, tabel/migrasi, histori, similarity, frontend binding, atau flag. Working tree sudah memiliki perubahan Tahap 1–5B dan pekerjaan terdahulu; perubahan tersebut dipertahankan, bukan diklaim sebagai perubahan baru Tahap 5C.

## 2. API

Semua endpoint memakai prefix **`/api/stage5a`**, autentikasi Sanctum dan guard `EnsureIsolatedWorkspaceAccess` existing:

| GET | Fungsi |
| --- | --- |
| `/workspaces/{workspace}` | Owner, dataset workspace, dataset aktual job, progres, readiness, konfigurasi sesuai permission |
| `/workspaces/{workspace}/jobs/{job}/review-results` | State efektif dan kandidat tampil per halaman; juga kontrak sumber untuk Results versi baru |
| `/workspaces/{workspace}/jobs/{job}/candidates?record_key=001` | Kandidat immutable per record, rank opsional, status/versi saat ini, indikasi klaim/hold |
| `/workspaces/{workspace}/datasets/{dataset}/rows` | Pratinjau halaman/pencarian source; fallback preview yang dinyatakan parsial |

`page` 1–1.000.000; `per_page` 1–100, default 25. Review menerima `record_key`, `status`, `search`, `sort=record_order|similarity_desc|similarity_asc`, `similarity_min/max` 0–100, `input_province_code` dua digit dan `input_regency_code` empat digit. Prefix kabupaten harus sesuai provinsi jika keduanya diberikan. Tidak ada backfill/index build otomatis. Wilayah belum siap menghasilkan 409. Tidak ada endpoint agregasi kelompok kasus baru pada tahap ini.

Filter diterapkan sebelum pagination. Status adalah status kontrak (`matched`, `possible_match`, `unmatched`, `duplicate_input`, `reference_conflict`), bukan label UI. Urutan default leksikografis key string; similarity memakai kandidat pilihan reviewer bila tersedia, NULL terakhir dan key sebagai tie-breaker. Search mencakup key dan snapshot input kandidat rank 1, bukan pencarian seluruh nama acuan. Parameter tak dikenal ditolak.

## 3. Response dan error

Sukses: `{success: true, data: ...}`. Daftar review di dalam `data` berisi `source: review_states`, `ready`, `access`, `summary`, `data` record dan `pagination`. Summary status bersifat seluruh job, terpisah dari total hasil filter.

Record memberikan `matching_job_id`, `input_record_key`, `status`, `decision`, `version`, `decision_origin`, `decision_protection`, `integrity_status`, selected candidate/ref/group, `duplicate_of_input_record_key`, `source_occurrence_count`, `lineage_status`, canonical pointer beserta versi/status, `actors`, `selected_candidate_valid`, kandidat tampil dan `actions` advisory.

Kandidat memberikan ID hasil, input/ref key, rank, skor historis, kategori hasil awal, snapshot input/acuan, field scores, evidence dan alasan historis. `snapshot_available` membedakan snapshot yang tersedia dari payload kosong; `initial_result_type` tidak menggantikan status efektif state. `reference_occupied` dan `integrity_hold` tidak membocorkan record/aktor lain. Tidak menjalankan similarity ulang.

Dataset memberikan `source_file` atau `preview_snapshot`, `partial`, jumlah baris source historis, jumlah preview yang tersedia serta pagination yang jujur. File hilang tidak diartikan sebagai lineage lengkap. Metadata dataset tidak membocorkan path file atau email pengguna.

| Status | Kondisi |
| --- | --- |
| 401 | Tidak terautentikasi |
| 403 | Akses workspace/resource ditolak, termasuk ID job lintas workspace |
| 404 | Record key tidak ditemukan di job terotorisasi |
| 409 | `review_state_not_ready`, `review_regions_not_ready`, payload snapshot invalid |
| 413 | `reader_payload_too_large`; tidak memotong snapshot secara diam-diam |
| 422 | Parameter/rentang/key tidak valid atau field aktor tak dikenal |
| 503 | Guard default-off atau bukan database pengujian yang diizinkan |

Error domain mengikuti handler existing: `{success:false, code, details}`. Error validasi mengikuti Laravel. Batas data kandidat mentah per halaman, hasil decode/dekompresi dan JSON response masing-masing 2 MiB; ini batas payload, bukan klaim batas total RAM proses 2 MiB.

## 4. Permission dan scope

Identitas aktor berasal dari user Sanctum. Tidak menerima `user_id`/`role` untuk kewenangan. Reuse policy Tahap 5A: Owner/Admin sesuai kapabilitas; Editor review yang diizinkan; Viewer/Pimpinan baca tanpa write. Dataset harus terkait workspace yang boleh dibaca; job harus benar-benar milik workspace pada URL, termasuk untuk Admin. Kandidat harus cocok job dan input key, bukan hanya ID hasil.

GET state memakai transaksi database dan lock shared pada actor/workspace/member/job melalui policy existing. Pada MySQL pengujian dengan REPEATABLE READ, satu response memakai snapshot konsisten. Lock selesai setelah pembacaan terbatas; pratinjau source melakukan otorisasi ulang sesudah I/O file. Revocation sebelum request berikutnya menyebabkan 403. Snapshot permission bukan otorisasi untuk write berikutnya: writer tetap memeriksa ulang CAS dan akses.

Guard tetap membutuhkan flag existing, MySQL, database tepat `rematch_stage4_test` dan `REMATCH_REVIEW_TEST=isolated-stage4`. Mengaktifkan flag saja tidak membuka reader pada database utama maupun SQLite.

## 5. Version, actor, protection

Reader mengambil version nyata dari state, tidak membuat version berdasarkan waktu atau jumlah histori. Sesudah Accept, Reject, Unmatched, Undo, revisi/approval, request baru membaca commit aktual. Proposal yang belum disetujui dan rejection proposal tidak menaikkan version state efektif secara fiktif.

Reviewer historis, proposer, approver, dan last modifier masing-masing memiliki ID/nama terpisah; identitas tidak diketahui tetap NULL. Approval tidak menjadikan approver sebagai author keputusan usulan. Proteksi approved/reviewer-owned tetap berlaku bahkan bila author yang sama meminta revisi atas keputusan approved. `requires_proposal` berasal dari proteksi, bukan skor similarity.

Canonical pointer/versi dibaca dari state canonical job yang sama, dan selected reference dari state aktual. Pembacaan tidak membuat perubahan canonical/reassignment baru. Indikasi klaim mempertimbangkan kelompok entitas terverifikasi dataset-scoped, termasuk membership yang dibuat setelah assignment historis dengan projection group NULL; klaim tetap job-scoped. Tidak menggabungkan entitas berdasarkan nama.

## 6. Readiness dan audit reader lama

Audit menemukan reader review/results lama mengagregasi `review_decisions`; reader workspace/dataset lama juga membawa asumsi kepemilikan serta fallback preview. Karena itu legacy tidak dipakai sebagai fallback keputusan pada endpoint baru dan tidak diganti pada aplikasi aktif.

Review/candidates baru hanya membuka job `completed`, readiness `ready`, schema version 1. Selain itu mengembalikan readiness eksplisit dan 409, tanpa version palsu. Metadata workspace tetap dapat dibaca dengan `ready=false` dan review count NULL. State efektif **seluruhnya dari `review_states`**; matching results hanya sumber snapshot/score kandidat. Histori tidak disortir ulang untuk menebak keputusan. Kandidat foreign/tidak terbukti tidak dipublikasikan dan action review dinonaktifkan. Hold record tidak menahan record aman lainnya.

Review dan Results versi baru harus memakai kontrak tunggal ini dan mapping Tahap 1. Konsistensi backend kontrak telah diuji; aplikasi Results legacy belum dialihkan atau diuji sebagai consumer baru.

## 7. Pengujian MySQL dan Laravel

MySQL **8.0.46 / InnoDB** disposable, tanpa network eksternal, data tmpfs; source PHP dipasang read-only. Database utama tidak dipakai untuk pengujian atau pengukuran. Tidak ada migrasi/backfill/cutover utama.

- Tahap 5C integrasi: **67 assertion** lulus; pemeriksaan tambahan: **15 checks** lulus.
- Harness Tahap 4: **48 assertion**, termasuk koneksi independen dan retry concurrency; Tahap 5A: **81 assertion**, termasuk approval/access dan kernel HTTP.
- Schema/regresi terisolasi Tahap 2: **94 assertion**; Tahap 3: **55 assertion**, termasuk rollback/reapply, resume, missing source dan lineage; fixture 2.000 input 8,143 s, PHP 12 MiB.
- Regresi Laravel: **40 tes / 260 assertion lulus**, meliputi kontrak, historical resolver, transaction/access boundary, reader boundary, review/results dan export. Tes tambahan membuktikan halaman 12.000, key dengan padding dan penolakan parameter malformed/actor spoofing.
- Node kontrak Tahap 1: **3 tes lulus**. Syntax PHP lulus. Frontend tidak diubah sehingga build/browser frontend tidak diklaim sebagai pengujian integrasi Tahap 5C.

Cakupan mencakup Owner, shared Editor, read-only Viewer/Pimpinan, Admin, outsider, IDOR workspace/job/dataset, `001` versus `1` serta padded key, rank berbeda, committed Accept/Reject/Unmatched/Undo, selected rank 2 dan score filter, pending/approved/rejected proposal, author/protection, revocation, unready job, record/reference hold, duplicate canonical, payload terkompresi, preview partial dan source CSV, pagination/filter serta sumber status bersama. HTTP menggunakan kernel test actor, bukan sesi browser autentikasi nyata. Perubahan canonical melalui writer baru tidak ditambahkan pada tahap reader ini.

## 8. Performa dan memori

Fixture besar berisi **300.000 review state sintetis**, bukan 300.000 snapshot kandidat lengkap. Pengujian kandidat dan decoding memakai fixture kecil tersendiri. Server dibatasi 2 CPU, RAM container 1 GiB dan buffer pool 128 MiB; tmpfs juga masuk pemakaian RAM container. Pengukuran hangat bersifat lingkungan pengujian, bukan SLA produksi.

| Profil | Sampel | p50 | p95 | Query / payload |
| --- | --- | --- | --- | --- |
| Status + record order, halaman 2, 25 record | 20 | 206,60 ms | 236,33 ms | 12 query; 19.463 byte |
| Record order tambahan | 5 | 242,50 ms | 254,57 ms | Fixture semua skor NULL |
| Similarity descending tambahan | 5 | 3.396,45 ms | 3.512,49 ms | Fixture semua skor NULL; join/sort tetap mahal |

PHP peak harness lengkap 32,06 MiB; proses supplemental reader peak 8 MiB. Ini peak proses, bukan incremental RAM per request. MySQL container mencapai batas sekitar 1 GiB termasuk data tmpfs/cache, tanpa OOM kill yang teramati; jangan menafsirkan PHP 8 MiB sebagai total memori sistem.

`EXPLAIN` daftar status memakai `review_states_job_status_idx`, access `ref`, `Using index`. Menghindari join kandidat pada pagination biasa dan memisahkan count dari join sortir menurunkan profil awal sekitar 1,2 s ke sekitar 207 ms. Kandidat, actor dan canonical diambil batch untuk halaman saat ini; tidak ada load seluruh histori/N+1. Count status tetap menghitung seluruh job lewat indeks.

## 9. Batasan dan risiko tersisa

- Sortir score dinamis berdasarkan kandidat pilihan memakai CASE/join/filesort; **target satu detik belum tercapai** pada profil besar. Indeks state/status tidak menyelesaikan sort score ini. Perlu evaluasi projection score versioned yang disepakati pada tahap berikutnya, bukan denormalisasi diam-diam sekarang.
- Search snapshot JSON dapat memindai seluruh hasil; region/filter dengan snapshot kandidat penuh, deep pagination, concurrent reader/writer dan cold cache belum dibenchmark skala penuh.
- Streaming pratinjau source membatasi RAM tetapi paging/search file tetap scan sequential; tidak ada source row index baru. Ketersediaan file tidak membuktikan checksum/lineage utuh.
- Payload sangat besar ditolak eksplisit. Frontend perlu menampilkan error/retry dan mendukung pagination/rank; tidak boleh menganggap snapshot kosong sebagai record asli.
- Asumsi isolation level pengujian REPEATABLE READ harus diperiksa kembali saat deployment; tidak mengubah konfigurasi server utama.
- Tidak ada uji browser end-to-end backend, durability crash test, live rollout atau matching penuh baru. Tidak menyatakan sistem siap cutover dari hasil reader saja.

## 10. Persiapan integrasi frontend berikutnya

Adapter frontend Tahap 5B perlu memetakan DTO ini ke interface versioned review, menggunakan owner/access metadata server, mapping status Tahap 1 dan version aktual sesudah write. Tangani 409 readiness/protection/CAS, 403 revocation, 413 payload, selected candidate unavailable dan partial preview. Pisahkan pagination state/kandidat; pertahankan tabel saat refresh kueri sama dan skeleton saat kueri berubah.

Uji browser dengan backend terisolasi untuk Review dan Results, proposal/approval, Undo dan revocation sebelum binding/cutover yang disetujui. Frontend tidak boleh menaikkan version sendiri atau mengambil sebagian status dari reader legacy. Seluruh container pengujian Tahap 5C telah dihapus setelah bukti disimpan di `review/stage5c/*.log` (ignored) dan benchmark JSON di docs. **Berhenti pada Tahap 5C; tidak mengaktifkan sharing atau melanjutkan tahap berikutnya.**
