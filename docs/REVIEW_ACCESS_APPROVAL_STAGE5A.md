# RE-MATCH — Tahap 5A: akses workspace dan approval backend

2026-10-13. Implementasi dan pengujian **hanya terisolasi**, tanpa cutover.
Schema Tahap 2/3 dipakai kembali; tidak ada migration atau backfill baru.
Database utama, hasil/keputusan historis, matching engine dan UI tidak diubah.
Route existing tetap pada ownership/legacy writer. Fitur baru belum tersedia untuk pengguna live.

## 1. File backend

Ditambahkan:

- `app/Services/Workspace/WorkspaceAccessService.php`: policy scope/role, permission, resource association dan list workspace.
- `app/Services/Workspace/WorkspaceMembershipService.php`: member list, registered user search, versioned grant/change/revoke.
- `app/Http/Controllers/Api/WorkspaceAccessController.php`: adapter actor dari autentikasi backend, read/query/write API.
- `app/Http/Requests/WorkspaceAccessRequest.php`: validation termasuk penolakan actor/field tambahan.
- `app/Http/Middleware/EnsureIsolatedWorkspaceAccess.php`: flag serta fixed database/env guard.
- `config/workspace_access.php`, `routes/workspace_access.php`.
- `scripts/test_workspace_access_mysql.php`: reuse regresi Tahap 4, independent PDO concurrency, HTTP kernel fixtures dan benchmark.
- `tests/Feature/WorkspaceAccessBoundaryTest.php`: inactive guard, authentication, validation/key tests.

Diubah:

- `app/Services/Matching/Transactions/ReviewTransactionService.php`: optional policy dengan koneksi yang sama; submit/resolve melalui executor yang sama. Tidak menambah writer state kedua.
- `routes/api.php`: mendaftarkan namespace guarded terpisah.
- `bootstrap/app.php`: skip trimming hanya `api/stage5a/*`; string key/idempotency sampai ke service utuh. Route lain tetap memakai normalisasi request existing.

Dokumentasi: API, ARCHITECTURE, SESSION, IMPLEMENTATION_STATUS, CHANGELOG dan laporan/benchmark ini. Tidak mengubah ResourceOwnership, PermissionRegistry, controller review existing, skema, dependency atau frontend.

## 2. API/service

Prefix **`/api/stage5a`**, seluruhnya `auth:sanctum` + isolated guard + policy backend.

| Method/path setelah prefix | Fungsi |
| --- | --- |
| GET `/workspaces` | Own/shared untuk user; semua untuk Admin/Pimpinan; pagination 50 |
| GET `/workspaces/{workspace}/permissions` | Role efektif, capability booleans, membership version |
| GET `/workspaces/{workspace}/members` | Owner/Admin member list, status/version/grant/revoke actors |
| GET `/workspaces/{workspace}/users?search=...` | Registered user search, min 2 chars, maksimal 25; hanya role user, tanpa owner |
| POST `/workspaces/{workspace}/members` | `user_id`, `role=editor|viewer`, `expected_version`; 0=create, current version=change/reactivate |
| DELETE `/workspaces/{workspace}/members/{user_id}` | `expected_version`; revoke/tombstone, tanpa menghapus row |
| GET `/workspaces/{workspace}/resources/{kind}/{id}` | Dataset/job/result/history metadata terasosiasi; tanpa storage path/raw JSON |
| GET `/jobs/{job}/proposals` | Owner/Admin inbox, page/status, old/proposed decision, reason, names/actor IDs, versions |
| POST `/jobs/{job}/proposals` | Explicit key/version/decision/candidate, reason dan idempotency_key |
| POST `/jobs/{job}/proposals/{id}/resolve` | expected_request_version, approve boolean, reason, idempotency_key |
| POST `/jobs/{job}/decisions` | Explicit list 1–50 key/version/decision/candidate; same Stage 4 writer |
| POST `/jobs/{job}/undo` | operation_id, versions seluruh applied input, idempotency_key; atomic Undo |

Tidak ada undangan akun baru, ownership mutation, config/dataset/rerun mutator atau bulk approval baru.
Member POST juga mengubah role; version stale -> 409. Membership mutations menggunakan CAS, bukan idempotency ledger job; transport retry dengan versi lama ditolak, bukan menggandakan row.
Role admin/pimpinan tidak perlu membership; grant baru untuk keduanya ditolak. Stale membership tetap dapat dicabut setelah target berganti role aplikasi. Owner tidak dibuat sebagai membership role.

