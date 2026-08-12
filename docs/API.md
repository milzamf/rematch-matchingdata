# BatchMatch REST API Draft

Status: API contract draft with implemented MVP slices called out explicitly.

## API Principles

- Backend: Laravel REST API.
- Frontend: React app consuming JSON APIs only.
- Authentication should protect the main workflow and session-backed workspace state.
- Workspace ownership and membership checks are deferred to a later milestone.
- File parsing, profiling, matching, AI calls, export generation, and audit logging happen in the backend.

## Implemented MVP Vertical Slice

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/health` | `GET` | Check API availability. | none | `success`, `data.service`, `data.status`, `data.version` |
| `/api/workspaces` | `GET` | List saved workflow workspaces for the authenticated session. | none | `id`, `name`, `status`, `current_step`, `record_count`, `updated_at` |
| `/api/workspaces` | `POST` | Create a saved workflow workspace. | `name`, `status`, `current_step`, `reference_dataset_id`, `input_dataset_id`, `workflow_state` | `workspace` |
| `/api/workspaces/{workspaceId}` | `GET` | Restore workspace detail, linked datasets, and workflow snapshot. | none | `workspace`, `reference_dataset`, `input_dataset`, `matching_job`, `workflow_state` |
| `/api/workspaces/{workspaceId}` | `PATCH` | Idempotently autosave workspace progress. | `name`, `status`, `current_step`, `reference_dataset_id`, `input_dataset_id`, `matching_job_id`, `workflow_state`, `sync_state`, `export_history` | `workspace` |
| `/api/workspaces/{workspaceId}` | `DELETE` | Delete workspace session only. Linked datasets are not deleted. | none | `id` |
| `/api/datasets/inspect` | `POST` | Upload and inspect one CSV/XLSX dataset for the current frontend workflow. | `file`, `dataset_role`, `sheet_name`, `delimiter`, `header_row` | `dataset`, `columns`, `preview_rows`, `profiling_summary` |
| `/api/matching-jobs/run` | `POST` | Run the Matching Engine MVP and optionally attach the job to a workspace. | `workspace_id`, `name`, `reference_dataset_id`, `input_dataset_id`, `mappings`, `configuration` | `job`, `progress`, `summary`, `top_results` |

Note: implemented workflow endpoints are now behind Laravel Sanctum session auth. Workspace ownership still comes later.

## 1. Auth

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/login` | `POST` | Login with email and password using session/cookie auth. | `email`, `password` | `id`, `name`, `email` |
| `/api/me` | `GET` | Get the currently authenticated user. | none | `id`, `name`, `email` |
| `/api/logout` | `POST` | Invalidate the current authenticated session. | none | `message` |

## 2. User / Workspace

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/me` | `GET` | Get the current authenticated user session. | none | `id`, `name`, `email` |
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

| Endpoint | Method | Purpose | Basic request fields | Basic response fields |
| --- | --- | --- | --- | --- |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews` | `GET` | List records requiring review. | `status`, `search`, `sort`, `page`, `per_page` | `review_items`, `pagination` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews` | `POST` | Save reviewer decision. | `matching_result_id`, `decision`, `notes` | `review_decision`, `updated_result` |
| `/api/workspaces/{workspaceId}/matching-jobs/{jobId}/reviews/bulk` | `POST` | Save bulk review decisions. | `decisions[]` with `matching_result_id`, `decision`, `notes` | `accepted_count`, `rejected_count`, `skipped_count`, `errors` |

## 11. Sync / Merge Strategy

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

- Endpoint paths are draft names and can be adjusted during Laravel implementation.
- Mutating endpoints should create `audit_logs` entries where the action changes data, workflow state, AI recommendation status, sync strategy, review decision, or export state.
- AI tokens must never be exposed to frontend code. AI requests should use masked/redacted data where configured by user privacy settings.
- Long-running operations such as parsing, profiling, matching, AI generation, and export generation should be queue-backed when implemented.
