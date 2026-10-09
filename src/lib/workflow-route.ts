const MIN_WORKFLOW_STEP = 1;
const MAX_WORKFLOW_STEP = 3;

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
  if (parsed < 1) return 1;
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  // Map legacy steps: 4 (Configure) -> 2, 5 (Run) -> 2, 6..8 (Review, Sync, Export) -> 3
  if (parsed === 4 || parsed === 5) return 2;
  return 3;
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

