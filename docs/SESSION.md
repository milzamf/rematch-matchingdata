# BatchMatch - Session

## Current Milestone

Milestone 3B: Configure Logic completed.

## Project Status

- Upload: Done
- Profiling: Done
- Mapping: Done
- Configure: Done for UX and workflow state, no backend persistence yet
- Run: Not started
- Review: Not started
- Sync: Not started
- Export: Not started

## Completed

- Initial BatchMatch frontend with Dashboard, Matching, Results, and Settings.
- Clean enterprise SaaS UI polish for navigation, dashboard, workflow, review, and results.
- Matching wizard uses 8 steps: Upload, Profiling, Mapping, Configure, Run, Review, Sync, Export.
- Upload and Profiling are integrated with Laravel `/api/datasets/inspect`.
- Backend health endpoint and dataset inspect endpoint are available.
- CSV and XLSX inspect support is implemented.
- Dataset and dataset column metadata are persisted.
- Mapping uses real inspected reference/input columns.
- Mapping supports manual add, remove, pair changes, type badges, suggestion metadata, and duplicate reference validation.
- Configure uses Quick Setup, Summary Configuration, conditional Advanced Settings, validation, and workflow-level configuration state.

## Next Milestone

Milestone 4: Matching Engine Preparation.

Objective: define and implement the first matching job/config handoff without adding AI, Review, Sync, or Export execution.

## Current Architecture

Frontend:
React, Vite, TypeScript, Tailwind CSS. Handles UI state, workflow navigation, preferences, and API calls.

Backend:
Laravel REST API. Handles health check, dataset upload inspection, parsing, profiling, and dataset metadata persistence.

Database:
Development database uses MySQL. Implemented tables are `datasets` and `dataset_columns`; Laravel default `users` table exists.

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

- Matching Engine belum dibuat.
- Authentication belum dibuat.
- Workspace ownership belum dibuat.
- AI Assistance belum dibuat.
- Matching job persistence belum dibuat.
- Column mapping persistence belum dibuat.
- Configure sudah tersimpan di workflow state; belum persist ke backend.
- Run masih simulasi UI.
- Review, Sync, Export, dan Results masih mock/local state.
- Export generation dan audit trail persistence belum dibuat.

## Notes

- `PRD.md` adalah sumber utama fitur dan business rules.
- `.codex/PROJECT_RULES.md` adalah standar kerja wajib untuk task berikutnya.
- `docs/UX_GUIDELINES.md` adalah acuan UX untuk halaman baru atau perubahan UI.
- Upload dan Profiling sudah real; jangan kembali ke dummy data untuk dua step ini.
- Mapping hanya bertugas memasangkan kolom reference dan input.
- Matching Algorithm dipindahkan dari Mapping ke Configure.
- Configure menampilkan Quick Setup di permukaan utama; Custom membuka strategi Exact, Fuzzy, Composite / Hybrid, dan Rule-Based secara kondisional.
- Exact tidak menampilkan threshold, Top N, bobot, atau formula; Fuzzy menampilkan algoritma, threshold, kandidat, dan normalisasi.
- Composite / Hybrid memakai bobot otomatis default; bobot manual dan formula hanya muncul jika diaktifkan.
- Rule-Based menampilkan rule builder; toleransi angka/tanggal hanya muncul untuk tipe field yang relevan.
- Configure snapshot menyimpan preset, mode, strategy, fields, algorithms, thresholds, candidate generation, search optimization, normalization, weights, rules, dan output.
- Run hanya membaca ringkasan konfigurasi tersimpan; Matching Engine belum dibuat.
- Auto mapping saat ini rule-based sederhana, bukan AI.
- Reference column tidak boleh dipakai dua kali; input column boleh dipakai ulang.
- Jangan mengubah Run, Review, Sync, Export, AI, Auth, Workspace, atau Matching Engine kecuali milestone meminta.
- Jangan membuat ulang frontend atau backend.
- Generated build/test artifacts are ignored and can be regenerated with build or test commands.

## Safe To Continue

YES
