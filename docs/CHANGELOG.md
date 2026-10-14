# RE-MATCH Changelog

## Unreleased

- Production guard defaults isolated/closed; exact DB/release and hash-pinned operator backup/recovery/drain attestation required, with shared access mandatory and no test probe in production. Guard/boundary 8/17 passed; one-input MySQL post-write recovery 7 assertions passed (destructive rollback refused, append-only Undo restores state). Fix UAT bootstrap copying host SQLite DBs; diagnose 502 as unready fixture upstream. Main backup found empty, isolated restore permission/path pending; no main flags/DB changes.

- Blocker-only Docker follow-up: isolated MySQL backfill 57 assertions and two-connection InnoDB lock/release passed; fence/recovery unit 12/32 passed. Browser login pending due test startup/proxy failure. Fixed-test guards, main backup restore proof and post-write recovery still NO-GO; no main DB/flag changes. Disposable resources cleaned, five main services running.

### NO-GO blocker hardening (2026-10-14)

- Follow-up: rollback evidence deletion now locks and revalidates the row within a short transaction; resolved evidence is retained. Focused recovery tests: 7 passed / 10 assertions; PHP lint and diff check passed. CodeGraph installed/integrated locally and indexed once; Docker unavailable, MySQL lock/login verification and production recovery remain pending.
- Gate login inputs/submit on auth bootstrap; focused delayed-bootstrap browser regression passes, real MySQL login still pending. Add default-off shared-marker API/legacy writer and queue admission fence; running requests/workers must be drained separately.
- Capture/recheck preexisting checkpoint versions/operation IDs and source/history before recovery; old incomplete proof fails closed, processing jobs cannot become ready. Native isolated tests 11/30 + review regression 17/181, TypeScript/lint pass. No main DB/schema/flags, guard relaxation, heavy UAT rerun or cutover; full MySQL/backfill/replay readiness pending.

### Workspace Sharing UAT closure (2026-10-14)

- Hardened export against successful partial CSVs and fenced legacy review/Undo in new backend modes. Optimized paging/counts/joins with an additive region-count index; main database/flags unchanged.
- Real shared workflows and 300k/900k/30k integrity/load/export verified. Similarity/deep/region p95 145/277/611 ms; ten-reader load requires capacity review, substring search remains ~5.07 s. Synthetic backup/restore and DDL verified; full 300k backfill completion and real flag-off browser remain unverified. NO-GO; stopped on user request. Docker offline prevents final UAT resource removal; safe cleanup script prepared. See WORKSPACE_SHARING_CUTOVER_UAT.md.

### Indexed similarity and real shared frontend integration (2026-10-13)

- Added derived-score migration/indexes/transactional triggers and optimized identity joins; no main migration/history/similarity change. Comparable warm 300k reader p95 1,988 -> 259 ms, 8 MiB PHP, same 19,404-byte payload.
- Sharing UI now consumes actual reader/writer/approval APIs, without runtime fixture. Added scoped state CSV export, current-version refresh fences, durable conflict feedback, authoritative sharing auth bootstrap and shared Results. Legacy behavior remains when flag off.
- MySQL 48/81/67 + schema/backfill 94/55 assertions and 10 projection checks passed; Laravel 40/260 and Node 3 passed. Real-session browser flow, concurrent record/ref conflicts, Admin access management and flag-off regression tested. See SHARED_WORKSPACE_INTEGRATION_QA.md for final frontend checks, limits and cutover prerequisites. No activation.

### Isolated shared reader and versioned API Tahap 5C (2026-10-13)

- Added four scoped GET readers for workspace metadata, review_states, candidate snapshots and dataset preview under existing fixed-test guard. Enriched isolated workspace catalogue with owner/role. No legacy reader, schema, historical decision, frontend binding or main flag change.
- Real state versions/actors/protection, explicit readiness and partial preview; bounded payload, batch candidate/actor/canonical reads, selected-candidate scope proof and verified entity claim/hold indicators.
- Isolated MySQL: Stage 5C 67 assertions + 15 supplemental checks; Stage 4/5A 48/81 and schema Stage 2/3 94/55 passed. Node contracts 3 passed. Laravel 40 tests/260 assertions passed. See REVIEW_READERS_STAGE5C.md for test scope and limits.
- 300,000 synthetic states, warm status pagination: p50/p95 206.60/236.33 ms, 12 queries, 19,463 bytes, PHP process peak 32.06 MiB. Supplemental similarity sort p95 3,512.49 ms: one-second target not met; large fixture lacks full candidate snapshots. No full matching/browser/cutover guarantee.

