# RE-MATCH - Implementation Status

Last Updated: 2026-10-14
Version: MVP v0.1.0

Backup utama konsisten sudah dibuat atas izin pengguna: arsip 4,04 GB, gzip/SHA-256 tercatat, tidak masuk Git. Restore penuh belum diizinkan/dibuktikan; NO-GO tetap. Admission Linux baru 4/18, penolakan maintenance non-fixture satu tes tambahan, dan tiga cek MySQL recovery/admission baru lulus. Database/schema/flag utama tidak diubah.

Terbaru: admission API/matching/queue/backfill memakai shared/exclusive flock; Linux baru 4/18 dan MySQL tiga pemeriksaan recovery/admission baru lulus. Konfigurasi deployment/drain aktual belum diaktifkan; backup utama diizinkan, pembuktian restore masih ditahan. NO-GO hingga backup dapat dipulihkan terbukti; tanpa migrasi/flag utama.

Latest: inactive production guard supports hash-pinned operator evidence/exact DB+release, paired flags and access-only writer; 8 guard/boundary tests/17 assertions pass. MySQL one-input post-write recovery 7 assertions pass, operation-based Undo only (not backup replay). Fixture 502 upstream refusal diagnosed; bootstrap excludes host databases. Main backup file empty, valid backup/restore proof and production backfill admission remain NO-GO. No main DB/flags changed.

Docker-active blocker check: MySQL 8.0.46 isolated backfill/recovery 57 assertions, two-connection lock timeout/release, and unit fence/recovery 12/32 pass. Real flag-off browser login remains pending (fixture startup/proxy 502); fixed-test production guards, restorable main backup and post-write recovery not cleared. NO-GO; main services untouched/running, fixture resources removed.

Latest narrow follow-up: atomic locked rollback evidence validation/deletion implemented; 7 recovery tests / 10 assertions passed (SQLite only). CodeGraph indexed once. Docker unavailable; real MySQL/login, production guard/drain and full recovery readiness remain pending; NO-GO, main untouched.
Blocker follow-up only: bootstrap-gated login, inactive shared-marker API/legacy/queue admission fence, preexisting checkpoint version/operation proof and stale-history recovery refusal saved. Light native tests 11/30 + review regression 17/181, focused mocked login browser 1, TypeScript/lint pass. MySQL real login/full backfill/rollback plus coordinated production guard/drain/recovery remain pending; NO-GO unchanged. No main DB/flags/migrations or heavy test rerun.

UAT closed on user request, NO-GO cutover. Real shared flows and 300k inputs/900k candidates/30k history pass integrity/concurrency/export checks; reader/count optimizations and export/legacy fences saved. Backup/restore and DDL rehearsal proven. Full 300k backfill/readiness/rollback result unavailable; real flag-off browser login timed out, search ~5.07 s, deployment/recovery guards remain. Main untouched. Docker offline leaves exact UAT container/volume cleanup pending; script prepared. See WORKSPACE_SHARING_CUTOVER_UAT.md. No heavy retest/resume at closure.

Indexed similarity/shared frontend integration implemented in isolation (2026-10-13): additive derived score/indexes/triggers; actual API metadata/datasets/candidates/versioned review/approval/Undo/Results/CSV wired, runtime fixture removed. Comparable warm 300k reader p95 1.99s -> 0.259s. Real cookie/CSRF/MySQL browser workflow, concurrent writes and Admin sharing verified; main flags/schema/history unchanged. Legacy flag-off regression passes. Guard remains fixed-test: not production cutover. See SHARED_WORKSPACE_INTEGRATION_QA.md for evidence, frontend checks and limits.

Tahap 5C backend readers prepared/tested in isolation (2026-10-13): workspace metadata/catalogue owner-role, actual versioned review_states, scoped immutable candidates and partial-aware dataset preview. Four GET routes under existing default-off/fixed-test guard; legacy/UI unchanged, no main migration/backfill/flags/cutover. MySQL reader 67 + supplemental 15 checks passed; prior Stage 2/3/4/5A 94/55/48/81 assertions passed. Node 3 and Laravel 40 tests/260 assertions passed; see REVIEW_READERS_STAGE5C.md. Warm 300k synthetic state pagination p95 236.33 ms; similarity sort p95 3.51 s, full candidate dataset/search/cold load not yet proven. Reader availability supersedes the backend-reader absence described in the historical 5B entry below; frontend adapter and approved genuine browser integration remain pending. Stop 5C.

