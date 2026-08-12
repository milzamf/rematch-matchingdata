# RE-MATCH Changelog

## Unreleased

### Added

- Results page integration with real workspace context, matching job outputs, review decisions, sync summary, and export history
- Workspace-linked export history metadata persisted from Step 8 for later reading in Results
- Authentication foundation with Laravel Sanctum session/cookie login, current user, and logout endpoints.
- Role and permission foundation with centralized backend permission mapping for `admin`, `user`, and `pimpinan`.
- Direct workflow ownership on datasets, matching jobs, and workspaces through authenticated `user_id`.
- Admin area MVP for user role management and workspace owner reassignment.
- Pimpinan monitoring dashboard with organization-wide read-only workspace visibility.
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
