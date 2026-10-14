# RE-MATCH - Session

## Current Milestone

Blocker follow-up (2026-10-14); NO-GO production, light tests only.
- Real shared browser workflows and 300k inputs/900k candidates/30k history verified; history unchanged, zero duplicate claims/projection mismatches. Reader p95 similarity/deep/region 145/277/611 ms. Ten reviewers: 2.125 s on 2 CPU, 839 ms on 4 CPU. Search 5.07 s; export complete/revocation fail-closed verified. Laravel 41/284 and isolated backfill regression 55 passed; initial TypeScript/build passed.
- Login bootstrap gate fixed, targeted mock browser passes; real MySQL flag-off login remains pending. Added default-off business API/legacy/queue-admission freeze fence and preexisting checkpoint version/history recovery checks. Native isolated tests 11/30 + review regression 17/181, TypeScript/focused lint pass. Full 300k readiness/rollback and production guard/replay/drain proof pending; Docker unavailable, exact UAT cleanup pending. Main DB/flags/history/algorithm untouched; no heavy rerun, commit or push. See WORKSPACE_SHARING_CUTOVER_UAT.md.

## Previous Milestone

Backend shared readers Tahap 5C — isolated, no activation (2026-10-13).
- Added four authenticated/scoped GET readers using review_states as sole effective decision source, real versions/actors/protection, bounded candidate snapshots and partial-aware source preview. Isolated catalogue now supplies owner_name/access_role. No legacy reader/UI/schema/main DB/flag changes.
- MySQL reader 67 assertions + 15 supplemental checks; prior stages 94/55/48/81 assertions, Laravel 40 tests/260 assertions and Node 3 passed. Warm 300k synthetic state status page p50/p95 206.60/236.33 ms, 12 queries, 19,463 bytes; score-sort supplemental p95 3.51 s. No full candidate-data/matching/browser/cutover proof. See REVIEW_READERS_STAGE5C.md and benchmark JSON. Frontend adapter remains pending. Stop 5C.

## Previous Milestone

Frontend workspace access/approval Tahap 5B — gated, mock-tested, no activation (2026-10-13).
- Added typed Stage 5A client, effective permissions, reusable member modal, shared-ID list/Matching shell, admin access action, approval inbox and versioned review/proposal/Undo components. Default UI flag off; legacy pages/writers retained. No main database/backend/algorithm changes. See REVIEW_FRONTEND_STAGE5B.md.
- Browser mock 17 + flag-off legacy 1 + Node compatibility 3 passed; TypeScript, focused lint and production build passed. Global frontend lint has 25,150 errors/21 warnings, mostly formatting. Missing full shared/versioned readers and owner-name DTO prevent genuine backend/full-workflow integration; local dev fixture is not a server reader. Stop 5B, no live activation/cutover.

## Previous Milestone
Concurrency-safe review Tahap 4 — tested in isolation, inactive on live API (2026-10-13).
- Added bounded CAS/idempotent review service with unique reference/entity/hold guards, permission/protection checks, partial bulk outcomes and atomic append-only Undo. No new schema or old route/UI/algorithm changes. Config default off; hard test-DB guard. See REVIEW_TRANSACTIONS_STAGE4.md.
- MySQL independent connections: 48 assertions passed (including real deadlock/retry); Stage 2/3: 94/55. Backend 33 tests/223 assertions; frontend contract 3 tests. Warm 5,000-input service benchmark p95 1/5/10 reviewers: 11.49/53.99/86.29 ms, PHP 12 MiB/worker. No 300k/HTTP/durability verification. Main stage tables/migrations zero; no cutover/sharing/approval. Test server removed. Stop Stage 4.