### Gated sharing and approval frontend Tahap 5B (2026-10-13)

- Added Stage 5A-only client, backend-effective permission rendering, reusable access modal, own/shared workspace metadata list, admin access action, proposal/inbox/approval/Undo controls, durable conflict feedback and custom remote-search select.
- Default UI flag off; original workflow/writers retained. No main database, backend, migration, backfill, algorithm, history or cutover changes. Full shared/versioned readers absent from Stage 5A: record UI verified with explicit dev fixture only, never guessed versions or legacy writer fallback. See REVIEW_FRONTEND_STAGE5B.md.
- 17 mock Chromium scenarios, 1 flag-off legacy browser regression and 3 Node contracts passed; TypeScript/focused lint/build passed. Global frontend lint still fails (25,150 errors/21 warnings). Mock success is not real backend/full-workflow integration; no activation.

### Isolated workspace access and approval backend Tahap 5A (2026-10-13)

- Added workspace application/membership policy, registered member search and versioned grant/change/revoke. Shared permission locks coordinate review and revocation without exclusive workspace review locking.
- Proposals preserve effective state; Owner/Admin approval uses Stage 4 CAS/unique/hold/idempotency writer, separately records previous reviewer/proposer/approver/operator, and protects approved revisions. Rejection/stale/conflict events remain in operation ledger; historical decision rows unchanged.
- Added 12 authenticated isolated API routes, strict actor/field validation and namespace-only preservation of padded opaque keys. No new schema, main migration/backfill, UI/algorithm change, cutover or live sharing activation. Main flags false; disposable MySQL removed.
- MySQL 8.0.46: Stage 5A 81 assertions, Stage 4/2/3 regressions 48/94/55; backend 37 tests/235 assertions and Node contract 3 tests passed. Small warm Editor service benchmark p95 24.39 ms / 39 queries; full-scale/durability still unverified. See REVIEW_ACCESS_APPROVAL_STAGE5A.md.

### Isolated concurrency-safe review Tahap 4 (2026-10-13)

- Added bounded CAS/idempotent transaction service, indexed reference/entity/hold checks, permission and protection checks, explicit partial bulk outcomes and atomic append-only Undo. Historical actors, string identities and engine classifications/scores preserved.
- MySQL 8.0.46 independent-connection tests passed 48 assertions, including actual deadlock/retry, same-input/reference collisions, revocation, candidate switching and bulk Undo rollback. Stage 2/3 regressions passed 94/55 assertions; backend 33 tests/223 assertions and frontend contract 3 tests passed.
- Direct-service synthetic benchmark (5,000 inputs): 1/5/10 reviewers p95 11.49/53.99/86.29 ms; PHP peak 12 MiB per worker. Full-scale/HTTP/durability performance remains unverified. See REVIEW_TRANSACTIONS_STAGE4.md for measured server RAM and limits.
- No main migration/backfill/readiness writes, active API/UI/algorithm change or cutover. Default-disabled configuration plus test-database guard; sharing/approval inactive. Disposable server removed. Stop at Tahap 4.

### Review reconciliation and shadow backfill Tahap 3 (2026-10-13)

- User approved dataset-scoped verification snapshots and additive neutral hold/issue migration. Held states retain provable historical status/resources; colliding claims are held together without selecting a winner.
- Added disk-backed lineage/history dry-run, explicit accounting/unknown evidence, deterministic proposals, chunked idempotent shadow backfill, checkpoint replay and guarded rollback. Legacy keys/NULL actors/actions/Undo preserved; ambiguous history is quarantined, not recomputed.
- Isolated MySQL 8.0.46/InnoDB: 55 assertions passed, plus independent Stage 2 94 assertions and relevant backend/frontend contract regressions. Fixture 2,000 input ~6.3s with 12 MiB peak PHP allocation; full-scale benchmark deferred.
- No main migration/backfill/readiness writes, application cutover, sharing, approval, concurrency service, similarity or UI/API change. Production writer explicitly disabled. Main migration/table counts zero. See REVIEW_BACKFILL_STAGE3.md.

### Additive review schema Tahap 2 (2026-10-13)

