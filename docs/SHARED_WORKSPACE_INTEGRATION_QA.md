# Reader similarity dan integrasi Workspace Sharing

2026-10-13. Implementasi gated; tidak ada migrasi/backfill, perubahan histori, flag, atau cutover database utama.

## Implementasi

- Migration `2026_10_13_000004_add_review_display_score_indexes.php` menambahkan proyeksi decimal skor tampil, indikator kesiapan, generated NULL indicator, empat indeks urutan status/all asc/desc dan satu indeks kesiapan. Dua trigger menyalin skor kandidat immutable yang benar pada INSERT/UPDATE state, di transaksi yang sama dengan keputusan/Undo/approval; tidak membuat versi atau histori baru.
- Reader menghindari join/filesort seluruh state saat proyeksi siap. State lama yang belum diisi tetap memakai query join. Join identitas kandidat disamakan dengan collation indeks legacy, disertai pemeriksaan BINARY agar identitas opaque tetap tepat. Matching/similarity tidak dijalankan ulang.
- `workspace-access.ts`, `shared-matching.tsx`, `shared-workspaces.tsx`, `versioned-review.tsx`, serta route Results memakai API 5A/5C aktual. Fixture runtime tidak digunakan. Katalog mengirim nama owner dan role, sehingga list tidak meminta permission satu per satu untuk sekadar menampilkan setiap card.
- Dataset/candidate pagination, input-region/score/status/search filters, sorting, actual version/actors/protection, direct decision, revision, approval/rejection, Undo dan refresh terintegrasi. Aksi ditahan saat refresh versi; 409 tidak di-retry sebagai write. Modal konflik ditutup dengan error tetap terlihat.
- Auth bootstrap pada mode sharing menunggu `/api/me`; permission localStorage tidak dianggap sesi aktif saat first render. SSR sharing routes ditahan sampai client siap. Flag off mempertahankan perilaku lama.
- Route tambahan `/api/stage5a/workspaces/{workspace}/jobs/{job}/export` menghasilkan CSV state efektif dengan keyset 500 baris dan pemeriksaan akses ulang per chunk. Export legacy membaca keputusan lama/owner scope sehingga tidak cukup aman untuk hasil sharing baru; endpoint legacy tidak diubah. CSV baru bukan pengganti seluruh preset/audit export legacy.

## Bukti benchmark

MySQL 8.0.46/InnoDB disposable, 2 CPU, limit 2 GiB, buffer pool 256 MiB; 300.000 state sintetis, 25 record/halaman, 20 sampel hangat. Fixture besar sama seperti uji sebelumnya: skor kandidat NULL, bukan 300.000 snapshot kandidat penuh. Pemilihan rank/skor non-NULL diuji terpisah dengan fixture dan browser.

| Reader penuh, server/fixture/payload sama | p50 | p95 | SQL | Payload |
| --- | ---: | ---: | ---: | ---: |
| Join, proyeksi disabled khusus baseline test | 1.944 ms | 1.988 ms | 12 | 19.404 byte |
| Proyeksi terindeks | 246 ms | **259 ms** | 13 | 19.404 byte |

Target p95 ≤1 detik tercapai pada benchmark sebanding. Laporan historis 5C mencatat p95 3,51 detik pada konfigurasi server lebih kecil; angka tersebut tidak dipakai sebagai perbandingan hardware identik. SQL lama p95 1.681 ms, SQL indeks 0,79 ms. `EXPLAIN ANALYZE` berubah dari scan/join/sort 300.000 state ke lookup 25 baris tanpa filesort. PHP peak proses benchmark 8 MiB. Query tambahan memeriksa kesiapan proyeksi; indeks memperbesar storage dan menambah pemeliharaan kecil saat write, tanpa menyalin JSON.

Artefak aktual: `REVIEW_SHARED_SORT_BENCHMARK.json`. Baseline menggunakan salinan sementara reader dengan cabang proyeksi dinonaktifkan, tidak menambah bypass API runtime.

## Verifikasi

- MySQL Stage 4/5A/5C: 48/81/67 assertion lulus. Dua koneksi independen dan race/retry existing tetap diuji.
- Schema Stage 2: 94 assertion; Stage 3/backfill: 55 assertion; projection rollback/reapply/refresh/rank: 10 checks lulus. Effective key/decision/actor/version/history tetap sama saat refreshing projection; refresh di fixture memakai chunk 200.
- Laravel regression: 40 tes / 260 assertion lulus. Node contract: 3 tes lulus.
- Browser tanpa mock endpoint: login form, cookie session dan CSRF nyata, enam aktor, empat Laravel worker, MySQL disposable. Alur sharing/review/approval/Undo/rank/sort/filter/export, dua request bersamaan (record/ref claim), 409, dan revocation otomatis lulus. Pengelolaan akses dari halaman Administrasi dan kesiapan filter wilayah juga diuji. Final run: 3 tes browser lulus (exit 0); durasi runner mencakup keterlambatan teardown Vite Windows, bukan waktu request aplikasi.
- Browser flag-off legacy lulus. Final TypeScript dan production build exit 0; focused lint komponen integrasi/API/auth/config/spec exit 0 (dua warning Fast Refresh existing). Lint diperluas ke rute lama masih gagal karena backlog formatting/CRLF existing; tidak dilakukan formatting massal. PHP lint enam file terbaru lulus, git diff --check lulus.
- Log pengujian berada di `review/shared-*.log` (ignored); ID fixture `review/shared-e2e.json` di-ignore. Seed/script/container dibatasi database test. Dependency image dan project memiliki hash installed.json identik. Windows teardown Vite memerlukan penghentian proses test yang sudah lulus; exit 0 diperiksa.

## Batas kesiapan cutover

Integrasi alur yang diminta sudah tersedia di mode terisolasi. Guard fixed-test DB dan flag default-off tetap dipertahankan. Rollout membutuhkan persetujuan penerapan schema/backfill utama, pengisian proyeksi untuk state existing, perubahan guard deployment yang ditinjau, fencing writer legacy serta uji penerimaan data nyata. Matikan reader baru sebelum rollback kolom proyeksi.

Benchmark cold cache, pencarian JSON/region kompleks, snapshot kandidat penuh berskala produksi, source-file deep paging, export snapshot seluruh job dan durability belum dibuktikan. Export CSV baru konsisten per chunk/versi baris, bukan snapshot transaksi seluruh job; revocation menghentikan chunk berikutnya. Uji browser yang lulus tidak berarti seluruh wizard creation, bulk/group diagnostics atau semua preset export legacy sudah dicutover.

Tidak ada aktivasi atau perubahan pada database utama. Container/network/server pengujian dibersihkan setelah bukti disimpan.