Payload unknown fields, actor IDs dari frontend, key numeric yang bukan string, candidate lintas job/input dan candidate non-null pada mark_unmatched ditolak. Key tetap opaque; `001`, `1` dan padded strings tidak di-trim/disamakan.
Request hash dan ack menggunakan kontrak Tahap 4. Proposal ack: `submitted=1, applied=0`; rejection ack: `rejected=1, applied=0`; approval efektif `applied=1`. Conflict approval durable: `conflicted=1`, request status/code dan HTTP 409. Business exception biasa memakai structured code/details.

## 3. Matriks permission

Role aplikasi tetap admin/user/pimpinan. Membership hanya editor/viewer; owner dari `workspaces.user_id`.

| Hak | Admin | Owner (user) | Editor (user) | Viewer (user) | Pimpinan |
| --- | --- | --- | --- | --- | --- |
| Membaca | Semua | Milik sendiri | Dibagikan | Dibagikan | Semua, existing |
| Review | Ya* | Ya* | Ya* | Tidak | Tidak |
| Mengajukan revisi | Ya | Ya | Ya | Tidak | Tidak |
| Approval/reject proposal | Semua | Milik sendiri | Tidak | Tidak | Tidak |
| Mengelola member | Semua | Milik sendiri | Tidak | Tidak | Tidak |
| Config/dataset write/rerun capability | Ya | Ya | Tidak | Tidak | Tidak |
| Read/export-read capability | Semua | Milik sendiri | Dibagikan | Dibagikan | Semua |

*Direct revise hanya keputusan sendiri yang current/unapproved, atau state terbuka. Keputusan reviewer lain/unknown/approved membutuhkan proposal juga bagi Owner/Admin. Integrity/readiness/version checks berlaku bagi seluruh role. Capability config/run/export-read disiapkan untuk adapter berikutnya; tidak membuat mutator atau download export baru pada tahap ini.
App role membatasi membership: pimpinan yang masih mempunyai row editor tetap read-only. Unknown role ditolak. Permission tidak dipercaya dari session snapshot/UI; user/owner/membership dibaca kembali dari DB.

## 4. Audit resource scope

Endpoint workspace/config/progress, dataset rows, run/stop, status/stream, results/region/rules, decisions/Undo, AI result readers, export, history, monitoring dan administration diperiksa lewat route serta ResourceOwnership/service existing. Ownership dan application permission paths existing dipertahankan. Tidak memperluas scopeDatasets ke semua data owner melalui membership.

Policy baru mengharuskan context workspace yang sah. Job dengan workspace_id memakai hubungan tersebut; job legacy memerlukan satu hubungan workspace.matching_job_id yang tidak ambigu. Ambiguitas ditolak, tidak ditebak berdasarkan owner atau nama.
Dataset diizinkan bila terhubung langsung ke workspace atau digunakan oleh job terkait; acuan yang digunakan ulang tetap terbaca hanya melalui hubungan eksplisit. Dataset pribadi lain milik owner tetap ditolak. Result/history mengikuti matching_job_id sebenarnya, bukan ID job yang dikirim pengguna. Metadata projections tidak membaca packed explanations atau mengekspor storage path.

**Batas integrasi:** API live belum mengenali sharing. Endpoint metadata di namespace ini membuktikan scope dan menjadi dasar adapter. Full preview/rows/review pagination/export/config readers existing belum dialihkan. Aktivasi nantinya harus membawa policy ini ke semua adapter terkait dan single state authority; frontend tidak boleh mengasumsikan bahwa grant otomatis membuka endpoint legacy.

## 5. Revocation dan locking

Review: actor shared -> job shared -> workspace shared -> membership shared -> target state FOR UPDATE. Tidak memakai exclusive workspace lock per review. Membership: sorted actor/target user shared -> workspace shared -> target membership FOR UPDATE, CAS version. Named membership resource lock membatasi concurrent create/change; duplicate row tetap dilindungi unique constraint.

Review memegang membership shared hingga commit. Revocation/role downgrade memerlukan exclusive row yang sama: review yang lebih dahulu memegang izin boleh commit lalu revoke; revoke yang commit dahulu membuat save berikutnya gagal 403. Completed idempotency retry diotorisasi ulang, termasuk shared locks sebelum ack, sehingga akses lama tidak hidup kembali.

