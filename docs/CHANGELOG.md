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
- Mapping type badges and suggestion source metadata.
- Configure Quick Setup with Balanced, Strict, Exploratory, and Custom presets.
- Configure Summary Configuration for the selected preset, thresholds, search mode, candidates, output count, and normalization preset.
- Configure e2e coverage for Quick Setup, Summary Configuration, and collapsed Advanced Settings.
- Conditional Configure flow for Exact, Fuzzy, Composite / Hybrid, and Rule-Based strategies.
- Default algorithm recommendations per mapped field type/name, with advanced algorithms hidden behind More Algorithms.
- Configure validation for active fields, thresholds, candidate count, manual weights, and rule text.
- Workflow-level Configure state snapshot for future Matching Engine handoff.
- Run step configuration summary sourced from saved Configure state.

### Improved

- UI polish for navigation, dashboard tables, workflow stepper, column mapping, matching configuration, manual review, and results tabs.
- Results experience with Overview, Matched, Possible Match, Unmatched, Statistics, Audit Trail, and Export History tabs.
- Settings page with profile, matching defaults, AI preferences, data privacy, and about sections.
- Documentation alignment with `PRD.md`, `.codex/PROJECT_RULES.md`, and the BatchMatch workflow.
- Mapping workflow now supports manual add, remove, pair changes, type badges, suggestion metadata, and duplicate reference-column prevention.
- Mapping page now focuses only on reference/input column pairing; matching algorithm selection is deferred to Configure.
- Configure technical controls are now grouped under collapsed Advanced Settings for progressive disclosure.
- Configure now shows only controls relevant to the selected strategy.
- Configure now stores only relevant active settings for the selected preset or custom strategy.
- Encoding artifacts in Matching UI labels were corrected.
- Post-milestone housekeeping for ignored build, test, cache, and temporary log artifacts.

### Notes

- Matching engine execution, AI service integration, export generation, audit persistence, and authentication are not implemented yet.
- Run, Review, Sync, Export, and Results still use mock/local state.
- Configure state is frontend-only and is not persisted to the backend yet.
