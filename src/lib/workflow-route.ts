const MIN_WORKFLOW_STEP = 1;
const MAX_WORKFLOW_STEP = 8;

export type WorkflowSearch = {
  workspace?: string;
  step?: number;
};

export function normalizeWorkspaceSearchValue(value: unknown) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeWorkflowStep(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < MIN_WORKFLOW_STEP || parsed > MAX_WORKFLOW_STEP) return undefined;
  return parsed;
}

export function validateWorkflowSearch(search: Record<string, unknown>): WorkflowSearch {
  return {
    workspace: normalizeWorkspaceSearchValue(search.workspace),
    step: normalizeWorkflowStep(search.step),
  };
}

export function buildMatchingSearch(workspaceId?: string | null, step?: number | null): WorkflowSearch {
  return {
    workspace: normalizeWorkspaceSearchValue(workspaceId),
    step: normalizeWorkflowStep(step),
  };
}

export function buildResultsSearch(workspaceId?: string | null) {
  const workspace = normalizeWorkspaceSearchValue(workspaceId);
  return workspace ? { workspace } : {};
}