Tahap 5B frontend prepared/tested behind default-off VITE_WORKSPACE_SHARING_UI (2026-10-13): actual Stage 5A client/permissions, reusable membership controls, same-ID shared list, admin access actions, revision/approval and versioned Undo UI. Mock Chromium 17, flag-off legacy browser 1, Node contract 3 passed; TypeScript/focused ESLint/production build passed. Global frontend lint fails (25,150 errors/21 warnings). Full shared dataset/review/version reader contracts and owner-name DTO are not available in Stage 5A; versioned review is demonstrated only with explicit dev fixture, not a fabricated endpoint. No main/backend/schema/history/algorithm changes or activation. Genuine backend full-workflow integration and cutover remain blocked on approved reader contracts. See REVIEW_FRONTEND_STAGE5B.md.

Tahap 5A backend implemented/tested only in isolation (2026-10-13): workspace scope/RBAC, member list/search/CAS grant/change/revoke and submit/resolve approval through the same Stage 4 writer. Twelve authenticated fixed-test guarded routes; default flags false, main stage tables/migrations zero. MySQL 8.0.46: 81 Stage 5A assertions + 48 Stage 4 + 94 Stage 2 + 55 Stage 3 passed; backend 37 tests/235 assertions, frontend contract 3 tests. Warm synthetic review: membership Editor p50/p95 15.54/24.39 ms, 39 queries vs baseline 33; HTTP process peak 26 MiB. No production/300k/approval-load guarantee. No new schema, live sharing, UI, algorithm or cutover change. Scoped metadata reads prepared; full legacy readers/writers still require gated integration. Stop at 5A; see REVIEW_ACCESS_APPROVAL_STAGE5A.md.

Tahap 4 implemented/tested only in isolation: CAS/version checks, idempotent bounded operations, one-to-one reference/entity guards, actor/permission/protection checks, partial bulk outcomes and atomic append-only Undo. No new schema or changes to active review routes/UI/algorithms. MySQL 8.0.46: 48 concurrency assertions passed, with Stage 2/3 regressions 94/55; backend 33 tests/223 assertions and frontend contract 3 tests passed. Warm direct-service p95 for 1/5/10 reviewers: 11.49/53.99/86.29 ms on 5,000 synthetic inputs; PHP peak 12 MiB per worker. No 300k/full-HTTP/durability benchmark. Main stage tables/migrations remain zero; default-disabled, test-database guard retained, no cutover/sharing/approval. See REVIEW_TRANSACTIONS_STAGE4.md and REVIEW_STAGE4_BENCHMARK.json. Stop after Tahap 4.

Tahap 3 implemented/tested in isolation after explicit schema/scope approval: additive issue/neutral-hold migration, conservative source lineage/history reconstruction and chunked idempotent shadow backfill with resume/guarded rollback. MySQL 8.0.46/InnoDB Stage 3: 55 assertions; independent Stage 2: 94 assertions; relevant backend and 3 frontend contract tests passed. Fixture 2,000 input ~6.3s / PHP peak 12 MiB; not a 300k benchmark. Main DB stage migration/table counts remain zero. No cutover, live writer, sharing, approval, concurrency service or API/UI/algorithm change. See REVIEW_BACKFILL_STAGE3.md.

Review schema Tahap 2 prepared (2026-10-13), not applied to main DB: two additive migrations, six foundation tables, version/readiness fields and nullable audit links/actors/versions. Isolated MySQL 8.0.46 InnoDB migration/constraint/rollback tests: 94 assertions passed. Stage 1: 19 backend tests / 189 assertions and 3 frontend tests passed. No backfill, source cutover, sharing/approval/concurrency service or UI/algorithm changes. See REVIEW_SCHEMA_STAGE2.md for remaining guarantees and rollout limits.

Review contract Tahap 1 implemented (2026-10-13): existing status mapping centralized, Results effective classification corrected for reject_match, additive actor/statistics contract and prospective actor attribution using existing fields. Historical data/keys/scores unchanged. No schema migration, sharing, approval, one-to-one constraints or concurrency implementation. Verification: 19 backend tests / 189 assertions (SQLite), 3 frontend contract tests, TypeScript and production build. See REVIEW_CONTRACT_V1.md.