Permission/state policy wajib memakai ConnectionInterface yang sama dengan writer; mismatch ditolak. Named lock acquisition dan session row timeout sekitar 2 detik; timeout session dipulihkan. Review memakai bounded retry Tahap 4 (3 attempt/jitter) untuk deadlock/lock timeout; membership transaksi maksimal 3 attempt dengan Laravel concurrency retry. Konflik bisnis/version tidak retry otomatis. Lock timeout/exhaustion membership -> structured 409.
Deletion/role/owner/config maintenance di luar service harus mengikuti row/fencing protocol saat integrasi. Tidak menguji seluruh live management paths karena belum ada cutover.

## 6. Approval dan aktor

1. Pengusul memiliki permission propose saat submit; job completed/ready/schema 1, input consistent, current expected_version dan candidate scope benar. Duplicate Input tidak direklasifikasi melalui proposal.
2. Satu pending request per state. Simpan previous reviewer/status/reference, proposed decision/candidate/entity, alasan, expected state version dan request version=1. Tidak mengubah review_states maupun histori efektif.
3. Owner/Admin resolve dengan request version. State/request dikunci; permission approver dan pengusul diperiksa ulang. Pengusul revoked/downgraded tidak dapat mengaktifkan pending revision.
4. Approval memanggil write() Tahap 4 dalam outer transaction yang sama. Candidate snapshot, CAS, reference/entity uniqueness, Auto Match protection dan old/new holds tetap berlaku.
5. Success: request approved/version+1, operation linked, state version+1/protection approved, audit baru append. Failure karena old state version -> stale; reference/hold/proposer permission -> conflicted. Konflik tersimpan sebagai completed operation dan ack 409, tanpa menulis state/audit keputusan. Owner/Admin rejection menyimpan reason/actor/event tanpa state write.
6. Retry payload/key yang sama mengembalikan durable ack tanpa audit kedua. Different resolver/key terhadap request yang selesai mendapat stale_proposal_version 409. Tidak ada auto-rebase/reapply atau pemilihan pemenang.

| Identitas | Penyimpanan |
| --- | --- |
| Reviewer keputusan lama | request.previous_reviewer_user_id + immutable before snapshot/original audit; unknown tetap NULL |
| Pengusul/content author keputusan baru | proposed_by_user_id; setelah approval reviewer_user_id = pengusul |
| Pemberi persetujuan | approved_by_user_id |
| Aktor penerapan/last modifier | operation.actor_user_id / last_modified_by_user_id = approver |

Reviewer baru tidak mendapatkan hak overwrite dari ID tersebut: protection approved selalu menang, termasuk untuk Undo oleh pengusul. Revisi berikutnya harus melalui proposal lagi. Original review_decisions/undone_at tidak diubah. Proposal/resolution events append di review_operations; current request row menyimpan lifecycle/version. Inbox before_decision memakai current unchanged state atau unique versioned audit; histori yang tidak terbukti tetap unknown.
Tidak menambahkan kebijakan two-person/self-approval exclusion bagi Owner/Admin yang belum diminta; tidak membuat jalur Editor self-approve.

## 7. Pengujian

MySQL **8.0.46 / InnoDB**, container baru network none, tmpfs 2 GiB, RAM 1 GiB/CPU 2/buffer pool 128 MiB, binlog off. Source/vendor mounts read-only; test DB tetap `rematch_stage4_test` dengan env `REMATCH_REVIEW_TEST=isolated-stage4`. Namespace Tahap 2/3 terpisah pada server disposable; tidak memakai config/koneksi main untuk penulisan.

| Suite | Hasil |
| --- | --- |
| Tahap 5A independent PDO + HTTP kernel | **81 assertions PASS** |
| Regresi Tahap 4 independent PDO, termasuk real deadlock | **48 assertions PASS** |
| Tahap 2 schema/constraint/rollback MySQL | **94 assertions PASS** |
| Tahap 3 lineage/history/backfill MySQL | **55 assertions PASS** |
| Backend kontrak/resolver/review/export + boundary | **37 tests / 235 assertions PASS**, SQLite :memory: |
| Frontend contract Node | **3 tests PASS** |
| Scoped Pint, route list | PASS, **12 guarded routes** |

Fixture covers semua minimum user: grants Editor/Viewer, disallowed writes/member management, Admin tanpa membership, Pimpinan/role changes, workspace/job/dataset/result/history spoofing, parallel membership CAS, both revocation orders, protected revision/proposal, approval/stale/reference conflict, revoked proposer, concurrent approvers and exact retry. Tambahan: pending counts, reject vs unmatched, NULL prior reviewer, approved Undo blocked, role downgrade fencing retry, reused reference dataset, unversioned history, padded key HTTP.
HTTP uses Laravel kernel/validation/auth middleware dengan authenticated test guard; tidak membuat sesi/login nyata atau browser E2E. Boundary tests membuktikan flags saja tidak dapat mengaktifkan SQLite/main writer.
Stage 3 fixture 2,000-input load 6.224s / PHP peak 12 MiB; angka regresi terpisah dari benchmark review.

