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

### Improved

- UI polish for navigation, dashboard tables, workflow stepper, column mapping, matching configuration, manual review, and results tabs.
- Results experience with Overview, Matched, Possible Match, Unmatched, Statistics, Audit Trail, and Export History tabs.
- Settings page with profile, matching defaults, AI preferences, data privacy, and about sections.
- Documentation alignment with `PRD.md`, `.codex/PROJECT_RULES.md`, and the BatchMatch workflow.

### Notes

- Backend, database migrations, matching engine execution, AI service integration, export generation, and audit persistence are not implemented yet.
- Current frontend behavior uses mock/local state only.
