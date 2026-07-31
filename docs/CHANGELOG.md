# BatchMatch Changelog

## Unreleased

### Added

- Initial BatchMatch frontend with Dashboard, Matching, Results, and Settings.
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

### Improved

- UI polish for navigation, dashboard tables, workflow stepper, column mapping, matching configuration, manual review, and results tabs.
- Results experience with Overview, Matched, Possible Match, Unmatched, Statistics, Audit Trail, and Export History tabs.
- Settings page with profile, matching defaults, AI preferences, data privacy, and about sections.
- Documentation alignment with `PRD.md`, `.codex/PROJECT_RULES.md`, and the BatchMatch workflow.
- Mapping workflow now supports manual add, remove, pair changes, algorithm changes, and duplicate reference-column prevention.
- Mapping algorithm choices now include Exact, Normalized Exact, Contains, Starts With, Ends With, and Fuzzy.

### Notes

- Matching engine execution, AI service integration, export generation, audit persistence, and authentication are not implemented yet.
- Configure, Run, Review, Sync, Export, and Results still use mock/local state.
