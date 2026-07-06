# BatchMatch Database Draft

Status: Initial entity model. Do not create migrations from this document yet.

## Main Entities

| Entity | Responsibility |
| --- | --- |
| `users` | Stores login identity, profile fields, and account status. |
| `workspaces` | Separates each user's or organization's jobs, uploads, exports, review history, and audit trail. |
| `datasets` | Stores uploaded dataset metadata, source type, parser status, schema snapshot, and storage location. |
| `matching_jobs` | Tracks the job lifecycle from upload through export, including status, counts, and ownership. |
| `column_mappings` | Stores reference-to-input column pairs and selected per-column algorithm. |
| `matching_configurations` | Stores preset, strategy, thresholds, normalization, candidate strategy, weights, review rules, and sync strategy. |
| `matching_results` | Stores matched, possible match, and unmatched records with score, method, and reason. |
| `review_decisions` | Stores manual approve, reject, skip, and force-match decisions with reviewer and timestamp. |
| `exports` | Stores generated export metadata, file format, scope, status, storage path, and history. |
| `audit_logs` | Stores user, job, dataset, config, review, sync, export, and AI recommendation events. |
| `ai_recommendations` | Stores optional AI suggestions, confidence, source workflow step, user decision, and audit metadata. |

## High-Level Relationships

- A `workspace` has many `users` through membership or ownership.
- A `workspace` has many `datasets`, `matching_jobs`, `exports`, `audit_logs`, and `ai_recommendations`.
- A `matching_job` belongs to one `workspace`.
- A `matching_job` references one or more `datasets`, commonly one reference dataset and one input dataset.
- A `matching_job` has many `column_mappings`.
- A `matching_job` has one active `matching_configuration`, with possible historical snapshots later.
- A `matching_job` has many `matching_results`.
- A `matching_result` may have zero or many `review_decisions`.
- An `export` belongs to a `matching_job` and records the selected result scope and file format.
- An `audit_log` may reference a user, dataset, matching job, review decision, export, or AI recommendation.
- An `ai_recommendation` may reference a dataset, matching job, column mapping, configuration, result, or review decision.

## Modeling Notes

- Store reproducible configuration snapshots for each completed job.
- Keep uploaded raw files in object/file storage; store metadata and parsed schema in the database.
- Store sensitive values carefully and support masking/redaction for AI processing and audit views.
- Add indexes later around workspace ID, job status, dataset status, result category, review status, and export status.
- Use JSON columns only where schema variability is expected, such as parser warnings, profiling summaries, and AI recommendation payloads.
