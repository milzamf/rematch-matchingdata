import type { PermissionName, UserRole } from "@/lib/authorization";

export type DatasetRole = "reference" | "input";

export type DatasetMetadata = {
  id: string;
  dataset_role: DatasetRole;
  name: string;
  original_filename: string;
  file_format: string;
  file_size: number;
  selected_sheet: string | null;
  sheet_names: string[];
  delimiter: string | null;
  header_row: number;
  row_count: number;
  column_count: number;
  parse_status: string;
};

export type DatasetColumnProfile = {
  id: string;
  name: string;
  normalized_name: string;
  data_type: "empty" | "boolean" | "number" | "date" | "text" | string;
  position: number;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  duplicate_percentage: number;
  sample_values: string[];
};

export type DatasetInspectResult = {
  dataset: DatasetMetadata;
  columns: DatasetColumnProfile[];
  preview_rows: Record<string, string | number | boolean | null>[];
  profiling_summary: {
    columns: number;
    rows: number;
    high_missing_columns: string[];
    duplicate_prone_columns: string[];
  };
};

type ApiSuccess<T> = {
  success: true;
  data: T;
  message?: string;
};

type ApiFailure = {
  success: false;
  message?: string;
  errors?: Record<string, string[]>;
};

export type AuthUser = {
  id: string | number;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
};

export type AuthSession = {
  user: AuthUser;
  permissions: PermissionName[];
};

export type WorkspaceOwnerSummary = {
  id: string | number;
  name: string;
  email: string;
  role: UserRole;
};

export const AUTH_UNAUTHORIZED_EVENT = "batchmatch:auth-unauthorized";

type InspectDatasetInput = {
  file: File;
  datasetRole: DatasetRole;
  sheetName?: string;
  delimiter?: string;
  headerRow?: number;
};

type RunMatchingInput = {
  name?: string;
  workspaceId?: string;
  referenceDatasetId: string;
  inputDatasetId: string;
  mappings: unknown[];
  configuration: unknown;
};

export type WorkspaceStatus =
  | "draft"
  | "configuring"
  | "matching"
  | "reviewing"
  | "ready_to_sync"
  | "completed"
  | "failed";

