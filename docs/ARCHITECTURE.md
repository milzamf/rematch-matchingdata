# BatchMatch Architecture

Status: Initial high-level architecture. `PRD.md` remains the source of truth for product scope.

## High-Level Components

### React Frontend

Provides the BatchMatch web UI: Dashboard, Matching wizard, Results, and Settings. It handles user interaction, local UI state, form validation feedback, loading/empty/error states, toasts, confirmation dialogs, and API calls. It does not run backend matching logic.

### Laravel REST API

Owns authentication, authorization, workspace isolation, request validation, job orchestration, persistence, and API contracts. It exposes REST endpoints consumed by the React frontend.

### Database

Stores users, workspaces, dataset metadata, job configurations, mappings, results, review decisions, exports, AI recommendations, and audit logs. Raw uploaded files should be stored outside the relational database, with references stored in metadata tables.

### Matching Engine

Parses normalized tabular data, profiles columns, applies normalization, generates candidates, scores similarity, classifies results, and produces sync/export-ready outputs. It may run inside Laravel services initially and move to queued workers as file sizes grow.

### AI Assistance Service

Provides optional suggestions for profiling, column mapping, matching configuration, review explanation, and tuning. AI suggestions are reviewable, can be ignored, and must not overwrite user choices without confirmation.

### Export Service

Generates downloadable files for matched, possible match, unmatched, sync summary, mapping keys, audit trail, and updated reference outputs. It records export history and storage metadata.

### Audit Trail

Records user actions and system events across upload, profiling, mapping, configuration, matching run, review, sync, export, and AI recommendations. Audit records support reproducibility and accountability.

## Data Flow

1. Upload: user uploads reference and input datasets.
2. Profiling: system parses files, extracts schema, profiles columns, and returns warnings or suggestions.
3. Mapping: user maps reference columns to input columns.
4. Configure: user selects preset, strategy, thresholds, normalization, candidate strategy, output configuration, and advanced settings.
5. Run: matching job is queued or executed and produces scored results.
6. Review: possible matches are approved, rejected, skipped, or force matched.
7. Sync: user selects merge strategy for matched, unmatched, possible match, and conflict records.
8. Export: system generates output files and records export history and audit trail.

## Runtime Boundaries

- Frontend owns presentation, navigation, and immediate feedback.
- Laravel owns business rules, permissions, validation, persistence, and orchestration.
- Matching Engine owns deterministic parsing, profiling, scoring, and classification.
- AI Assistance owns optional recommendations only.
- Export Service owns file generation and export records.
- Audit Trail records every important decision without driving UI behavior directly.

## Initial Deployment Shape

- React frontend served as a static or SSR-compatible build.
- Laravel API hosted as the main backend application.
- MySQL or PostgreSQL for relational data.
- File/object storage for uploads and generated exports.
- Queue workers for parsing, matching, AI calls, export generation, and long-running jobs.
