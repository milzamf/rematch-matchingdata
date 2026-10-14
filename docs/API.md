# BatchMatch REST API Draft

Shared endpoints return HTTP 503 `review_deployment_not_approved` if deployment mode/database/release or pinned approval evidence do not match. Feature flags alone do not authorize production. Existing freeze, permissions, readiness and HTTP 409 version/reference conflicts remain in force; no new endpoint or flag activation.

Status: API contract draft with implemented MVP slices called out explicitly.

## API Principles

- Backend: Laravel REST API.
- Frontend: React app consuming JSON APIs only.
- Authentication should protect the main workflow and session-backed workspace state.
- Workflow resources now use direct authenticated ownership with role-based read/write scope.
- File parsing, profiling, matching, AI calls, export generation, and audit logging happen in the backend.

## Implemented MVP Vertical Slice

Backend Tahap 5A (2026-10-13) is implemented only under guarded `/api/stage5a`: own/shared/admin workspace lists, permissions, member list/search/grant/change/revoke, scoped resource metadata, proposal inbox/submit/resolve, CAS decisions and atomic Undo. All use authenticated actors and fixed isolated MySQL/env guards; `WORKSPACE_ACCESS_ENABLED` and `REVIEW_STATE_TRANSACTIONS_ENABLED` default false. Main routes retain existing ownership and legacy state authority. See [REVIEW_ACCESS_APPROVAL_STAGE5A.md](REVIEW_ACCESS_APPROVAL_STAGE5A.md) for paths, payloads, permission matrix, submitted/rejected/applied distinctions and 403/409 handling. Full preview/review/export reader adapters have not been switched to sharing.

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/health` | `GET` | Check API availability. | none | `success`, `data.service`, `data.status`, `data.version` |
| `/api/workspaces` | `GET` | List saved workflow workspaces for the authenticated session. Requires `workspace.view`. | none | `id`, `name`, `status`, `current_step`, `record_count`, `updated_at` |
| `/api/workspaces` | `POST` | Create a saved workflow workspace. Requires `workspace.create`. | `name`, `status`, `current_step`, `reference_dataset_id`, `input_dataset_id`, `workflow_state` | `workspace` |
| `/api/workspaces/{workspaceId}` | `GET` | Restore workspace detail, linked datasets, and workflow snapshot. Requires `workspace.view`. | none | `workspace`, `reference_dataset`, `input_dataset`, `matching_job`, `workflow_state` |
| `/api/workspaces/{workspaceId}` | `PATCH` | Idempotently autosave workspace progress. Requires `workspace.update`. | `name`, `status`, `current_step`, `reference_dataset_id`, `input_dataset_id`, `matching_job_id`, `workflow_state`, `sync_state`, `export_history` | `workspace` |
| `/api/workspaces/{workspaceId}` | `DELETE` | Delete workspace session only. Linked datasets are not deleted. Requires `workspace.delete`. | none | `id` |
| `/api/datasets/inspect` | `POST` | Upload and inspect one CSV/XLSX dataset for the current frontend workflow. Requires `matching.create`. | `file`, `dataset_role`, `sheet_name`, `delimiter`, `header_row` | `dataset`, `columns`, `preview_rows`, `profiling_summary` |
| `/api/matching-jobs/run` | `POST` | Run the Matching Engine MVP and optionally attach the job to a workspace. Requires `matching.run`. | `workspace_id`, `name`, `reference_dataset_id`, `input_dataset_id`, `mappings`, `configuration` | `job`, `progress`, `summary`, `top_results` |

Note: implemented workflow endpoints are now behind Laravel Sanctum session auth and are scoped by authenticated owner unless the role is `admin` or `pimpinan`.

## 1. Auth

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/login` | `POST` | Login with email and password using session/cookie auth. | `email`, `password` | `user.id`, `user.name`, `user.email`, `user.role`, `permissions[]` |
| `/api/me` | `GET` | Get the currently authenticated user and permissions. | none | `user.id`, `user.name`, `user.email`, `user.role`, `permissions[]` |
| `/api/logout` | `POST` | Invalidate the current authenticated session. | none | `message` |
| `/api/admin/users` | `GET` | List authenticated users for administration. Requires `admin.access`. | none | `id`, `name`, `email`, `role`, `workspace_count`, `dataset_count`, `matching_job_count` |
| `/api/admin/users/{userId}` | `PATCH` | Update user display name or role. Requires `admin.access`. | `name`, `role` | `user` |
| `/api/admin/workspaces` | `GET` | List all workspaces for administration. Requires `admin.access`. | none | `id`, `name`, `status`, `owner`, `record_count`, `updated_at` |
| `/api/admin/workspaces/{workspaceId}/owner` | `PATCH` | Reassign workspace owner and rebind linked dataset/job ownership. Requires `admin.access`. | `user_id` | `workspace` |
| `/api/monitoring/overview` | `GET` | Cross-workspace monitoring summary for leadership/admin. Requires `monitoring.view`. | none | `summary`, `owner_breakdown`, `recent_workspaces` |