Case-group preparation recovery completed (2026-10-13): retryable cache contention keeps loading instead of a terminal failure, with bounded abortable GET retries and a manual retry action. Failed counters show unknown. Actual warm read: 11 groups / 7,549 members, 0.45 seconds; cold construction speed unchanged. Review regressions: 12 tests / 130 assertions; frontend build/TypeScript and synthetic browser retry/cancellation passed.

Selected-workspace cleanup completed (2026-10-13): seven workspaces, 17 linked jobs, 12 datasets, 3,307,263 candidates and 1,308 decisions retained and verified after Docker restart. Removed 14 unused jobs, 13 unused datasets, 1,005,045 unused candidates and orphan files/indexes. Four redundant indexes removed through a reversible migration. Historical packing completed with a 31.1 MiB PHP peak for the final maintenance pass; a 1,000-result sample payload was 22.5% smaller. Matching-results file approximately 35 -> 15.1 GiB; MySQL directory approximately 62 -> 43 GiB including logs; Docker VHD 113.08 -> 62.12 GB after offline compaction. MINIMAL logging and I/O capacity 1,000 persisted, logging ON and RAM buffer unchanged. Relevant regressions passed (29 tests, 232 assertions); all services healthy. See MATCHING_MEMORY_QA.md for measurements and limits.

Matching efficiency (2026-10-12): candidate-search batches are merged directly and buffers released early; checkpoint SQLite cache is bounded at 8 MiB, with lossless compressed checkpoint/result evidence and backward-compatible review access. Field scores remain SQL-queryable. Runtime files are excluded from backend Docker images. Read-only 1,000-result sample: checkpoint bytes reduced 83.5%, metadata/evidence 13.7%; full-job peak RAM/throughput not yet measured. The first efficiency milestone did not delete historical results or migrate the schema.

False address conflicts caused by separated house-number suffixes are corrected. Jrobang No 14 A and No. 14A normalize identically and score 100% on reevaluation, while different suffixes/numbers remain conflicts. Frontend preview and backend scoring share the same behavior; saved old results are preserved.

MFD disambiguation now uses separate input/reference province and kab/kota codes, including source aliases `prov`/`kab`. Both dictionaries contain 514 entries with explicit KOTA names; frontend and backend distinguish same-name cities/regencies. Actual Bandung example resolves equal after the fix. Persisted old scores need reevaluation; manual decisions are preserved.

Bulk review feedback now uses actual API affected/skipped counts and shows exclusion reasons. Sorting no longer unmounts cumulative diagnostics; loading reserves the table viewport. Live audit confirmed 82 saved matches and 18 shared-reference exceptions from a 100-selection batch.

Review dropdowns now share one component; sorting is non-searchable, province/regency searchable. Address completeness no longer overrides passed thresholds/guardrails; enrichment is separate evidence. Persisted old job outcomes are preserved and require reevaluation to use the corrected classification.

Case-group detail regression and server review filters implemented (2026-10-12). Active “Beda Alamat” group now returns 1,462 members even with summaries disabled. Both review views support stable full-job similarity order/range and input MFD province/regency filters. Region backfill completed on the 133,524-input job; warmed HTTP requests measured 899–986 ms, with cold group-cache rebuild still 11.5–19.2 seconds. Review tests passed (10/121 assertions), matching regressions passed (9/60), and frontend build/TypeScript passed. Browser checks read data without changing user decisions.

Review stabilization: exact cumulative column diagnostics, indexed status counts, targeted decision/undo snapshots, cached case membership, and native Docker Composer volume implemented. On the active 133,524-record job, warmed review HTTP requests measured 216–408 ms and a rollback-only decision measured 174 ms. Review regressions: 7 tests, 65 assertions; frontend build/TypeScript passed.

## Overall Progress

Stable loading UX implemented: review updates retain the table and open dialogs; changed filters/pages use skeletons; dataset replacements preserve existing previews/mappings until inspection succeeds. Offline browser fixtures verified review row changes, filter skeletons, and initial/replacement upload success/failure without changing persisted data.