export type WorkspaceStatePayload = {
  reference?: {
    name: string;
    size: number;
    status: "loading" | "success" | "error";
    result?: DatasetInspectResult;
    error?: string;
  } | null;
  input?: {
    name: string;
    size: number;
    status: "loading" | "success" | "error";
    result?: DatasetInspectResult;
    error?: string;
  } | null;
  columnMappings?: unknown[];
  matchingConfiguration?: unknown;
  runState?: "idle" | "running" | "success" | "failed";
  progress?: number;
  runResult?: MatchingRunResult | null;
  runError?: string | null;
  workspaceNameEdited?: boolean;
  syncState?: Record<string, unknown> | null;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  status: WorkspaceStatus | string;
  current_step: number;
  reference_dataset_id: string | null;
  input_dataset_id: string | null;
  matching_job_id: string | null;
  record_count: number | null;
  owner: WorkspaceOwnerSummary | null;
  workflow_state: WorkspaceStatePayload | null;
  sync_state: Record<string, unknown> | null;
  export_history: unknown[] | null;
  reference_dataset: DatasetInspectResult | null;
  input_dataset: DatasetInspectResult | null;
  matching_job: {
    id: string;
    name: string | null;
    status: string;
    processed_count: number;
    total_count: number;
    record_counts: Record<string, number>;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
  } | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminUserSummary = {
  id: string | number;
  name: string;
  email: string;
  role: UserRole;
  workspace_count: number;
  dataset_count: number;
  matching_job_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminUserUpsertInput = {
  name: string;
  email: string;
  role: UserRole;
};

export type AdminUserPasswordInput = {
  password: string;
  passwordConfirmation: string;
};

export type MonitoringOverview = {
  summary: {
    workspace_total: number;
    user_total: number;
    matching_job_total: number;
    pending_review_total: number;
    status_counts: Record<string, number>;
  };
  owner_breakdown: {
    owner: string;
    user_id: string | number | null;
    role: UserRole | null;
    workspace_count: number;
    pending_review: number;
  }[];
  recent_workspaces: Array<{
    id: string;
    name: string;
    status: string;
    current_step: number;
    record_count: number | null;
    pending_review: number;
    owner: WorkspaceOwnerSummary | null;
    updated_at: string | null;
  }>;
};

type WorkspaceInput = {
  name?: string;
  status?: WorkspaceStatus;
  currentStep?: number;
  referenceDatasetId?: string | null;
  inputDatasetId?: string | null;
  matchingJobId?: string | null;
  workflowState?: WorkspaceStatePayload | null;
  syncState?: Record<string, unknown> | null;
  exportHistory?: unknown[] | null;
};

export type MatchingRunResult = {
  job: {
    id: string;
    name: string | null;
    status: "queued" | "processing" | "completed" | "failed" | string;
    reference_dataset_id: string;
    input_dataset_id: string;
    started_at: string | null;
    finished_at: string | null;
    error_message: string | null;
  };
  progress: {
    status: string;
    processed: number;
    total: number;
    percentage: number;
  };
  summary: {
    matched: number;
    possible_match: number;
    unmatched: number;
    candidates_scored: number;
  };
  top_results: {
    id: string;
    input_record_key: string;
    reference_record_key: string | null;
    result_type: string;
    overall_score: number;
    candidate_rank: number;
  }[];
};

export type ReviewFieldScore = {
  reference_column: string;
  input_column: string;
  score: number;
  comparison: "same" | "similar" | "different" | string;
  identity_conflict?: boolean;
  identity_metadata?: {
    reference?: Record<string, string | number | boolean | null>;
    input?: Record<string, string | number | boolean | null>;
  };
};

export type VerificationRuleEvaluated = {
  order: number;
  mapping_id: string | null;
  field_name: string;
  reference_column: string;
  input_column: string;
  method: string;
  required_threshold: number;
  actual_score: number;
  passed: boolean;
  is_mandatory: boolean;
};

export type VerificationEvidence = {
  phase: string;
  is_exact_match: boolean;
  bypassed_fuzzy: boolean;
  initial_classification: string;
  final_classification: string;
  weighted_similarity: number;
  downgraded: boolean;
  downgrade_reason: string | null;
  rules_evaluated: VerificationRuleEvaluated[];
  summary: {
    total_rules: number;
    passed_rules: number;
    failed_rules: number;
    all_passed: boolean;
    message?: string;
  };
};

export type ReviewCandidate = {
  id: string;
  reference_record_key: string | null;
  reference_record: Record<string, string | number | boolean | null>;
  result_type: "matched" | "possible_match" | "unmatched" | string;
  review_status: string;
  score: number;
  rank: number;
  field_scores: ReviewFieldScore[];
  decision_reason: string | null;
  verification_evidence?: VerificationEvidence | null;
};

export type ReviewDecisionSummary = {
  id: string;
  decision: string;
  previous_result_type?: string | null;
  new_result_type?: string | null;
  selected_reference_record_key: string | null;
  created_at: string | null;
  decided_at?: string | null;
  undone_at?: string | null;
  source?: "individual" | "group" | string;
  reviewer?: string | null;
  affected_records?: number;
  case_group_id?: string | null;
  batch_id?: string | null;
  review_knowledge?: {
    level?: "NEW_PATTERN" | "KNOWN_PATTERN" | "TRUSTED_PATTERN" | string;
    pattern?: string;
    decision?: string;
    conditions?: Record<string, unknown>;
  } | null;
  safety_validation?: {
    applied?: boolean;
    passed?: boolean;
    skipped_records?: ReviewSafetyRecord[];
  } | null;
};

export type ReviewItem = {
  input_record_key: string;
  status: "matched" | "possible_match" | "unmatched" | string;
  display_status?: string;
  status_code?:
    | "AUTO_MATCHED"
    | "MANUAL_ACCEPTED"
    | "MANUAL_REJECTED"
    | "CONFIRMED_UNMATCHED"
    | "NEED_REVIEW"
    | string;
  review_status: string;
  decision: ReviewDecisionSummary | null;
  decision_history?: ReviewDecisionSummary[];
  input_record: Record<string, string | number | boolean | null>;
  candidates: ReviewCandidate[];
  case_features?: {
    pattern: string;
    fingerprint: string;
    reason: string;
    conditions: Record<string, unknown>;
  };
};

export type ReviewCaseGroup = {
  id: string;
  fingerprint: string;
  status?: "open" | "resolved" | string;
  pattern: string;
  label: string;
  reason: string;
  conditions: Record<string, unknown>;
  confidence: "High" | "Mixed" | "Unique" | string;
  consistency?: "High" | "Mixed" | "Unique" | string;
  recommendation?: string;
  knowledge_level?: "NEW_PATTERN" | "KNOWN_PATTERN" | "TRUSTED_PATTERN" | string;
  eligible_for_bulk: boolean;
  item_count: number;
  reviewed_count: number;
  decision_summary?: {
    accepted: number;
    rejected: number;
    unmatched: number;
    pending: number;
    mixed: boolean;
  };
  decision_history?: ReviewDecisionSummary[];
  item_keys: string[];
  representative_input_key: string | null;
  representative: ReviewItem;
  representative_samples?: ReviewItem[];
};

export type ReviewSafetyRecord = {
  input_record_key: string;
  reference_record_key: string | null;
  reason: string;
};

export type ReviewDecisionResult = {
  decision: {
    id: string;
    decision: string;
    input_record_key: string;
    selected_reference_record_key: string | null;
    new_result_type: string;
    affected_records: number;
    skipped_records?: ReviewSafetyRecord[];
    skipped_count?: number;
  };
  review: ReviewResults;
};

export type ReviewResults = {
  job: {
    id: string;
    name: string | null;
    status: string;
  };
  summary: {
    matched: number;
    possible_match: number;
    unmatched: number;
    reviewed: number;
  };
  items: ReviewItem[];
  case_groups: ReviewCaseGroup[];
};

export type AiEnvelope<T> = {
  success: boolean;
  provider: string;
  model: string | null;
  data: T | null;
  usage: Record<string, unknown> | null;
  latency_ms: number | null;
  error: {
    code: string | null;
    message: string | null;
  };
};

export type AiReviewAnalysis = {
  assessment: "likely_match" | "uncertain" | "likely_not_match" | string;
  confidence: number;
  summary: string;
  supporting_evidence: string[];
  conflicts: string[];
  missing_information: string[];
  attention_points: string[];
};

export type ReviewKnowledgeCase = {
  matching_result_id: string;
  matching_job_id: string;
  input_record_key: string;
  relevance_score: number;
  previous_human_decision: string;
  decision_recorded_at: string | null;
  pattern: string;
  important_agreements: string[];
  important_conflicts: string[];
  field_scores: Array<{
    field: string;
    score: number | null;
    comparison: string | null;
  }>;
};

export type ReviewKnowledgeResponse = {
  similar_cases: ReviewKnowledgeCase[];
  total_cases_found: number;
};

export type AiReviewRecommendation = {
  recommendation: "accept_match" | "reject_match" | "mark_unmatched" | "needs_review" | string;
  confidence: number;
  rationale: string;
  key_evidence: string[];
  historical_context: string[];
  risks: string[];
  suggested_checks: string[];
};

export type AiConfigRecommendedField = {
  field?: string;
  mapping?: string;
  use_for_matching?: boolean;
  priority?: string;
  suggested_weight?: number;
  suggested_algorithm?: string;
  reason?: string;
};

export type AiMatchingConfigurationSuggestion = {
  recommended_fields: AiConfigRecommendedField[];
  suggested_thresholds?: {
    auto_match?: number;
    needs_review?: number;
  };
  hard_conflict_rules: string[];
  warnings: string[];
  rationale: string;
};

type ReviewDecisionInput = {
  inputRecordKey: string;
  inputRecordKeys?: string[];
  matchingResultId?: string;
  decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched";
  scope?: "one" | "selected" | "group";
  caseGroupId?: string;
  note?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export async function fetchCurrentUser(): Promise<AuthSession | null> {
  const response = await apiFetch("/me");
  if (response.status === 401) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<AuthSession>
    | ApiFailure
    | null;
  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Unable to load the current session",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function loginWithSession(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  await ensureCsrfCookie();

  const response = await apiFetch("/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<AuthSession>
    | ApiFailure
    | null;
  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Email or password is incorrect",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function logoutSession(): Promise<void> {
  await ensureCsrfCookie();

  const response = await apiFetch("/logout", {
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as ApiSuccess<unknown> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Logout failed",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
let pendingUnauthorizedProbe: Promise<boolean> | null = null;

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: { skipUnauthorizedHandling?: boolean } = {},
) {
  const response = await sendApiRequest(path, init);

  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    !options.skipUnauthorizedHandling &&
    shouldProbeUnauthorized(path)
  ) {
    const sessionExpired = await confirmSessionExpired();
    if (sessionExpired) {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    }
  }

  return response;
}

function getClientLocale(): string {
  if (typeof window === "undefined") return "id";
  try {
    const raw = window.localStorage.getItem("batchmatch:preferences");
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: string };
      if (parsed.language === "en" || parsed.language === "id") {
        return parsed.language;
      }
    }
  } catch {
    // fallback
  }
  return "id";
}

async function sendApiRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  const currentLocale = getClientLocale();
  headers.set("X-Locale", currentLocale);
  headers.set(
    "Accept-Language",
    currentLocale === "id" ? "id-ID,id;q=0.9,en;q=0.8" : "en-US,en;q=0.9,id;q=0.8",
  );

  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = readCookie("XSRF-TOKEN");
    if (csrfToken) {
      headers.set("X-XSRF-TOKEN", csrfToken);
    }
  }

  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
}

function shouldProbeUnauthorized(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return !["/me", "/login", "/logout"].includes(normalized);
}

async function confirmSessionExpired() {
  if (pendingUnauthorizedProbe) {
    return pendingUnauthorizedProbe;
  }

  pendingUnauthorizedProbe = (async () => {
    try {
      const response = await apiFetch(
        "/me",
        {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        },
        { skipUnauthorizedHandling: true },
      );

      return response.status === 401;
    } catch {
      return false;
    } finally {
      pendingUnauthorizedProbe = null;
    }
  })();

  return pendingUnauthorizedProbe;
}

async function ensureCsrfCookie() {
  await fetch(
    import.meta.env.VITE_CSRF_URL ?? "/sanctum/csrf-cookie",
    {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    },
  );
}

export async function inspectDataset(input: InspectDatasetInput): Promise<DatasetInspectResult> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("dataset_role", input.datasetRole);

  if (input.sheetName) form.append("sheet_name", input.sheetName);
  if (input.delimiter) form.append("delimiter", input.delimiter);
  if (input.headerRow) form.append("header_row", String(input.headerRow));

  const response = await apiFetch("/datasets/inspect", {
    method: "POST",
    body: form,
    headers: {
      Accept: "application/json",
    },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<DatasetInspectResult> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Dataset inspection failed. Please try again.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export interface PaginatedDatasetRowsResult {
  data: Record<string, unknown>[];
  total: number;
  current_page: number;
  per_page: number;
  last_page: number;
}

export async function fetchDatasetRows(
  datasetId: string,
  params?: { page?: number; per_page?: number; search?: string },
): Promise<PaginatedDatasetRowsResult> {
  const query = new URLSearchParams();
  if (params?.page) query.append("page", String(params.page));
  if (params?.per_page) query.append("per_page", String(params.per_page));
  if (params?.search) query.append("search", params.search);

  const qs = query.toString();
  const endpoint = `/datasets/${datasetId}/rows${qs ? `?${qs}` : ""}`;

  const response = await apiFetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<PaginatedDatasetRowsResult>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Failed to fetch dataset rows.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function runMatching(input: RunMatchingInput): Promise<MatchingRunResult> {
  const response = await apiFetch("/matching-jobs/run", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      workspace_id: input.workspaceId,
      reference_dataset_id: input.referenceDatasetId,
      input_dataset_id: input.inputDatasetId,
      mappings: input.mappings,
      configuration: input.configuration,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<MatchingRunResult> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Matching run failed. Please check your configuration.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchMatchingJobStatus(jobId: string): Promise<MatchingRunResult> {
  const response = await apiFetch(`/matching-jobs/${jobId}/status`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<MatchingRunResult>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Matching job status could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchReviewResults(jobId: string): Promise<ReviewResults> {
  const response = await apiFetch(`/matching-jobs/${jobId}/review-results`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<ReviewResults> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Review results could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchAiReviewAnalysis(resultId: string): Promise<AiEnvelope<AiReviewAnalysis>> {
  const response = await apiFetch(`/matching-results/${resultId}/ai-review-analysis`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<AiEnvelope<AiReviewAnalysis>>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "AI analysis could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchAiReviewRecommendation(
  resultId: string,
): Promise<AiEnvelope<AiReviewRecommendation>> {
  const response = await apiFetch(`/matching-results/${resultId}/ai-review-recommendation`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<AiEnvelope<AiReviewRecommendation>>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "AI recommendation could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchReviewKnowledge(resultId: string): Promise<ReviewKnowledgeResponse> {
  const response = await apiFetch(`/matching-results/${resultId}/review-knowledge`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<ReviewKnowledgeResponse>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Review knowledge could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export type FetchAiMatchingConfigurationOptions = {
  locale?: string;
  mappings?: Array<{
    mapping_id?: string;
    reference_column?: string;
    input_column?: string;
    data_type?: string;
    strict?: boolean;
  }>;
};

export async function fetchAiMatchingConfiguration(
  jobId: string,
  options?: FetchAiMatchingConfigurationOptions,
): Promise<AiEnvelope<AiMatchingConfigurationSuggestion>> {
  const queryParams = new URLSearchParams();
  if (options?.locale) {
    queryParams.set("locale", options.locale);
  }
  const queryString = queryParams.toString();
  const url = `/matching-jobs/${jobId}/ai-matching-configuration${queryString ? `?${queryString}` : ""}`;

  const hasMappings = Boolean(options?.mappings && options.mappings.length > 0);

  const response = await apiFetch(url, {
    method: hasMappings ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(options?.locale ? { "X-Locale": options.locale } : {}),
      ...(hasMappings ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasMappings
      ? {
          body: JSON.stringify({
            locale: options?.locale,
            mappings: options?.mappings,
          }),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<AiEnvelope<AiMatchingConfigurationSuggestion>>
    | ApiFailure
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "AI configuration suggestion could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function saveReviewDecision(
  jobId: string,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  const response = await apiFetch(`/matching-jobs/${jobId}/review-decisions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_record_key: input.inputRecordKey,
      input_record_keys: input.inputRecordKeys,
      matching_result_id: input.matchingResultId,
      decision: input.decision,
      scope: input.scope,
      case_group_id: input.caseGroupId,
      note: input.note,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<ReviewDecisionResult> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Review decision could not be saved.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await apiFetch("/workspaces", {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<WorkspaceSummary[]> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Workspaces could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const response = await apiFetch("/admin/users", {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<AdminUserSummary[]> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Users could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function createAdminUser(
  input: AdminUserUpsertInput & AdminUserPasswordInput,
): Promise<AdminUserSummary> {
  const response = await apiFetch("/admin/users", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      role: input.role,
      password: input.password,
      password_confirmation: input.passwordConfirmation,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<AdminUserSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "User could not be created.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function updateAdminUser(
  id: string | number,
  input: { name?: string; email?: string; role?: UserRole },
): Promise<AdminUserSummary> {
  const response = await apiFetch(`/admin/users/${id}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<AdminUserSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "User could not be updated.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function setAdminUserPassword(
  id: string | number,
  input: AdminUserPasswordInput,
): Promise<AdminUserSummary> {
  const response = await apiFetch(`/admin/users/${id}/password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password: input.password,
      password_confirmation: input.passwordConfirmation,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<AdminUserSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Password could not be updated.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function listAdminWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await apiFetch("/admin/workspaces", {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<WorkspaceSummary[]> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Admin workspaces could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function reassignWorkspaceOwner(
  workspaceId: string,
  userId: string | number,
): Promise<WorkspaceSummary> {
  const response = await apiFetch(`/admin/workspaces/${workspaceId}/owner`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<WorkspaceSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Workspace owner could not be updated.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function fetchMonitoringOverview(): Promise<MonitoringOverview> {
  const response = await apiFetch("/monitoring/overview", {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<MonitoringOverview> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Monitoring overview could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function createWorkspace(input: WorkspaceInput): Promise<WorkspaceSummary> {
  return writeWorkspace(`${API_BASE_URL}/workspaces`, "POST", input);
}

export async function fetchWorkspace(id: string): Promise<WorkspaceSummary> {
  const response = await apiFetch(`/workspaces/${id}`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<WorkspaceSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Workspace could not be loaded.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function updateWorkspace(
  id: string,
  input: WorkspaceInput,
): Promise<WorkspaceSummary> {
  return writeWorkspace(`${API_BASE_URL}/workspaces/${id}`, "PATCH", input);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const response = await apiFetch(`/workspaces/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<{ id: string }> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Workspace could not be deleted.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }
}

async function writeWorkspace(
  url: string,
  method: "POST" | "PATCH",
  input: WorkspaceInput,
): Promise<WorkspaceSummary> {
  const response = await apiFetch(url.replace(API_BASE_URL, ""), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      status: input.status,
      current_step: input.currentStep,
      reference_dataset_id: input.referenceDatasetId,
      input_dataset_id: input.inputDatasetId,
      matching_job_id: input.matchingJobId,
      workflow_state: input.workflowState,
      sync_state: input.syncState,
      export_history: input.exportHistory,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<WorkspaceSummary> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Workspace could not be saved.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data;
}

export async function undoReviewDecision(
  jobId: string,
  decisionId: string,
): Promise<ReviewResults> {
  const response = await apiFetch(
    `/matching-jobs/${jobId}/review-decisions/${decisionId}/undo`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    ApiSuccess<{ review: ReviewResults }> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Review decision could not be undone.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data.review;
}