- Added six foundation tables for review state, idempotent operations, proposals, memberships and verified reference entities; generated conditional assignment uniqueness, canonical-only duplicate FK and pending-request uniqueness.
- Prepared workspace/job versioning and nullable review_decisions audit columns without backfill or runtime cutover. Added safe rollback guards for used schema additions.
- Isolated MySQL 8.0.46 InnoDB tests passed 94 assertions for migration up/down/reapply and constraints, preserving old fixture data/columns/indexes. Stage 1 regressions remained green (19 backend tests / 189 assertions, 3 frontend tests). No primary-database migration performed.

### Review contract Tahap 1 (2026-10-13)

- Centralized existing action/status mapping; Results counts rejected candidates as pending rather than unmatched, while retaining badges and export action categories.
- Added contract version, honest preprocessing/entity accounting, and separate actor payloads. New decisions record the authenticated reviewer using the existing FK; new Undo records its actor without replacing the reviewer. Legacy attribution remains unknown.
- Documented opaque keys, lineage limitations, compatibility and deferred concurrency/sharing boundaries in REVIEW_CONTRACT_V1.md. No schema/data migration or similarity change.
- Verified 19 backend regressions / 189 assertions on isolated SQLite, 3 frontend contract tests, TypeScript and production build; no live review decisions changed.

### Case-group preparation recovery (2026-10-13)

- Concurrent group-cache preparation returns `case_groups_preparing` / Retry-After. Review GET retries that response up to 12 times; leaving the view aborts pending waits. Other errors provide a retry button and unknown counts rather than zeroes.
- Warm service read returned 11 groups / 7,549 members in 0.45 seconds. Cold construction remains expensive (approximately 93-second request logs); this fixes recovery, not build throughput. Verified 12 review tests / 130 assertions, build/TypeScript, and browser synthetic retry/cancellation. Decisions unchanged.

### Retained-workspace cleanup and compact scores (2026-10-13)

- Keep the seven explicitly selected workspaces and all their linked jobs, datasets, and review decisions. Maintenance scripts default to dry run, validate the exact workspace selection, record a manifest, verify source/evidence round trips, and compare retained counts and decision hashes.
- Store SQL-readable per-field score projections alongside losslessly packed explanations; avoid growing short records. Sample 1,000-result payload: 3,196,347 -> 2,476,036 bytes (22.5% smaller).
- Remove four redundant matching-result indexes via reversible migration. Compact SQLite free pages after removing only checkpoint headers associated with explicitly removed jobs.
- Set local binary-log retention to seven days; logging remains enabled. User approved MINIMAL row images and background I/O capacity 1,000 on 2026-10-13; both applied and persisted in Compose, with max I/O 2,000 and RAM buffer unchanged.
- Completed historical conversion and physical cleanup: seven workspaces, 17 jobs, 12 datasets, 3,307,263 candidates and all 1,308 decisions verified after restart. Removed 14 unused jobs, 13 datasets and 1,005,045 candidates. Matching-results file approximately 35 -> 15.1 GiB; total MySQL directory approximately 62 -> 43 GiB including logs. Docker VHD 113.08 -> 62.12 GB after offline compaction; temporary peak was 142.31 GB.
- Reset private staging per batch using TRUNCATE: repeated DELETE had accumulated 3.6 GiB of temporary space; staging now stays around 12 MiB. Final maintenance pass PHP peak was 31.1 MiB. New candidate IDs use UUIDv7; historical IDs remain unchanged. Backend regressions passed (29 tests/232 assertions), all services restored and approved server settings verified persistent.

### Matching storage and RAM efficiency (2026-10-12)

- Merge Meilisearch responses batch by batch, retain candidate IDs only, and free consumed buffers before allocating the next chunk.
- Compress checkpoint payloads losslessly, read legacy JSON checkpoints, cap SQLite page cache at 8 MiB, and restore in 250-row batches.
- Store verification evidence losslessly in candidate metadata for new results; preserve model/API evidence shape and historical compatibility. Keep scores and searchable source metadata uncompressed.
- Exclude runtime files, uploaded datasets, local SQLite databases and testing artifacts from backend images; avoid recursively duplicating storage in a permissions layer.
- Add read-only sample benchmark and payload-size chunk metrics. No historical results, manual decisions, or binary logs deleted.

### House-number suffix normalization (2026-10-12)

