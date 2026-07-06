# BatchMatch Roadmap

Status: Draft architecture planning document.

## Completed Sprints

| Sprint | Scope | Status |
| --- | --- | --- |
| UI Polish | Navigation, dashboard tables, wizard layout, mapping layout, configuration sections, review table, and results tabs. | Completed |
| Synchronization Strategy | Added Sync workflow step and merge strategy UI for matched, unmatched, possible match, and conflict handling. | Completed |
| Preferences | Added theme mode, language switcher, Settings preferences, AI preferences, and data privacy settings. | Completed |
| Frontend Finalization | Added loading states, empty states, error states, toast notifications, and confirmation dialogs. | Completed |

## Next Phases

| Phase | Goal |
| --- | --- |
| Architecture | Finalize system boundaries, data model, API modules, and operational decisions before backend work. |
| DX Automation | Add scripts, lint/test/build checks, seed data, local environment docs, and CI guardrails. |
| Laravel Backend | Implement REST API, authentication, workspace isolation, file metadata, job lifecycle, and audit logging. |
| Matching Engine | Implement parsers, profiling, normalization, candidate generation, scoring, thresholding, and sync execution. |
| AI Integration | Connect optional AI suggestions through configurable API endpoints and secure token configuration. |
| Export & Audit | Generate exports, export history, audit trail records, and reproducible job configuration snapshots. |
| Deployment | Prepare production build, environment variables, storage, queue workers, database migrations, and release process. |

## Product Guardrails

- `PRD.md` remains the source of truth for feature scope and business rules.
- Main navigation remains Dashboard, Matching, Results, Settings.
- Main workflow remains Upload -> Profiling -> Mapping -> Configure -> Run -> Review -> Sync -> Export.
- AI recommendations remain optional, reviewable, and never overwrite user choices without confirmation.