## Previous Milestone
Review reconciliation/backfill Tahap 3 — tested in isolation, unapplied to main DB (2026-10-13).
- User approved dataset-scoped verified entities and neutral hold/issue schema. New migration retains held historical state without publishing colliding assignments; no winner chosen. Disk-backed source/history audit and chunked idempotent shadow backfill support resume/guarded rollback; unverifiable lineage remains partial/unverified. See REVIEW_BACKFILL_STAGE3.md.
- MySQL 8.0.46/InnoDB: Stage 3 55 assertions and Stage 2 94 assertions passed; backend contract/review/export regressions and 3 frontend contract tests passed. Fixture 2,000 input: ~6.3s / PHP peak 12 MiB; full-scale benchmark still needed. Writer restricted to disposable test DB; no main migration/backfill/ready change, runtime cutover, sharing, approval or concurrency service. Main stage migration/table counts zero.

## Previous Milestone
Review schema additive Tahap 2 — completed, unapplied to main DB (2026-10-13).
- Two migrations prepare six review/sharing/entity tables, generated unique assignments/canonical guards, workspace/job versioning and nullable audit links/actors/versions. No runtime reads/writes switched, no historical backfill or similarity/UI changes.
- MySQL 8.0.46 InnoDB isolated tmpfs test: 94 assertions passed including up/down/reapply, FK/unique/key checks and legacy fixture data/column/index preservation. Rollback refuses populated additions.
- Stage 1 regressions: 19 backend tests / 189 assertions and 3 frontend tests passed. Main DB Stage 2 migration count remains zero. Test container removed. See REVIEW_SCHEMA_STAGE2.md for limits and future write-service obligations.

## Previous Milestone
Review contract Tahap 1 — implemented (2026-10-13).
- Centralized compatible status mapping; rejected candidates remain pending in Results counts. Badges/export categories preserved.
- Added actors and accounting payloads, with unknown legacy identity/lineage and null unverified entity counts. New decisions/Undo capture separate actors using existing fields.
- No schema migration, historical backfill, similarity changes, sharing, approval or new concurrency guarantees. Details: REVIEW_CONTRACT_V1.md.
- Verification: 19 backend tests / 189 assertions on isolated SQLite; 3 frontend contract tests, TypeScript and production build passed. No live review writes.

## Previous Milestone
Case-group preparation recovery — completed (2026-10-13).
- Concurrent cold group requests exceed the 10-second lock wait and return 503; the frontend previously treated this as a terminal error. API now returns `case_groups_preparing` and Retry-After; review GET retries only that condition, at most 12 times, with abortable waits. Other errors still surface with a retry button; failed counts show unknown rather than zero.
- Actual job 01a12eb3 warmed service read returned 11 groups / 7,549 members in 0.45 seconds. Earlier server request logs show approximately 93-second cold reads; cold-build speed is unchanged by this fix.
- Verification: 12 review tests / 130 assertions, frontend build and TypeScript passed. Browser synthetic 503 -> success used two GETs; abort during retry stopped at one GET. Authenticated live browser verification was unavailable; actual service read succeeded without changing decisions.

## Previous Milestone
Selected-workspace cleanup and compact scores — completed (2026-10-13).
- Preserve the seven workspaces in the user's screenshot and all 17 linked jobs, referenced datasets, and 1,308 review decisions. Initial manifest identifies 14 unrelated jobs and 1,005,045 unused result rows. Maintenance performs bounded deletes, lossless payload conversion, and retained-count/decision-hash verification; original manifest is under storage/app/maintenance.
- Full field-score explanations packed losslessly alongside SQL-readable column/score projections; short payloads stay uncompressed if packing would grow them. Sample 1,000-result payload reduced 22.5%. Reversible migration removes four redundant prefix indexes; migration applied, relevant regressions passed.
- Seven-day binlog retention applied. User explicitly approved MINIMAL row logging and I/O capacity 1,000 on 2026-10-13; both applied live and persisted in Compose. Logging ON, max I/O 2,000, buffer pool 2 GiB unchanged. Conversion still uses the application account, never root.
- Checkpoint free pages compacted: legacy SQLite 1.6 GB -> 312 KB; native checkpoint SQLite 3.3 GB -> 372 KB. Kept headers preserved; reference caches untouched.
- Deletion finished: 14 unused jobs, 13 unused datasets and 1,005,045 unused candidates removed. Seven workspaces/17 jobs/12 datasets and decision hash verified. Thirteen orphan files (1.04 GB), three obsolete spill files (265.7 MB), and one orphan search index removed. Temporary staging/primary-key joins replace slow CASE updates. Targeted regressions passed: 29 tests/232 assertions.
- Historical conversion finished: 3,307,263 retained candidates verified, packing processed 3,304,535 candidates (new or already compact), and 2,728 small payloads stayed unchanged; all 1,308 decisions unchanged. Final pass peak PHP allocation 31.1 MiB. Repeated staging DELETE accumulated 3.6 GiB; TRUNCATE per batch now holds staging around 12 MiB.
- Both table rebuilds and offline VHD compaction finished. matching_results approximately 35 GiB -> 15.1 GiB; MySQL directory approximately 62 -> 43 GiB including logs. VHD 113.08 GB initially, 142.31 GB during rebuilding, then 62.12 GB after compaction/restart. All 3,307,263 candidates and 1,308 decisions verified after restart; checksum unchanged. Five containers running, backend/frontend HTTP 200 and Meilisearch available. Approved MINIMAL/I/O settings persisted and verified.