| Area                 | Progress | Status                                                     |
| -------------------- | -------: | ---------------------------------------------------------- |
| Documentation        |      97% | In progress                                                |
| Frontend UI          |      97% | Mostly complete with RE-MATCH product-facing copy          |
| Frontend Integration |      85% | Upload through Export plus stabilized auth/workspace/results integration |
| Backend API          |      58% | Upload/Profile/Run/Review/Workspace/Auth/Admin/Monitoring slices exist |
| Database             |      39% | Workflow tables plus direct ownership columns exist      |
| Matching Engine      |      30% | MVP engine slice with entity-aware names                   |
| AI Assistant         |       0% | Not started                                                |
| Export Engine        |      20% | Frontend CSV/XLSX generation exists                        |
| Authentication       |      52% | Session auth, role/permission foundation, and ownership scoping exist |
| Testing              |      28% | In progress                                                |

## Frontend

| Area      | Status                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Integrated with Workspace backend for continue work, action required, summary, review queue, and recent workspaces. |
| Upload    | Integrated with Laravel `/api/datasets/inspect` for CSV/XLSX.                                                        |
| Profiling | Uses real inspect/profile response for uploaded CSV/XLSX files.                                                      |
| Mapping   | Uses inspected reference/input columns with frontend state only; algorithm choice moved to Configure.                |
| Configure | Logic complete with conditional configuration state ready for the future Matching Engine.                            |
| Run       | Calls Laravel Matching Engine MVP and shows returned summary.                                                        |
| Review    | Uses real Matching Engine results with smart case groups, safety-validated bulk actions, decision history, and undo. |
| Sync      | Uses latest review decisions for frontend finalization preview and local idempotent audit.                           |
| Export    | Generates default/custom CSV and XLSX files from latest Review results.                                              |
| Workspace | Lists resumable workspaces, uses shared router workspace links, and restores canonical Matching workflow state from backend. |
| Results   | Uses real workspace, matching job, review, sync summary, and export history data without dummy metrics, and routes back to canonical Matching workspace steps. |
| Settings  | Preferences, theme, language, matching defaults, AI preferences, privacy, and about sections complete.               |
| Shell     | Rebranded to RE-MATCH and cleaned of dummy user/search/notification/help controls.                                  |
| Auth      | Login redirects to the Laravel session, with current user role, permissions, logout, protected routes, one-time bootstrap, deduplicated `/api/me` verification, and non-destructive 401 handling exposed in the app shell. |

## Backend

| Area                     | Status                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Laravel Foundation       | Installed and running.                                                                                                        |
| API Routing              | Available through `routes/api.php`.                                                                                           |
| Health Endpoint          | Implemented: `GET /api/health`.                                                                                               |
| Dataset Inspect Endpoint | Implemented: `POST /api/datasets/inspect`.                                                                                    |
| CSV Parser               | Implemented for inspection milestone.                                                                                         |
| XLSX Parser              | Implemented for inspection milestone using internal ZIP reader and OpenXML parsing.                                           |
| Dataset Profiler         | Implemented for basic type, null, unique, duplicate, and sample value profiling.                                              |
| Auth API                 | Implemented: `POST /api/login`, `GET /api/me`, and `POST /api/logout` using Sanctum session auth, plus role/permission payloads and permission middleware. |
| Workspace Ownership      | Implemented MVP with direct `user_id` ownership on datasets, matching jobs, and workspaces plus backend scoping by role. |
| Admin Area               | Implemented MVP endpoints for user list/create/update, password reset, and workspace owner reassignment. |
| Pimpinan Monitoring      | Implemented MVP monitoring overview endpoint with cross-workspace read-only summary. |
| Matching Engine          | MVP service implemented with normalization, entity-aware names, indexing, candidate generation, scoring, Top N, and progress. |
| Review Knowledge         | Deterministic review patterns and knowledge levels are stored in review decision metadata.                                    |
| Workspace Persistence    | MVP endpoint supports list/create/detail/update/delete and stores workflow snapshots.                                         |
| Export Engine            | Frontend-only CSV/XLSX generation exists; server-side export persistence not started.                                         |

## Database