### Implemented permission codes

- `dashboard.view`
- `workspace.view`
- `workspace.create`
- `workspace.update`
- `workspace.delete`
- `matching.view`
- `matching.create`
- `matching.configure`
- `matching.run`
- `review.view`
- `review.decide`
- `sync.view`
- `sync.execute`
- `export.view`
- `export.execute`
- `monitoring.view`
- `admin.access`

## 2. User / Workspace

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/me` | `GET` | Get the current authenticated user session. | none | `id`, `name`, `email`, `role`, `permissions[]` |
| `/api/user/preferences` | `PATCH` | Save theme, language, defaults, AI, and privacy preferences. | `theme`, `language`, `matching_defaults`, `ai_preferences`, `privacy_settings` | `preferences` |
| `/api/workspaces` | `GET` | List accessible workspaces. | none | `workspaces` |
| `/api/workspaces` | `POST` | Create a workspace/session. | `name`, `status`, `current_step`, `reference_dataset_id`, `input_dataset_id`, `workflow_state` | `workspace` |
| `/api/workspaces/{workspaceId}` | `GET` | Get workspace detail. | none | `workspace`, `members` |
| `/api/workspaces/{workspaceId}` | `PATCH` | Update workspace metadata/settings and autosaved workflow state. | `name`, `status`, `current_step`, `matching_job_id`, `workflow_state`, `sync_state`, `export_history` | `workspace` |
| `/api/workspaces/{workspaceId}` | `DELETE` | Delete workspace/session without deleting linked datasets. | none | `id` |

## 3. Dataset Upload

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/datasets` | `GET` | List datasets in a workspace. | `dataset_role`, `parse_status`, `search` | `datasets`, `pagination` |
| `/api/workspaces/{workspaceId}/datasets` | `POST` | Upload reference or input dataset. | `file`, `dataset_role`, `source_type`, `parser_options` | `dataset`, `parse_status`, `warnings` |
| `/api/workspaces/{workspaceId}/datasets/{datasetId}` | `GET` | Get dataset metadata and schema snapshot. | none | `dataset`, `columns`, `profiling_summary` |
| `/api/workspaces/{workspaceId}/datasets/{datasetId}/preview` | `GET` | Preview parsed rows. | `limit`, `sheet_or_table` | `columns`, `rows`, `warnings` |
| `/api/workspaces/{workspaceId}/datasets/{datasetId}` | `DELETE` | Remove dataset metadata and stored file if allowed. | none | `message` |

## 4. Profiling

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/datasets/{datasetId}/profile` | `POST` | Start or rerun profiling. | `parser_options`, `sample_size` | `profile_job_id`, `status` |
| `/api/workspaces/{workspaceId}/datasets/{datasetId}/profile` | `GET` | Read profiling output. | none | `columns`, `quality_summary`, `suggested_key_columns`, `warnings` |

## 5. Matching Jobs

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs` | `GET` | List matching jobs. | `status`, `search`, `date_from`, `date_to` | `jobs`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs` | `POST` | Create a job from reference and input datasets. | `name`, `reference_dataset_id`, `input_dataset_id` | `job` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}` | `GET` | Get job detail and workflow state. | none | `job`, `datasets`, `counts`, `current_step` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}` | `PATCH` | Update job metadata or current workflow step. | `name`, `current_step` | `job` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/cancel` | `POST` | Cancel a pending or running job. | `reason` | `job`, `message` |