## Previous Milestone — Memory Efficiency

Matching RAM and storage efficiency improved (2026-10-12).
- Merge candidate search batches directly into ID-only lists; release consumed search/output buffers before the next batch. Checkpoint SQLite cache is capped at 8 MiB, with disk-backed temporary work and bounded restore inserts.
- Lossless fast compression for checkpoints and verification evidence; new evidence lives in candidate metadata, while the model preserves the old API and reads historical results. Field scores remain SQL-queryable. No results or decisions deleted; no schema migration.
- Read-only 1,000-result benchmark: checkpoint 3,589,861 -> 591,912 bytes (83.5% smaller); metadata/evidence 1,688,370 -> 1,456,320 bytes (13.7% smaller). Checkpoint encode/decode 30.71/32.68 ms; evidence encode plus integrity checks 50.29 ms.
- Runtime uploads, SQLite databases, spill/cache files, logs, and testing artifacts excluded from Docker build. MFD dictionary retained. Old processing status from September 24 is stale; queue contains no reserved/pending jobs.
- Existing results and MySQL binary logs are retained. Historical database size will not shrink automatically; a full production-size before/after run is still needed to measure peak RAM and end-to-end throughput.
- Verified 30 backend tests / 234 assertions; rebuilt and applied images (11.9 GB -> 1.33 GB each, shared layers). Active images total 16.55 GB -> 5.981 GB; obsolete build cache cleanup reclaimed 12.58 GB. API/frontend HTTP 200 after recreation; all five containers running.

## Previous Milestone — Address Normalization

Address suffix normalization corrected (2026-10-12).
- Reproduced Jrobang false conflict: JL/JALAN already normalized, but No 14 A was parsed as 14 and compared against 14A, triggering the 60% conflict cap.
- Backend scoring and frontend standardized preview now canonicalize labeled house numbers and single-letter suffix spacing (14 A/14A/014 A). Distinct suffixes/numbers remain conflicts; raw source values are preserved.
- Reference normalization cache version bumped to avoid reusing old address strings. Persisted scores and manual decisions remain unchanged until reevaluation.
- Verification passed: 10 backend tests / 85 assertions, TypeScript, and production frontend build. Worker reload signaled gracefully after verification.
## Previous Milestone — MFD Context

MFD context disambiguation corrected (2026-10-12).
- Regency-name normalization uses separate province/regency codes, including numeric `prov`/`kab` aliases present in the actual reference row. Read-only comparison of input 35607 now resolves both Bandung sides to 3204.
- Synced frontend/backend MFD dictionaries still contain 514 entries. City names carry KOTA for local codes starting with 7; region options use full labels to distinguish kabupaten/kota. Frontend lookup no longer guesses between ambiguous bare names.
- Reference normalization cache version bumped so new matching cannot reuse the old unresolved names. Old persisted scores/decisions remain unchanged and require reevaluation; no user decisions were overwritten.
- Relevant backend regressions passed (18 tests), with an additional targeted rerun verifying the actual alias. Frontend build/TypeScript passed; worker receives a graceful reload.
## Previous Milestone — Bulk Feedback and Layout