## 8. Dampak performa

Fixture dasar 5.000 input sintetis; 40 individual accepts per profil, satu reviewer, unique input/ref, warm direct service sebelum HTTP boot. Angka observasi kecil, bukan SLA/perbandingan kausal dengan produksi.

| Profil | p50 ms | p95 ms | SQL/request | GET_LOCK calls ms/request |
| --- | ---: | ---: | ---: | ---: |
| Owner, writer Tahap 4 tanpa policy sharing | 13.17 | 14.36 | 33 | 0.87 |
| Editor, policy membership Tahap 5A | 15.54 | 24.39 | 39 | 0.93 |

6 query tambahan membeli fresh authorization/member checks; tidak mengklaim lebih cepat dari jalur lama. Query count mencakup session/savepoint SQL, tidak PDO BEGIN/COMMIT atau fixture candidate lookup. Lock call time termasuk SQL roundtrip. PHP core fixture/concurrent worker peak 12 MiB; proses setelah boot HTTP kernel peak **26 MiB**, bukan peak incremental/request atau total server.
Server snapshot setelah repeated test setup: **901.3 MiB / 1 GiB** termasuk tmpfs/cache/schema fixtures; cgroup max/OOM/OOM-kill 0. Tidak ada tuning RAM main. Lifecycle lists bounded 50, user search 25, mutation 50 input max; scalar projections/checks menggunakan indeks existing. Approval juga menambah ledger/proposer checks; belum ada approval-specific load/300k, full browser/HTTP throughput, production binlog/durability, soak atau proxy/failover benchmark. Raw small benchmark: REVIEW_STAGE5A_BENCHMARK.json.

## 9. Guard, main DB dan risiko

`WORKSPACE_ACCESS_ENABLED=false` dan `REVIEW_STATE_TRANSACTIONS_ENABLED=false` default. Stage 5A additionally requires fixed test DB/env/driver; mengubah flag saja tidak membuka live/main. Tidak ada membership/approval activation pada application existing.
SELECT-only main `rematch`: stage migrations **0**, state/operation/member/request tables **0**, kedua flags **false**. Tidak menjalankan migration/backfill, ready change, session login atau decision write main. Container disposable dibersihkan setelah tes; main containers tidak direstart.

Risiko tersisa: single-primary/connection-pinned named locks; belum crash/network/failover soak; privileged SQL/maintenance di luar protocol; full reader/writer/config/dataset/autosave fences belum diintegrasikan. Bulk confidence/evidence guardrails business existing harus dibawa ke adapter activation; isolated explicit-item API ini menguji kontrak transaksi, bukan mengganti evaluator tersebut. Service-level append-only tidak melindungi SQL administrator. Membership row menyimpan current grant/revoke/version, bukan ledger append-only seluruh perubahan membership. Tidak ada invite/new-account atau bulk approval. Unknown lineage/history tetap memerlukan rekonsiliasi sesuai Tahap 3; approval tidak menyelesaikannya secara otomatis.

## 10. Persiapan Tahap 5B

Siapkan UI own/shared/admin workspace list, capability-driven controls, member Editor/Viewer dengan version CAS, approval inbox before/proposed/actor/reason, explicit version/idempotency request, 403 revocation recovery dan 409 conflict handling. Bedakan submitted/rejected dari applied; jangan memutasi tabel efektif saat proposal pending. Approved state tetap terkunci untuk Editor, termasuk pengusul.
Full matching view/preview/export adapters memerlukan scope policy dan satu sumber status efektif sebelum rollout. Legacy review/Undo/bulk/queue/internal writes harus di-fence saat cutover; jangan menjalankan mixed legacy/state authority. Aktivasi memerlukan persetujuan baru, schema/backfill/reconciliation deployment terkontrol, role/access/owner transfer rehearsal, snapshot immutability, dan production-scale/durability benchmark.

**Berhenti Tahap 5A.** Tidak mengimplementasikan UI Tahap 5B, database utama atau cutover. Aman disiapkan sebagai commit milestone terisolasi; belum commit/push. Usulan: `feat: add isolated workspace access and review approval backend`.