## 6. Column Mapping

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/column-mappings` | `GET` | List selected mappings. | none | `mappings` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/column-mappings` | `PUT` | Replace column mappings for a job. | `mappings[]` with `reference_column_id`, `input_column_id`, `algorithm`, `weight`, `required_match`, `normalization_rule` | `mappings`, `validation_warnings` |

## 7. Matching Configuration

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/configuration` | `GET` | Read current configuration. | none | `configuration` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/configuration` | `PUT` | Save preset, strategy, thresholds, normalization, search optimization, candidate generation, output config, and advanced settings. | `preset`, `strategy`, `thresholds`, `normalization`, `search_optimization`, `candidate_generation`, `output_config`, `advanced_settings` | `configuration`, `config_hash`, `validation_warnings` |

## 8. Run Matching

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/run` | `POST` | Start matching pipeline. | `confirm_large_comparison`, `run_options` | `job`, `run_id`, `status` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/status` | `GET` | Read run progress. | none | `status`, `progress`, `counts`, `started_at`, `finished_at`, `errors` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/retry` | `POST` | Retry failed run. | `retry_from_step` | `job`, `status` |

## 9. Results

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/results/overview` | `GET` | Get result summary. | none | `counts`, `match_rate`, `quality_metrics`, `sync_summary` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/results` | `GET` | List matched, possible match, unmatched, or conflict records. | `result_type`, `search`, `sort`, `page`, `per_page` | `results`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/results/{resultId}` | `GET` | Read detailed comparison evidence. | none | `result`, `reference_record`, `input_record`, `field_scores`, `decision_reason` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/results/statistics` | `GET` | Read scoring and review statistics. | none | `score_distribution`, `algorithm_metrics`, `review_metrics` |

## 10. Manual Review

Implemented review filters (2026-10-12):

- Candidate verification evidence now includes `address_enrichment_available` for newly evaluated outcomes. This is an informational flag; compatible extra address detail does not force `possible_match` after thresholds and verification pass. Real address-component conflicts still require review. Previously persisted outcomes are not reclassified by a GET request.

- `GET /api/matching-jobs/{jobId}/review-results` accepts `sort=record_order|similarity_desc|similarity_asc`, `similarity_min`, `similarity_max`, `input_province_code`, and `input_regency_code`, alongside the existing parameters. All predicates run before pagination. Scores must be 0–100; minimum must not exceed maximum. Region codes must exist in MFD, and a selected regency must belong to the selected province.
- Regions refer to **input** records. Regency codes use the full MFD ID (for example Jakarta Barat `3174`), not the province-local `74`. New rank-1 results carry canonical codes; older results are backfilled in queued batches without rerunning matching or changing review decisions.
- `GET /api/matching-jobs/{jobId}/review-region-options` returns `data: {ready, remaining, provinces: [{code, label}], regencies: [{code, province_code, label}]}`. It schedules preparation for an older job. While `ready=false`, ordinary table queries work; applying a region predicate returns 409. The UI disables only region controls until ready.
- `case_group_id` resolves cached membership even with `include_groups=false`. This suppresses the group payload, not membership lookup. Unknown group IDs return a specific 404; concurrent cache preparation returns 503 with `code: case_groups_preparing` and `Retry-After: 5`. Clients may retry this GET while retaining loading state; other failures are not automatically retried.
- Displayed candidate and similarity sort/range use the reviewer's selected candidate when present. Equal scores use text record keys as a stable tie breaker; null scores sort last. Default `record_order` retains primary-row insertion order. The current schema stores overall scores as non-null decimals; the query also handles future null scores.
- Group searches inspect record contents as well as keys. Pagination fetches candidate payloads only for that page. Column quality remains cumulative across the whole job and is loaded separately.

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/matching-jobs/{jobId}/review-results` | `GET` | Paginate persisted matching outcomes and load case groups, including already-committed rows while a job is still processing. | `status`, `search`, `page`, `per_page`, `case_group_id`, `include_groups`, `include_quality` | `job`, `summary`, `pagination`, `items`, `case_groups`, `field_quality_summary`, `is_processing` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews` | `GET` | List records requiring review. | `status`, `search`, `sort`, `page`, `per_page` | `review_items`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews` | `POST` | Save reviewer decision. | `matching_result_id`, `decision`, `notes` | `review_decision`, `updated_result` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews/bulk` | `POST` | Save bulk review decisions. | `decisions[]` with `matching_result_id`, `decision`, `notes` | `accepted_count`, `rejected_count`, `skipped_count`, `errors` |

## 11. Sync / Merge Strategy

Review performance contract (2026-10-11):

- `include_quality=true` returns exact cumulative `field_quality_summary` for all rank-1 candidates in the job, independent of status filtering and pagination. It defaults to the value of `include_groups`. Each field has actual `totalEvaluated`, `totalRecords`, `unscoredCount`, average score, and counts/percentages for >=90, 80–89, and <80. Missing/null scores are excluded, not extrapolated or treated as zero.
- `POST /api/matching-jobs/{jobId}/review-decisions` returns `decision` and a lightweight `review` snapshot containing affected/requested records (including skipped bulk targets), with a full-job summary. Individual actions do not rebuild case groups. Group actions also return current cached group overlays.
- `POST /api/matching-jobs/{jobId}/review-decisions/{decisionId}/undo` returns `undone_decision_id`, `affected_records`, and an affected-record review snapshot. The write transaction completes before generating the response.
- Input record keys must remain strings, including numeric-looking keys. This preserves exact key semantics and indexed MySQL lookups.
- Docker Composer dependencies use shared volume `rematch_backend_vendor`. When `composer.lock` changes, synchronize it with `docker compose exec backend composer install` before restarting the idle worker. Source code remains bind-mounted.

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/sync-plan` | `GET` | Read current sync plan. | none | `sync_plan`, `summary` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/sync-plan` | `PUT` | Save merge strategy before export. | `matched_action`, `unmatched_action`, `possible_action`, `conflict_action` | `sync_plan`, `estimated_summary` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/sync-plan/preview` | `POST` | Preview estimated merge impact. | `matched_action`, `unmatched_action`, `possible_action`, `conflict_action` | `records_to_drop`, `records_to_append`, `records_to_update`, `conflicts_to_review`, `final_reference_size` |