Bulk outcome feedback and sorting layout corrected (2026-10-12).
- Latest actual batch requested 100 but applied 82; 18 were excluded because multiple inputs pointed to the same reference. All 82 saved outcomes are matched; excluded example records have no active review decisions.
- All-record bulk notifications now report the API's applied count and skipped count, with an expandable list of exclusions. Group exclusions use the same detail panel; records reviewed afterwards leave that list.
- Cumulative diagnostics remain mounted when table items temporarily clear for sorting/filtering. Review skeleton reserves the same 520px table viewport, preventing the large page jump. Verified sort changes with an artificially delayed read-only fetch; no decisions were saved.
## Previous Milestone — Dropdowns and Classification

Consistent review dropdowns and address completeness classification corrected (2026-10-12).
- Sort/province/regency filters share the existing searchable-select component. Sorting omits only the search input; panel, options, keyboard selection, focus return, and portal positioning remain shared.
- Confirmed actual KARMA MANGGALA YUDHA result: WLS 98%, address 92%, construction checks 2/2 passed, but an unconditional partial-address override forced Need Review. Removed that override; enrichment availability is informational evidence. Address component conflicts and failed verification still require review.
- Existing persisted outcomes and reviewer decisions are unchanged. New matching uses corrected classification; old outcomes need reevaluation before their status can change. Worker receives a graceful reload signal.
- Targeted fixture covers 98% auto-match, a failing 95% address rule, and conflicting address numbers. Browser checks verify sorting keyboard selection/return focus and province search without saving decisions.
- Verification: 9 backend tests/68 assertions, TypeScript, and frontend build passed.
## Previous Milestone — Review Filters

Case-group members and review query filters implemented (2026-10-12).
- Cached group membership is resolved independently of `include_groups`; detail pages hydrate only paginated candidate rows. A shared lock prevents concurrent cold builds, with distinct not-found/preparation errors and retry UI.
- All-record and group queries apply search, effective status, input MFD region, similarity range, and stable sort before pagination. Review-selected candidates determine score/display; string keys break ties.
- Region columns/indexes migrated. Background backfill for job `01a12b82-477a-7270-b8fe-566756f87f2f` completed (133,524 inputs; 38 provinces/504 regencies). Worker received a graceful reload signal. Matching and user decisions were not rerun or replaced.
- Actual Beda Alamat group: 1,462 members. Warm HTTP reads: 899–986 ms for details/sort/region/range/search. Cold cache rebuilding: 11.5–19.2 seconds; warm backend detail: 201–327 ms. EXPLAIN confirms score/region and job/input/rank indexes, with scalar union sorting still requiring filesort.
- Verification: review 10 tests/121 assertions; matching pipeline/cache/store 9 tests/60 assertions; TypeScript/build passed. Browser verification is read-only; filter changes use skeletons and same-query updates retain rows.
## Previous Milestone — Stable Loading

