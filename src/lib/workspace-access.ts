import { apiFetch } from "@/lib/api";

// Build-time only. No query string/local storage override; legacy writers never used here.
export const workspaceSharingEnabled = import.meta.env.VITE_WORKSPACE_SHARING_UI === "true";
export type AccessRole = "owner" | "admin" | "editor" | "viewer" | "pimpinan";
export type WorkspaceAccess = {
  workspace_id: string;
  role: AccessRole;
  membership_version: number | null;
  permissions: Record<
    | "read"
    | "review"
    | "propose"
    | "approve"
    | "members"
    | "configure"
    | "run"
    | "dataset_write"
    | "export_read",
    boolean
  >;
};
export type AccessWorkspace = {
  id: string;
  name: string;
  user_id: number;
  status: string;
  matching_job_id: string | null;
  configuration_version: number;
  owner_name?: string;
  access_role?: AccessRole;
};
export type SharedCandidate = {
  id: string;
  input_record_key: string;
  reference_record_key: string;
  rank: number;
  score: number | null;
  input_record: Record<string, unknown>;
  reference_record: Record<string, unknown>;
  field_scores: Record<string, unknown> | unknown[];
  verification_evidence: unknown;
  decision_reason: string | null;
  reference_occupied?: boolean;
  integrity_hold?: boolean;
};
export type SharedState = {
  input_record_key: string;
  version: number;
  status: string;
  decision: Decision | null;
  decision_origin: string;
  decision_protection: string;
  integrity_status: string;
  selected_matching_result_id: string | null;
  selected_reference_record_key: string | null;
  duplicate_of_input_record_key: string | null;
  lineage_status: string;
  source_occurrence_count: number | null;
  actors: Record<
    "reviewer" | "proposer" | "approver" | "last_modifier",
    { id: number | null; name: string | null }
  >;
  similarity_score: number | null;
  displayed_candidate: SharedCandidate | null;
  actions: { review: boolean; propose: boolean; requires_proposal: boolean };
};
export type SharedReview = {
  data: SharedState[];
  pagination: Omit<Page<never>, "data">;
  summary: Record<string, number>;
};
export type SharedDataset = { id: string; name: string; row_count: number; parse_status: string };
export type SharedWorkspaceMetadata = {
  workspace: AccessWorkspace;
  owner: { id: number; name: string };
  datasets: Record<string, SharedDataset>;
  job: null | {
    id: string;
    status: string;
    ready: boolean;
    region_filters_ready: boolean;
    review_state_readiness: string;
    processed_count: number;
    total_count: number;
    datasets: Record<string, SharedDataset>;
  };
  configuration: Record<string, unknown> | null;
};
export type SharedFilters = {
  page?: number;
  per_page?: number;
  record_key?: string;
  status?: string;
  search?: string;
  sort?: string;
  similarity_min?: number;
  similarity_max?: number;
  input_province_code?: string;
  input_regency_code?: string;
};
const queryString = (filters: SharedFilters) =>
  new URLSearchParams(
    Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
export type Page<T> = {
  data: T[];
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
};
export type Member = {
  id: string;
  user_id: number;
  name: string;
  email: string;
  role: "editor" | "viewer";
  status: "active" | "revoked";
  version: number;
};
type MembershipAck = Pick<Member, "user_id" | "role" | "status" | "version">;
export type RegisteredUser = { id: number; name: string; email: string };
export type Decision = "accept_match" | "select_candidate" | "reject_match" | "mark_unmatched";
export type ProposalStatus =
  "pending" | "approved" | "rejected" | "stale" | "conflicted" | "cancelled";
export type Proposal = {
  id: string;
  input_record_key: string;
  version: number;
  expected_version: number;
  current_state_version: number;
  before_decision: Decision | null;
  before_status: string;
  before_reference_record_key: string | null;
  proposed_reference_record_key: string | null;
  proposed_decision: Decision;
  reason: string;
  resolution_reason: string | null;
  status: ProposalStatus;
  previous_reviewer_name: string | null;
  proposer_name: string | null;
  approver_name: string | null;
  proposed_by_user_id: number;
  previous_reviewer_user_id: number | null;
  created_at: string;
};
export type WriteItem = {
  input_record_key: string;
  expected_version: number;
  decision: Decision;
  candidate_id?: string | null;
};
export type AckItem = {
  input_record_key: string;
  outcome: string;
  version?: number;
  decision_id?: string;
  request_id?: string;
  request_version?: number;
  status?: ProposalStatus;
  code?: string;
  conflict_code?: string;
};
export type ReviewAck = {
  operation_id: string;
  applied: number;
  conflicted: number;
  skipped: number;
  approval_required: number;
  submitted?: number;
  rejected?: number;
  items: AckItem[];
};

export class WorkspaceAccessError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
    public ack?: ReviewAck,
  ) {
    super(accessErrorMessage(code));
  }
}
export function accessErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    stale_review_version:
      "Record telah diubah pengguna lain. Muat data terbaru sebelum memutuskan kembali.",
    stale_proposal_version: "Usulan telah berubah atau diselesaikan. Muat daftar terbaru.",
    proposal_snapshot_changed: "Keputusan dasar usulan berubah. Muat daftar terbaru.",
    workspace_access_disabled: "Fitur akses workspace belum diaktifkan pada lingkungan ini.",
    review_forbidden: "Hak review berubah atau dicabut. Tindakan dihentikan.",
    proposal_not_pending: "Usulan ini tidak lagi menunggu persetujuan.",
    reference_conflict:
      "Acuan sudah digunakan input lain. Pilih acuan lain setelah memuat data terbaru.",
    reference_integrity_hold: "Acuan sedang dalam integrity hold; diperlukan rekonsiliasi.",
    input_integrity_hold: "Record sedang dalam integrity hold; diperlukan rekonsiliasi.",
    workspace_forbidden: "Hak akses workspace berubah atau dicabut. Tindakan dihentikan.",
    workspace_resource_forbidden: "Data ini tidak dapat diakses dari workspace ini.",
    stale_membership_version: "Keanggotaan telah berubah. Muat daftar anggota terbaru.",
    approval_required: "Keputusan ini memerlukan usulan revisi dan persetujuan.",
    feature_disabled: "Fitur belum diaktifkan pada lingkungan ini.",
    review_state_not_ready:
      "Review state belum siap. Muat data terbaru setelah rekonsiliasi selesai.",
    review_regions_not_ready:
      "Indeks wilayah belum siap. Reset filter wilayah untuk membaca record lainnya.",
    reader_payload_too_large: "Data melebihi batas halaman. Kurangi jumlah record per halaman.",
  };
  return (
    messages[code] ??
    (code === "validation_failed"
      ? "Periksa isian dan alasan yang wajib diisi."
      : "Permintaan gagal. Muat data terbaru; penyimpanan tidak diulangi otomatis.")
  );
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!workspaceSharingEnabled) throw new WorkspaceAccessError(503, "feature_disabled");
  const response = await apiFetch(`/stage5a${path}`, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    const ack = payload?.data as ReviewAck | undefined;
    throw new WorkspaceAccessError(
      response.status,
      payload?.code ??
        ack?.items?.[0]?.conflict_code ??
        (response.status === 403
          ? "workspace_forbidden"
          : response.status === 422
            ? "validation_failed"
            : response.status === 503
              ? "feature_disabled"
              : "request_failed"),
      payload?.details ?? payload?.errors,
      ack,
    );
  }
  return payload.data as T;
}
const key = encodeURIComponent; // Do not trim/coerce opaque record keys.
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const accessApi = {
  workspace: (id: string, signal?: AbortSignal) =>
    request<SharedWorkspaceMetadata>(`/workspaces/${key(id)}`, { signal }),
  review: (workspace: string, job: string, filters: SharedFilters, signal?: AbortSignal) =>
    request<SharedReview>(
      `/workspaces/${key(workspace)}/jobs/${key(job)}/review-results?${queryString(filters)}`,
      { signal },
    ),
  candidates: (
    workspace: string,
    job: string,
    record_key: string,
    page = 1,
    signal?: AbortSignal,
  ) =>
    request<{ version: number; data: SharedCandidate[]; pagination: Omit<Page<never>, "data"> }>(
      `/workspaces/${key(workspace)}/jobs/${key(job)}/candidates?${queryString({ record_key, page, per_page: 25 })}`,
      { signal },
    ),
  dataset: (workspace: string, dataset: string, page = 1, signal?: AbortSignal) =>
    request<Page<Record<string, unknown>> & { partial: boolean; source_row_count: number }>(
      `/workspaces/${key(workspace)}/datasets/${key(dataset)}/rows?page=${page}`,
      { signal },
    ),
  export: async (workspace: string, job: string) => {
    if (!workspaceSharingEnabled) throw new WorkspaceAccessError(503, "feature_disabled");
    const response = await apiFetch(
      `/stage5a/workspaces/${key(workspace)}/jobs/${key(job)}/export`,
    );
    if (!response.ok) {
      const error = await response.json();
      throw new WorkspaceAccessError(response.status, error.code ?? "request_failed");
    }
    return response.blob();
  },
  workspaces: (page = 1, signal?: AbortSignal) =>
    request<Page<AccessWorkspace>>(`/workspaces?page=${page}`, { signal }),
  permissions: (id: string, signal?: AbortSignal) =>
    request<WorkspaceAccess>(`/workspaces/${key(id)}/permissions`, { signal }),
  members: (id: string, page = 1, signal?: AbortSignal) =>
    request<Page<Member>>(`/workspaces/${key(id)}/members?page=${page}`, { signal }),
  users: (id: string, search: string, signal?: AbortSignal) =>
    request<RegisteredUser[]>(`/workspaces/${key(id)}/users?search=${key(search)}`, { signal }),
  setMember: (id: string, user_id: number, role: Member["role"], expected_version: number) =>
    request<MembershipAck>(
      `/workspaces/${key(id)}/members`,
      json("POST", { user_id, role, expected_version }),
    ),
  revoke: (id: string, user_id: number, expected_version: number) =>
    request<MembershipAck>(
      `/workspaces/${key(id)}/members/${user_id}`,
      json("DELETE", { expected_version }),
    ),
  proposals: (job: string, status: ProposalStatus, page = 1, signal?: AbortSignal) =>
    request<Page<Proposal>>(`/jobs/${key(job)}/proposals?status=${status}&page=${page}`, {
      signal,
    }),
  propose: (job: string, item: WriteItem, reason: string, idempotency_key: string) =>
    request<ReviewAck>(
      `/jobs/${key(job)}/proposals`,
      json("POST", { ...item, reason, idempotency_key }),
    ),
  resolve: (
    job: string,
    proposal: Proposal,
    approve: boolean,
    reason: string,
    idempotency_key: string,
  ) =>
    request<ReviewAck>(
      `/jobs/${key(job)}/proposals/${key(proposal.id)}/resolve`,
      json("POST", {
        expected_request_version: proposal.version,
        approve,
        reason,
        idempotency_key,
      }),
    ),
  decide: (job: string, items: WriteItem[], idempotency_key: string) =>
    request<ReviewAck>(`/jobs/${key(job)}/decisions`, json("POST", { items, idempotency_key })),
  undo: (
    job: string,
    operation_id: string,
    items: { input_record_key: string; expected_version: number }[],
    idempotency_key: string,
  ) =>
    request<ReviewAck>(
      `/jobs/${key(job)}/undo`,
      json("POST", { operation_id, items, idempotency_key }),
    ),
};

export const decisionLabels: Record<Decision, string> = {
  accept_match: "Terima Match",
  select_candidate: "Pilih Kandidat",
  reject_match: "Tolak Kandidat",
  mark_unmatched: "Tandai Unmatched",
};
export const proposalLabels: Record<ProposalStatus, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  stale: "Kedaluwarsa",
  conflicted: "Konflik",
  cancelled: "Dibatalkan",
};