| Table                     | Status                            |
| ------------------------- | --------------------------------- |
| `datasets`                | Migration and model implemented with direct owner `user_id`.  |
| `dataset_columns`         | Migration and model implemented.  |
| `users`                   | Laravel default migration exists, with role added by milestone 9.1. |
| `workspaces`              | Migration and model implemented with direct owner `user_id`.  |
| `workspace_users`         | Not started.                      |
| `matching_jobs`           | Migration and model implemented with direct owner `user_id`.  |
| `column_mappings`         | Migration and model implemented.  |
| `matching_configurations` | Migration and model implemented.  |
| `matching_results`        | Migration and model implemented.  |
| `review_decisions`        | Migration and model implemented.  |
| `sync_plans`              | Not started.                      |
| `exports`                 | Not started.                      |
| `audit_logs`              | Not started.                      |
| `ai_recommendations`      | Not started.                      |

## Completed Milestone

Milestone 9.1: Role & Permission Foundation

| Requirement                                 | Status   |
| ------------------------------------------- | -------- |
| Central role definition                     | Complete |
| `users.role` migration                      | Complete |
| Backend permission registry                 | Complete |
| Sanctum auth payload with role/permissions  | Complete |
| Protected backend workflow endpoints        | Complete |
| Frontend auth permission awareness          | Complete |
| Role-aware sidebar and topbar               | Complete |
| Hidden workflow actions by permission       | Complete |
| Access denied frontend state                | Complete |
| Workspace ownership and membership boundary | Partial |

## Completed Milestone

Milestone 9.2-9.4: Workspace Ownership, Admin Area, and Pimpinan Monitoring

| Requirement                                         | Status   |
| --------------------------------------------------- | -------- |
| Direct owner on workspaces, datasets, jobs          | Complete |
| Backend scoping by authenticated user and role      | Complete |
| Admin access to all workspaces                      | Complete |
| Admin user list, create, edit, and password reset   | Complete |
| Admin workspace owner reassignment                  | Complete |
| Pimpinan read-only monitoring overview              | Complete |
| Pimpinan post-login landing to monitoring           | Complete |
| Frontend monitoring and admin routes                | Complete |
| Membership collaboration model                      | Deferred |
| Fine-grained admin operations beyond role/owner     | Deferred |

## Completed Milestone

Milestone 2: Real Column Mapping

| Requirement                                   | Status   |
| --------------------------------------------- | -------- |
| Health endpoint                               | Complete |
| CSV inspect                                   | Complete |
| XLSX inspect                                  | Complete |
| Basic profiling metadata                      | Complete |
| Persist dataset metadata                      | Complete |
| Persist dataset column metadata               | Complete |
| Frontend Upload integration                   | Complete |
| Frontend Profiling integration                | Complete |
| Real reference/input columns in Mapping       | Complete |
| Manual column mapping state                   | Complete |
| Simple non-AI auto-suggest by column name     | Complete |
| Unmatched reference columns shown in Mapping  | Complete |
| Duplicate reference-column validation         | Complete |
| Mapping simplified to reference/input pairing | Complete |
| Column type badges in Mapping                 | Complete |
| Algorithm selection moved out of Mapping      | Complete |
| Post-milestone generated artifact cleanup     | Complete |
| Backend tests                                 | Added    |
| Frontend tests                                | Added    |

## Completed Milestone

Milestone 3A: Configure UX

| Requirement                                   | Status   |
| --------------------------------------------- | -------- |
| Quick Setup presets                           | Complete |
| Balanced, Strict, Exploratory, Custom modes   | Complete |
| Summary Configuration                         | Complete |
| Technical controls moved to Advanced Settings | Complete |
| Advanced Settings collapsed by default        | Complete |
| Beginner friendly progressive disclosure      | Complete |
| Conditional strategy UI                       | Complete |
| Exact/Fuzzy/Hybrid/Rule-Based active controls | Complete |
| Default field algorithm recommendation        | Complete |
| Relevant Configure validation                 | Complete |
| English and Indonesian Configure labels       | Complete |
| Configure state remains local/engine-ready    | Complete |
| Backend/API/database changes                  | None     |

## Completed Milestone

Milestone 3B: Configure Logic

| Requirement                                 | Status   |
| ------------------------------------------- | -------- |
| Preset default configuration logic          | Complete |
| Custom conditional configuration logic      | Complete |
| Exact/Fuzzy/Hybrid/Rule-Based validation    | Complete |
| Field algorithm defaults by field type/name | Complete |
| Automatic/manual normalization state        | Complete |
| Automatic/manual candidate filtering state  | Complete |
| Standard/custom output state                | Complete |
| Workflow-level configuration snapshot       | Complete |
| Run step reads saved configuration summary  | Complete |
| Backend/API/database changes                | None     |

