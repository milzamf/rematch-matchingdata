# RE-MATCH - Session

## Current Milestone

Milestone 8.1.4: Workspace Hydration and Workflow Runtime Stabilization completed.

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
- Login now uses Laravel Sanctum session/cookie auth with `/api/login`, `/api/me`, and `/api/logout`.
- Protected app routes and workflow APIs now require an authenticated session.
- User role is now part of the session identity with backend permission mapping as the source of truth.
- Frontend shell and workflow actions now hide or deny access based on returned permissions.
- Register and forgot-password dummy routes now redirect to Login.
- The first development user can be created by setting `BATCHMATCH_DEV_PASSWORD` and optional `BATCHMATCH_DEV_ROLE`, then running `php artisan db:seed`, which provisions `dev@re-match.local`.
- Product-facing UI is rebranded from BatchMatch to RE-MATCH.
- Sidebar and application shell no longer show dummy user identity, search, notification, help, or fake account controls.
- Organization identity is shown lightly in the sidebar and Settings.
- Matching workflow copy now follows the language switcher for Indonesian and English.
- Future workflow steps are locked until their prerequisites are available.
- Manual `/matching?step=` bypass is clamped back to the highest allowed step.
- Workspace name can be changed from the workflow header and persisted through workspace autosave.

## Next Milestone

Milestone 9.2: Workspace Ownership.

Objective: scope workspaces, datasets, jobs, review decisions, and exports to the authenticated user or membership boundary.

## Current Architecture

Frontend:
React, Vite, TypeScript, Tailwind CSS. Handles UI, workflow navigation, preferences, API calls, local export generation, and workspace resume/autosave.

Backend:
Laravel REST API. Handles health, authentication, dataset inspection/profiling, matching engine run/status, review decisions, and workspace persistence.

Database:
Implemented MVP tables include `users` with role, `datasets`, `dataset_columns`, `matching_jobs`, `column_mappings`, `matching_configurations`, `matching_results`, `review_decisions`, and `workspaces`.

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

- User/workspace membership ownership belum dibuat.
- Role-based ownership boundary belum dibuat; current authorization is permission-based only.
- AI Assistance belum dibuat.
- Matching Engine MVP masih memakai inspected preview rows, belum full-file processing.
- Sync persistence masih berupa frontend/local state, belum server-side sync plan table.
- Export history masih frontend/local download, belum server-side export table.
- Results page sudah memakai data nyata dari workspace, matching job, review results, sync state, dan export history.
- Audit trail table belum dibuat.
- Authentication now uses session/cookie auth only; ownership and role enforcement are intentionally deferred.
- Backend permission map sekarang menjadi source of truth; frontend hanya membaca `role` dan `permissions` dari `/api/me`.
- Role yang tersedia saat ini: `admin`, `user`, `pimpinan`.

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
- Results bersifat read-only dan harus mengarahkan user kembali ke step Review, Sync, atau Export bila masih ada tindakan.
- Matching hydration harus tetap backend-first; jangan mengandalkan state React lama saat membuka workspace lagi.
- One task = one milestone. Jangan mengerjakan fitur di luar milestone aktif.

## Safe To Continue

YES
