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
};

type ApiFailure = {
  success: false;
  message?: string;
  errors?: Record<string, string[]>;
};

type InspectDatasetInput = {
  file: File;
  datasetRole: DatasetRole;
  sheetName?: string;
  delimiter?: string;
  headerRow?: number;
};

type RunMatchingInput = {
  name?: string;
  referenceDatasetId: string;
  inputDatasetId: string;
  mappings: unknown[];
  configuration: unknown;
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
};

export type ReviewItem = {
  input_record_key: string;
  status: "matched" | "possible_match" | "unmatched" | string;
  display_status?: string;
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

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api").replace(
  /\/$/,
  "",
);

export async function inspectDataset(input: InspectDatasetInput): Promise<DatasetInspectResult> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("dataset_role", input.datasetRole);

  if (input.sheetName) form.append("sheet_name", input.sheetName);
  if (input.delimiter) form.append("delimiter", input.delimiter);
  if (input.headerRow) form.append("header_row", String(input.headerRow));

  const response = await fetch(`${API_BASE_URL}/datasets/inspect`, {
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

export async function runMatching(input: RunMatchingInput): Promise<MatchingRunResult> {
  const response = await fetch(`${API_BASE_URL}/matching-jobs/run`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
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

export async function fetchReviewResults(jobId: string): Promise<ReviewResults> {
  const response = await fetch(`${API_BASE_URL}/matching-jobs/${jobId}/review-results`, {
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

export async function saveReviewDecision(
  jobId: string,
  input: ReviewDecisionInput,
): Promise<ReviewResults> {
  const response = await fetch(`${API_BASE_URL}/matching-jobs/${jobId}/review-decisions`, {
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
    ApiSuccess<{ review: ReviewResults }> | ApiFailure | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(
      payload?.message ?? "Review decision could not be saved.",
      response.status,
      payload?.success === false ? payload.errors : undefined,
    );
  }

  return payload.data.review;
}

export async function undoReviewDecision(
  jobId: string,
  decisionId: string,
): Promise<ReviewResults> {
  const response = await fetch(
    `${API_BASE_URL}/matching-jobs/${jobId}/review-decisions/${decisionId}/undo`,
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