## Completed Milestone

Milestone 4: Optimized Matching Engine MVP

| Requirement                                  | Status   |
| -------------------------------------------- | -------- |
| Normalize once before comparisons            | Complete |
| Exact/normalized exact index lookup          | Complete |
| Token candidate generation for fuzzy scoring | Complete |
| Chunked input processing                     | Complete |
| Configurable bounded worker slots            | Complete |
| Field scoring algorithms MVP                 | Complete |
| Top N candidate ranking                      | Complete |
| Incremental result persistence               | Complete |
| Matching progress status                     | Complete |
| Frontend Run integration                     | Complete |
| Review/Sync/Export execution                 | Deferred |

## Completed Milestone

Milestone 5B: Review Matching Results

| Requirement                                        | Status   |
| -------------------------------------------------- | -------- |
| Group results as Matched / Need Review / Unmatched | Complete |
| Load persisted Matching Engine results             | Complete |
| Show Input Record vs Reference candidate           | Complete |
| Show score and supporting field highlights         | Complete |
| Show Top N candidates when available               | Complete |
| Accept / reject / mark unmatched                   | Complete |
| Select alternative candidate                       | Complete |
| Undo decision before final                         | Complete |
| Persist review decisions                           | Complete |
| Sync/Export/Auth/Workspace/AI                      | Deferred |

## Completed Milestone

Milestone 5B.1: Entity-Aware Name Matching

| Requirement                                                            | Status   |
| ---------------------------------------------------------------------- | -------- |
| Parse raw and core company/entity names                                | Complete |
| Extract legal form, status qualifier, public status, and unit metadata | Complete |
| Compare fuzzy/entity names using `core_name`                           | Complete |
| Preserve identity metadata for validation                              | Complete |
| Prevent explicit PT vs CV from becoming Auto Match                     | Complete |
| Treat missing legal form or missing Persero/Tbk as non-conflict        | Complete |
| Separate branch/unit metadata from parent company                      | Complete |
| Case clustering, Sync, Export, AI                                      | Deferred |

## Completed Milestone

Milestone 5C: Case-Grouped Review & Review Knowledge

| Requirement                                      | Status   |
| ------------------------------------------------ | -------- |
| Case feature extraction                          | Complete |
| Deterministic case fingerprint / classification  | Complete |
| Group similar Need Review cases                  | Complete |
| Cluster confidence High / Mixed / Unique         | Complete |
| Representative example per group                 | Complete |
| View toggle Case Groups / All Records            | Complete |
| Apply decision to one, selected, or entire group | Complete |
| Block bulk decision for non-homogeneous clusters | Complete |
| Store Review Knowledge as pattern and conditions | Complete |
| Sync/Export/Auth/Workspace/AI                    | Deferred |

## Completed Milestone

Milestone 5C.1: Smart Case-Based Review

| Requirement                                                   | Status   |
| ------------------------------------------------------------- | -------- |
| Default Case Groups view for Need Review records              | Complete |
| Deterministic fingerprint grouping and representative samples | Complete |
| Case reason, count, consistency, confidence, recommendation   | Complete |
| Accept Group, Reject Group, Review More, Review Individually  | Complete |
| Bulk safety validation after human decision                   | Complete |
| Unsafe records stay in Need Review without failing the group  | Complete |
| Status code support for AUTO_MATCHED / MANUAL / NEED_REVIEW   | Complete |
| Review Knowledge levels NEW_PATTERN and KNOWN_PATTERN         | Complete |
| LLM, AI, Workspace, Authentication                            | Deferred |

## Completed Milestone

Milestone 5D: Review Traceability Fix and Sync Finalization

| Requirement                                                                                             | Status   |
| ------------------------------------------------------------------------------------------------------- | -------- |
| Keep accepted/rejected case groups visible                                                              | Complete |
| Case Groups filters Open / Resolved / All                                                               | Complete |
| Decision metadata: previous status, decided time, source, reviewer, affected records                    | Complete |
| Record display status: Need Review, Auto Matched, Manual Accepted, Manual Rejected, Confirmed Unmatched | Complete |
| Mixed decision summary per group                                                                        | Complete |
| Decision History in record/group detail                                                                 | Complete |
| Group/bulk undo using batch audit metadata                                                              | Complete |
| Sync Finalize Summary / Recommended Plan / Preview / Confirm flow                                       | Complete |
| Sync warning for unresolved review                                                                      | Complete |
| Recommended sync plan from latest review decisions                                                      | Complete |
| Local idempotent sync audit per job                                                                     | Complete |
| Server-side sync persistence, Export, Auth, Workspace, AI                                               | Deferred |