- Standardize No. 14 A, No 14A, and No 014 A identically before address scoring/conflict detection, alongside JL/JLN/JALAN expansion.
- Align frontend previews with backend normalization; keep genuine 14A/14B/15 differences and preserve source addresses and user decisions.
- Invalidate old reference-normalization caches for subsequent matching evaluations.

### MFD regency/city context (2026-10-12)

- Resolve ambiguous names such as Bandung/Kupang through separate source-row codes, including numeric columns named `kab` and `prov`.
- Prefix city dictionary names with KOTA for local codes starting with 7; retain all 514 entries and distinct kabupaten/kota identities. Extraction script and both dictionaries remain synchronized.
- Align frontend resolution with backend: retain multiple name candidates, require context for ambiguity, and avoid guessing from partial tokens. Region options show full administrative labels.
- Invalidate old reference-normalization cache signatures for new matching; preserve previous result evidence and manual decisions.

### Bulk feedback and stable sort layout (2026-10-12)

- Report actual bulk affected records instead of the number selected. Explain skipped safety exceptions in a persistent expandable list; do not claim excluded rows were accepted.
- Keep cumulative diagnostic panels mounted during table-query changes and reserve the review table's viewport height in loading skeletons.
- Confirmed latest live 100-selection batch saved 82 matches and excluded 18 shared-reference cases. No backend safety rule or persisted review decision was changed.

### Dropdown consistency and address classification (2026-10-12)

- Replace native review sort select with the existing shared dropdown; add a non-searchable variant with identical trigger/panel/items and accessible keyboard focus.
- Stop forcing compatible partial/full addresses into review after configured thresholds/verification pass. Keep enrichment as an informational evidence flag and retain review for conflicting address components or failed rules.
- Preserve persisted job outcomes and reviewer decisions; corrected classification applies on evaluation, not as an automatic rewrite of old results.

### Case-group members and review filters (2026-10-12)

- Fix empty case details when `include_groups=false`; resolve cached membership independently of summary delivery, preserve string record keys, and fetch only paginated candidates.
- Serialize cold group-cache builds; expose specific missing-group and retryable preparation errors. Group search now searches record contents.
- Add full-job similarity sorting/ranges and input province/regency filters to both review views. Selected reviewer candidates determine the displayed/sorted score; ties use stable text keys.
- Add indexed canonical MFD region columns, queued incremental backfill for existing jobs, and a readiness/options endpoint. The active 133,524-input job finished backfill and exposes 38 provinces/504 regencies without rerunning matching.
- Preserve skeletons for changed queries and existing rows during background updates; column charts remain cumulative. Relevant review tests: 10 passed/121 assertions; matching regression tests: 9 passed/60 assertions; TypeScript/build passed.
- Live warmed HTTP reads after backfill: 899–986 ms across group pages, score sort, region/range, and group search. Cold group rebuilding measured 11.5–19.2 seconds; warm backend group reads 201–327 ms. No persisted user decisions changed during browser verification.

### Stable loading (2026-10-12)

- Keep review tables/case groups mounted during background refresh; update affected records and gently remove rows that leave the selected status filter.
- Use table skeletons for first loads and different filters/pages, with a small updating indicator for existing data.
- Preserve active datasets, previews, and mappings during replacement inspection; retain them on failure and avoid rehydrating a freshly created workspace after upload.
- Keep server preview rows visible during refresh and preserve open record dialogs on same-page review updates.

### Review performance (2026-10-11)

- Count column quality across all primary candidates, without sampling or extrapolation; show records without score separately.
- Preserve text bindings for numeric-looking input keys, keeping MySQL review queries indexed.
- Read only targeted records for decisions/undo, commit before constructing the response, and retain bulk safety exclusions.
- Cache immutable case membership and overlay decisions instead of rebuilding groups after each action.
- Separate column diagnostics from table requests; preload navigation and show immediate pending feedback.
- Store Composer dependencies in a shared native Docker volume to avoid Windows filesystem overhead.

### Added

