# RE-MATCH - Session

## Current Milestone

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

## Project Status

- Upload: Done
- Profiling: Done
- Mapping: Done
- Configure: Done
- Run: Done
- Review: Done
- Sync: Done frontend/local audit
- Export: Done frontend CSV/XLSX
- Workspace Persistence: Done MVP
- Authentication: Done foundation
- Dashboard Real Data: Done
- RE-MATCH Branding and Shell Cleanup: Done
- Language Consistency: Done for main workflow and shell
- Workflow Step Guard: Done
- Workspace Rename: Done
- Role & Permission Foundation: Done
- Workspace Ownership: Done MVP
- Admin Area: Done MVP
- Pimpinan Monitoring: Done MVP

## Completed

- Upload and Profiling are integrated with Laravel `/api/datasets/inspect`.
- CSV and XLSX inspect support persists dataset and column metadata.
- Mapping uses real inspected reference/input columns with non-AI auto-suggest.
- Configure stores conditional matching configuration in workflow state.
- Matching Engine MVP runs through Laravel and persists jobs, mappings, config, results, and progress.
- Review uses real matching results, smart case groups, traceable decisions, safety validation, and undo.
- Sync previews a recommended finalization plan using latest review decisions.
- Export generates default/custom CSV and XLSX from final review state in the frontend.
- Workspace MVP persists workflow progress to backend and can resume the latest step.
- Workspace list supports Open/Continue, Rename, and Delete without deleting datasets.
- Dashboard reads workspace data from backend and no longer shows dummy analytics.
- Results now reads real workspace, matching job, review, sync, and export history data without dummy summaries.
- Matching now rehydrates canonical workflow state from backend workspace data when reopened from Results or direct workspace URLs.
- Requested workflow steps are now validated against hydrated backend state instead of stale local step state.
- Non-auth 401 responses no longer clear frontend auth immediately; `/api/me` is used as the final session check.
- Auth bootstrap now runs once safely with deduplicated `/api/me` verification and stale-response protection.
- Results, Dashboard, Workspaces, and Matching now use shared router-based workspace navigation instead of raw `href` workflow deep links.
- Matching now shows safe loading/not-found states while hydrating persisted workspace state before rendering the requested step.
- Login now uses Laravel Sanctum session/cookie auth with `/api/login`, `/api/me`, and `/api/logout`.
- Protected app routes and workflow APIs now require an authenticated session.
- User role is now part of the session identity with backend permission mapping as the source of truth.
- Frontend shell and workflow actions now hide or deny access based on returned permissions.
- Register and forgot-password dummy routes now redirect to Login.
- Development users can be provisioned by setting `BATCHMATCH_DEV_USER_PASSWORD`, `BATCHMATCH_DEV_ADMIN_PASSWORD`, and `BATCHMATCH_DEV_PIMPINAN_PASSWORD`, then running `php artisan db:seed`.
- Product-facing UI is rebranded from BatchMatch to RE-MATCH.
- Sidebar and application shell no longer show dummy user identity, search, notification, help, or fake account controls.
- Organization identity is shown lightly in the sidebar and Settings.
- Matching workflow copy now follows the language switcher for Indonesian and English.
- Future workflow steps are locked until their prerequisites are available.
- Manual `/matching?step=` bypass is clamped back to the highest allowed step.
- Workspace name can be changed from the workflow header and persisted through workspace autosave.

## Next Milestone

Milestone 10: Stabilization and QA.

Objective: verify auth, ownership, admin, and monitoring flows end to end before moving to deeper backend hardening.

## Current Architecture

Frontend:
React, Vite, TypeScript, Tailwind CSS. Handles UI, workflow navigation, preferences, API calls, local export generation, and workspace resume/autosave.

Backend:
Laravel REST API. Handles health, authentication, dataset inspection/profiling, matching engine run/status, review decisions, and workspace persistence.

Database:
Implemented MVP tables include `users` with role, `datasets`, `dataset_columns`, `matching_jobs`, `column_mappings`, `matching_configurations`, `matching_results`, `review_decisions`, and `workspaces` with direct `user_id` ownership on workflow resources.

Workflow:

Upload
-> Profiling
-> Mapping
-> Configure
-> Run
-> Review
-> Sync
-> Export

## Known Limitations

- AI Assistance belum dibuat.
- Matching Engine MVP masih memakai inspected preview rows, belum full-file processing.
- Sync persistence masih berupa frontend/local state, belum server-side sync plan table.
- Export history masih frontend/local download, belum server-side export table.
- Results page sudah memakai data nyata dari workspace, matching job, review results, sync state, dan export history.
- Audit trail table belum dibuat.
- Backend permission map sekarang menjadi source of truth; frontend hanya membaca `role` dan `permissions` dari `/api/me`.
- Role yang tersedia saat ini: `admin`, `user`, `pimpinan`.
- Workspace ownership saat ini memakai direct owner `user_id`, belum membership/collaboration multi-user.
- Admin area saat ini fokus pada role update dan reassign owner, belum ada suspend/delete user.
- Pimpinan monitoring bersifat read-only dan belum punya filter lanjutan atau export.

## Notes

- `PRD.md` adalah sumber utama fitur dan business rules.
- `.codex/PROJECT_RULES.md` adalah standar kerja wajib.
- `docs/UX_GUIDELINES.md` adalah acuan UX.
- Sidebar utama tetap hanya Dashboard, Matching, Results, Settings.
- Workspace page adalah halaman pendukung, bukan menu sidebar baru.
- Dashboard adalah entry point kerja untuk Continue, Action Required, Review Queue, Recent Workspaces, dan New Matching.
- Dashboard tidak boleh memakai dummy user greeting, dummy score, dummy insight, atau dummy analytics.
- Product-facing name is RE-MATCH; internal technical identifiers may still use `batchmatch`.
- Main UI copy uses formal, concise Bahasa Indonesia.
- Visible workflow copy should come from translation resources, not hardcoded component strings.
- Workflow step availability must be based on actual workflow state, not step number alone.
- Export remains locked until Sync is confirmed.
- Organization identity: Direktorat Statistik Sumber Daya Mineral dan Konstruksi, Badan Pusat Statistik.
- Workspace snapshot menyimpan workflow UI state; dataset/result utama tetap memakai tabel domain existing.
- Autosave workspace dilakukan melalui endpoint `/api/workspaces`.
- Resume workspace harus membuka URL `/matching?workspace={id}`.
- Jangan rerun matching jika `runResult` sudah dipulihkan dari workspace state.
- Hapus workspace hanya menghapus row workspace, bukan dataset atau reference data utama.
- User biasa hanya boleh melihat resource yang `user_id`-nya milik sendiri.
- Admin dapat melihat semua workspace, membuat user baru, mengubah data/peran user, mengatur ulang password user, dan memindahkan owner workspace.
- Pimpinan mendarat ke `/monitoring` setelah login dan hanya mendapat akses baca lintas workspace.
- Results bersifat read-only dan harus mengarahkan user kembali ke step Review, Sync, atau Export bila masih ada tindakan.
- Matching hydration harus tetap backend-first; jangan mengandalkan state React lama saat membuka workspace lagi.
- Lifecycle auth harus terpisah dari lifecycle workspace; navigasi step atau hydrate workspace tidak boleh mereset sesi.
- One task = one milestone. Jangan mengerjakan fitur di luar milestone aktif.

## Safe To Continue

YES