Stable loading and review updates implemented (2026-10-12).
- Review tables and case groups retain their contents during background refresh. Successful decisions update affected rows; rows leaving the active filter fade out. Filter/page changes use table skeletons, and same-query refresh preserves open record dialogs.
- Upload inspection has separate pending state. Existing datasets, previews, and mappings remain visible during replacement; failed inspection preserves the active dataset. Initial upload uses skeletons, and newly created workspaces avoid redundant rehydration.
- Server preview retains rows during refresh with a small updating indicator. No API/database changes.
- Browser smoke checks with Chrome network set to Offline and synthetic responses: review table remained mounted while 25 rows became 24; All retained 25 rows; new filters/initial upload used skeletons; replacement success/failure retained all four existing tables. No persisted decisions or datasets were changed.
- Verification: final frontend build, TypeScript check, and whitespace check passed. Browser returned to live Matching with all mocks removed.
## Previous Milestone
Review performance and full-job column diagnostics stabilized (2026-10-11).
- Column quality uses exact full-job primary-candidate aggregates; pagination never substitutes a page sample. Missing scores are reported separately.
- Review queries bind input keys as strings so MySQL can use its indexes. Decisions/undo return affected-record snapshots after committing; bulk guardrails remain enforced.
- Case membership is cached independently of review decisions, with current decision/history overlays. Diagnostic requests are separate from table and mutation loading.
- Router shows pending navigation immediately and preloads on intent. Composer dependencies use shared native Docker volume `rematch_backend_vendor`.
- Measured on the active 133,524-input job: browser review GET 216–408 ms; rollback-only individual decision 174 ms; Matching-to-Results navigation 314 ms. After the covering index was applied, Unmatched pages 100/4,000 measured 646/922 ms. Cold initial reads can be slower; these are observations, not a throughput guarantee.
- Verification: review regressions 7 tests/65 assertions; frontend build and TypeScript check passed.

## Project Status and Architecture
- Upload through Review, workspace resume, dashboard/results, authentication, ownership, and role foundation are implemented. Sync audit and CSV/XLSX export remain frontend/local.
- Frontend: React, Vite, TypeScript, Tailwind. Backend: Laravel REST API and queued full-file matching; MySQL stores domain data, Meilisearch generates candidates, SQLite stores normalized caches/checkpoints.
- Workflow: Upload -> Profiling -> Mapping -> Configure -> Run -> Review -> Sync -> Export. CSV/XLSX inspection persists datasets/columns; matching persists configuration, candidates, and progress.
- Review includes case groups, cumulative diagnostics, safe bulk decisions, history, and undo. Results is read-only and returns unfinished work to the matching workflow.
- Authentication uses Laravel Sanctum sessions. Backend role/permissions are authoritative; ownership uses direct user_id. Roles: admin, user, pimpinan; monitoring is read-only.
- Development users can be seeded using BATCHMATCH_DEV_USER_PASSWORD, BATCHMATCH_DEV_ADMIN_PASSWORD, and BATCHMATCH_DEV_PIMPINAN_PASSWORD.

## Known Limitations
- AI assistance and server-side sync/export histories remain incomplete. Additive review/sharing tables and isolated transaction service are prepared but unapplied/inactive on the main database.
- Persisted historical scores need reevaluation to apply newer normalization/classification rules; manual decisions are preserved.
- Full-production-size peak RAM and throughput comparison remains outstanding. Warm request/sample benchmarks are observations, not guarantees.
- Admin currently supports role/password/owner management; monitoring has limited filters/export.

## Continuation Rules
- Latest blocker-only follow-up: CodeGraph installed/local MCP integrated, indexed once; rollback evidence rechecked under deletion lock. Recovery unit 7/10 passes; Docker offline, MySQL login/lock and production recovery remain pending. Main untouched, NO-GO.
- PRD.md is the product source of truth; .codex/PROJECT_RULES.md and docs/UX_GUIDELINES.md apply. One request = one milestone.
- Preserve published Git history (Lovable). Existing unrelated working-tree changes must be retained.
- Workspace snapshots hold UI state, domain tables hold datasets/results. Resume via /matching?workspace={id}; never rerun restored results. Deleting a workspace does not automatically delete its datasets.
- Hydration is backend-first; auth lifecycle is independent of workspace navigation. Non-auth 401s require /api/me verification before clearing auth.
- Sidebar: Dashboard, Matching, Results, Settings; workspace listing supports continue/rename/delete. Product: RE-MATCH, Direktorat Statistik Sumber Daya Mineral dan Konstruksi, BPS.
- Future steps are gated; export requires confirmed Sync. Pimpinan enters /monitoring and has cross-workspace read access.
- Stage 5B frontend integrated with real shared/versioned readers; isolated browser and MySQL verification passed. No main migration/backfill/cutover, live flag or sharing/approval activation without further approval.