- Results page integration with real workspace context, matching job outputs, review decisions, sync summary, and export history
- Workspace-linked export history metadata persisted from Step 8 for later reading in Results
- Authentication foundation with Laravel Sanctum session/cookie login, current user, and logout endpoints.
- Role and permission foundation with centralized backend permission mapping for `admin`, `user`, and `pimpinan`.
- Direct workflow ownership on datasets, matching jobs, and workspaces through authenticated `user_id`.
- Admin area MVP for user role management and workspace owner reassignment.
- Pimpinan monitoring dashboard with organization-wide read-only workspace visibility.
- Administration user creation, user editing, and admin password reset actions.
- Dedicated monitoring and administration frontend routes using the existing RE-MATCH shell.
- Multi-account development seeding through role-specific environment variables.
- Backend permission middleware for protected workspace, inspect, matching, and review APIs.
- Frontend permission-aware auth state, role-aware shell navigation, and access-denied pages for restricted sections.
- Protected app access for authenticated users only, with login redirect and dummy registration/password-reset routes disabled.
- Frontend auth state centralization for current user, loading, login, logout, and session refresh.
- Initial RE-MATCH frontend with Dashboard, Matching, Results, and Settings.
- Matching wizard aligned to the main workflow: Upload -> Profiling -> Mapping -> Configure -> Run -> Review -> Sync -> Export.
- Synchronization / merge strategy for matched, unmatched, possible match, and conflict records.
- Preferences support for dark mode, light mode, system theme, English, and Bahasa Indonesia.
- Frontend feedback states: loading, empty, error, toast notifications, and confirmation dialogs.
- DX automation for Playwright smoke tests, automatic screenshots, Lighthouse audit, and unified review command.
- Architecture documentation covering roadmap, architecture, database design, REST API draft, and changelog.
- Backend health endpoint and dataset inspect endpoint for CSV/XLSX.
- Database migrations and models for `datasets` and `dataset_columns`.
- Frontend Upload and Profiling integration with Laravel inspect API through `VITE_API_BASE_URL`.
- Backend and frontend tests for the first Upload -> Inspect -> Profiling vertical slice.
- Real Column Mapping frontend slice using inspected reference/input columns.
- Non-AI auto-suggest for matching columns with the same or simply similar names.
- Mapping rows for unmatched reference columns with empty input selection.
- Mapping type badges and suggestion source metadata.
- Configure Quick Setup with Balanced, Strict, Exploratory, and Custom presets.
- Configure Summary Configuration for the selected preset, thresholds, search mode, candidates, output count, and normalization preset.
- Configure e2e coverage for Quick Setup, Summary Configuration, and collapsed Advanced Settings.
- Conditional Configure flow for Exact, Fuzzy, Composite / Hybrid, and Rule-Based strategies.
- Default algorithm recommendations per mapped field type/name, with advanced algorithms hidden behind More Algorithms.
- Configure validation for active fields, thresholds, candidate count, manual weights, and rule text.
- Workflow-level Configure state snapshot for future Matching Engine handoff.
- Run step configuration summary sourced from saved Configure state.
- Laravel Matching Engine MVP endpoint with job, mapping, configuration, and result persistence.
- Matching pipeline with one-time normalization, index/candidate search, chunked processing, field scoring, Top N, and progress summary.
- MVP scoring support for exact, normalized exact, case-insensitive exact, fuzzy, token-based, and composite-style weighted scoring.
- Review results API for grouped matched, need-review, and unmatched records from persisted Matching Engine output.
- Review decision persistence with accept, reject, select alternative candidate, mark unmatched, and undo support.
- Entity-aware company/name parser for Matching Engine metadata: raw name, core name, legal form, ownership/status qualifier, public status, unit type, and unit name.
- Case-grouped Review with deterministic fingerprints, confidence labels, representative examples, and bulk eligibility rules.
- Review Knowledge metadata storing decision patterns and conditions for future matching runs.
- Traceable Review case groups with Open / Resolved / All filters, decision history, decision source, affected records, and batch undo.
- Smart case-based Review with recommendations, representative samples, deterministic bulk safety validation, and Review Knowledge levels.
- Sync finalization preview using latest review decisions, recommended plan, unresolved-review warning, and local idempotent audit.
- Export Results step with default and custom export modes sourced from latest review decisions.
- Client-side CSV and XLSX export generation for final matching rows and review decision summary.
- Workspace persistence MVP with backend `workspaces` table and REST endpoints.
- Resumable Matching workflow autosave using backend workspace snapshots.
- Workspace list page with Continue, Rename, and Delete actions.
- Dashboard real data integration using saved workspace data from the backend.
- Product-facing rebrand from BatchMatch to RE-MATCH.
- Lightweight organization identity for Direktorat Statistik Sumber Daya Mineral dan Konstruksi, Badan Pusat Statistik.

### Improved

