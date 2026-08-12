# BatchMatch - Session

## Current Milestone

Milestone 8: Workspace / Session Persistence completed.

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

## Next Milestone

Stabilization & QA.

Objective: run build/lint/tests, fix regressions from MVP feature work, and verify Upload -> Export with workspace resume.

## Current Architecture

Frontend:
React, Vite, TypeScript, Tailwind CSS. Handles UI, workflow navigation, preferences, API calls, local export generation, and workspace resume/autosave.

Backend:
Laravel REST API. Handles health, dataset inspection/profiling, matching engine run/status, review decisions, and workspace persistence.

Database:
Implemented MVP tables include `datasets`, `dataset_columns`, `matching_jobs`, `column_mappings`, `matching_configurations`, `matching_results`, `review_decisions`, and `workspaces`.

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

- Authentication belum dibuat.
- User/workspace membership ownership belum dibuat.
- AI Assistance belum dibuat.
- Matching Engine MVP masih memakai inspected preview rows, belum full-file processing.
- Sync persistence masih berupa frontend/local state, belum server-side sync plan table.
- Export history masih frontend/local download, belum server-side export table.
- Results page masih mock/local state.
- Audit trail table belum dibuat.

## Notes

- `PRD.md` adalah sumber utama fitur dan business rules.
- `.codex/PROJECT_RULES.md` adalah standar kerja wajib.
- `docs/UX_GUIDELINES.md` adalah acuan UX.
- Sidebar utama tetap hanya Dashboard, Matching, Results, Settings.
- Workspace page adalah halaman pendukung, bukan menu sidebar baru.
- Workspace snapshot menyimpan workflow UI state; dataset/result utama tetap memakai tabel domain existing.
- Autosave workspace dilakukan melalui endpoint `/api/workspaces`.
- Resume workspace harus membuka URL `/matching?workspace={id}`.
- Jangan rerun matching jika `runResult` sudah dipulihkan dari workspace state.
- Hapus workspace hanya menghapus row workspace, bukan dataset atau reference data utama.
- One task = one milestone. Jangan mengerjakan fitur di luar milestone aktif.

## Safe To Continue

YES
