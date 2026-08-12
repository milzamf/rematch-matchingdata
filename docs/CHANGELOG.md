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
- Laravel Matching Engine MVP endpoint with job, mapping, configuration, and result persistence.
- Matching pipeline with one-time normalization, index/candidate search, chunked processing, field scoring, Top N, and progress summary.
- MVP scoring support for exact, normalized exact, case-insensitive exact, fuzzy, token-based, and composite-style weighted scoring.
- Review results API for grouped matched, need-review, and unmatched records from persisted Matching Engine output.
- Review decision persistence with accept, reject, select alternative candidate, mark unmatched, and undo support.
- Entity-aware company/name parser for Matching Engine metadata: raw name, core name, legal form, ownership/status qualifier, public status, unit type, and unit name.
- Case-grouped Review with deterministic fingerprints, confidence labels, representative examples, and bulk eligibility rules.
- Review Knowledge metadata storing decision patterns and conditions for future matching runs.
- Traceable Review case groups with Open / Resolved / All filters, decision history, decision source, affected records, and batch undo.
- Sync finalization preview using latest review decisions, recommended plan, unresolved-review warning, and local idempotent audit.
- Export Results step with default and custom export modes sourced from latest review decisions.
- Client-side CSV and XLSX export generation for final matching rows and review decision summary.

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
- Run step now calls the backend Matching Engine MVP instead of mock random progress.
- Review step now prioritizes real Need Review records, shows Input vs Reference comparison, Top N candidates, and field similarity highlights.
- Company/entity fuzzy matching now compares core names while preserving legal/status/unit metadata as validation constraints.
- Explicit PT vs CV conflicts are downgraded to review instead of becoming Auto Match; missing legal form or missing Persero/Tbk is not treated as automatic conflict.
- Review now defaults to Case Groups while preserving All Records review for granular decisions.
- Bulk review decisions are blocked for mixed or unique groups that are not homogeneous enough.
- Accepted or rejected case groups remain visible under Resolved instead of disappearing.
- Sync flow is simplified to Finalize Summary -> Recommended Plan -> Preview -> Confirm Sync.
- Export now shows record-count preview, generated filename, format selection, loading, success, and error feedback.
- Encoding artifacts in Matching UI labels were corrected.
- Post-milestone housekeeping for ignored build, test, cache, and temporary log artifacts.

### Notes

- AI service integration, server-side export history, audit persistence, and authentication are not implemented yet.
- Sync still uses local audit state; Export is frontend-generated from latest Review results; Results still uses mock/local state.
- Matching Engine MVP currently runs against inspected preview rows, not full stored file contents.
- Review decisions are stored without Auth/Workspace ownership until those milestones are implemented.
