# BatchMatch Roadmap

Status: Phase-level roadmap. Keep this document concise and aligned with `PRD.md`.

## Completed

| Phase / Epic | Outcome |
| --- | --- |
| UI Polish | Main navigation, dashboard table, matching wizard layout, configuration sections, review table, and results tabs refined. |
| Synchronization Strategy | Sync step added between Review and Export with merge strategy for matched, unmatched, possible match, and conflict records. |
| Preferences | Theme mode, language switcher, local preferences, AI preferences, and data privacy settings added to Settings. |
| Frontend Finalization | Loading, empty, error, toast, and confirmation states added across the frontend. |
| DX Automation | Playwright smoke tests, screenshot capture, Lighthouse audit, and unified review command added. |
| Architecture Docs | Initial architecture, database, API, changelog, and roadmap documentation created. |

## Next

| Phase / Epic | Goal |
| --- | --- |
| Laravel Foundation | Establish Laravel backend structure, service layers, environment setup, storage, queues, and base conventions. |
| Auth API | Implement login, register, forgot password, session/token handling, workspace access, and ownership rules. |
| Dataset Upload | Implement secure file upload, parser selection, file metadata, preview, validation, and workspace-scoped storage. |
| Profiling | Generate column metadata, data quality statistics, suggested keys, warnings, and profiling summaries. |
| Matching Engine | Implement normalization, column mapping, search optimization, candidate generation, scoring, thresholds, review classification, and sync execution. |
| AI Assistance | Connect optional AI suggestions through backend-only configurable endpoints with masking, confirmation, and audit logging. |
| Export & Audit | Generate exports, export history, reproducible configuration snapshots, sync summaries, and audit trail records. |
| Deployment | Prepare production build, database migrations, queue workers, storage, environment variables, and release process. |

## Guardrails

- `PRD.md` remains the source of truth for feature scope and business rules.
- Main navigation remains Dashboard, Matching, Results, Settings.
- Main workflow remains Upload -> Profiling -> Mapping -> Configure -> Run -> Review -> Sync -> Export.
- AI recommendations remain optional, reviewable, and never overwrite user choices without confirmation.