## 12. Export

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/exports` | `GET` | List export history. | `status`, `format`, `scope` | `exports`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/exports` | `POST` | Request export generation. | `format`, `scope`, `include_audit`, `include_configuration`, `include_score_detail`, `sync_plan_id` | `export`, `status` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/exports/{exportId}` | `GET` | Read export metadata. | none | `export`, `download_available` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/exports/{exportId}/download` | `GET` | Download generated file. | none | file response or signed download URL |

## 13. AI Recommendations

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/ai/recommendations` | `GET` | List AI recommendations. | `matching_job_id`, `dataset_id`, `recommendation_type`, `status` | `recommendations`, `pagination` |
| `/api/workspaces/{workspaceId}/ai/recommendations` | `POST` | Request AI suggestions for profiling, mapping, configuration, review explanation, or tuning. | `recommendation_type`, `matching_job_id`, `dataset_id`, `target_type`, `target_id`, `masked_payload` | `recommendation`, `confidence`, `status` |
| `/api/workspaces/{workspaceId}/ai/recommendations/{recommendationId}/apply` | `POST` | Apply a selected AI recommendation after user confirmation. | `apply_scope`, `override_fields` | `recommendation`, `applied_changes`, `audit_log_id` |
| `/api/workspaces/{workspaceId}/ai/recommendations/{recommendationId}/ignore` | `POST` | Mark AI recommendation as ignored. | `reason` | `recommendation`, `audit_log_id` |

## 14. Audit Logs

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/audit-logs` | `GET` | List workspace audit events. | `user_id`, `matching_job_id`, `entity_type`, `action`, `date_from`, `date_to`, `page`, `per_page` | `audit_logs`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/audit-logs` | `GET` | List audit events for one matching job. | `action`, `date_from`, `date_to` | `audit_logs` |

## Notes

- User role behavior currently is: `user` = own resources only, `admin` = full access, `pimpinan` = read-only cross-workspace monitoring and workflow visibility.
- Endpoint paths are draft names and can be adjusted during Laravel implementation.
- Mutating endpoints should create `audit_logs` entries where the action changes data, workflow state, AI recommendation status, sync strategy, review decision, or export state.
- AI tokens must never be exposed to frontend code. AI requests should use masked/redacted data where configured by user privacy settings.
- Long-running operations such as parsing, profiling, matching, AI generation, and export generation should be queue-backed when implemented.

## Review compatibility contract v1 (2026-10-13)

Review-results adds `data.contract_version = 1`, `data.summary.accounting`, and
`decision.actors` (including decision history). Existing fields and request values
remain compatible. New writes use existing reviewer_user_id; Undo retains the
reviewer and records its own actor in existing metadata. Legacy unknown actors
remain unknown. `reject_match` is effectively possible_match, while mark_unmatched
is unmatched; badges and exported action labels remain separate.

See [REVIEW_CONTRACT_V1.md](REVIEW_CONTRACT_V1.md) for field definitions, opaque-key
rules, statistics provenance, export compatibility and the boundaries of Tahap 1.
No migration, Workspace Sharing, approval or new concurrency behavior is enabled.

## Stage 5B frontend consumer note (2026-10-13)

No backend API was added/changed. The default-disabled workspace-access client consumes the existing 11 Stage 5A list/permission/member/user/proposal/decision/Undo contracts and preserves `code`, `details` and durable 409 `data` acknowledgements. Membership writes return user_id/role/status/version only. Actor attribution comes from session/server; opaque record keys remain strings. Unknown fields/endpoints are not invented. Full shared workspace/dataset/current-version review readers and owner-name metadata are still absent; the UI cannot use scalar resource metadata as that reader. See REVIEW_FRONTEND_STAGE5B.md for the exact endpoint table and development mock boundaries.
## Tahap 5C isolated readers (2026-10-13)

Shared integration adds authenticated/scoped GET `/api/stage5a/workspaces/{workspace}/jobs/{job}/export` (CSV effective states, keyset 500, permission rechecked per chunk). UAT hardening prepares the complete CSV in temporary disk storage before publishing HTTP 200; a generation error/revocation returns an error and removes that temporary file. Authorization is checked again before download. This delays first byte, needs bounded concurrent-export disk capacity, and is not a whole-job transactional snapshot. Existing readers now feed gated actual frontend; ready score projections accelerate sorting without changing DTO/decision semantics. State CSV is not the full legacy preset/audit export. See [SHARED_WORKSPACE_INTEGRATION_QA.md](SHARED_WORKSPACE_INTEGRATION_QA.md). Main activation remains off.

Legacy review decision/Undo writers return HTTP 409 `legacy_review_write_disabled` when either `workspace_access.enabled` or `review_transactions.enabled` is true. Both flags false retain legacy behavior. This fence does not replace deployment fencing for matching/configuration/autosave/queue writers.

Blocker follow-up: default-off `review_deployment` freeze config/shared marker returns HTTP 503 `review_deployment_frozen` before every business API handler (including reads with possible side effects); login/logout/me remain available. With either new backend flag enabled, legacy business mutations return 409 `legacy_workspace_write_disabled`; legacy decision/Undo retain their existing reason above. Stage 5A mutations retain their versioned services outside freeze. Requires shared marker/config coherence and draining existing requests/workers; does not authorize production activation.

New authenticated GETs under `/api/stage5a`: `/workspaces/{workspace}`, `/workspaces/{workspace}/jobs/{job}/review-results`, `/workspaces/{workspace}/jobs/{job}/candidates?record_key=001`, `/workspaces/{workspace}/datasets/{dataset}/rows`. Existing fixed-test guard/default-off remains; main legacy API/frontend unchanged. Review/candidates require completed + ready + schema 1 and use review_states exclusively for effective decisions/version/actors. Pagination up to 100 rows, filters before paging, 2 MiB payload limit. Actual parameters/DTO/errors/scoping and benchmark limitations: [REVIEW_READERS_STAGE5C.md](REVIEW_READERS_STAGE5C.md). This is not a live rollout or frontend integration.