## Completed Milestone

Milestone 7: Export Results

| Requirement                                                             | Status   |
| ----------------------------------------------------------------------- | -------- |
| Default export for matched, new/unmatched, rejected, and review summary | Complete |
| Custom export mode with selectable columns and statuses                 | Complete |
| Include/exclude matching score, reference key, and review/audit fields  | Complete |
| CSV generation                                                          | Complete |
| XLSX workbook generation                                                | Complete |
| Preview record count and generated filename                             | Complete |
| Loading, success, and error feedback                                    | Complete |
| Read-only export from latest review decisions                           | Complete |
| Server-side export history, Auth, Workspace, AI                         | Deferred |

## Completed Milestone

Milestone 8: Workspace / Session Persistence

| Requirement                                               | Status   |
| --------------------------------------------------------- | -------- |
| Workspace table for resumable matching sessions           | Complete |
| Workspace REST API list/create/detail/update/delete       | Complete |
| Matching workflow autosaves progress to backend           | Complete |
| Resume restores current step and frontend workflow state  | Complete |
| Matching run can attach completed job to active workspace | Complete |
| Workspace list page with continue, rename, delete         | Complete |
| Workspace delete does not delete datasets/reference data  | Complete |
| Auth, permissions, collaboration, AI                      | Deferred |

## Completed Milestone

Milestone 8.1: Dashboard Real Data Integration

| Requirement                                      | Status   |
| ------------------------------------------------ | -------- |
| Dashboard reads workspace data from backend      | Complete |
| Removed dummy jobs, scores, insights, analytics  | Complete |
| Continue Your Work from latest relevant workspace | Complete |
| Action Required from Need Review, Failed, Ready to Sync | Complete |
| Workspace Summary from persisted workspace/job data | Complete |
| Recent Workspaces table with Continue/Open action | Complete |
| Review Queue entry point                         | Complete |
| Empty state for no workspaces                    | Complete |
| Dashboard writing rules added to UX Guidelines   | Complete |

## Completed Milestone

Milestone 8.1.1: Dashboard Shell Cleanup, RE-MATCH Rebranding, and Organizational UI Copy

| Requirement                                           | Status   |
| ----------------------------------------------------- | -------- |
| Product-facing branding changed to RE-MATCH           | Complete |
| Organization identity added lightly to shell/settings | Complete |
| Dummy user identity removed from app shell            | Complete |
| Global search, notification, help, fake account UI hidden | Complete |
| Upload copy changed to Data Acuan and Data Input      | Complete |
| Main UI default language changed to Bahasa Indonesia  | Complete |
| Generic SaaS/dashboard copy removed                   | Complete |
| UX writing rules documented                           | Complete |

## Completed Milestone

Milestone 8.1.2: UI Language Consistency, Workflow Step Guard, Workspace Naming, and Copy Cleanup

| Requirement                                           | Status   |
| ----------------------------------------------------- | -------- |
| Main workflow copy follows translation resources      | Complete |
| Indonesian and English workflow copy aligned          | Complete |
| Stepper labels and helper text follow language switch | Complete |
| Future workflow steps locked by prerequisite state    | Complete |
| Manual future-step URL bypass clamped                 | Complete |
| Export locked until Sync is confirmed                 | Complete |
| Workspace default name changed to New Workspace / Workspace Baru | Complete |
| Workspace rename added to workflow header             | Complete |
| Workspace name persisted through workspace autosave   | Complete |
| UX writing rules expanded for translation and guards  | Complete |

## Next Milestone

Stabilization & QA

- Run build, lint, E2E, and backend tests after implementation-only milestones.
- Fix regressions found in Upload -> Export with workspace resume.
- Keep AI mapping suggestions deferred until AI Assistance milestone.

## Remaining MVP Work

- Auth and workspace membership ownership.
- Full-file matching beyond inspected preview rows.
- Server-side sync execution/audit persistence.
- Server-side export history and audit persistence.
- Audit trail persistence.
- AI assistance integration.