- Matching workspace hydration now rebuilds workflow state from persisted backend workspace data when reopened from Results or direct workspace links.
- Requested Matching steps are now clamped against hydrated backend state instead of stale local step values.
- Protected API 401 responses no longer clear auth immediately unless `/api/me` confirms the session is actually invalid.
- Auth bootstrap now runs once safely, deduplicates session verification, and ignores stale `/api/me` responses that would otherwise overwrite a valid authenticated state.
- Dashboard, Workspaces, Results, and Matching now share router-based workspace navigation/search handling for persisted workflow deep links.
- Matching now hydrates persisted workspace state before rendering a requested workflow step and falls back safely for invalid workspace or step search params.
- Results now reads real workflow data instead of dummy latest-global metrics, fake review history, and fake exports
- Results actions now route users back to Review, Sync, or Export workflow steps instead of duplicating those workflows
- `/api/me` and login session payloads now return user identity plus permissions for frontend authorization.
- Protected workflow resources now scope by authenticated owner for `user`, by read-all for `pimpinan`, and by full access for `admin`.
- Login now redirects `pimpinan` to the monitoring surface after session bootstrap resolves the active role.
- Review, sync, export, workspace rename/delete, and new matching actions are now hidden when the active role lacks permission.
- UI polish for navigation, dashboard tables, workflow stepper, column mapping, matching configuration, manual review, and results tabs.
- Results experience with Overview, Matched, Possible Match, Unmatched, Statistics, Audit Trail, and Export History tabs.
- Settings page with profile, matching defaults, AI preferences, data privacy, and about sections.
- Documentation alignment with `PRD.md`, `.codex/PROJECT_RULES.md`, and the RE-MATCH workflow.
- Mapping workflow now supports manual add, remove, pair changes, type badges, suggestion metadata, and duplicate reference-column prevention.
- Mapping page now focuses only on reference/input column pairing; matching algorithm selection is deferred to Configure.
- Configure technical controls are now grouped under collapsed Advanced Settings for progressive disclosure.
- Configure now shows only controls relevant to the selected strategy.
- Configure now stores only relevant active settings for the selected preset or custom strategy.
- Run step now calls the backend Matching Engine MVP instead of mock random progress.
- Review step now prioritizes real Need Review records, shows Input vs Reference comparison, Top N candidates, and field similarity highlights.
- Company/entity fuzzy matching now compares core names while preserving legal/status/unit metadata as validation constraints.
- Explicit PT vs CV conflicts are downgraded to review instead of becoming Auto Match; missing legal form or missing Persero/Tbk is not treated as automatic conflict.
- Review now defaults to Case Groups while preserving All Records review for granular decisions.
- Bulk review decisions are blocked for mixed or unique groups that are not homogeneous enough.
- Bulk Accept now applies only to records that pass safety validation; exceptions remain in Need Review.
- Accepted or rejected case groups remain visible under Resolved instead of disappearing.
- Sync flow is simplified to Finalize Summary -> Recommended Plan -> Preview -> Confirm Sync.
- Export now shows record-count preview, generated filename, format selection, loading, success, and error feedback.
- Matching workflow can be reopened from `/matching?workspace={id}` without losing uploaded dataset/profile/mapping/config/run progress.
- Dashboard now focuses on Continue Your Work, Action Required, Workspace Summary, Recent Workspaces, and Review Queue.
- Dashboard dummy jobs, fake scores, fake insights, and generic analytics content were removed.
- App shell dummy search, notification, help, account dropdown, and demo identity were removed.
- Upload copy now uses Data Acuan and Data Input terminology.
- Main UI defaults to Bahasa Indonesia.
- Main workflow copy now follows the language switcher for Indonesian and English.
- Workflow stepper now locks future steps until prerequisite state is available.
- Manual future-step URL access is clamped to the highest allowed workflow step.
- Workspace name can be changed from the Matching header and persists through backend autosave.
- Export remains unavailable until Sync is confirmed.
- Encoding artifacts in Matching UI labels were corrected.
- Post-milestone housekeeping for ignored build, test, cache, and temporary log artifacts.

### Notes

- AI service integration, server-side export history, audit persistence, and workspace membership/collaboration are not implemented yet.
- Sync still uses local audit state; Export is frontend-generated from latest Review results; Results still uses mock/local state.
- Matching Engine MVP currently runs against inspected preview rows, not full stored file contents.
- Review decisions remain tied indirectly to owned matching jobs; dedicated membership and reviewer audit tables are still future work.
