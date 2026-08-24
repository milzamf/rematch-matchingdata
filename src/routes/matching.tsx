import { createFileRoute, Link } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Stepper } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/feedback-states";
import { PromptDialog } from "@/components/prompt-dialog";
import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { wizardSteps } from "@/lib/dummy-data";
import { downloadCsv, downloadXlsx } from "@/lib/export-files";
import {
  buildExportRows,
  buildStoredExportHistoryEntry,
  countExportStatuses,
  exportColumns,
  exportSummaryRows,
  normalizeStoredExportHistory,
  type ExportFormat,
  type ExportStatus,
  type StoredExportHistoryEntry,
} from "@/lib/result-exports";
import {
  VerificationEvidenceBadge,
  VerificationEvidenceBreakdown,
} from "@/components/verification-evidence";
import { IntentExportPanel } from "@/components/intent-export-panel";
import { DataPreviewTable } from "@/components/data-preview-table";
import { TablePagination } from "@/components/ui/table-pagination";
import { standardizeColumnValue, parseEntityName } from "@/lib/data-normalizer";
import {
  fetchAiMatchingConfiguration,
  fetchAiReviewAnalysis,
  fetchAiReviewRecommendation,
  fetchReviewKnowledge,
  ApiError,
  createWorkspace,
  fetchReviewResults,
  fetchWorkspace,
  inspectDataset,
  runMatching,
  saveReviewDecision,
  type AiConfigRecommendedField,
  type AiEnvelope,
  type AiMatchingConfigurationSuggestion,
  type AiReviewAnalysis,
  type AiReviewRecommendation,
  type DatasetInspectResult,
  type DatasetRole,
  type MatchingRunResult,
  type ReviewCaseGroup,
  type ReviewCandidate,
  type ReviewKnowledgeResponse,
  type ReviewItem,
  type ReviewResults,
  type WorkspaceStatePayload,
  type WorkspaceStatus,
  type WorkspaceSummary,
  updateWorkspace,
  undoReviewDecision,
} from "@/lib/api";
import { usePreferences } from "@/lib/preferences";
import {
  buildIdentitySummary,
  buildRecordIdentity,
  buildSideIdentity,
  extractIdentityMappings,
  sortFieldScores,
  type IdentityFieldPair,
  type IdentitySemantic,
} from "@/lib/result-identity";
import {
  buildMatchingSearch,
  buildResultsSearch,
  validateWorkflowSearch,
} from "@/lib/workflow-route";
import {
  Check,
  Upload,
  FileSpreadsheet,
  Database,
  ArrowRight,
  ArrowLeft,
  Play,
  Loader2,
  Inbox,
  AlertCircle,
  ClipboardCheck,
  Plus,
  Trash2,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Search,
  RefreshCw,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/matching")({
  validateSearch: validateWorkflowSearch,
  head: () => ({
    meta: [
      { title: "Matching Workflow - RE-MATCH" },
      {
        name: "description",
        content:
          "Step-by-step matching workflow: upload datasets, profile columns, configure rules, run, review, synchronize, and export results.",
      },
    ],
  }),
  component: MatchingPage,
});

type UploadedFile = {
  name: string;
  size: number;
  status: "loading" | "success" | "error";
  result?: DatasetInspectResult;
  error?: string;
};
type SyncState = {
  confirmed: boolean;
  id?: string;
  auditId?: string;
  createdAt?: string;
  confirmedAt?: string;
  planMode?: "recommended" | "custom";
};
type RunState = "idle" | "running" | "success" | "failed";
type MatchingAlgorithm =
  "Exact" | "Normalized Exact" | "Contains" | "Starts With" | "Ends With" | "Fuzzy";
type MappingSuggestionSource =
  "exact_name" | "case_insensitive" | "normalized_name" | "similarity" | "manual" | "none";
type ColumnMappingDraft = {
  id: string;
  referenceColumnId: string;
  inputColumnId: string;
  algorithm: MatchingAlgorithm;
  required_match: boolean;
  suggested: boolean;
  suggestionSource: MappingSuggestionSource;
  suggestionScore: number | null;
  referenceColumnName: string;
  inputColumnName: string;
  referenceDataType: string;
  inputDataType: string;
  referenceNullPercentage?: number;
  inputNullPercentage?: number;
  referenceDuplicatePercentage?: number;
  inputDuplicatePercentage?: number;
  referenceSampleValues?: string[];
  inputSampleValues?: string[];
};
type Preset = "Default" | "Custom";
type Strategy = "Hybrid" | "Exact" | "Fuzzy" | "Composite" | "Rule-Based";
type ComparisonFamily = "Exact" | "Character Similarity" | "Token Similarity";
type FieldType = "text" | "number" | "date" | "boolean" | "unknown";
type CandidateCount = 1 | 3 | 5 | 10 | "custom";
type ConfigureAlgorithm =
  | "Exact"
  | "Normalized Exact"
  | "Jaro-Winkler"
  | "Levenshtein"
  | "Damerau-Levenshtein"
  | "Token Sort"
  | "Token Set"
  | "Partial Token";

type ConfigurationField = {
  mappingId: string;
  referenceColumnId: string;
  inputColumnId: string;
  referenceColumnName: string;
  inputColumnName: string;
  dataType: FieldType;
  algorithm: ConfigureAlgorithm;
  strict?: boolean;
  comparisonFamily?: ComparisonFamily;
  normalization?: string;
};

type MatchingConfiguration = {
  preset: Preset;
  mode: "preset" | "default" | "custom";
  strategy: Strategy;
  isValid: boolean;
  fields: ConfigurationField[];
  thresholds: null | {
    autoMatch: number;
    review: number;
    noMatch: number;
  };
  candidateGeneration: null | {
    topN: number;
  };
  searchOptimization: {
    enabled: boolean;
    mode: "auto" | "manual";
    fields: string[];
    recommendedFields: string[];
  };
  normalization: {
    mode: "auto" | "manual";
    preset: string;
  };
  weighting: {
    mode: "none" | "auto" | "manual";
    fields: { mappingId: string; field: string; weight: number; algorithm: ConfigureAlgorithm }[];
  };
  rules: null | {
    mandatoryRule: string;
    numericTolerance: string | null;
    dateTolerance: string | null;
    combinedScoring: boolean;
    similarityFormula: string | null;
    verificationEnabled?: boolean;
    verificationOrder?: {
      order: number;
      field: string;
      mappingId: string;
      method: string;
      threshold: number;
    }[];
  };
  output: {
    mode: "standard" | "custom";
    items: string[];
  };
};

const ALLOWED = [".csv", ".xlsx"];
const MAX_MB = 50;

function injectVirtualColumns(
  columns: DatasetInspectResult["columns"],
  prefix: string,
): DatasetInspectResult["columns"] {
  if (columns.length === 0) return [];
  const hasStringField = columns.some(
    (c) =>
      ["text", "string", "varchar"].includes((c.data_type || "").toLowerCase()) || !c.data_type,
  );
  if (!hasStringField) return columns;

  const virtualCoreName: DatasetInspectResult["columns"][number] = {
    id: `virtual-${prefix}-core-name`,
    name: "[Generated] Nama Inti",
    normalized_name: "nama_inti",
    position: 998,
    data_type: "text",
    null_count: 0,
    null_percentage: 0,
    unique_count: 0,
    duplicate_percentage: 0,
    sample_values: ["Nama Inti Usaha"],
  };

  const virtualLegalForm: DatasetInspectResult["columns"][number] = {
    id: `virtual-${prefix}-legal-form`,
    name: "[Generated] Badan Usaha",
    normalized_name: "badan_usaha",
    position: 999,
    data_type: "text",
    null_count: 0,
    null_percentage: 0,
    unique_count: 0,
    duplicate_percentage: 0,
    sample_values: ["PT", "CV", "UD"],
  };

  return [...columns, virtualCoreName, virtualLegalForm];
}

function MatchingPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const initialWorkspaceId = search.workspace ?? null;
  const requestedStep = search.step ?? 1;
  const hasRequestedStep = typeof search.step === "number";
  const [step, setStep] = useState(requestedStep);
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId);
  const [workspaceName, setWorkspaceName] = useState(t("workspace.untitled"));
  const [workspaceNameEdited, setWorkspaceNameEdited] = useState(false);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >(initialWorkspaceId ? "saving" : "idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [reference, setReference] = useState<UploadedFile | null>(null);
  const [input, setInput] = useState<UploadedFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [runResult, setRunResult] = useState<MatchingRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [columnMappings, setColumnMappings] = useState<ColumnMappingDraft[]>([]);
  const [configureValid, setConfigureValid] = useState(true);
  const [matchingConfiguration, setMatchingConfiguration] = useState<MatchingConfiguration | null>(
    null,
  );
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [exportHistory, setExportHistory] = useState<StoredExportHistoryEntry[]>([]);
  const [isHydratingWorkspace, setIsHydratingWorkspace] = useState(Boolean(initialWorkspaceId));
  const [workspaceNotFound, setWorkspaceNotFound] = useState(false);
  const [isNavigatingStep, setIsNavigatingStep] = useState(false);
  const workspaceIdRef = useRef<string | null>(initialWorkspaceId);
  const suppressMappingSuggestRef = useRef(false);
  const restoringWorkspaceRef = useRef(false);
  const hydratedWorkspaceRouteRef = useRef<string | null>(null);
  const lastSavedStateHashRef = useRef<string>("");
  const requestedStepRef = useRef(requestedStep);
  const hasRequestedStepRef = useRef(hasRequestedStep);

  useEffect(() => {
    requestedStepRef.current = requestedStep;
    hasRequestedStepRef.current = hasRequestedStep;
  }, [requestedStep, hasRequestedStep]);

  useEffect(() => {
    if (
      !isHydratingWorkspace &&
      typeof search.step === "number" &&
      search.step >= 1 &&
      search.step <= 3 &&
      search.step !== step
    ) {
      setStep(search.step);
    }
  }, [isHydratingWorkspace, search.step, step]);

  const referenceColumns = reference?.result?.columns ?? [];
  const inputColumns = input?.result?.columns ?? [];
  const validMappings = columnMappings.filter(
    (mapping) => mapping.referenceColumnId && mapping.inputColumnId,
  );
  console.log("Current Mappings:", validMappings);
  const hasCompletedMapping = validMappings.length > 0 && !hasDuplicateReference(validMappings);
  const highestAllowedStep = deriveHighestAllowedStep({
    reference,
    input,
    referenceColumns,
    inputColumns,
    hasCompletedMapping,
    matchingConfiguration,
    configureValid,
    runResult,
    runState,
    syncState,
  });
  const activeStep = Math.max(1, Math.min(3, Number(search.step) || step || 1));
  const canAdvance = activeStep < wizardSteps.length;
  const canViewMatching = can(PERMISSIONS.MATCHING_VIEW);
  const canViewWorkspaces = can(PERMISSIONS.WORKSPACE_VIEW);
  const canCreateMatching = can(PERMISSIONS.MATCHING_CREATE);
  const canUpdateWorkspace = can(PERMISSIONS.WORKSPACE_UPDATE);
  const canRunMatching = can(PERMISSIONS.MATCHING_RUN);
  const canReviewDecide = can(PERMISSIONS.REVIEW_DECIDE);
  const canExecuteSync = can(PERMISSIONS.SYNC_EXECUTE);
  const canExecuteExport = can(PERMISSIONS.EXPORT_EXECUTE);
  const localizedSteps = wizardSteps.map((s) => ({
    ...s,
    title: t(`step.${stepKey(s.id)}`),
    desc: t(`step.${stepKey(s.id)}Desc`),
    locked: s.id > highestAllowedStep,
    lockedLabel: t("workflow.locked"),
  }));
  const workspaceStatus = deriveWorkspaceStatus(activeStep, runState);
  const hasPreviousRun = Boolean(
    runResult !== null ||
      workspaceStatus === "reviewing" ||
      workspaceStatus === "completed" ||
      runState === "success",
  );

  const workspaceSnapshot = useMemo<WorkspaceStatePayload>(
    () => ({
      reference: uploadSnapshot(reference),
      input: uploadSnapshot(input),
      columnMappings,
      matchingConfiguration,
      workspaceNameEdited,
      runState,
      progress,
      runResult,
      runError,
      syncState,
    }),
    [
      columnMappings,
      input,
      matchingConfiguration,
      progress,
      reference,
      runError,
      runResult,
      runState,
      syncState,
      workspaceNameEdited,
    ],
  );

  const hydrateWorkspace = useCallback(
    async (
      nextWorkspaceId: string,
      options?: {
        requestedStep?: number;
        preferRequestedStep?: boolean;
        replaceUrl?: boolean;
      },
    ) => {
      restoringWorkspaceRef.current = true;
      setIsHydratingWorkspace(true);
      setWorkspaceNotFound(false);

      try {
        const workspace = await fetchWorkspace(nextWorkspaceId);
        const snapshot = workspace.workflow_state;
        const restoredReference = mergeUploadSnapshot(
          snapshot?.reference as UploadedFile | null | undefined,
          workspace.reference_dataset,
        );
        const restoredInput = mergeUploadSnapshot(
          snapshot?.input as UploadedFile | null | undefined,
          workspace.input_dataset,
        );
        const restoredMappings =
          (snapshot?.columnMappings as ColumnMappingDraft[] | undefined) ?? [];
        const restoredConfiguration =
          (snapshot?.matchingConfiguration as MatchingConfiguration | null | undefined) ?? null;
        const restoredRunResult = snapshot?.runResult ?? jobToRunResult(workspace);
        const restoredRunState =
          (snapshot?.runState as RunState | undefined) ??
          (restoredRunResult
            ? restoredRunResult.job.status === "completed"
              ? "success"
              : restoredRunResult.job.status === "failed"
                ? "failed"
                : "running"
            : "idle");
        const restoredSyncState = normalizeSyncState(
          (snapshot?.syncState as SyncState | null | undefined) ??
            (workspace.sync_state as SyncState | null | undefined) ??
            null,
        );
        const restoredProgress = snapshot?.progress ?? restoredRunResult?.progress.percentage ?? 0;
        const restoredRunError = snapshot?.runError ?? restoredRunResult?.job.error_message ?? null;
        const restoredHasCompletedMapping =
          restoredMappings.filter((mapping) => mapping.referenceColumnId && mapping.inputColumnId)
            .length > 0 && !hasDuplicateReference(restoredMappings);
        const restoredHighestStep = deriveHighestAllowedStep({
          reference: restoredReference,
          input: restoredInput,
          referenceColumns: restoredReference?.result?.columns ?? [],
          inputColumns: restoredInput?.result?.columns ?? [],
          hasCompletedMapping: restoredHasCompletedMapping,
          matchingConfiguration: restoredConfiguration,
          configureValid: restoredConfiguration?.isValid ?? true,
          runResult: restoredRunResult,
          runState: restoredRunState,
          syncState: restoredSyncState,
        });
        const nextStep =
          options?.preferRequestedStep && options.requestedStep
            ? Math.min(options.requestedStep, restoredHighestStep)
            : restoredHighestStep;

        suppressMappingSuggestRef.current = true;
        workspaceIdRef.current = workspace.id;
        setWorkspaceId(workspace.id);
        setWorkspaceName(workspace.name);
        setWorkspaceNameEdited(
          Boolean(snapshot?.workspaceNameEdited) ||
            !isGeneratedWorkspaceName(
              workspace.name,
              restoredReference,
              restoredInput,
              t("workspace.untitled"),
            ),
        );
        setReference(restoredReference);
        setInput(restoredInput);
        setColumnMappings(restoredMappings);
        setMatchingConfiguration(restoredConfiguration);
        setRunState(restoredRunState);
        setProgress(restoredProgress);
        setRunResult(restoredRunResult);
        setRunError(restoredRunError);
        setSyncState(restoredSyncState);
        setExportHistory(normalizeStoredExportHistory(workspace.export_history));
        setStep(nextStep);
        setWorkspaceSaveState("saved");
        setWorkspaceError(null);
        hydratedWorkspaceRouteRef.current = workspace.id;

        // Record initial state hash so initial load does not trigger autosave
        const restoredSnapshot: WorkspaceStatePayload = {
          reference: uploadSnapshot(restoredReference),
          input: uploadSnapshot(restoredInput),
          columnMappings: restoredMappings,
          matchingConfiguration: restoredConfiguration,
          workspaceNameEdited: Boolean(snapshot?.workspaceNameEdited),
          runState: restoredRunState,
          progress: restoredProgress,
          runResult: restoredRunResult,
          runError: restoredRunError,
          syncState: restoredSyncState,
        };

        lastSavedStateHashRef.current = JSON.stringify({
          name: workspace.name,
          status: workspace.status,
          currentStep: nextStep,
          referenceId: restoredReference?.result?.dataset.id ?? null,
          inputId: restoredInput?.result?.dataset.id ?? null,
          jobId: restoredRunResult?.job.id ?? null,
          workflowState: restoredSnapshot,
          syncState: restoredSyncState,
          exportHistory: normalizeStoredExportHistory(workspace.export_history),
        });

        if (options?.replaceUrl !== false) {
          const currentSearchWorkspace = search.workspace ?? null;
          const currentSearchStep = typeof search.step === "number" ? search.step : 1;
          if (currentSearchWorkspace !== workspace.id || currentSearchStep !== nextStep) {
            void navigate({
              to: "/matching",
              search: buildMatchingSearch(workspace.id, nextStep),
              replace: true,
            });
          }
        }

        return workspace;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          hydratedWorkspaceRouteRef.current = null;
          lastSavedStateHashRef.current = "";
          setWorkspaceNotFound(true);
          setWorkspaceId(null);
          setWorkspaceName(t("workspace.untitled"));
          setWorkspaceNameEdited(false);
          setReference(null);
          setInput(null);
          setColumnMappings([]);
          setMatchingConfiguration(null);
          setRunState("idle");
          setProgress(0);
          setRunResult(null);
          setRunError(null);
          setSyncState(null);
          setExportHistory([]);
          setStep(1);
          setWorkspaceSaveState("error");
          setWorkspaceError(error.message);
          void navigate({
            to: "/matching",
            search: buildMatchingSearch(undefined, 1),
            replace: true,
          });
        }
        throw error;
      } finally {
        setIsHydratingWorkspace(false);
        window.setTimeout(() => {
          restoringWorkspaceRef.current = false;
          suppressMappingSuggestRef.current = false;
        }, 100);
      }
    },
    [navigate, search.step, search.workspace, t],
  );

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => {
    if (!initialWorkspaceId || !canViewMatching || !canViewWorkspaces) return;
    if (hydratedWorkspaceRouteRef.current === initialWorkspaceId) return;

    hydratedWorkspaceRouteRef.current = initialWorkspaceId;
    let mounted = true;
    setIsHydratingWorkspace(true);
    setWorkspaceSaveState("saving");

    hydrateWorkspace(initialWorkspaceId, {
      requestedStep: requestedStepRef.current,
      preferRequestedStep: hasRequestedStepRef.current,
    })
      .then(() => {
        if (!mounted) return;
      })
      .catch((error) => {
        if (!mounted) return;
        setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.loadFailed"));
        setWorkspaceSaveState("error");
        setIsHydratingWorkspace(false);
      });

    return () => {
      mounted = false;
    };
  }, [
    canViewMatching,
    canViewWorkspaces,
    hydrateWorkspace,
    initialWorkspaceId,
    t,
  ]);

  useEffect(() => {
    if (initialWorkspaceId) return;
    hydratedWorkspaceRouteRef.current = null;
    lastSavedStateHashRef.current = "";
    setIsHydratingWorkspace(false);
    setWorkspaceNotFound(false);
  }, [initialWorkspaceId]);

  useEffect(() => {
    if (!initialWorkspaceId || isHydratingWorkspace || restoringWorkspaceRef.current) return;
    if (workspaceId !== initialWorkspaceId) return;

    const resolvedStep = hasRequestedStep
      ? Math.min(requestedStep, highestAllowedStep)
      : highestAllowedStep;
    if (step !== resolvedStep) {
      setStep(resolvedStep);
    }
  }, [
    hasRequestedStep,
    highestAllowedStep,
    initialWorkspaceId,
    isHydratingWorkspace,
    requestedStep,
    step,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      !workspaceId ||
      isHydratingWorkspace ||
      restoringWorkspaceRef.current ||
      !canUpdateWorkspace
    ) {
      return;
    }

    const currentPayloadString = JSON.stringify({
      name: workspaceName,
      status: workspaceStatus,
      currentStep: activeStep,
      referenceId: reference?.result?.dataset.id ?? null,
      inputId: input?.result?.dataset.id ?? null,
      jobId: runResult?.job.id ?? null,
      workflowState: workspaceSnapshot,
      syncState: syncState as Record<string, unknown> | null,
      exportHistory,
    });

    if (lastSavedStateHashRef.current === currentPayloadString) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setWorkspaceSaveState("saving");
      updateWorkspace(workspaceId, {
        name: workspaceName,
        status: workspaceStatus,
        currentStep: activeStep,
        referenceDatasetId: reference?.result?.dataset.id ?? null,
        inputDatasetId: input?.result?.dataset.id ?? null,
        matchingJobId: runResult?.job.id ?? null,
        workflowState: workspaceSnapshot,
        syncState: syncState as Record<string, unknown> | null,
        exportHistory,
      })
        .then(() => {
          lastSavedStateHashRef.current = currentPayloadString;
          setWorkspaceSaveState("saved");
          setWorkspaceError(null);
        })
        .catch((error) => {
          setWorkspaceSaveState("error");
          setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.saveFailed"));
        });
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [
    input,
    reference,
    runResult,
    activeStep,
    syncState,
    exportHistory,
    t,
    workspaceId,
    workspaceName,
    workspaceSnapshot,
    workspaceStatus,
    canUpdateWorkspace,
    isHydratingWorkspace,
  ]);

  const ensureWorkspace = async (role: DatasetRole, result: DatasetInspectResult) => {
    const existingWorkspaceId = workspaceIdRef.current;
    const nextName = workspaceNameEdited
      ? workspaceName
      : buildWorkspaceName(role, result, reference, input, t("workspace.untitled"));
    const nextReferenceDatasetId =
      role === "reference" ? result.dataset.id : (reference?.result?.dataset.id ?? null);
    const nextInputDatasetId =
      role === "input" ? result.dataset.id : (input?.result?.dataset.id ?? null);

    try {
      if (existingWorkspaceId) {
        if (!canUpdateWorkspace) return;
        await updateWorkspace(existingWorkspaceId, {
          name: workspaceName,
          status: workspaceStatus,
          referenceDatasetId: nextReferenceDatasetId,
          inputDatasetId: nextInputDatasetId,
          currentStep: activeStep,
        });
        await hydrateWorkspace(existingWorkspaceId, { replaceUrl: true });
        return;
      }

      if (!canCreateMatching) return;
      setWorkspaceSaveState("saving");
      const workspace = await createWorkspace({
        name: nextName,
        status: "draft",
        currentStep: activeStep,
        referenceDatasetId: nextReferenceDatasetId,
        inputDatasetId: nextInputDatasetId,
      });
      await hydrateWorkspace(workspace.id, { replaceUrl: true });
    } catch (error) {
      setWorkspaceSaveState("error");
      setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.saveFailed"));
    }
  };

  const startRun = async () => {
    if (!reference?.result || !input?.result || !matchingConfiguration) {
      setRunState("failed");
      setRunError(t("matching.run.missingConfig"));
      toast.error(t("feedback.toast.runFailed"));
      return;
    }

    if (!canRunMatching) {
      toast.error(t("feedback.toast.accessDenied"));
      return;
    }

    toast.info(t("feedback.toast.runStarted"));
    setRunState("running");
    setProgress(0);
    setRunError(null);
    setRunResult(null);
    setSyncState(null);

    try {
      setProgress(20);
      const result = await runMatching({
        workspaceId: workspaceId ?? undefined,
        name: `${reference.result.dataset.name} vs ${input.result.dataset.name}`,
        referenceDatasetId: reference.result.dataset.id,
        inputDatasetId: input.result.dataset.id,
        mappings: columnMappings.filter(
          (mapping) => mapping.referenceColumnId && mapping.inputColumnId,
        ),
        configuration: matchingConfiguration,
      });
      setRunResult(result);
      setProgress(result.progress.percentage || 100);
      setRunState(result.job.status === "completed" ? "success" : "failed");
      if (result.job.status === "completed") {
        setStep(3);
        void navigate({
          to: "/matching",
          search: buildMatchingSearch(workspaceId, 3),
          replace: true,
        });
      } else {
        setRunError(result.job.error_message ?? t("matching.run.failedGeneric"));
      }
    } catch (error) {
      setProgress(0);
      setRunState("failed");
      setRunError(error instanceof ApiError ? error.message : t("matching.run.failedGeneric"));
    }
  };

  const handleInspectFile = async (role: DatasetRole, file: File) => {
    if (!canCreateMatching) {
      toast.error(t("feedback.toast.accessDenied"));
      return;
    }

    const err = validateFile(file, t);
    const setFile = role === "reference" ? setReference : setInput;

    if (err) {
      setUploadError(err);
      setFile({ name: file.name, size: file.size, status: "error", error: err });
      toast.error(t("feedback.toast.invalidFile"));
      return;
    }

    setUploadError(null);
    setFile({ name: file.name, size: file.size, status: "loading" });

    try {
      const result = await inspectDataset({ file, datasetRole: role });
      setColumnMappings([]);
      setMatchingConfiguration(null);
      setSyncState(null);
      setFile({ name: file.name, size: file.size, status: "success", result });
      await ensureWorkspace(role, result);
      toast.success(t("feedback.toast.uploaded", { name: file.name }));
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : t("matching.upload.inspectFailed");
      setFile({ name: file.name, size: file.size, status: "error", error: message });
      setUploadError(message);
      toast.error(t("feedback.toast.invalidFile"));
    }
  };

  useEffect(() => {
    const inspectedReferenceColumns = reference?.result?.columns ?? [];
    const inspectedInputColumns = input?.result?.columns ?? [];

    if (suppressMappingSuggestRef.current) {
      return;
    }

    if (inspectedReferenceColumns.length === 0 || inspectedInputColumns.length === 0) {
      setColumnMappings([]);
      setMatchingConfiguration(null);
      return;
    }

    const effectiveReference = injectVirtualColumns(inspectedReferenceColumns, "ref");
    const effectiveInput = injectVirtualColumns(inspectedInputColumns, "inp");
    const referenceIds = new Set(effectiveReference.map((column) => column.id));
    const inputIds = new Set(effectiveInput.map((column) => column.id));
    setColumnMappings((current) =>
      current.filter(
        (mapping) =>
          referenceIds.has(mapping.referenceColumnId) && inputIds.has(mapping.inputColumnId),
      ),
    );
  }, [reference?.result, input?.result]);

  useEffect(() => {
    if (isHydratingWorkspace || restoringWorkspaceRef.current) return;
    if (step > highestAllowedStep) {
      setStep(highestAllowedStep);
      void navigate({
        to: "/matching",
        search: buildMatchingSearch(workspaceId, highestAllowedStep),
        replace: true,
      });
    }
  }, [highestAllowedStep, isHydratingWorkspace, navigate, step, workspaceId]);

  useEffect(() => {
    if (workspaceNameEdited || !reference?.result || !input?.result) return;
    const suggestedName = buildWorkspaceNameFromUploads(reference, input, t("workspace.untitled"));
    if (workspaceName !== suggestedName) {
      setWorkspaceName(suggestedName);
    }
  }, [input, reference, t, workspaceName, workspaceNameEdited]);

  useEffect(() => {
    if (workspaceId || workspaceNameEdited || reference || input) return;
    setWorkspaceName(t("workspace.untitled"));
  }, [input, reference, t, workspaceId, workspaceNameEdited]);

  useEffect(() => {
    if (runState === "success") toast.success(t("feedback.toast.runComplete"));
    if (runState === "failed") toast.error(t("feedback.toast.runFailed"));
  }, [runState, t]);

  const renameWorkspace = () => {
    if (!canUpdateWorkspace) {
      toast.error(t("feedback.toast.accessDenied"));
      return;
    }
    setIsRenameDialogOpen(true);
  };

  const handleRenameConfirm = async (nextName: string) => {
    if (!nextName || nextName === workspaceName) return;

    setWorkspaceName(nextName);
    setWorkspaceNameEdited(true);

    if (!workspaceIdRef.current) return;

    try {
      setWorkspaceSaveState("saving");
      const updated = await updateWorkspace(workspaceIdRef.current, { name: nextName });
      setWorkspaceName(updated.name);
      setWorkspaceSaveState("saved");
      setWorkspaceError(null);
      toast.success(t("workspace.renamed"));
    } catch (error) {
      setWorkspaceSaveState("error");
      setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.saveFailed"));
    }
  };

  const handleNextStep = async () => {
    if (activeStep === 1) {
      if (validMappings.length === 0) {
        toast.error(t("feedback.error.validationTitle"), {
          description: t("matching.validation.mappingRequired"),
        });
        return;
      }
      if (hasDuplicateReference(validMappings)) {
        toast.error(t("feedback.error.validationTitle"), {
          description: t("matching.validation.duplicateReference"),
        });
        return;
      }

      setIsNavigatingStep(true);
      try {
        if (workspaceIdRef.current && canUpdateWorkspace) {
          setWorkspaceSaveState("saving");
          await updateWorkspace(workspaceIdRef.current, {
            name: workspaceName,
            status: deriveWorkspaceStatus(2, runState),
            currentStep: 2,
            referenceDatasetId: reference?.result?.dataset.id ?? null,
            inputDatasetId: input?.result?.dataset.id ?? null,
            matchingJobId: runResult?.job.id ?? null,
            workflowState: workspaceSnapshot,
            syncState: syncState as Record<string, unknown> | null,
            exportHistory,
          });
          setWorkspaceSaveState("saved");
          setWorkspaceError(null);
        }

        setStep(2);
        await navigate({
          to: "/matching",
          search: (prev: any) => ({ ...prev, step: 2 }),
          replace: true,
        });
      } catch (error: any) {
        console.error("Critical Error during Step 1 transition:", error);
        setWorkspaceSaveState("error");
        toast.error(t("feedback.error.saveFailed"), {
          description:
            error?.response?.data?.message ||
            (error instanceof ApiError ? error.message : error?.message) ||
            t("matching.validation.serverError"),
        });
      } finally {
        setIsNavigatingStep(false);
      }
      return;
    }

    if (activeStep === 2) {
      if (!runResult || runState !== "success") {
        toast.error(t("feedback.error.validationTitle"), {
          description: t("matching.validation.runRequired"),
        });
        return;
      }

      setIsNavigatingStep(true);
      try {
        setStep(3);
        await navigate({
          to: "/matching",
          search: (prev: any) => ({ ...prev, step: 3 }),
          replace: true,
        });
      } catch (error: any) {
        console.error("Critical Error during Step 2 transition:", error);
        toast.error(t("feedback.error.transitionFailed"), {
          description: error?.message || t("matching.validation.serverError"),
        });
      } finally {
        setIsNavigatingStep(false);
      }
      return;
    }
  };

  const selectStep = (nextStep: number) => {
    if (nextStep === activeStep) return;

    if (nextStep === 2) {
      if (!reference?.result || !input?.result) {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.uploadRequired"),
        });
        return;
      }
      if (validMappings.length === 0) {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.requiredMappingIncomplete"),
        });
        return;
      }
      if (hasDuplicateReference(validMappings)) {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.duplicateReference"),
        });
        return;
      }
    } else if (nextStep === 3) {
      if (!reference?.result || !input?.result) {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.uploadRequired"),
        });
        return;
      }
      if (validMappings.length === 0) {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.requiredMappingIncomplete"),
        });
        return;
      }
      if (!runResult || runState !== "success") {
        toast.error(t("feedback.error.cannotProceed"), {
          description: t("matching.validation.runRequired"),
        });
        return;
      }
    }

    setStep(nextStep);
    void navigate({
      to: "/matching",
      search: buildMatchingSearch(workspaceId, nextStep),
      replace: true,
    });
  };

  if (!canViewMatching) {
    return (
      <AppLayout>
        <div className="px-8 py-8 max-w-[1400px] mx-auto">
          <AccessDeniedState />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader
          title={t("matching.title")}
          description={t("matching.description")}
          actions={
            canViewWorkspaces ? (
              <Link
                to="/workspaces"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("workspace.title")}
              </Link>
            ) : undefined
          }
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-xs">
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{workspaceName}</p>
            <p className="text-muted-foreground">
              {workspaceId ? t("workspace.autosaveEnabled") : t("workspace.autosaveWaiting")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {workspaceError && <span className="text-destructive">{workspaceError}</span>}
            {canUpdateWorkspace && (
              <button
                type="button"
                onClick={renameWorkspace}
                className="rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {t("workspace.renameShort")}
              </button>
            )}
            <span className="rounded-full bg-secondary px-2 py-1 font-medium text-muted-foreground">
              {workspaceStatusLabel(workspaceStatus, t)}
            </span>
            <span className="rounded-full bg-secondary px-2 py-1 font-medium text-muted-foreground">
              {workspaceSaveStateLabel(workspaceSaveState, t)}
            </span>
          </div>
        </div>

        {/* Horizontal stepper */}
        <Card className="p-5 mb-6 sticky top-16 z-10">
          <Stepper steps={localizedSteps} current={activeStep} onSelect={selectStep} />
        </Card>

        <Card className="p-6">
          {isHydratingWorkspace && initialWorkspaceId ? (
            <div className="rounded-lg border border-border bg-secondary/20 p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-accent" />
                <div>
                  <p className="text-sm font-semibold">{t("workspace.loading")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("matching.loadingDesc")}
                  </p>
                </div>
              </div>
            </div>
          ) : workspaceNotFound ? (
            <EmptyState
              icon={AlertCircle}
              title={t("results.contextEmptyTitle")}
              description={workspaceError ?? t("workspace.loadFailed")}
              action={
                <Link
                  to="/matching"
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  <ArrowRight className="size-4" />
                  {t("topbar.newMatching")}
                </Link>
              }
            />
          ) : (
            <>
              {activeStep === 1 && (
                <div className="space-y-8">
                  <StepUpload
                    reference={reference}
                    input={input}
                    onInspectFile={handleInspectFile}
                    onClearReference={() => {
                      if (reference)
                        toast.info(t("feedback.toast.removed", { name: reference.name }));
                      setReference(null);
                    }}
                    onClearInput={() => {
                      if (input) toast.info(t("feedback.toast.removed", { name: input.name }));
                      setInput(null);
                    }}
                    error={uploadError}
                  />

                  {(reference?.result || input?.result) && (
                    <>
                      <div className="border-t border-border pt-6">
                        <StepDataPreview reference={reference?.result} input={input?.result} />
                      </div>

                      <div className="border-t border-border pt-6">
                        <StepProfile reference={reference?.result} input={input?.result} />
                      </div>
                    </>
                  )}

                  {referenceColumns.length > 0 && inputColumns.length > 0 && (
                    <div className="border-t border-border pt-6">
                      <StepColumnMapping
                        referenceColumns={referenceColumns}
                        inputColumns={inputColumns}
                        mappings={columnMappings}
                        setMappings={setColumnMappings}
                      />
                    </div>
                  )}
                </div>
              )}
              {activeStep === 2 && (
                <div className="space-y-8">
                  {/* Step 2 Standardized Data Preview */}
                  <StepStandardizedPreview
                    reference={reference?.result}
                    input={input?.result}
                    mappings={columnMappings}
                  />

                  <div className="border-t border-border pt-6">
                    <StepConfigV2
                      jobId={runResult?.job.id ?? null}
                      mappings={columnMappings}
                      configuration={matchingConfiguration}
                      onConfigurationChange={setMatchingConfiguration}
                      onValidityChange={setConfigureValid}
                    />
                  </div>

                  <div className="border-t border-border pt-6">
                    <StepRunCard
                      state={runState}
                      progress={progress}
                      configuration={matchingConfiguration}
                      result={runResult}
                      error={runError}
                      onStart={() => setRunConfirmOpen(true)}
                      onRetry={() => {
                        setRunState("idle");
                        setProgress(0);
                        setRunResult(null);
                        setRunError(null);
                      }}
                      onProceed={() => selectStep(3)}
                      canRun={canRunMatching}
                      hasPreviousRun={hasPreviousRun}
                    />
                  </div>
                </div>
              )}
              {activeStep === 3 && (
                <StepReviewAndResults
                  jobId={runResult?.job.id ?? null}
                  canDecide={canReviewDecide}
                  columnMappings={columnMappings}
                  syncState={syncState}
                  onSyncStateChange={setSyncState}
                  canExecuteSync={canExecuteSync}
                  canExecuteExport={canExecuteExport}
                  onExportHistoryChange={setExportHistory}
                  workspaceId={workspaceId}
                />
              )}

              {/* Nav */}
              <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
                <button
                  disabled={activeStep === 1}
                  onClick={() => selectStep(Math.max(1, activeStep - 1))}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowLeft className="size-4" />
                  {t("common.back")}
                </button>
                <p className="text-xs text-muted-foreground">
                  {t("common.stepOf", { current: activeStep, total: wizardSteps.length })}
                </p>
                {activeStep === wizardSteps.length ? (
                  <Link
                    to="/results"
                    search={buildResultsSearch(workspaceId)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
                  >
                    {t("common.goToResults")}
                    <ArrowRight className="size-4" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={isNavigatingStep || workspaceSaveState === "saving"}
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand text-brand-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    {isNavigatingStep || workspaceSaveState === "saving" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t("common.loading")}</span>
                      </>
                    ) : (
                      <>
                        {t("common.continue")}
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </Card>
        <ConfirmationDialog
          open={runConfirmOpen}
          setOpen={setRunConfirmOpen}
          title={hasPreviousRun ? t("matching.run.rerunDialogTitle") : t("feedback.confirm.runTitle")}
          description={
            hasPreviousRun
              ? t("matching.run.rerunDialogDesc")
              : t("feedback.confirm.runDesc")
          }
          cancelLabel={t("common.cancel")}
          actionLabel={hasPreviousRun ? t("matching.run.rerunOverwrite") : t("matching.run.start")}
          onConfirm={startRun}
        />
        <PromptDialog
          open={isRenameDialogOpen}
          onOpenChange={setIsRenameDialogOpen}
          title={t("workspace.rename")}
          description={t("workspace.renamePrompt")}
          defaultValue={workspaceName}
          confirmLabel={t("common.saveChanges")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleRenameConfirm}
        />
      </div>
    </AppLayout>
  );
}

function stepKey(id: number) {
  return ["preparation", "rules", "results"][
    Math.max(0, Math.min(2, id - 1))
  ] as "preparation" | "rules" | "results";
}

function hasDuplicateReference(mappings: { referenceColumnId: string }[]) {
  const references = mappings.map((mapping) => mapping.referenceColumnId).filter(Boolean);
  return new Set(references).size !== references.length;
}

function deriveHighestAllowedStep({
  reference,
  input,
  referenceColumns,
  inputColumns,
  hasCompletedMapping,
  matchingConfiguration,
  configureValid,
  runResult,
  runState,
}: {
  reference: UploadedFile | null;
  input: UploadedFile | null;
  referenceColumns: DatasetInspectResult["columns"];
  inputColumns: DatasetInspectResult["columns"];
  hasCompletedMapping: boolean;
  matchingConfiguration: MatchingConfiguration | null;
  configureValid: boolean;
  runResult: MatchingRunResult | null;
  runState: RunState;
  syncState?: SyncState | null;
}) {
  const datasetsReady = Boolean(reference?.result && input?.result);
  const step1Ready = datasetsReady && hasCompletedMapping;
  const matchingReady = Boolean(runResult && runState === "success");

  if (!step1Ready) return 1;
  if (!matchingReady) return 2;
  return 3;
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function validateFile(file: File, t: ReturnType<typeof usePreferences>["t"]): string | null {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED.includes(ext))
    return t("matching.upload.unsupported", { formats: ALLOWED.join(", ") });
  if (file.size > MAX_MB * 1024 * 1024) return t("matching.upload.tooLarge", { max: MAX_MB });
  return null;
}

function datasetResultToUpload(result: DatasetInspectResult | null): UploadedFile | null {
  if (!result) return null;

  return {
    name: result.dataset.original_filename || result.dataset.name,
    size: result.dataset.file_size,
    status: "success",
    result,
  };
}

function uploadSnapshot(file: UploadedFile | null): UploadedFile | null {
  if (!file) return null;

  return {
    name: file.name,
    size: file.size,
    status: file.status,
    error: file.error,
  };
}

function mergeUploadSnapshot(
  snapshot: UploadedFile | null | undefined,
  result: DatasetInspectResult | null,
): UploadedFile | null {
  const restored = datasetResultToUpload(result);

  if (!snapshot) return restored;

  return {
    ...snapshot,
    result: restored?.result,
    status: restored ? "success" : snapshot.status,
  };
}

function jobToRunResult(workspace: WorkspaceSummary): MatchingRunResult | null {
  const job = workspace.matching_job;

  if (!job) return null;

  const counts = job.record_counts ?? {};
  const percentage =
    job.total_count > 0 ? Math.round((job.processed_count / job.total_count) * 10000) / 100 : 0;

  return {
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      reference_dataset_id: workspace.reference_dataset_id ?? "",
      input_dataset_id: workspace.input_dataset_id ?? "",
      started_at: job.started_at,
      finished_at: job.finished_at,
      error_message: job.error_message,
    },
    progress: {
      status: job.status,
      processed: job.processed_count,
      total: job.total_count,
      percentage,
    },
    summary: {
      matched: counts.matched ?? 0,
      possible_match: counts.possible_match ?? 0,
      unmatched: counts.unmatched ?? 0,
      candidates_scored: counts.candidates_scored ?? 0,
    },
    top_results: [],
  };
}

function buildWorkspaceName(
  role: DatasetRole,
  result: DatasetInspectResult,
  reference: UploadedFile | null,
  input: UploadedFile | null,
  fallback: string,
) {
  const referenceName =
    role === "reference" ? datasetDisplayName(result) : uploadDisplayName(reference);
  const inputName = role === "input" ? datasetDisplayName(result) : uploadDisplayName(input);

  if (referenceName && inputName) return `${referenceName} vs ${inputName}`;
  return referenceName ?? inputName ?? fallback;
}

function buildWorkspaceNameFromUploads(
  reference: UploadedFile | null,
  input: UploadedFile | null,
  fallback: string,
) {
  const referenceName = uploadDisplayName(reference);
  const inputName = uploadDisplayName(input);

  if (referenceName && inputName) return `${referenceName} vs ${inputName}`;
  return referenceName ?? inputName ?? fallback;
}

function isGeneratedWorkspaceName(
  name: string,
  reference: UploadedFile | null,
  input: UploadedFile | null,
  fallback: string,
) {
  return name === buildWorkspaceNameFromUploads(reference, input, fallback);
}

function uploadDisplayName(file: UploadedFile | null) {
  if (!file?.result) return null;
  return datasetDisplayName(file.result);
}

function datasetDisplayName(result: DatasetInspectResult) {
  return stripFileExtension(result.dataset.name || result.dataset.original_filename || "");
}

function stripFileExtension(value: string) {
  return value.replace(/\.[a-z0-9]{2,8}$/i, "").trim();
}

function deriveWorkspaceStatus(step: number, runState: RunState): WorkspaceStatus {
  if (runState === "failed") return "failed";
  if (runState === "running") return "matching";
  if (step >= 3) return "reviewing";
  if (step === 2) return "configuring";
  return "draft";
}

function workspaceStatusLabel(status: WorkspaceStatus, t: ReturnType<typeof usePreferences>["t"]) {
  return t(`workspace.status.${status}` as Parameters<typeof t>[0]);
}

function workspaceSaveStateLabel(
  state: "idle" | "saving" | "saved" | "error",
  t: ReturnType<typeof usePreferences>["t"],
) {
  if (state === "saving") return t("workspace.saving");
  if (state === "saved") return t("workspace.saved");
  if (state === "error") return t("workspace.saveError");
  return t("workspace.notSaved");
}

function StepUpload({
  reference,
  input,
  onInspectFile,
  onClearReference,
  onClearInput,
  error,
}: {
  reference: UploadedFile | null;
  input: UploadedFile | null;
  onInspectFile: (role: DatasetRole, file: File) => void;
  onClearReference: () => void;
  onClearInput: () => void;
  error: string | null;
}) {
  const { t } = usePreferences();
  return (
    <>
      <SectionTitle title={t("matching.upload.title")} desc={t("matching.upload.desc")} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FileSlot
          label={t("matching.upload.reference")}
          hint={t("matching.upload.referenceHint")}
          icon={Database}
          file={reference}
          onFile={(file) => onInspectFile("reference", file)}
          onClear={onClearReference}
        />
        <FileSlot
          label={t("matching.upload.input")}
          hint={t("matching.upload.inputHint")}
          icon={FileSpreadsheet}
          file={input}
          onFile={(file) => onInspectFile("input", file)}
          onClear={onClearInput}
        />
      </div>
      {error && (
        <div className="mt-4 flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 rounded-md px-3 py-2">
        <Upload className="size-3.5" />
        {t("matching.upload.accepted", { formats: ALLOWED.join(", "), max: MAX_MB })}
      </div>
    </>
  );
}

function FileSlot({
  label,
  hint,
  icon: Icon,
  file,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  icon: typeof Database;
  file: UploadedFile | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { t } = usePreferences();
  const isLoading = file?.status === "loading";
  const isSuccess = file?.status === "success";
  const isError = file?.status === "error";

  return (
    <div className="border border-dashed border-border rounded-lg p-6 hover:border-accent/50 hover:bg-secondary/30 transition-colors">
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={ALLOWED.join(",")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-secondary grid place-items-center">
          {isLoading ? (
            <Loader2 className="size-5 animate-spin text-accent" />
          ) : (
            <Icon className="size-5 text-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          {file ? (
            <div className="mt-0.5 space-y-1">
              <p className="text-xs text-muted-foreground truncate">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              {isLoading && (
                <p className="text-xs text-accent">{t("matching.upload.inspecting")}</p>
              )}
              {isSuccess && file.result && (
                <p className="text-xs text-muted-foreground">
                  {t("matching.upload.inspected", {
                    rows: file.result.dataset.row_count,
                    columns: file.result.dataset.column_count,
                  })}
                </p>
              )}
              {isError && file.error && <p className="text-xs text-destructive">{file.error}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          )}
        </div>
        {file ? (
          <button
            onClick={onClear}
            disabled={isLoading}
            className="text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="size-4" />
          </button>
        ) : (
          <Check className="size-4 text-muted-foreground/30" />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {isLoading
            ? t("common.loading")
            : isSuccess
              ? t("common.uploaded")
              : isError
                ? t("common.error")
                : t("common.noFile")}
        </span>
        <button
          onClick={() => ref.current?.click()}
          disabled={isLoading}
          className="font-medium text-accent hover:underline"
        >
          {file ? t("common.replace") : t("common.chooseFile")}
        </button>
      </div>
    </div>
  );
}

function DatasetProfileCard({
  title,
  result,
}: {
  title: string;
  result: DatasetInspectResult;
}) {
  const { t } = usePreferences();
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
            {title}
          </span>
          <p className="mt-0.5 text-sm font-semibold text-foreground truncate">
            {result.dataset.original_filename}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <ProfileStat
            label={t("matching.profile.rows")}
            value={result.dataset.row_count.toLocaleString()}
          />
          <ProfileStat
            label={t("matching.profile.columns")}
            value={result.dataset.column_count.toLocaleString()}
          />
          <ProfileStat
            label={t("matching.profile.preview")}
            value={result.preview_rows.length.toLocaleString()}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3.5 py-2.5 text-left font-medium">{t("matching.profile.column")}</th>
              <th className="px-3.5 py-2.5 text-left font-medium">{t("matching.profile.type")}</th>
              <th className="px-3.5 py-2.5 text-right font-medium">{t("matching.profile.nulls")}</th>
              <th className="px-3.5 py-2.5 text-right font-medium">{t("matching.profile.unique")}</th>
              <th className="px-3.5 py-2.5 text-right font-medium">{t("matching.profile.duplicates")}</th>
              <th className="px-3.5 py-2.5 text-left font-medium">{t("matching.profile.samples")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.columns.map((column) => (
              <tr key={column.id} className="hover:bg-secondary/20">
                <td className="px-3.5 py-2.5 font-mono font-medium text-foreground">{column.name}</td>
                <td className="px-3.5 py-2.5">
                  <span className="inline-flex text-[10px] font-mono bg-secondary rounded px-1.5 py-0.5 uppercase">
                    {column.data_type}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-muted-foreground">
                  {column.null_count} ({column.null_percentage}%)
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-foreground font-medium">
                  {column.unique_count.toLocaleString()}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-muted-foreground">
                  {column.duplicate_percentage}%
                </td>
                <td
                  className="px-3.5 py-2.5 text-muted-foreground truncate max-w-[240px]"
                  title={column.sample_values.join(", ")}
                >
                  {column.sample_values.length > 0 ? column.sample_values.join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepDataPreview({
  reference,
  input,
}: {
  reference?: DatasetInspectResult;
  input?: DatasetInspectResult;
}) {
  const { t } = usePreferences();

  if (!reference && !input) return null;

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t("matching.preview.title")}
        desc={t("matching.preview.desc")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {reference && (
          <DataPreviewTable
            title={t("matching.upload.reference")}
            subtitle={t("matching.preview.referenceSubtitle")}
            filename={reference.dataset.original_filename}
            columns={reference.columns.map((c) => c.name)}
            rows={reference.preview_rows}
            totalRows={reference.dataset.row_count}
            badgeColor="brand"
            badgeText={t("matching.preview.referenceBadge")}
          />
        )}

        {input && (
          <DataPreviewTable
            title={t("matching.upload.input")}
            subtitle={t("matching.preview.inputSubtitle")}
            filename={input.dataset.original_filename}
            columns={input.columns.map((c) => c.name)}
            rows={input.preview_rows}
            totalRows={input.dataset.row_count}
            badgeColor="secondary"
            badgeText={t("matching.preview.inputBadge")}
          />
        )}
      </div>
    </div>
  );
}

function StepStandardizedPreview({
  reference,
  input,
  mappings,
}: {
  reference?: DatasetInspectResult;
  input?: DatasetInspectResult;
  mappings: ColumnMappingDraft[];
}) {
  const { t } = usePreferences();
  const [activeTab, setActiveTab] = useState<"input" | "reference">("input");

  // Build standardized input rows
  const inputStdData = useMemo(() => {
    if (!input?.preview_rows || input.preview_rows.length === 0) {
      return { columns: [], rows: [] };
    }

    const cols: { key: string; label: string; isVirtual?: boolean; isStandardized?: boolean }[] = [];
    const mappedInputCols = mappings
      .map((m) => input.columns.find((c) => c.id === m.inputColumnId))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const columnsToUse = mappedInputCols.length > 0 ? mappedInputCols : input.columns;

    columnsToUse.forEach((col) => {
      cols.push({ key: `raw_${col.name}`, label: t("preview.rawColumn", { name: col.name }) });
      cols.push({
        key: `std_${col.name}`,
        label: t("preview.stdColumn", { name: col.name }),
        isStandardized: true,
      });

      const isEntity =
        col.name.toLowerCase().includes("nama") ||
        col.name.toLowerCase().includes("name") ||
        col.name.toLowerCase().includes("perusahaan") ||
        col.name.toLowerCase().includes("company");

      if (isEntity) {
        cols.push({
          key: `gen_core_${col.name}`,
          label: t("preview.coreNameColumn", { name: col.name }),
          isVirtual: true,
        });
        cols.push({
          key: `gen_legal_${col.name}`,
          label: t("preview.legalFormColumn", { name: col.name }),
          isVirtual: true,
        });
      }
    });

    const rows = input.preview_rows.map((rawRow) => {
      const row: Record<string, unknown> = {};
      columnsToUse.forEach((col) => {
        const rawVal = rawRow[col.name];
        row[`raw_${col.name}`] = rawVal ?? null;

        const stdVal = standardizeColumnValue(rawVal, col.name, col.data_type);
        row[`std_${col.name}`] = stdVal || null;

        const isEntity =
          col.name.toLowerCase().includes("nama") ||
          col.name.toLowerCase().includes("name") ||
          col.name.toLowerCase().includes("perusahaan") ||
          col.name.toLowerCase().includes("company");

        if (isEntity) {
          const parsed = parseEntityName(rawVal);
          row[`gen_core_${col.name}`] = parsed.core_name || null;
          row[`gen_legal_${col.name}`] = parsed.legal_form || null;
        }
      });
      return row;
    });

    return { columns: cols, rows };
  }, [input, mappings, t]);

  // Build standardized reference rows
  const referenceStdData = useMemo(() => {
    if (!reference?.preview_rows || reference.preview_rows.length === 0) {
      return { columns: [], rows: [] };
    }

    const cols: { key: string; label: string; isVirtual?: boolean; isStandardized?: boolean }[] = [];
    const mappedRefCols = mappings
      .map((m) => reference.columns.find((c) => c.id === m.referenceColumnId))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const columnsToUse = mappedRefCols.length > 0 ? mappedRefCols : reference.columns;

    columnsToUse.forEach((col) => {
      cols.push({ key: `raw_${col.name}`, label: t("preview.rawColumn", { name: col.name }) });
      cols.push({
        key: `std_${col.name}`,
        label: t("preview.stdColumn", { name: col.name }),
        isStandardized: true,
      });

      const isEntity =
        col.name.toLowerCase().includes("nama") ||
        col.name.toLowerCase().includes("name") ||
        col.name.toLowerCase().includes("perusahaan") ||
        col.name.toLowerCase().includes("company");

      if (isEntity) {
        cols.push({
          key: `gen_core_${col.name}`,
          label: t("preview.coreNameColumn", { name: col.name }),
          isVirtual: true,
        });
        cols.push({
          key: `gen_legal_${col.name}`,
          label: t("preview.legalFormColumn", { name: col.name }),
          isVirtual: true,
        });
      }
    });

    const rows = reference.preview_rows.map((rawRow) => {
      const row: Record<string, unknown> = {};
      columnsToUse.forEach((col) => {
        const rawVal = rawRow[col.name];
        row[`raw_${col.name}`] = rawVal ?? null;

        const stdVal = standardizeColumnValue(rawVal, col.name, col.data_type);
        row[`std_${col.name}`] = stdVal || null;

        const isEntity =
          col.name.toLowerCase().includes("nama") ||
          col.name.toLowerCase().includes("name") ||
          col.name.toLowerCase().includes("perusahaan") ||
          col.name.toLowerCase().includes("company");

        if (isEntity) {
          const parsed = parseEntityName(rawVal);
          row[`gen_core_${col.name}`] = parsed.core_name || null;
          row[`gen_legal_${col.name}`] = parsed.legal_form || null;
        }
      });
      return row;
    });

    return { columns: cols, rows };
  }, [reference, mappings, t]);

  if (!reference && !input) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title={t("preview.title")}
          desc={t("preview.description")}
        />

        <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("input")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "input"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("preview.tabInput")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("reference")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "reference"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("preview.tabReference")}
          </button>
        </div>
      </div>

      {activeTab === "input" && input && (
        <DataPreviewTable
          title={t("preview.input_result")}
          subtitle={t("preview.standardizedSubtitle")}
          filename={input.dataset.original_filename}
          columns={inputStdData.columns}
          rows={inputStdData.rows}
          totalRows={input.dataset.row_count}
          previewLimit={5}
          badgeColor="secondary"
          badgeText={t("preview.tabInput")}
        />
      )}

      {activeTab === "reference" && reference && (
        <DataPreviewTable
          title={t("preview.reference_result")}
          subtitle={t("preview.standardizedSubtitle")}
          filename={reference.dataset.original_filename}
          columns={referenceStdData.columns}
          rows={referenceStdData.rows}
          totalRows={reference.dataset.row_count}
          previewLimit={5}
          badgeColor="brand"
          badgeText={t("preview.tabReference")}
        />
      )}
    </div>
  );
}

function StepProfile({
  reference,
  input,
}: {
  reference?: DatasetInspectResult;
  input?: DatasetInspectResult;
}) {
  const { t } = usePreferences();

  if (!reference && !input) {
    return (
      <>
        <SectionTitle title={t("matching.profile.title")} desc={t("matching.profile.desc")} />
        <EmptyState
          icon={Inbox}
          title={t("matching.profile.emptyTitle")}
          description={t("matching.profile.emptyDesc")}
          className="rounded-lg border border-border"
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle title={t("matching.profile.title")} desc={t("matching.profile.desc")} />
      {reference && (
        <DatasetProfileCard
          title={t("matching.upload.reference")}
          result={reference}
        />
      )}
      {input && (
        <DatasetProfileCard
          title={t("matching.upload.input")}
          result={input}
        />
      )}
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function StepColumnMapping({
  referenceColumns,
  inputColumns,
  mappings,
  setMappings,
}: {
  referenceColumns: DatasetInspectResult["columns"];
  inputColumns: DatasetInspectResult["columns"];
  mappings: ColumnMappingDraft[];
  setMappings: Dispatch<SetStateAction<ColumnMappingDraft[]>>;
}) {
  const { t } = usePreferences();
  const effectiveReferenceColumns = useMemo(
    () => injectVirtualColumns(referenceColumns, "ref"),
    [referenceColumns],
  );
  const effectiveInputColumns = useMemo(
    () => injectVirtualColumns(inputColumns, "inp"),
    [inputColumns],
  );

  const usedReferenceIds = new Set(mappings.map((mapping) => mapping.referenceColumnId));
  const hasColumns = effectiveReferenceColumns.length > 0 && effectiveInputColumns.length > 0;
  const hasAvailableReference = effectiveReferenceColumns.some((column) => !usedReferenceIds.has(column.id));
  const selectClass =
    "h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50";

  const updateMapping = (id: string, patch: Partial<ColumnMappingDraft>) => {
    setMappings((current) => {
      if (
        patch.referenceColumnId &&
        current.some(
          (mapping) => mapping.id !== id && mapping.referenceColumnId === patch.referenceColumnId,
        )
      ) {
        toast.error(t("matching.mapping.duplicateReference"));
        return current;
      }

      return current.map((mapping) => {
        if (mapping.id !== id) return mapping;

        const next = { ...mapping, ...patch, suggested: false };
        const referenceColumn = effectiveReferenceColumns.find(
          (column) => column.id === next.referenceColumnId,
        );
        const inputColumn = effectiveInputColumns.find((column) => column.id === next.inputColumnId);

        if (patch.referenceColumnId !== undefined || patch.inputColumnId !== undefined) {
          next.algorithm = next.required_match
            ? "Exact"
            : referenceColumn && inputColumn
              ? defaultMappingAlgorithm(referenceColumn, inputColumn)
              : referenceColumn
                ? defaultAlgorithmForColumn(referenceColumn)
                : "Normalized Exact";
          next.suggestionSource = "manual";
          next.suggestionScore = null;
          next.referenceColumnName = referenceColumn?.name ?? "";
          next.referenceDataType = referenceColumn?.data_type ?? "";
          next.inputColumnName = inputColumn?.name ?? "";
          next.inputDataType = inputColumn?.data_type ?? "";
          next.referenceNullPercentage = referenceColumn?.null_percentage;
          next.inputNullPercentage = inputColumn?.null_percentage;
          next.referenceDuplicatePercentage = referenceColumn?.duplicate_percentage;
          next.inputDuplicatePercentage = inputColumn?.duplicate_percentage;
          next.referenceSampleValues = referenceColumn?.sample_values ?? [];
          next.inputSampleValues = inputColumn?.sample_values ?? [];
        }

        if (patch.required_match !== undefined) {
          next.algorithm = patch.required_match
            ? "Exact"
            : referenceColumn && inputColumn
              ? defaultMappingAlgorithm(referenceColumn, inputColumn)
              : "Normalized Exact";
        }

        return next;
      });
    });
  };

  const addMapping = () => {
    if (!hasAvailableReference || effectiveInputColumns.length === 0) {
      toast.error(t("matching.mapping.noAvailableReference"));
      return;
    }

    setMappings((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        referenceColumnId: "",
        inputColumnId: "",
        algorithm: "Normalized Exact",
        required_match: false,
        suggested: false,
        suggestionSource: "manual",
        suggestionScore: null,
        referenceColumnName: "",
        inputColumnName: "",
        referenceDataType: "",
        inputDataType: "",
        referenceSampleValues: [],
        inputSampleValues: [],
      },
    ]);
    toast.success(t("matching.mapping.added"));
  };

  const removeMapping = (id: string) => {
    setMappings((current) => current.filter((mapping) => mapping.id !== id));
    toast.info(t("matching.mapping.removed"));
  };

  return (
    <>
      <SectionTitle title={t("matching.mapping.title")} desc={t("matching.mapping.desc")} />

      {!hasColumns ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t("matching.mapping.emptyTitle")}
          description={t("matching.mapping.emptyDesc")}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2.5 overflow-x-auto">
            {mappings.length > 0 && (
              <div className="grid min-w-[840px] grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_150px_44px] items-center gap-4 px-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{t("matching.mapping.input")}</span>
                <span className="text-center" aria-hidden="true">
                  &harr;
                </span>
                <span>{t("matching.mapping.reference")}</span>
                <span>{t("matching.mapping.strict")}</span>
                <span className="sr-only">{t("common.action")}</span>
              </div>
            )}

            {mappings.map((mapping, index) => {
              const referenceColumn = effectiveReferenceColumns.find(
                (column) => column.id === mapping.referenceColumnId,
              );
              const inputColumn = effectiveInputColumns.find(
                (column) => column.id === mapping.inputColumnId,
              );
              const usedByOtherRows = new Set(
                mappings
                  .filter((item) => item.id !== mapping.id)
                  .map((item) => item.referenceColumnId),
              );

              return (
                <div
                  key={mapping.id}
                  data-testid="mapping-row"
                  className="grid min-w-[840px] grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_150px_44px] items-center gap-4 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0">
                    <select
                      aria-label={t("matching.mapping.inputSelect", { row: index + 1 })}
                      data-testid="mapping-input-select"
                      value={mapping.inputColumnId}
                      onChange={(event) =>
                        updateMapping(mapping.id, { inputColumnId: event.target.value })
                      }
                      className={selectClass}
                    >
                      <option value="">{t("matching.mapping.noInputSelected")}</option>
                      {effectiveInputColumns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                      {inputColumn ? (
                        <ColumnTypeBadge column={inputColumn} testId="mapping-input-type" />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {t("matching.mapping.noInputSelected")}
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className="text-center text-sm font-medium text-muted-foreground"
                    aria-hidden="true"
                  >
                    &harr;
                  </span>

                  <div className="min-w-0">
                    <select
                      aria-label={t("matching.mapping.referenceSelect", { row: index + 1 })}
                      data-testid="mapping-reference-select"
                      value={mapping.referenceColumnId}
                      onChange={(event) =>
                        updateMapping(mapping.id, { referenceColumnId: event.target.value })
                      }
                      className={selectClass}
                    >
                      <option value="">{t("matching.mapping.noReferenceSelected")}</option>
                      {effectiveReferenceColumns.map((column) => (
                        <option
                          key={column.id}
                          value={column.id}
                          disabled={usedByOtherRows.has(column.id)}
                        >
                          {column.name}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                      {referenceColumn ? (
                        <ColumnTypeBadge column={referenceColumn} testId="mapping-reference-type" />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {t("matching.mapping.noReferenceSelected")}
                        </span>
                      )}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(mapping.required_match)}
                      onChange={(event) =>
                        updateMapping(mapping.id, { required_match: event.target.checked })
                      }
                      className="mt-0.5 size-4 accent-brand"
                    />
                    <span>
                      <span className="font-semibold">{t("matching.mapping.strict")}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                        {t("matching.mapping.strictHint")}
                      </span>
                    </span>
                  </label>

                  <button
                    type="button"
                    data-testid="mapping-remove-button"
                    onClick={() => removeMapping(mapping.id)}
                    className="grid size-10 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("matching.mapping.remove", { row: index + 1 })}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}

            {mappings.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium">{t("matching.mapping.noMappingsTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("matching.mapping.noMappingsDesc")}
                </p>
              </div>
            )}

            <button
              type="button"
              data-testid="mapping-add-button"
              onClick={addMapping}
              disabled={!hasAvailableReference}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
              {t("matching.mapping.add")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ColumnTypeBadge({
  column,
  testId,
}: {
  column: DatasetInspectResult["columns"][number];
  testId: string;
}) {
  const { t } = usePreferences();
  const type = normalizedDataType(column.data_type);
  const tone =
    type === "text"
      ? "border-brand/20 bg-brand/10 text-brand"
      : type === "number"
        ? "border-success/20 bg-success/10 text-success"
        : type === "date"
          ? "border-warning/20 bg-warning/10 text-warning"
          : type === "boolean"
            ? "border-foreground/15 bg-foreground/5 text-foreground"
            : "border-border bg-secondary text-muted-foreground";

  return (
    <span
      data-testid={testId}
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${tone}`}
    >
      {t(`matching.mapping.type.${type}`)}
    </span>
  );
}

function defaultMappingAlgorithm(
  referenceColumn: DatasetInspectResult["columns"][number],
  inputColumn: DatasetInspectResult["columns"][number],
): MatchingAlgorithm {
  const types = [referenceColumn.data_type, inputColumn.data_type].map((type) =>
    type.toLowerCase(),
  );

  if (types.some((type) => ["number", "date", "boolean"].includes(type))) {
    return "Exact";
  }

  return "Normalized Exact";
}

function defaultAlgorithmForColumn(
  column: DatasetInspectResult["columns"][number],
): MatchingAlgorithm {
  return ["number", "date", "boolean"].includes(column.data_type.toLowerCase())
    ? "Exact"
    : "Normalized Exact";
}

function normalizedDataType(dataType: string): "text" | "number" | "date" | "boolean" | "unknown" {
  const normalized = dataType.toLowerCase();
  return ["text", "number", "date", "boolean"].includes(normalized)
    ? (normalized as "text" | "number" | "date" | "boolean")
    : "unknown";
}

function defaultAlgorithmForField(
  referenceName: string,
  inputName: string,
  type: FieldType,
): ConfigureAlgorithm {
  const combinedName = `${referenceName} ${inputName}`.toLowerCase();
  if (type === "number" || type === "date" || type === "boolean") return "Exact";
  if (/(npwp|nik|id|kode|code|email)/.test(combinedName)) return "Normalized Exact";
  if (/(alamat|address)/.test(combinedName)) return "Jaro-Winkler";
  if (/(perusahaan|company|entity|entitas|nama|name|vendor|customer)/.test(combinedName)) {
    return "Jaro-Winkler";
  }
  if (/[_\s-]/.test(combinedName)) return "Token Set";
  return "Jaro-Winkler";
}

function defaultExactAlgorithmForField(
  referenceName: string,
  inputName: string,
  type: FieldType,
): ConfigureAlgorithm {
  const combinedName = `${referenceName} ${inputName}`.toLowerCase();
  if (type === "number" || type === "date") return "Exact";
  if (/(npwp|nik|id|kode|code|email)/.test(combinedName)) return "Normalized Exact";
  if (type === "text") return "Normalized Exact";
  return "Exact";
}

const STANDARD_OUTPUTS = ["Matched", "Possible Match", "Unmatched", "Summary Report"];

const COMPARISON_FAMILY_ALGORITHMS: Record<ComparisonFamily, ConfigureAlgorithm[]> = {
  Exact: ["Exact", "Normalized Exact"],
  "Character Similarity": ["Jaro-Winkler", "Levenshtein", "Damerau-Levenshtein"],
  "Token Similarity": ["Token Sort", "Token Set", "Partial Token"],
};

type ConfigFieldV2 = {
  id: string;
  label: string;
  referenceColumnId: string;
  inputColumnId: string;
  reference: string;
  input: string;
  type: FieldType;
  strict: boolean;
  family: ComparisonFamily;
  algorithm: ConfigureAlgorithm;
  normalization: string;
  reason: "identifier" | "entity_name" | "location" | "address" | "typed" | "categorical" | "multiword" | "text";
  signal: number;
};

function isEntityNameField(names: string): boolean {
  const normalized = names.toLowerCase().replace(/[^a-z0-9]/g, " ");
  return [
    "nama",
    "name",
    "perusahaan",
    "company",
    "usaha",
    "badan usaha",
    "entity",
    "entitas",
    "vendor",
    "customer",
    "client",
  ].some((kw) => normalized.includes(kw));
}

function isIdentifierField(names: string): boolean {
  const normalized = names.toLowerCase().replace(/[^a-z0-9]/g, " ");
  return ["nik", "npwp", "nib", "id", "kode", "code", "nomor", "no_"].some((kw) =>
    normalized.includes(kw),
  );
}

function isLocationField(names: string): boolean {
  const normalized = names.toLowerCase().replace(/[^a-z0-9]/g, " ");
  return [
    "kabupaten",
    "kota",
    "kab",
    "provinsi",
    "prov",
    "wilayah",
    "kecamatan",
    "kelurahan",
    "city",
    "province",
    "region",
  ].some((kw) => normalized.includes(kw));
}

function isAddressField(names: string): boolean {
  const normalized = names.toLowerCase().replace(/[^a-z0-9]/g, " ");
  return ["alamat", "address", "jalan", "street", "lokasi"].some((kw) =>
    normalized.includes(kw),
  );
}

function isGenericIdentifierName(value: string) {
  return /(^|[\s_-])(id|code|kode|key|number|nomor|identifier|uuid)([\s_-]|$)/i.test(value);
}

function averageSampleWords(values: string[] | undefined) {
  const samples = (values ?? []).filter(Boolean).slice(0, 5);
  if (samples.length === 0) return 0;
  return samples.reduce((sum, value) => sum + value.trim().split(/\s+/).length, 0) / samples.length;
}

function recommendComparison(
  mapping: ColumnMappingDraft,
): Pick<ConfigFieldV2, "family" | "algorithm" | "normalization" | "reason" | "signal"> {
  const type = normalizedDataType(mapping.referenceDataType || mapping.inputDataType);
  const names = `${mapping.referenceColumnName} ${mapping.inputColumnName}`;
  const completeness =
    100 - Math.max(mapping.referenceNullPercentage ?? 0, mapping.inputNullPercentage ?? 0);

  // 1. Identifiers (NPWP/NIB/NIK/ID) -> Normalized Exact, ~30% weight
  if (isIdentifierField(names) || isGenericIdentifierName(names)) {
    return {
      family: "Exact",
      algorithm: "Normalized Exact",
      normalization: "Automatic by field type",
      reason: "identifier",
      signal: 30 + completeness * 0.05,
    };
  }

  // 2. Name / Entity Fields -> Jaro-Winkler (Character Similarity) to punish reversed word orders! ~40% weight
  if (isEntityNameField(names) || names.includes("Nama Inti") || names.includes("Badan Usaha")) {
    return {
      family: "Character Similarity",
      algorithm: "Jaro-Winkler",
      normalization: "Automatic by field type",
      reason: "entity_name",
      signal: 40 + completeness * 0.05,
    };
  }

  // 3. Location / Category -> Normalized Exact, ~15% weight
  if (isLocationField(names)) {
    return {
      family: "Exact",
      algorithm: "Normalized Exact",
      normalization: "Automatic by field type",
      reason: "location",
      signal: 15 + completeness * 0.05,
    };
  }

  // 4. Address -> Jaro-Winkler, ~15% weight
  if (isAddressField(names)) {
    return {
      family: "Character Similarity",
      algorithm: "Jaro-Winkler",
      normalization: "Automatic by field type",
      reason: "address",
      signal: 15 + completeness * 0.05,
    };
  }

  if (type === "number" || type === "date" || type === "boolean") {
    return {
      family: "Exact",
      algorithm: "Normalized Exact",
      normalization: "Automatic by field type",
      reason: "typed",
      signal: 15 + completeness * 0.05,
    };
  }

  return {
    family: "Character Similarity",
    algorithm: "Jaro-Winkler",
    normalization: "Automatic by field type",
    reason: "text",
    signal: 10 + completeness * 0.05,
  };
}

function algorithmsForField(family: ComparisonFamily, _type: FieldType): ConfigureAlgorithm[] {
  return COMPARISON_FAMILY_ALGORITHMS[family] ?? ["Exact"];
}

function normalizeIntegerWeights(
  fields: Array<{ id: string; signal: number }>,
  source?: Record<string, number>,
) {
  if (fields.length === 0) return {};
  const values = fields.map((field) => ({
    ...field,
    raw: Math.max(0, source?.[field.id] ?? field.signal),
  }));
  const rawTotal = values.reduce((sum, field) => sum + field.raw, 0) || values.length;
  const weighted = values.map((field) => ({
    ...field,
    exact: ((field.raw || 1) / rawTotal) * 100,
  }));
  const result = Object.fromEntries(weighted.map((field) => [field.id, Math.floor(field.exact)]));
  let remainder = 100 - Object.values(result).reduce((sum, value) => sum + value, 0);
  [...weighted]
    .sort(
      (a, b) =>
        b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) ||
        b.signal - a.signal ||
        a.id.localeCompare(b.id),
    )
    .forEach((field) => {
      if (remainder > 0) {
        result[field.id] += 1;
        remainder -= 1;
      }
    });
  return result;
}

function StepConfigV2({
  jobId,
  mappings,
  configuration,
  onConfigurationChange,
  onValidityChange,
}: {
  jobId: string | null;
  mappings: ColumnMappingDraft[];
  configuration: MatchingConfiguration | null;
  onConfigurationChange: (configuration: MatchingConfiguration) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const { t, language } = usePreferences();
  const initialMode = configuration?.mode === "custom" ? "custom" : "default";
  const [mode, setMode] = useState<"default" | "custom">(initialMode);
  const [showDetails, setShowDetails] = useState(false);
  const [autoMatchThreshold, setAutoMatchThreshold] = useState(
    configuration?.thresholds?.autoMatch ?? 90,
  );
  const [reviewThreshold, setReviewThreshold] = useState(configuration?.thresholds?.review ?? 75);
  const [verificationEnabled, setVerificationEnabled] = useState(
    configuration?.rules?.verificationEnabled ?? true,
  );
  const [verificationOrder, setVerificationOrder] = useState<string[]>(
    () => configuration?.rules?.verificationOrder?.map((step) => step.mappingId) ?? [],
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [verificationThresholds, setVerificationThresholds] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (configuration?.rules?.verificationOrder ?? []).map((step) => [
        step.mappingId,
        step.threshold,
      ]),
    ),
  );
  const [methods, setMethods] = useState<
    Record<
      string,
      { family: ComparisonFamily; algorithm: ConfigureAlgorithm; normalization: string }
    >
  >(() =>
    Object.fromEntries(
      (configuration?.fields ?? []).map((field) => [
        field.mappingId,
        {
          family:
            field.comparisonFamily ?? comparisonFamilyForAlgorithm(field.algorithm, field.dataType),
          algorithm: field.algorithm,
          normalization: field.normalization ?? "Automatic by field type",
        },
      ]),
    ),
  );
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (configuration?.weighting.fields ?? []).map((field) => [field.mappingId, field.weight]),
    ),
  );
  const [aiSuggestion, setAiSuggestion] =
    useState<AiEnvelope<AiMatchingConfigurationSuggestion> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fields = useMemo<ConfigFieldV2[]>(
    () =>
      mappings
        .filter((mapping) => mapping.referenceColumnId && mapping.inputColumnId)
        .map((mapping) => {
          const recommended = recommendComparison(mapping);
          return {
            id: mapping.id,
            label: `${mapping.inputColumnName} ↔ ${mapping.referenceColumnName}`,
            referenceColumnId: mapping.referenceColumnId,
            inputColumnId: mapping.inputColumnId,
            reference: mapping.referenceColumnName,
            input: mapping.inputColumnName,
            type: normalizedDataType(mapping.referenceDataType || mapping.inputDataType),
            strict: Boolean(mapping.required_match),
            family: recommended.family,
            algorithm: recommended.algorithm,
            normalization: recommended.normalization,
            reason: recommended.reason,
            signal: recommended.signal,
          };
        }),
    [mappings],
  );
  const similarityFields = useMemo(() => fields.filter((field) => !field.strict), [fields]);
  const strictFields = useMemo(() => fields.filter((field) => field.strict), [fields]);
  const verificationSteps = useMemo(
    () =>
      verificationOrder
        .map((id, index) => {
          const field = fields.find((item) => item.id === id);
          if (!field) return null;
          const method: ConfigureAlgorithm = field.strict
            ? "Exact"
            : (methods[field.id]?.algorithm ?? field.algorithm);
          return {
            order: index + 1,
            field: field.label,
            mappingId: field.id,
            method,
            threshold: field.strict ? 100 : (verificationThresholds[field.id] ?? reviewThreshold),
          };
        })
        .filter(
          (
            step,
          ): step is {
            order: number;
            field: string;
            mappingId: string;
            method: ConfigureAlgorithm;
            threshold: number;
          } => Boolean(step),
        ),
    [fields, methods, reviewThreshold, verificationOrder, verificationThresholds],
  );

  useEffect(() => {
    setMethods((current) => {
      const next: typeof current = {};
      fields.forEach((field) => {
        const existing = current[field.id];
        const allowed = algorithmsForField(existing?.family ?? field.family, field.type);
        next[field.id] =
          existing && allowed.includes(existing.algorithm)
            ? existing
            : {
                family: field.family,
                algorithm: algorithmsForField(field.family, field.type).includes(field.algorithm)
                  ? field.algorithm
                  : algorithmsForField(field.family, field.type)[0],
                normalization: field.normalization,
              };
      });
      return next;
    });
    setWeights((current) => {
      const usable = Object.fromEntries(
        similarityFields.map((field) => [field.id, current[field.id]]),
      );
      const hasCompleteWeights = similarityFields.every((field) =>
        Number.isFinite(usable[field.id]),
      );
      return hasCompleteWeights ? usable : normalizeIntegerWeights(similarityFields, usable);
    });
  }, [fields, similarityFields]);

  useEffect(() => {
    setVerificationOrder((current) => {
      const fieldIds = fields.map((field) => field.id);
      const currentValid = current.filter((id) => fieldIds.includes(id));
      const missing = fieldIds.filter((id) => !currentValid.includes(id));
      if (currentValid.length === 0) {
        return [...fields]
          .sort((a, b) => {
            if (a.strict !== b.strict) return a.strict ? -1 : 1;
            const aName = isEntityNameField(a.reference + " " + a.input);
            const bName = isEntityNameField(b.reference + " " + b.input);
            if (aName !== bName) return aName ? -1 : 1;
            const aLoc = isLocationField(a.reference + " " + a.input);
            const bLoc = isLocationField(b.reference + " " + b.input);
            if (aLoc !== bLoc) return aLoc ? -1 : 1;
            return a.id.localeCompare(b.id);
          })
          .map((f) => f.id);
      }
      return [...currentValid, ...missing];
    });

    setVerificationThresholds((current) => {
      const next = { ...current };
      fields.forEach((field) => {
        if (next[field.id] === undefined) {
          const names = `${field.reference} ${field.input}`;
          if (field.strict) next[field.id] = 100;
          else if (isEntityNameField(names)) next[field.id] = 90;
          else if (isLocationField(names)) next[field.id] = 100;
          else next[field.id] = 75;
        }
      });
      return next;
    });
  }, [fields]);

  const totalWeight = similarityFields.reduce((sum, field) => sum + (weights[field.id] ?? 0), 0);
  const methodsValid = similarityFields.every((field) => {
    const method = methods[field.id];
    return Boolean(
      method && algorithmsForField(method.family, field.type).includes(method.algorithm),
    );
  });
  const configValid =
    fields.length > 0 &&
    methodsValid &&
    (similarityFields.length === 0 || totalWeight === 100) &&
    (mode === "default" ||
      (autoMatchThreshold > reviewThreshold &&
        autoMatchThreshold <= 100 &&
        reviewThreshold >= 0)) &&
    (!verificationEnabled || verificationSteps.length > 0);

  const configurationSnapshot = useMemo<MatchingConfiguration>(
    () => ({
      preset: mode === "default" ? "Default" : "Custom",
      mode,
      strategy: "Hybrid",
      isValid: configValid,
      fields: fields.map((field) => {
        const method = methods[field.id] ?? field;
        return {
          mappingId: field.id,
          referenceColumnId: field.referenceColumnId,
          inputColumnId: field.inputColumnId,
          referenceColumnName: field.reference,
          inputColumnName: field.input,
          dataType: field.type,
          algorithm: field.strict ? "Exact" : method.algorithm,
          strict: field.strict,
          comparisonFamily: field.strict ? "Exact" : method.family,
          normalization: field.strict ? "Basic" : method.normalization,
        };
      }),
      thresholds:
        mode === "default"
          ? { autoMatch: 90, review: 75, noMatch: 75 }
          : {
              autoMatch: autoMatchThreshold,
              review: reviewThreshold,
              noMatch: reviewThreshold,
            },
      candidateGeneration: { topN: 3 },
      searchOptimization: {
        enabled: true,
        mode: "auto",
        fields: [],
        recommendedFields: [],
      },
      normalization: { mode: "auto", preset: "Automatic by field type" },
      weighting: {
        mode: "manual",
        fields: fields.map((field) => {
          const method = methods[field.id] ?? field;
          return {
            mappingId: field.id,
            field: field.label,
            weight: field.strict ? 0 : (weights[field.id] ?? 0),
            algorithm: field.strict ? "Exact" : method.algorithm,
          };
        }),
      },
      rules: {
        mandatoryRule: verificationEnabled
          ? verificationSteps
              .map((step) => `${step.order}. ${step.field}: ${step.method}`)
              .join("; ")
          : "",
        numericTolerance: null,
        dateTolerance: null,
        combinedScoring: true,
        similarityFormula: null,
        verificationEnabled,
        verificationOrder: verificationEnabled ? verificationSteps : [],
      },
      output: { mode: "standard", items: STANDARD_OUTPUTS },
    }),
    [
      autoMatchThreshold,
      configValid,
      fields,
      methods,
      mode,
      reviewThreshold,
      verificationEnabled,
      verificationSteps,
      weights,
    ],
  );

  useEffect(() => onValidityChange(configValid), [configValid, onValidityChange]);
  useEffect(
    () => onConfigurationChange(configurationSnapshot),
    [configurationSnapshot, onConfigurationChange],
  );

  const changeFamily = (field: ConfigFieldV2, family: ComparisonFamily) => {
    setMethods((current) => ({
      ...current,
      [field.id]: {
        family,
        algorithm: algorithmsForField(family, field.type)[0],
        normalization: current[field.id]?.normalization ?? field.normalization,
      },
    }));
  };

  const moveVerificationStep = (mappingId: string, direction: -1 | 1) => {
    setVerificationOrder((current) => {
      const index = current.indexOf(mappingId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const reorderVerificationSteps = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setVerificationOrder((current) => {
      const currentList = verificationSteps.map((s) => s.mappingId);
      const next = [...currentList];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  };

  const requestAiSuggestion = async () => {
    if (aiLoading || fields.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    try {
      if (jobId) {
        const next = await fetchAiMatchingConfiguration(jobId, {
          locale: language,
          mappings: fields.map((field) => ({
            mapping_id: field.id,
            reference_column: field.reference,
            input_column: field.input,
            data_type: field.type,
            strict: field.strict,
          })),
        });
        setAiSuggestion(next);
        if (!next.success) setAiError(next.error.message ?? t("matching.ai.unavailable"));
      } else {
        // Smart AI suggestion generated directly from mapped dataset schema
        const recommended_fields = fields.map((f) => {
          const colName = (f.reference || f.input || "").toLowerCase();
          const isIdentifier =
            colName.includes("id") ||
            colName.includes("nik") ||
            colName.includes("npwp") ||
            colName.includes("kode") ||
            colName.includes("code");
          const isEntity =
            colName.includes("nama") ||
            colName.includes("name") ||
            colName.includes("perusahaan") ||
            colName.includes("company") ||
            colName.includes("badan");
          const isAddress =
            colName.includes("alamat") ||
            colName.includes("address") ||
            colName.includes("jalan") ||
            colName.includes("kota") ||
            colName.includes("city");

          let algorithm = "Exact";
          let weight = 20;

          if (isIdentifier) {
            algorithm = "Normalized Exact";
            weight = 40;
          } else if (isEntity) {
            algorithm = "Jaro-Winkler";
            weight = 40;
          } else if (isAddress) {
            algorithm = "Token Set Ratio";
            weight = 20;
          }

          return {
            field_name: f.reference,
            use_for_matching: true,
            suggested_algorithm: algorithm,
            suggested_weight: weight,
            rationale: isIdentifier
              ? "Kolom identitas unik direkomendasikan dengan pencocokan eksak ternormalisasi dan bobot tinggi."
              : isEntity
                ? "Kolom nama entitas direkomendasikan dengan algoritma Jaro-Winkler untuk menangani variasi penulisan tipografi."
                : isAddress
                  ? "Kolom alamat direkomendasikan dengan Token Set Ratio untuk menangani perbedaan urutan kata."
                  : "Kolom pendukung untuk meningkatkan akurasi pencocokan.",
          };
        });

        const totalW = recommended_fields.reduce((acc, curr) => acc + curr.suggested_weight, 0) || 1;
        const normalized_fields = recommended_fields.map((rf) => ({
          ...rf,
          suggested_weight: Math.round((rf.suggested_weight / totalW) * 100),
        }));

        setAiSuggestion({
          success: true,
          provider: "heuristic-assistant",
          model: "rules-engine-v1",
          usage: null,
          latency_ms: 12,
          error: {
            code: null,
            message: null,
          },
          data: {
            rationale:
              "Rekomendasi konfigurasi cerdas dihitung berdasarkan tipe data, nama kolom, dan profil dataset yang telah dipetakan.",
            suggested_thresholds: {
              auto_match: 90,
              needs_review: 70,
            },
            recommended_fields: normalized_fields,
            hard_conflict_rules: [],
            warnings: [],
          },
        });
      }
    } catch (error) {
      setAiError(error instanceof ApiError ? error.message : t("matching.ai.configLoadFailed"));
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestion = () => {
    const recommendation = aiSuggestion?.data;
    if (!recommendation) return;
    const matches = recommendation.recommended_fields
      .filter((suggestion) => suggestion.use_for_matching)
      .map((suggestion) => {
        const field = findMappingForSuggestion(suggestion, fields);
        return field ? { suggestion, field } : null;
      })
      .filter((item): item is { suggestion: AiConfigRecommendedField; field: ConfigFieldV2 } =>
        Boolean(item),
      );
    const active = matches.filter(({ field }) => !field.strict);
    if (active.length === 0) {
      setAiError(t("matching.ai.configNoMatchingFields"));
      return;
    }
    setMode("custom");
    setWeights(
      normalizeIntegerWeights(
        similarityFields,
        Object.fromEntries(
          active.map(({ field, suggestion }) => [
            field.id,
            Number(suggestion.suggested_weight ?? 0),
          ]),
        ),
      ),
    );
    setMethods((current) => {
      const next = { ...current };
      active.forEach(({ field, suggestion }) => {
        const requestedAlgorithm = normalizeConfiguredAlgorithm(
          suggestion.suggested_algorithm ?? field.algorithm,
        );
        const family = comparisonFamilyForAlgorithm(requestedAlgorithm, field.type);
        const allowed = algorithmsForField(family, field.type);
        const algorithm = allowed.includes(requestedAlgorithm) ? requestedAlgorithm : allowed[0];
        next[field.id] = { family, algorithm, normalization: field.normalization };
      });
      return next;
    });
    if (typeof recommendation.suggested_thresholds?.auto_match === "number") {
      setAutoMatchThreshold(Math.round(recommendation.suggested_thresholds.auto_match));
    }
    if (typeof recommendation.suggested_thresholds?.needs_review === "number") {
      setReviewThreshold(Math.round(recommendation.suggested_thresholds.needs_review));
    }
    setAiError(null);
    toast.success(t("feedback.toast.recommendationApplied"));
  };

  return (
    <>
      <SectionTitle title={t("matching.config.title")} desc={t("matching.configV2.desc")} />

      <div className="inline-flex w-full rounded-md border border-border bg-secondary/30 p-1 sm:w-auto">
        {(["default", "custom"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`flex-1 rounded px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${mode === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {option === "default"
              ? t("matching.configV2.defaultMatch")
              : t("matching.configV2.customMatch")}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-5">
        <div className="rounded-lg border border-border bg-secondary/20 px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold">{t("matching.configV2.strictFields")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {strictFields.length > 0
                  ? strictFields.map((field) => field.label).join(", ")
                  : t("matching.configV2.none")}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold">{t("matching.configV2.similarityFields")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {similarityFields.length > 0
                  ? t("matching.configV2.fieldCount", { count: similarityFields.length })
                  : t("matching.configV2.none")}
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {t("matching.configV2.exactFirst")}
          </p>
        </div>

        <section className="border-y border-border py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{t("matching.configV2.variablesWeights")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  mode === "default"
                    ? "matching.configV2.defaultWeightsDesc"
                    : "matching.configV2.customWeightsDesc",
                )}
              </p>
            </div>
            <p
              className={`text-sm font-semibold tabular-nums ${totalWeight === 100 || similarityFields.length === 0 ? "text-success" : "text-destructive"}`}
            >
              {t("matching.configV2.totalWeight", { total: totalWeight })}
            </p>
          </div>

          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {fields.map((field) => (
              <div
                key={field.id}
                className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{field.label}</p>
                    {field.strict && (
                      <span className="rounded-full border border-brand/20 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                        {t("matching.mapping.strict")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {field.strict
                      ? t("matching.configV2.strictWeightHint")
                      : `${t("matching.configV2.systemRecommendation")}: ${t(`matching.configV2.reason.${field.reason}`)}`}
                  </p>
                </div>
                {field.strict ? (
                  <p className="text-right text-sm font-semibold tabular-nums">0%</p>
                ) : (
                  <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    {t("matching.configV2.weight")}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={weights[field.id] ?? 0}
                      onChange={(event) =>
                        setWeights((current) => ({
                          ...current,
                          [field.id]: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                        }))
                      }
                      className="h-9 w-20 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand"
                    />
                    %
                  </label>
                )}
              </div>
            ))}
            {fields.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                {t("matching.configV2.noFields")}
              </p>
            )}
          </div>
          {similarityFields.length > 0 && totalWeight !== 100 && (
            <p className="mt-2 text-xs font-medium text-destructive">
              {t("matching.configV2.weightError")}
            </p>
          )}
        </section>

        {mode === "default" ? (
          <section className="border-b border-border pb-5">
            <button
              type="button"
              onClick={() => setShowDetails((current) => !current)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={showDetails}
            >
              <div>
                <p className="text-sm font-semibold">{t("matching.configV2.details")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("matching.configV2.detailsDesc")}
                </p>
              </div>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform ${showDetails ? "rotate-180" : ""}`}
              />
            </button>
            {showDetails && (
              <div className="mt-4 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{t("matching.configV2.field")}</th>
                      <th className="px-3 py-2 font-semibold">{t("matching.configV2.family")}</th>
                      <th className="px-3 py-2 font-semibold">
                        {t("matching.configV2.algorithm")}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {t("matching.configV2.normalization")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {fields.map((field) => {
                      const method = methods[field.id] ?? field;
                      return (
                        <tr key={field.id}>
                          <td className="px-3 py-2 font-medium">{field.label}</td>
                          <td className="px-3 py-2">
                            {field.strict
                              ? t("matching.configV2.strictExact")
                              : comparisonFamilyLabel(method.family, t)}
                          </td>
                          <td className="px-3 py-2">
                            {field.strict || method.algorithm === "Exact"
                              ? "Raw Exact"
                              : method.algorithm}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {field.strict
                              ? t("matching.configV2.none")
                              : normalizationV2Label(method.normalization, t)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  {t("matching.configV2.thresholdSummary")}
                </p>
              </div>
            )}
          </section>
        ) : (
          <div className="space-y-6">
            <section className="border-b border-border pb-5">
              <p className="text-sm font-semibold">{t("matching.configV2.comparisonMethod")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("matching.configV2.comparisonMethodDesc")}
              </p>
              <div className="mt-4 divide-y divide-border rounded-md border border-border">
                {similarityFields.map((field) => {
                  const method = methods[field.id] ?? field;
                  return (
                    <div
                      key={field.id}
                      className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-center"
                    >
                      <p className="text-sm font-medium">{field.label}</p>
                      <select
                        value={method.family}
                        onChange={(event) =>
                          changeFamily(field, event.target.value as ComparisonFamily)
                        }
                        className="h-9 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand"
                      >
                        {(["Exact", "Character Similarity", "Token Similarity"] as ComparisonFamily[]).map(
                          (family) => (
                            <option key={family} value={family}>
                              {comparisonFamilyLabel(family, t)}
                            </option>
                          ),
                        )}
                      </select>
                      <select
                        value={method.algorithm}
                        onChange={(event) =>
                          setMethods((current) => ({
                            ...current,
                            [field.id]: {
                              ...method,
                              algorithm: event.target.value as ConfigureAlgorithm,
                            },
                          }))
                        }
                        className="h-9 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand"
                      >
                        {algorithmsForField(method.family, field.type).map((algorithm) => (
                          <option key={algorithm} value={algorithm}>
                            {algorithm === "Exact" ? "Raw Exact" : algorithm}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <details className="mt-3 rounded-md bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold text-foreground">
                  {t("matching.configV2.standardizationInfo")}
                </summary>
                <p className="mt-2 leading-relaxed">{t("matching.configV2.standardizationDesc")}</p>
              </details>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border px-3 py-3">
                  <p className="text-xs font-semibold">{t("matching.configV2.composite")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("matching.configV2.compositeDesc")}
                  </p>
                </div>
                <div className="rounded-md border border-border px-3 py-3">
                  <p className="text-xs font-semibold">{t("matching.configV2.ruleBased")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("matching.configV2.ruleBasedDesc")}
                  </p>
                </div>
              </div>
            </section>

            <section className="border-b border-border pb-5">
              <p className="text-sm font-semibold">{t("matching.configV2.resultRules")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("matching.configV2.resultRulesDesc")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">
                  {t("matching.configV2.autoMatch")}
                  <div className="mt-1 flex items-center gap-2">
                    <span>≥</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={autoMatchThreshold}
                      onChange={(event) => setAutoMatchThreshold(Number(event.target.value))}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums"
                    />
                    <span>%</span>
                  </div>
                </label>
                <label className="text-xs text-muted-foreground">
                  {t("matching.configV2.needReview")}
                  <div className="mt-1 flex items-center gap-2">
                    <span>≥</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={reviewThreshold}
                      onChange={(event) => setReviewThreshold(Number(event.target.value))}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums"
                    />
                    <span>%</span>
                  </div>
                </label>
                <RunConfigItem
                  label={t("matching.configV2.unmatched")}
                  value={`< ${reviewThreshold}%`}
                />
              </div>
              {!(
                autoMatchThreshold > reviewThreshold &&
                autoMatchThreshold <= 100 &&
                reviewThreshold >= 0
              ) && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  {t("matching.configV2.thresholdError")}
                </p>
              )}
              <label className="mt-4 flex items-start gap-3 rounded-md bg-secondary/30 px-3 py-3">
                <input
                  type="checkbox"
                  checked={verificationEnabled}
                  onChange={(event) => setVerificationEnabled(event.target.checked)}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span>
                  <span className="block text-xs font-semibold">
                    {t("matching.configV2.verification")}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("matching.configV2.verificationDesc")}
                  </span>
                </span>
              </label>
              {verificationEnabled && (
                <div className="mt-4 overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="bg-secondary/40 text-muted-foreground">
                      <tr>
                        <th className="w-24 px-3 py-2 font-semibold">{t("matching.configV2.order")}</th>
                        <th className="px-3 py-2 font-semibold">{t("matching.configV2.field")}</th>
                        <th className="px-3 py-2 font-semibold">{t("matching.configV2.method")}</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          {t("matching.configV2.threshold")}
                        </th>
                        <th className="w-28 px-3 py-2 text-right font-semibold">{t("common.action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {verificationSteps.map((step, index) => {
                        const field = fields.find((item) => item.id === step.mappingId);
                        const isDragging = draggedIndex === index;
                        const isDragOver = dragOverIndex === index;
                        return (
                          <tr
                            key={step.mappingId}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", String(index));
                              e.dataTransfer.effectAllowed = "move";
                              setDraggedIndex(index);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              if (dragOverIndex !== index) {
                                setDragOverIndex(index);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverIndex === index) {
                                setDragOverIndex(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (draggedIndex !== null) {
                                reorderVerificationSteps(draggedIndex, index);
                              }
                              setDraggedIndex(null);
                              setDragOverIndex(null);
                            }}
                            onDragEnd={() => {
                              setDraggedIndex(null);
                              setDragOverIndex(null);
                            }}
                            className={`transition-colors ${
                              isDragging ? "bg-secondary/40 opacity-50" : ""
                            } ${
                              isDragOver ? "border-t-2 border-brand bg-brand/10" : "hover:bg-secondary/20"
                            }`}
                          >
                            <td className="px-3 py-2 tabular-nums">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-flex cursor-grab items-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                                  title="Drag to reorder"
                                >
                                  <GripVertical className="size-3.5" />
                                </span>
                                <span>{step.order}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-medium">{step.field}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {field?.strict ? t("matching.mapping.strict") : step.method}
                            </td>
                            <td className="px-3 py-2">
                              {field?.strict ? (
                                <p className="text-right font-semibold tabular-nums">100%</p>
                              ) : (
                                <label className="flex items-center justify-end gap-2">
                                  <span>≥</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={step.threshold}
                                    onChange={(event) =>
                                      setVerificationThresholds((current) => ({
                                        ...current,
                                        [step.mappingId]: Math.max(
                                          0,
                                          Math.min(100, Number(event.target.value) || 0),
                                        ),
                                      }))
                                    }
                                    className="h-8 w-16 rounded-md border border-border bg-background px-2 text-right tabular-nums"
                                  />
                                  <span>%</span>
                                </label>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => moveVerificationStep(step.mappingId, -1)}
                                  disabled={step.order === 1}
                                  className="inline-flex size-7 items-center justify-center rounded border border-border bg-background text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
                                  aria-label={t("matching.configV2.moveUp")}
                                  title={t("matching.configV2.moveUp")}
                                >
                                  <ChevronUp className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveVerificationStep(step.mappingId, 1)}
                                  disabled={step.order === verificationSteps.length}
                                  className="inline-flex size-7 items-center justify-center rounded border border-border bg-background text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
                                  aria-label={t("matching.configV2.moveDown")}
                                  title={t("matching.configV2.moveDown")}
                                >
                                  <ChevronDown className="size-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        <section className="rounded-lg border border-accent/25 bg-accent/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold">{t("matching.ai.configTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("matching.ai.configDesc")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestAiSuggestion}
                disabled={aiLoading || fields.length === 0}
                className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50 cursor-pointer"
              >
                {aiLoading ? t("matching.ai.loading") : t("matching.ai.loadConfig")}
              </button>
              <button
                type="button"
                onClick={applyAiSuggestion}
                disabled={!aiSuggestion?.success || !aiSuggestion.data}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {t("matching.ai.applySuggestion")}
              </button>
            </div>
          </div>
          {aiError && <p className="mt-3 text-xs text-destructive">{aiError}</p>}
          {aiSuggestion?.data && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <SyncMetric
                  label={t("matching.ai.thresholdAuto")}
                  value={formatAiValue(aiSuggestion.data.suggested_thresholds?.auto_match, "%")}
                />
                <SyncMetric
                  label={t("matching.ai.thresholdReview")}
                  value={formatAiValue(aiSuggestion.data.suggested_thresholds?.needs_review, "%")}
                />
                <SyncMetric
                  label={t("matching.ai.weightTotal")}
                  value={formatAiValue(
                    aiSuggestion.data.recommended_fields
                      .filter((field) => field.use_for_matching)
                      .reduce((sum, field) => sum + Number(field.suggested_weight ?? 0), 0),
                    "%",
                  )}
                  strong
                />
              </div>
              <div className="overflow-x-auto rounded-md border border-border bg-background/70">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">
                        {t("matching.ai.recommendedField")}
                      </th>
                      <th className="px-3 py-2 font-semibold">{t("matching.ai.priority")}</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        {t("matching.ai.weight")}
                      </th>
                      <th className="px-3 py-2 font-semibold">{t("matching.ai.algorithm")}</th>
                      <th className="px-3 py-2 font-semibold">{t("matching.ai.reason")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {aiSuggestion.data.recommended_fields.map((field, index) => (
                      <tr key={`${field.field ?? field.mapping ?? "field"}-${index}`}>
                        <td className="px-3 py-2 font-medium">
                          {field.field ?? field.mapping ?? "-"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{field.priority ?? "-"}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {field.use_for_matching ? Number(field.suggested_weight ?? 0) : 0}%
                        </td>
                        <td className="px-3 py-2">{field.suggested_algorithm ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{field.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <CompactListCard
                  title={t("matching.ai.hardConflictRules")}
                  items={aiSuggestion.data.hard_conflict_rules}
                  emptyLabel={t("matching.ai.none")}
                />
                <CompactListCard
                  title={t("matching.ai.warnings")}
                  items={aiSuggestion.data.warnings}
                  emptyLabel={t("matching.ai.none")}
                />
              </div>
              <div className="rounded-md border border-border bg-background/70 px-3 py-3">
                <p className="text-xs font-semibold">{t("matching.ai.rationale")}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {aiSuggestion.data.rationale}
                </p>
              </div>
            </div>
          )}
        </section>

        {!configValid && (
          <p className="text-xs font-medium text-destructive">
            {fields.length === 0 ? t("matching.configV2.noFields") : t("matching.configV2.invalid")}
          </p>
        )}
      </div>
    </>
  );
}

function comparisonFamilyForAlgorithm(
  algorithm?: string,
  _type?: FieldType,
): ComparisonFamily {
  if (!algorithm) return "Character Similarity";
  if (algorithm === "Exact" || algorithm === "Normalized Exact") return "Exact";
  if (algorithm.includes("Token") || algorithm.includes("Partial")) {
    return "Token Similarity";
  }
  return "Character Similarity";
}

function comparisonFamilyLabel(
  family: ComparisonFamily,
  t: ReturnType<typeof usePreferences>["t"],
) {
  const labels: Record<ComparisonFamily, Parameters<typeof t>[0]> = {
    Exact: "matching.configV2.familyExact",
    "Character Similarity": "matching.configV2.familyCharacter",
    "Token Similarity": "matching.configV2.familyToken",
  };
  return labels[family] ? t(labels[family]) : family;
}

function normalizationV2Label(value: string, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    "Automatic by field type": "matching.configV2.normalizationAuto",
    Basic: "matching.configV2.normalizationBasic",
    "Text Standardization": "matching.configV2.normalizationText",
    "Identifier Strict": "matching.configV2.normalizationIdentifier",
  };
  return labels[value] ? t(labels[value]) : value;
}

function normalizeConfiguredAlgorithm(value: string): ConfigureAlgorithm {
  if (value === "Token Sort Ratio" || value === "Token Sort") return "Token Sort";
  if (value === "Token Set Ratio" || value === "Token Set") return "Token Set";
  if (
    value === "Partial Ratio" ||
    value === "Partial Token Sort" ||
    value === "Partial Token Set" ||
    value === "Partial Token"
  ) {
    return "Partial Token";
  }
  if (value === "Normalized Exact") return "Normalized Exact";
  if (value === "Exact") return "Exact";
  if (value === "Levenshtein") return "Levenshtein";
  if (value === "Damerau-Levenshtein") return "Damerau-Levenshtein";
  return "Jaro-Winkler";
}

function findMappingForSuggestion(
  suggestion: AiConfigRecommendedField,
  mappedFields: Array<{
    id: string;
    label: string;
    reference: string;
    input: string;
    type: FieldType;
    algorithm: ConfigureAlgorithm;
    referenceColumnId: string;
    inputColumnId: string;
  }>,
) {
  const fieldName = (suggestion.field ?? suggestion.mapping ?? "").trim().toLowerCase();
  if (!fieldName) return null;

  return (
    mappedFields.find((field) => field.id === fieldName) ??
    mappedFields.find((field) => field.label.toLowerCase() === fieldName) ??
    mappedFields.find((field) => field.reference.toLowerCase() === fieldName) ??
    mappedFields.find((field) => field.input.toLowerCase() === fieldName) ??
    mappedFields.find(
      (field) =>
        `${field.reference} ↔ ${field.input}`.toLowerCase() === fieldName ||
        `${field.reference} <-> ${field.input}`.toLowerCase() === fieldName,
    )
  );
}

function CompactListCard({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/70 px-3 py-3">
      <p className="text-xs font-semibold">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompactInlineList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-md bg-secondary/30 px-2.5 py-2">
      <p className="text-[11px] font-semibold">{label}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {items.length > 0 ? items.join(", ") : "-"}
      </p>
    </div>
  );
}

function AiPanelSection({
  title,
  loading,
  error,
  hasData,
  onLoad,
  actionLabel,
  children,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onLoad: () => void;
  actionLabel: string;
  children: React.ReactNode;
}) {
  const { t } = usePreferences();

  return (
    <section className="rounded-md border border-border bg-background/70 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold">{title}</p>
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary disabled:opacity-50"
        >
          {loading ? t("matching.ai.loading") : hasData ? t("matching.ai.reload") : actionLabel}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-muted-foreground">{error}</p>
      ) : hasData ? (
        <div className="mt-3">{children}</div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t("matching.ai.notLoaded")}</p>
      )}
    </section>
  );
}

function outputLabel(value: string, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    Matched: "matching.output.matched",
    "Possible Match": "matching.output.possible",
    Unmatched: "matching.output.unmatched",
    "Synchronization Summary": "matching.output.syncSummary",
    "Mapping Table": "matching.output.mapping",
    "Foreign Key": "matching.output.foreignKey",
    "Audit Trail": "matching.output.audit",
    "Summary Report": "matching.output.summary",
  };
  return labels[value] ? t(labels[value]) : value;
}

function formatAiValue(value: string | number | null | undefined, suffix = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return `${value}${suffix}`;

  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ThresholdInput({
  label,
  tone,
  value,
  onChange,
}: {
  label: string;
  tone: "success" | "warning" | "muted";
  value: number;
  onChange: (n: number) => void;
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className={`text-sm font-semibold tabular-nums ${color}`}>≥ {value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

function RunConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StepRunCard({
  state,
  progress,
  configuration,
  result,
  error,
  onStart,
  onRetry,
  onProceed,
  canRun,
  hasPreviousRun,
}: {
  state: RunState;
  progress: number;
  configuration: MatchingConfiguration | null;
  result: MatchingRunResult | null;
  error: string | null;
  onStart: () => void;
  onRetry: () => void;
  onProceed: () => void;
  canRun: boolean;
  hasPreviousRun: boolean;
}) {
  const { t } = usePreferences();

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {hasPreviousRun ? t("matching.run.rerunTitle") : t("matching.run.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {state === "idle"
              ? hasPreviousRun
                ? t("matching.run.rerunIdleDesc")
                : t("matching.run.idleDesc")
              : state === "running"
                ? t("matching.run.progressTitle")
                : state === "success"
                  ? t("matching.run.complete")
                  : t("matching.run.failedGeneric")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state === "idle" && (
            <button
              type="button"
              disabled={!canRun || !configuration?.isValid}
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {hasPreviousRun ? <RefreshCw className="size-4" /> : <Play className="size-4" />}
              <span>{hasPreviousRun ? t("matching.run.rerunOverwrite") : t("matching.run.start")}</span>
            </button>
          )}

          {state === "running" && (
            <div className="flex items-center gap-2 text-xs font-semibold text-brand">
              <Loader2 className="size-4 animate-spin" />
              <span>{t("matching.run.processingPercent", { progress })}</span>
            </div>
          )}

          {state === "failed" && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
            >
              <RefreshCw className="size-3.5" />
              {t("common.retry")}
            </button>
          )}

          {state === "success" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary cursor-pointer"
              >
                <RefreshCw className="size-3.5" />
                <span>{t("matching.run.rerunButton")}</span>
              </button>

              <button
                type="button"
                onClick={onProceed}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow hover:bg-brand/90 cursor-pointer"
              >
                <span>{t("step.results")}</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {state === "running" && (
        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-brand transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {state === "failed" && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {state === "success" && result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2 border-t border-border/60 text-xs">
          <div className="rounded-md bg-secondary/30 p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase">{t("results.totalRecords")}</p>
            <p className="mt-1 text-sm font-bold">{result.progress.total.toLocaleString()}</p>
          </div>
          <div className="rounded-md bg-secondary/30 p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase">{t("results.matchedRecords")}</p>
            <p className="mt-1 text-sm font-bold text-success">
              {result.summary.matched.toLocaleString()}
            </p>
          </div>
          <div className="rounded-md bg-secondary/30 p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase">{t("results.possibleMatches")}</p>
            <p className="mt-1 text-sm font-bold text-warning">
              {result.summary.possible_match.toLocaleString()}
            </p>
          </div>
          <div className="rounded-md bg-secondary/30 p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase">{t("results.unmatchedRecords")}</p>
            <p className="mt-1 text-sm font-bold text-muted-foreground">
              {result.summary.unmatched.toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StepReviewAndResults({
  jobId,
  canDecide,
  columnMappings,
  canExecuteExport,
  onExportHistoryChange,
  workspaceId,
}: {
  jobId: string | null;
  canDecide: boolean;
  columnMappings: ColumnMappingDraft[];
  syncState?: SyncState | null;
  onSyncStateChange?: Dispatch<SetStateAction<SyncState | null>>;
  canExecuteSync?: boolean;
  canExecuteExport: boolean;
  onExportHistoryChange: Dispatch<SetStateAction<StoredExportHistoryEntry[]>>;
  workspaceId?: string | null;
}) {
  const { t } = usePreferences();
  const [activeSubTab, setActiveSubTab] = useState<"review" | "export">("review");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab("review")}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeSubTab === "review"
                ? "bg-brand text-brand-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("step.review")}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("export")}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeSubTab === "export"
                ? "bg-brand text-brand-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("step.export")}
          </button>
        </div>

        {workspaceId && (
          <Link
            to="/results"
            search={buildResultsSearch(workspaceId)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {t("common.goToResults")}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>

      {activeSubTab === "review" && (
        <StepReview
          jobId={jobId}
          canDecide={canDecide}
          columnMappings={columnMappings}
        />
      )}

      {activeSubTab === "export" && (
        <StepExport
          jobId={jobId}
          canExecute={canExecuteExport}
          onExportHistoryChange={onExportHistoryChange}
        />
      )}
    </div>
  );
}

function StepRun({
  state,
  progress,
  configuration,
  result,
  error,
  onStart,
  onRetry,
  onBack,
  canRun,
}: {
  state: RunState;
  progress: number;
  configuration: MatchingConfiguration | null;
  result: MatchingRunResult | null;
  error: string | null;
  onStart: () => void;
  onRetry: () => void;
  onBack: () => void;
  canRun: boolean;
}) {
  const { t } = usePreferences();
  const strictFields = configuration?.fields.filter((field) => field.strict) ?? [];
  const similarityFields = configuration?.fields.filter((field) => !field.strict) ?? [];
  const configuredWeights = new Map(
    configuration?.weighting.fields.map((field) => [field.mappingId, field.weight]) ?? [],
  );
  return (
    <>
      <SectionTitle title={t("matching.run.title")} desc={t("matching.run.desc")} />
      {state === "idle" && (
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-secondary grid place-items-center">
                <Play className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">{t("matching.run.ready")}</p>
                <p className="text-xs text-muted-foreground">{t("matching.run.estimated")}</p>
              </div>
            </div>
            {canRun && (
              <button
                onClick={onStart}
                className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90"
              >
                {t("matching.run.start")}
              </button>
            )}
          </div>
          {configuration && (
            <div
              className="mt-5 space-y-3 rounded-lg border border-border bg-secondary/20 p-4"
              data-testid="run-configuration-summary"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <RunConfigItem
                  label={t("matching.run.strictFields")}
                  value={
                    strictFields.length > 0
                      ? strictFields
                          .map((field) => `${field.inputColumnName} ↔ ${field.referenceColumnName}`)
                          .join(", ")
                      : t("matching.configV2.none")
                  }
                />
                <RunConfigItem
                  label={t("matching.run.similarityFields")}
                  value={
                    similarityFields.length > 0
                      ? similarityFields
                          .map(
                            (field) =>
                              `${field.inputColumnName} ↔ ${field.referenceColumnName} (${configuredWeights.get(field.mappingId) ?? 0}%)`,
                          )
                          .join(", ")
                      : t("matching.configV2.none")
                  }
                />
              </div>
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                {t("matching.run.exactFirst")}
              </p>
            </div>
          )}
        </div>
      )}

      {state === "running" && (
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="size-5 text-accent animate-spin" />
            <div>
              <p className="text-sm font-semibold">{t("matching.run.progressTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {progress < 40
                  ? t("matching.run.building")
                  : progress < 80
                    ? t("matching.run.scoring")
                    : t("matching.run.finalizing")}
              </p>
            </div>
          </div>
          <div className="flex justify-between text-xs mb-2">
            <span className="text-muted-foreground">{t("common.progress")}</span>
            <span className="font-medium tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state === "success" && (
        <div className="border border-success/30 bg-success/5 rounded-lg p-6 flex items-start gap-4">
          <div className="size-10 rounded-full bg-success/10 grid place-items-center">
            <Check className="size-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t("matching.run.complete")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {result
                ? t("matching.run.completeSummary", {
                    matched: result.summary.matched,
                    possible: result.summary.possible_match,
                    unmatched: result.summary.unmatched,
                  })
                : t("matching.run.completeDesc")}
            </p>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-6 flex items-start gap-4">
          <div className="size-10 rounded-full bg-destructive/10 grid place-items-center">
            <AlertCircle className="size-5 text-destructive" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t("matching.run.failed")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {error ?? t("matching.run.failedDesc", { progress: Math.round(progress) })}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRetry}
                className="px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold"
              >
                {t("common.retry")}
              </button>
              <button
                onClick={onBack}
                className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-secondary"
              >
                {t("common.backToConfig")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type ReviewFilter = "possible_match" | "matched" | "unmatched" | "all";
type CaseGroupFilter = "open" | "resolved" | "all";

function StepReview({
  jobId,
  canDecide,
  columnMappings,
}: {
  jobId: string | null;
  canDecide: boolean;
  columnMappings: ColumnMappingDraft[];
}) {
  const { t } = usePreferences();
  const [review, setReview] = useState<ReviewResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"case_groups" | "all_records">("case_groups");
  const [caseGroupFilter, setCaseGroupFilter] = useState<CaseGroupFilter>("open");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("possible_match");
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Record<string, string[]>>({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [pendingRecords, setPendingRecords] = useState<Record<string, string>>({});
  const [pendingGroups, setPendingGroups] = useState<Record<string, string>>({});
  const [pendingUndos, setPendingUndos] = useState<Record<string, boolean>>({});
  const [aiAnalysisByResult, setAiAnalysisByResult] = useState<
    Record<string, AiEnvelope<AiReviewAnalysis>>
  >({});
  const [aiRecommendationByResult, setAiRecommendationByResult] = useState<
    Record<string, AiEnvelope<AiReviewRecommendation>>
  >({});
  const [reviewKnowledgeByResult, setReviewKnowledgeByResult] = useState<
    Record<string, ReviewKnowledgeResponse>
  >({});
  const [aiLoadingByKey, setAiLoadingByKey] = useState<Record<string, boolean>>({});
  const [aiErrorByKey, setAiErrorByKey] = useState<Record<string, string | null>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const identityMappings = useMemo(
    () => extractIdentityMappings({ columnMappings }),
    [columnMappings],
  );

  useEffect(() => {
    if (!jobId) {
      setReview(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReviewResults(jobId)
      .then((data) => {
        if (!cancelled) setReview(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : t("matching.review.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, t]);

  const items = review?.items ?? [];
  const caseGroups = review?.case_groups ?? [];
  const visibleCaseGroups = caseGroups.filter((group) => {
    if (caseGroupFilter !== "all" && (group.status ?? "open") !== caseGroupFilter) return false;
    if (!query) return true;
    const haystack = JSON.stringify([
      group.label,
      group.pattern,
      group.reason,
      group.confidence,
      group.representative?.input_record,
      group.representative?.candidates?.[0]?.reference_record,
    ]).toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const caseGroupCounts = {
    open: caseGroups.filter((group) => (group.status ?? "open") === "open").length,
    resolved: caseGroups.filter((group) => group.status === "resolved").length,
    all: caseGroups.length,
  };
  const selectedCaseGroup =
    (selectedGroupId ? caseGroups.find((group) => group.id === selectedGroupId) : null) ?? null;
  const filtered = items
    .filter((item) => filter === "all" || item.status === filter)
    .filter((item) => {
      if (!query) return true;
      const haystack = JSON.stringify([
        item.input_record_key,
        item.status,
        item.input_record,
        item.candidates.map((candidate) => candidate.reference_record),
      ]).toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .sort((a, b) => {
      const priority = (status: string) =>
        status === "possible_match" ? 0 : status === "matched" ? 1 : 2;
      const priorityDiff = priority(a.status) - priority(b.status);
      if (priorityDiff !== 0) return priorityDiff;
      return candidateScore(b) - candidateScore(a);
    });
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedCandidate =
    selected?.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    selected?.candidates[0] ??
    null;
  const selectedSummary = selected
    ? buildIdentitySummary(selected, selectedCandidate, identityMappings)
    : null;
  const selectedResultId = selectedCandidate?.id ?? null;

  const loadAiPanel = useCallback(
    async (kind: "analysis" | "recommendation" | "knowledge", resultId: string) => {
      const stateKey = `${kind}:${resultId}`;
      if (aiLoadingByKey[stateKey]) return;

      setAiLoadingByKey((current) => ({ ...current, [stateKey]: true }));
      setAiErrorByKey((current) => ({ ...current, [stateKey]: null }));

      try {
        if (kind === "analysis") {
          const next = await fetchAiReviewAnalysis(resultId);
          setAiAnalysisByResult((current) => ({ ...current, [resultId]: next }));
          if (!next.success) {
            setAiErrorByKey((current) => ({
              ...current,
              [stateKey]: next.error.message ?? t("matching.ai.unavailable"),
            }));
          }
        } else if (kind === "recommendation") {
          const next = await fetchAiReviewRecommendation(resultId);
          setAiRecommendationByResult((current) => ({ ...current, [resultId]: next }));
          if (!next.success) {
            setAiErrorByKey((current) => ({
              ...current,
              [stateKey]: next.error.message ?? t("matching.ai.unavailable"),
            }));
          }
        } else {
          const next = await fetchReviewKnowledge(resultId);
          setReviewKnowledgeByResult((current) => ({ ...current, [resultId]: next }));
        }
      } catch (err) {
        setAiErrorByKey((current) => ({
          ...current,
          [stateKey]: err instanceof ApiError ? err.message : t("matching.ai.loadFailed"),
        }));
      } finally {
        setAiLoadingByKey((current) => ({ ...current, [stateKey]: false }));
      }
    },
    [aiLoadingByKey, t],
  );

  const openRecord = useCallback((item: ReviewItem, candidateId?: string | null) => {
    const candidate =
      item.candidates.find((entry) => entry.id === candidateId) ?? item.candidates[0] ?? null;
    setSelected(item);
    setSelectedCandidateId(candidate?.id ?? null);
  }, []);

  const toggleSelectedGroupKey = (group: ReviewCaseGroup, key: string) => {
    setSelectedGroupKeys((current) => {
      const selectedKeys = current[group.id] ?? [];
      const nextKeys = selectedKeys.includes(key)
        ? selectedKeys.filter((item) => item !== key)
        : [...selectedKeys, key];

      return {
        ...current,
        [group.id]: nextKeys,
      };
    });
  };

  const replaceSelectedGroupKeys = useCallback((groupId: string, keys: string[]) => {
    setSelectedGroupKeys((current) => ({
      ...current,
      [groupId]: keys,
    }));
  }, []);

  const decide = async (
    item: ReviewItem,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    candidate?: ReviewCandidate | null,
  ) => {
    if (!jobId) return;
    setPendingRecords((current) => ({ ...current, [item.input_record_key]: decision }));
    try {
      const next = await saveReviewDecision(jobId, {
        inputRecordKey: item.input_record_key,
        matchingResultId: candidate?.id,
        decision,
      });
      setReview((current) =>
        mergeReviewSnapshot(
          current,
          next.review,
          [item.input_record_key],
          ((next.decision as unknown as Record<string, unknown>).caseGroupId as string | null) ??
            null,
        ),
      );
      const updated = next.review.items.find(
        (nextItem) => nextItem.input_record_key === item.input_record_key,
      );
      if (updated) {
        setSelected(updated);
        if (candidate?.id) {
          const matchedCandidate = updated.candidates.find((entry) => entry.id === candidate.id);
          setSelectedCandidateId(matchedCandidate?.id ?? updated.candidates[0]?.id ?? null);
        } else {
          setSelectedCandidateId(updated.candidates[0]?.id ?? null);
        }
      }
      toast.success(
        decision === "accept_match" || decision === "select_candidate"
          ? t("feedback.toast.approved")
          : t("feedback.toast.rejected"),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setPendingRecords((current) => {
        const next = { ...current };
        delete next[item.input_record_key];
        return next;
      });
    }
  };

  const decideCaseGroup = async (
    group: ReviewCaseGroup,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    scope: "selected" | "group",
  ) => {
    if (!jobId) return;

    if (!group.eligible_for_bulk) {
      toast.error(t("matching.review.bulkBlocked"));
      return;
    }

    const keys = scope === "selected" ? (selectedGroupKeys[group.id] ?? []) : group.item_keys;

    if (keys.length === 0) {
      toast.error(t("matching.review.selectRecordsFirst"));
      return;
    }

    setPendingGroups((current) => ({ ...current, [group.id]: decision }));
    try {
      const next = await saveReviewDecision(jobId, {
        inputRecordKey: keys[0],
        inputRecordKeys: keys,
        decision,
        scope,
        caseGroupId: group.id,
      });
      setReview((current) => mergeReviewSnapshot(current, next.review, keys, group.id));
      setSelectedGroupKeys((current) => ({ ...current, [group.id]: [] }));
      setSelected((current) => {
        if (!current || !keys.includes(current.input_record_key)) return current;
        return (
          next.review.items.find((item) => item.input_record_key === current.input_record_key) ??
          current
        );
      });
      toast.success(
        t("matching.review.groupDecisionSaved", {
          count: next.decision.affected_records,
          skipped: next.decision.skipped_count ?? 0,
        }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setPendingGroups((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
    }
  };

  const undo = async (item: ReviewItem) => {
    if (!item.decision) return;
    await undoDecision(item.decision.id, item.input_record_key);
  };

  const undoDecision = async (decisionId: string, selectedInputKey?: string) => {
    if (!jobId) return;
    setPendingUndos((current) => ({ ...current, [decisionId]: true }));
    try {
      const next = await undoReviewDecision(jobId, decisionId);
      setReview((current) =>
        mergeReviewSnapshot(
          current,
          next,
          selectedInputKey ? [selectedInputKey] : [],
          findDecisionGroupId(current, decisionId),
        ),
      );
      if (selectedInputKey) {
        const updated = next.items.find(
          (nextItem) => nextItem.input_record_key === selectedInputKey,
        );
        setSelected(updated ?? null);
      }
      toast.success(t("matching.review.undoSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setPendingUndos((current) => {
        const next = { ...current };
        delete next[decisionId];
        return next;
      });
    }
  };

  if (!jobId) {
    return (
      <>
        <SectionTitle title={t("matching.review.title")} desc={t("matching.review.emptyDesc")} />
        <EmptyState
          icon={ClipboardCheck}
          title={t("matching.review.noRunTitle")}
          description={t("matching.review.noRunDesc")}
        />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <SectionTitle title={t("matching.review.title")} desc={t("matching.review.desc")} />
        <div className="rounded-lg border border-border bg-secondary/20 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-accent" />
            <div>
              <p className="text-sm font-semibold">{t("common.loading")}</p>
              <p className="text-xs text-muted-foreground">{t("matching.review.loading")}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <SectionTitle title={t("matching.review.title")} desc={t("matching.review.desc")} />
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-semibold">{t("feedback.error.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionTitle title={t("matching.review.title")} desc={t("matching.review.desc")} />

      <div className="mb-4 grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <div className="inline-flex w-fit rounded-lg border border-border bg-secondary/30 p-1">
          {(["case_groups", "all_records"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setViewMode(mode);
                setPage(1);
              }}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                viewMode === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {mode === "case_groups"
                ? t("matching.review.caseGroups")
                : t("matching.review.allRecords")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {viewMode === "case_groups"
            ? t("matching.review.caseGroupsDesc")
            : t("matching.review.allRecordsDesc")}
        </p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 lg:w-72">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t("matching.review.search")}
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
      </div>

      {viewMode === "case_groups" &&
        (selectedCaseGroup ? (
          <GroupReviewSubview
            group={selectedCaseGroup}
            items={items}
            identityMappings={identityMappings}
            canDecide={canDecide}
            pendingGroups={pendingGroups}
            pendingRecords={pendingRecords}
            selectedKeys={selectedGroupKeys[selectedCaseGroup.id] ?? []}
            onBack={() => setSelectedGroupId(null)}
            onOpenRecord={openRecord}
            onToggleKey={toggleSelectedGroupKey}
            onReplaceSelectedKeys={replaceSelectedGroupKeys}
            onDecideRecord={decide}
            onDecideGroup={decideCaseGroup}
          />
        ) : (
          <CaseGroupsReview
            groups={visibleCaseGroups}
            filter={caseGroupFilter}
            counts={caseGroupCounts}
            identityMappings={identityMappings}
            pendingGroups={pendingGroups}
            pendingUndos={pendingUndos}
            onFilterChange={setCaseGroupFilter}
            onOpenGroup={(group) => setSelectedGroupId(group.id)}
            onUndo={undoDecision}
            onDecide={decideCaseGroup}
            canDecide={canDecide}
          />
        ))}

      {viewMode === "all_records" && (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex flex-wrap gap-2">
              {(["possible_match", "matched", "unmatched", "all"] as ReviewFilter[]).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setFilter(status);
                      setPage(1);
                    }}
                    className={[
                      "rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                      filter === status
                        ? "border-brand bg-brand/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {reviewFilterLabel(status, t)}
                    <span className="ml-2 tabular-nums text-muted-foreground">
                      {status === "all"
                        ? items.length
                        : items.filter((item) => item.status === status).length}
                    </span>
                  </button>
                ),
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-border">
              <EmptyState
                icon={Inbox}
                title={t("feedback.empty.title")}
                description={t("feedback.empty.desc")}
              />
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[980px] text-sm" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col />
                    <col />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "210px" }} />
                  </colgroup>
                  <thead className="bg-secondary/60 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">
                        {t("matching.review.input")}
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium">
                        {t("matching.review.reference")}
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium">
                        {t("matching.review.similarity")}
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium">
                        {t("matching.review.group")}
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium">
                        {t("matching.review.topCandidates")}
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium">{t("common.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map((item) => {
                      const candidate = item.candidates[0] ?? null;
                      const hasReferenceCandidate = Boolean(candidate?.reference_record_key);
                      const summary = buildIdentitySummary(item, candidate, identityMappings);
                      const inputIdentity = candidate
                        ? buildSideIdentity(summary, "input")
                        : buildRecordIdentity(item.input_record, "input", identityMappings);
                      const referenceIdentity = hasReferenceCandidate
                        ? buildSideIdentity(summary, "reference")
                        : null;
                      const rowPending = pendingRecords[item.input_record_key];
                      return (
                        <tr
                          key={item.input_record_key}
                          onClick={() => openRecord(item, candidate?.id ?? null)}
                          className="cursor-pointer hover:bg-secondary/40"
                        >
                          <td className="px-4 py-3 min-w-0">
                            <p className="text-sm font-medium truncate">{inputIdentity.headline}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {inputIdentity.meta}
                            </p>
                          </td>
                          <td className="px-4 py-3 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {hasReferenceCandidate
                                ? (referenceIdentity?.headline ?? t("matching.review.noCandidate"))
                                : t("matching.review.noCandidate")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {hasReferenceCandidate
                                ? (referenceIdentity?.meta ?? "-")
                                : t("matching.review.noCandidateDesc")}
                            </p>
                          </td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums font-semibold ${scoreTone(candidate?.score ?? 0)}`}
                          >
                            {candidate ? `${candidate.score}%` : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={statusBadgeClass(
                                item.status_code ?? item.display_status ?? item.status,
                              )}
                            >
                              {reviewStatusLabel(
                                item.status_code ?? item.display_status ?? item.status,
                                t,
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                            {item.candidates.length}
                          </td>
                          <td className="px-4 py-3">
                            {canDecide ? (
                              <div
                                className="flex justify-end gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={() => decide(item, "accept_match", candidate)}
                                  disabled={!hasReferenceCandidate || Boolean(rowPending)}
                                  className="cursor-pointer rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {rowPending === "accept_match" ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <Loader2 className="size-3 animate-spin" />
                                      {t("common.loading")}
                                    </span>
                                  ) : (
                                    t("matching.review.accept")
                                  )}
                                </button>
                                <button
                                  onClick={() => decide(item, "mark_unmatched", null)}
                                  disabled={Boolean(rowPending)}
                                  className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {rowPending === "mark_unmatched" ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <Loader2 className="size-3 animate-spin" />
                                      {t("common.loading")}
                                    </span>
                                  ) : (
                                    t("matching.review.markUnmatched")
                                  )}
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={page}
                pageSize={pageSize}
                totalItems={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(newPageSize) => {
                  setPageSize(newPageSize);
                  setPage(1);
                }}
                pageSizeOptions={[10, 25, 50]}
              />
            </div>
          )}
        </>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{t("matching.review.compare")}</SheetTitle>
                <SheetDescription>
                  {selected.input_record_key} ·{" "}
                  {reviewStatusLabel(
                    selected.status_code ?? selected.display_status ?? selected.status,
                    t,
                  )}
                </SheetDescription>
              </SheetHeader>

              {selected.decision && (
                <div className="mt-5 rounded-lg border border-success/30 bg-success/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">{t("matching.review.decisionSaved")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reviewDecisionLabel(selected.decision.decision, t)} ·{" "}
                        {decisionSourceLabel(selected.decision.source, t)} ·{" "}
                        {selected.decision.decided_at ?? selected.decision.created_at ?? "-"}
                      </p>
                    </div>
                    {canDecide && (
                      <button
                        type="button"
                        onClick={() => undo(selected)}
                        disabled={Boolean(selected.decision && pendingUndos[selected.decision.id])}
                        className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {selected.decision && pendingUndos[selected.decision.id] ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="size-3 animate-spin" />
                            {t("common.loading")}
                          </span>
                        ) : (
                          t("matching.review.undo")
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <RecordIdentityPanel
                  title={t("matching.review.input")}
                  identity={
                    selectedSummary
                      ? buildSideIdentity(selectedSummary, "input")
                      : buildRecordIdentity(selected.input_record, "input", identityMappings)
                  }
                />
                <RecordIdentityPanel
                  title={t("matching.review.reference")}
                  identity={
                    selectedCandidate?.reference_record_key && selectedSummary
                      ? buildSideIdentity(selectedSummary, "reference")
                      : buildRecordIdentity({}, "reference", identityMappings)
                  }
                  emptyText={t("matching.review.noCandidate")}
                />
              </div>

              {selected.candidates.length > 1 && (
                <details className="mt-5 rounded-lg border border-border p-3" open>
                  <summary className="cursor-pointer text-xs font-semibold">
                    {t("matching.review.topCandidates")}
                  </summary>
                  <div className="mt-3 space-y-2">
                    {selected.candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setSelectedCandidateId(candidate.id)}
                        className={[
                          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition-colors active:translate-y-px",
                          selectedCandidate?.id === candidate.id
                            ? "border-brand bg-brand/10"
                            : "border-border hover:bg-secondary",
                        ].join(" ")}
                      >
                        <span className="min-w-0">
                          {(() => {
                            const candidateSummary = buildIdentitySummary(
                              selected,
                              candidate,
                              identityMappings,
                            );
                            const candidateIdentity = buildSideIdentity(
                              candidateSummary,
                              "reference",
                            );

                            return (
                              <>
                                <span className="block truncate font-medium">
                                  #{candidate.rank} {candidateIdentity.headline}
                                </span>
                                <span className="block truncate text-muted-foreground">
                                  {candidateIdentity.meta}
                                </span>
                              </>
                            );
                          })()}
                        </span>
                        <span
                          className={`tabular-nums font-semibold ${scoreTone(candidate.score)}`}
                        >
                          {candidate.score}%
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              {selectedCandidate?.verification_evidence && (
                <div className="mt-5">
                  <VerificationEvidenceBreakdown candidate={selectedCandidate} />
                </div>
              )}

              <details className="mt-5 rounded-lg border border-border p-3" open>
                <summary className="cursor-pointer text-xs font-semibold">
                  {t("matching.review.supportingFields")}
                </summary>
                <div className="mt-3 space-y-2">
                  {sortFieldScores(selectedCandidate?.field_scores ?? []).map((field) => (
                    <FieldComparison
                      key={`${field.reference_column}-${field.input_column}`}
                      field={field}
                      inputRecord={selected.input_record}
                      referenceRecord={selectedCandidate?.reference_record ?? {}}
                    />
                  ))}
                </div>
              </details>

              {selectedResultId && (
                <div className="mt-5 rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{t("matching.ai.reviewTitle")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("matching.ai.reviewDesc")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <AiPanelSection
                      title={t("matching.ai.analysisTitle")}
                      loading={Boolean(aiLoadingByKey[`analysis:${selectedResultId}`])}
                      error={aiErrorByKey[`analysis:${selectedResultId}`] ?? null}
                      hasData={Boolean(aiAnalysisByResult[selectedResultId]?.data)}
                      onLoad={() => loadAiPanel("analysis", selectedResultId)}
                      actionLabel={t("matching.ai.loadAnalysis")}
                    >
                      {aiAnalysisByResult[selectedResultId]?.data && (
                        <div className="space-y-3 text-xs">
                          <div className="grid gap-3 md:grid-cols-2">
                            <SyncMetric
                              label={t("matching.ai.assessment")}
                              value={formatAiValue(
                                aiAnalysisByResult[selectedResultId]?.data?.assessment,
                              )}
                            />
                            <SyncMetric
                              label={t("matching.ai.confidence")}
                              value={formatAiValue(
                                aiAnalysisByResult[selectedResultId]?.data?.confidence,
                                "%",
                              )}
                            />
                          </div>
                          <p className="text-muted-foreground">
                            {aiAnalysisByResult[selectedResultId]?.data?.summary}
                          </p>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <CompactListCard
                              title={t("matching.ai.supportingEvidence")}
                              items={
                                aiAnalysisByResult[selectedResultId]?.data?.supporting_evidence ??
                                []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.conflicts")}
                              items={aiAnalysisByResult[selectedResultId]?.data?.conflicts ?? []}
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.missingInformation")}
                              items={
                                aiAnalysisByResult[selectedResultId]?.data?.missing_information ??
                                []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.attentionPoints")}
                              items={
                                aiAnalysisByResult[selectedResultId]?.data?.attention_points ?? []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                          </div>
                        </div>
                      )}
                    </AiPanelSection>

                    <AiPanelSection
                      title={t("matching.ai.recommendationTitle")}
                      loading={Boolean(aiLoadingByKey[`recommendation:${selectedResultId}`])}
                      error={aiErrorByKey[`recommendation:${selectedResultId}`] ?? null}
                      hasData={Boolean(aiRecommendationByResult[selectedResultId]?.data)}
                      onLoad={() => loadAiPanel("recommendation", selectedResultId)}
                      actionLabel={t("matching.ai.loadRecommendation")}
                    >
                      {aiRecommendationByResult[selectedResultId]?.data && (
                        <div className="space-y-3 text-xs">
                          <div className="grid gap-3 md:grid-cols-2">
                            <SyncMetric
                              label={t("matching.ai.recommendation")}
                              value={formatAiValue(
                                aiRecommendationByResult[selectedResultId]?.data?.recommendation,
                              )}
                            />
                            <SyncMetric
                              label={t("matching.ai.confidence")}
                              value={formatAiValue(
                                aiRecommendationByResult[selectedResultId]?.data?.confidence,
                                "%",
                              )}
                            />
                          </div>
                          <p className="text-muted-foreground">
                            {aiRecommendationByResult[selectedResultId]?.data?.rationale}
                          </p>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <CompactListCard
                              title={t("matching.ai.keyEvidence")}
                              items={
                                aiRecommendationByResult[selectedResultId]?.data?.key_evidence ?? []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.risks")}
                              items={aiRecommendationByResult[selectedResultId]?.data?.risks ?? []}
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.suggestedChecks")}
                              items={
                                aiRecommendationByResult[selectedResultId]?.data
                                  ?.suggested_checks ?? []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                            <CompactListCard
                              title={t("matching.ai.historicalContext")}
                              items={
                                aiRecommendationByResult[selectedResultId]?.data
                                  ?.historical_context ?? []
                              }
                              emptyLabel={t("matching.ai.none")}
                            />
                          </div>
                        </div>
                      )}
                    </AiPanelSection>

                    <AiPanelSection
                      title={t("matching.ai.historyTitle")}
                      loading={Boolean(aiLoadingByKey[`knowledge:${selectedResultId}`])}
                      error={aiErrorByKey[`knowledge:${selectedResultId}`] ?? null}
                      hasData={Boolean(reviewKnowledgeByResult[selectedResultId])}
                      onLoad={() => loadAiPanel("knowledge", selectedResultId)}
                      actionLabel={t("matching.ai.loadHistory")}
                    >
                      {reviewKnowledgeByResult[selectedResultId] && (
                        <div className="space-y-3 text-xs">
                          <SyncMetric
                            label={t("matching.ai.totalCasesFound")}
                            value={formatAiValue(
                              reviewKnowledgeByResult[selectedResultId]?.total_cases_found ?? 0,
                            )}
                          />
                          <div className="space-y-2">
                            {(reviewKnowledgeByResult[selectedResultId]?.similar_cases ?? []).map(
                              (item) => (
                                <div
                                  key={`${item.matching_result_id}-${item.input_record_key}`}
                                  className="rounded-md border border-border bg-background/70 px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold">{item.previous_human_decision}</p>
                                    <span className="tabular-nums text-muted-foreground">
                                      {t("matching.ai.relevanceScore")}:{" "}
                                      {formatAiValue(item.relevance_score, "%")}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-muted-foreground">{item.pattern}</p>
                                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                    <CompactInlineList
                                      label={t("matching.ai.importantAgreements")}
                                      items={item.important_agreements}
                                    />
                                    <CompactInlineList
                                      label={t("matching.ai.importantConflicts")}
                                      items={item.important_conflicts}
                                    />
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </AiPanelSection>
                  </div>
                </div>
              )}

              <DecisionHistory history={selected.decision_history ?? []} />

              <div className="mt-6 flex gap-2">
                {canDecide && (
                  <>
                    <button
                      onClick={() => decide(selected, "accept_match", selectedCandidate)}
                      disabled={
                        !selectedCandidate?.reference_record_key ||
                        Boolean(pendingRecords[selected.input_record_key])
                      }
                      className="flex-1 cursor-pointer rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pendingRecords[selected.input_record_key] === "accept_match" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="size-4 animate-spin" />
                          {t("common.loading")}
                        </span>
                      ) : (
                        t("matching.review.accept")
                      )}
                    </button>
                    <button
                      onClick={() => decide(selected, "reject_match", selectedCandidate)}
                      disabled={
                        !selectedCandidate?.reference_record_key ||
                        Boolean(pendingRecords[selected.input_record_key])
                      }
                      className="flex-1 cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pendingRecords[selected.input_record_key] === "reject_match" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="size-4 animate-spin" />
                          {t("common.loading")}
                        </span>
                      ) : (
                        t("matching.review.reject")
                      )}
                    </button>
                    <button
                      onClick={() => decide(selected, "mark_unmatched", null)}
                      disabled={Boolean(pendingRecords[selected.input_record_key])}
                      className="flex-1 cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pendingRecords[selected.input_record_key] === "mark_unmatched" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="size-4 animate-spin" />
                          {t("common.loading")}
                        </span>
                      ) : (
                        t("matching.review.markUnmatched")
                      )}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary active:translate-y-px"
                >
                  {t("common.skip")}
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function CaseGroupsReview({
  counts,
  filter,
  groups,
  canDecide,
  identityMappings,
  onOpenGroup,
  onDecide,
  onFilterChange,
  onUndo,
  pendingGroups,
  pendingUndos,
}: {
  counts: Record<CaseGroupFilter, number>;
  filter: CaseGroupFilter;
  groups: ReviewCaseGroup[];
  canDecide: boolean;
  identityMappings: IdentityFieldPair[];
  onOpenGroup: (group: ReviewCaseGroup) => void;
  pendingGroups: Record<string, string>;
  pendingUndos: Record<string, boolean>;
  onFilterChange: (filter: CaseGroupFilter) => void;
  onUndo: (decisionId: string) => void;
  onDecide: (
    group: ReviewCaseGroup,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    scope: "selected" | "group",
  ) => void;
}) {
  const { t } = usePreferences();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["open", "resolved", "all"] as CaseGroupFilter[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onFilterChange(item)}
            className={[
              "rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
              filter === item
                ? "border-brand bg-brand/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary",
            ].join(" ")}
          >
            {caseGroupFilterLabel(item, t)}
            <span className="ml-2 tabular-nums text-muted-foreground">{counts[item]}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-border">
          <EmptyState
            icon={Inbox}
            title={t("matching.review.noCaseGroups")}
            description={t("matching.review.noCaseGroupsDesc")}
          />
        </div>
      ) : (
        groups.map((group) => {
          const representative = group.representative;
          const candidate = representative.candidates[0] ?? null;
          const representativeSummary = buildIdentitySummary(
            representative,
            candidate,
            identityMappings,
          );
          const representativeIdentity = buildSideIdentity(representativeSummary, "input");
          const groupPending = pendingGroups[group.id];
          const canAccept = Boolean(candidate?.reference_record_key);
          const isResolved = group.status === "resolved";
          const latestDecision = group.decision_history?.[0] ?? null;

          return (
            <section
              key={group.id}
              className="rounded-lg border border-border bg-background p-4 shadow-sm"
            >
              <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{group.label}</p>
                    <span className={caseGroupStatusClass(group.status ?? "open")}>
                      {caseGroupStatusLabel(group.status ?? "open", t)}
                    </span>
                    <span className={caseConfidenceClass(group.confidence)}>
                      {caseConfidenceLabel(group.confidence, t)}
                    </span>
                    <span className={knowledgeLevelClass(group.knowledge_level ?? "NEW_PATTERN")}>
                      {knowledgeLevelLabel(group.knowledge_level ?? "NEW_PATTERN", t)}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("matching.review.caseCount", { count: group.item_count })}
                    </span>
                    {group.decision_summary?.mixed && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                        {t("matching.review.mixedDecision")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{group.reason}</p>
                  {group.recommendation && (
                    <p className="mt-2 text-xs font-medium text-foreground">
                      {t("matching.review.recommendation")}:{" "}
                      <span className="font-normal text-muted-foreground">
                        {group.recommendation}
                      </span>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("matching.review.representative")}:{" "}
                    <span className="font-medium text-foreground">
                      {representativeIdentity.headline}
                    </span>
                    {representativeIdentity.meta !== "-" ? (
                      <span className="ml-2 text-muted-foreground">
                        {representativeIdentity.meta}
                      </span>
                    ) : null}
                    {candidate ? (
                      <span
                        className={`ml-2 tabular-nums font-semibold ${scoreTone(candidate.score)}`}
                      >
                        {candidate.score}%
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("matching.review.decisionSummary")}:{" "}
                    {t("matching.review.acceptedCount", {
                      count: group.decision_summary?.accepted ?? 0,
                    })}{" "}
                    ·{" "}
                    {t("matching.review.rejectedCount", {
                      count: group.decision_summary?.rejected ?? 0,
                    })}{" "}
                    ·{" "}
                    {t("matching.review.unmatchedCount", {
                      count: group.decision_summary?.unmatched ?? 0,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                  {isResolved && latestDecision && canDecide ? (
                    <button
                      type="button"
                      onClick={() => onUndo(latestDecision.id)}
                      disabled={Boolean(pendingUndos[latestDecision.id])}
                      className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pendingUndos[latestDecision.id] ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="size-3 animate-spin" />
                          {t("common.loading")}
                        </span>
                      ) : (
                        t("matching.review.undo")
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenGroup(group)}
                        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px"
                      >
                        {t("matching.review.reviewGroup")}
                      </button>
                      {canDecide && (
                        <>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "accept_match", "group")}
                            disabled={
                              !group.eligible_for_bulk || !canAccept || Boolean(groupPending)
                            }
                            className="cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {groupPending === "accept_match" ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" />
                                {t("common.loading")}
                              </span>
                            ) : (
                              t("matching.review.applyGroupAccept")
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "reject_match", "group")}
                            disabled={
                              !group.eligible_for_bulk || !canAccept || Boolean(groupPending)
                            }
                            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {groupPending === "reject_match" ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" />
                                {t("common.loading")}
                              </span>
                            ) : (
                              t("matching.review.applyGroupReject")
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "mark_unmatched", "group")}
                            disabled={!group.eligible_for_bulk || Boolean(groupPending)}
                            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {groupPending === "mark_unmatched" ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" />
                                {t("common.loading")}
                              </span>
                            ) : (
                              t("matching.review.applyGroupUnmatched")
                            )}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {!group.eligible_for_bulk && !isResolved && (
                <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                  {t("matching.review.bulkNotEligible")}
                </div>
              )}

              <DecisionHistory history={group.decision_history ?? []} />
            </section>
          );
        })
      )}
    </div>
  );
}

function GroupReviewSubview({
  group,
  items,
  identityMappings,
  canDecide,
  pendingGroups,
  pendingRecords,
  selectedKeys,
  onBack,
  onOpenRecord,
  onToggleKey,
  onReplaceSelectedKeys,
  onDecideRecord,
  onDecideGroup,
}: {
  group: ReviewCaseGroup;
  items: ReviewItem[];
  identityMappings: IdentityFieldPair[];
  canDecide: boolean;
  pendingGroups: Record<string, string>;
  pendingRecords: Record<string, string>;
  selectedKeys: string[];
  onBack: () => void;
  onOpenRecord: (item: ReviewItem, candidateId?: string | null) => void;
  onToggleKey: (group: ReviewCaseGroup, key: string) => void;
  onReplaceSelectedKeys: (groupId: string, keys: string[]) => void;
  onDecideRecord: (
    item: ReviewItem,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    candidate?: ReviewCandidate | null,
  ) => Promise<void>;
  onDecideGroup: (
    group: ReviewCaseGroup,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    scope: "selected" | "group",
  ) => Promise<void>;
}) {
  const { t } = usePreferences();
  const groupItems = useMemo(
    () =>
      group.item_keys
        .map((key) => items.find((item) => item.input_record_key === key))
        .filter((item): item is ReviewItem => Boolean(item)),
    [group.item_keys, items],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pagedGroupItems = useMemo(
    () => groupItems.slice((page - 1) * pageSize, page * pageSize),
    [groupItems, page, pageSize],
  );
  const allSelectableKeys = groupItems.map((item) => item.input_record_key);
  const selectedSet = new Set(selectedKeys);
  const allSelected =
    allSelectableKeys.length > 0 && allSelectableKeys.every((key) => selectedSet.has(key));
  const representativeCandidate = group.representative.candidates[0] ?? null;
  const representativeSummary = buildIdentitySummary(
    group.representative,
    representativeCandidate,
    identityMappings,
  );
  const representativeIdentity = buildSideIdentity(representativeSummary, "input");
  const canAcceptGroup = Boolean(representativeCandidate?.reference_record_key);
  const groupPending = pendingGroups[group.id];

  const toggleSelectAll = () => {
    if (allSelected) {
      onReplaceSelectedKeys(group.id, []);
      return;
    }
    onReplaceSelectedKeys(group.id, allSelectableKeys);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px"
          >
            <ArrowLeft className="size-3.5" />
            {t("matching.review.backToCaseGroups")}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{group.label}</p>
            <span className={caseGroupStatusClass(group.status ?? "open")}>
              {caseGroupStatusLabel(group.status ?? "open", t)}
            </span>
            <span className={caseConfidenceClass(group.confidence)}>
              {caseConfidenceLabel(group.confidence, t)}
            </span>
            <span className={knowledgeLevelClass(group.knowledge_level ?? "NEW_PATTERN")}>
              {knowledgeLevelLabel(group.knowledge_level ?? "NEW_PATTERN", t)}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t("matching.review.caseCount", { count: group.item_count })}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{group.reason}</p>
          {group.recommendation ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("matching.review.recommendation")}:{" "}
              <span className="font-medium text-foreground">{group.recommendation}</span>
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            {t("matching.review.representative")}:{" "}
            <span className="font-medium text-foreground">{representativeIdentity.headline}</span>
            {representativeIdentity.meta !== "-" ? (
              <span className="ml-2">{representativeIdentity.meta}</span>
            ) : null}
          </p>
        </div>

        {canDecide ? (
          <div className="flex flex-wrap justify-start gap-2">
            <button
              type="button"
              onClick={() => onDecideGroup(group, "accept_match", "group")}
              disabled={!group.eligible_for_bulk || !canAcceptGroup || Boolean(groupPending)}
              className="cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {groupPending === "accept_match"
                ? t("common.loading")
                : t("matching.review.applyGroupAccept")}
            </button>
            <button
              type="button"
              onClick={() => onDecideGroup(group, "reject_match", "group")}
              disabled={!group.eligible_for_bulk || !canAcceptGroup || Boolean(groupPending)}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {groupPending === "reject_match"
                ? t("common.loading")
                : t("matching.review.applyGroupReject")}
            </button>
            <button
              type="button"
              onClick={() => onDecideGroup(group, "mark_unmatched", "group")}
              disabled={!group.eligible_for_bulk || Boolean(groupPending)}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {groupPending === "mark_unmatched"
                ? t("common.loading")
                : t("matching.review.applyGroupUnmatched")}
            </button>
          </div>
        ) : null}
      </div>

      {!group.eligible_for_bulk ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          {t("matching.review.bulkNotEligible")}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-background shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={!canDecide || allSelectableKeys.length === 0 || Boolean(groupPending)}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("matching.review.selectAll")}
            </button>
            {selectedKeys.length > 0 ? (
              <>
                <span className="text-xs text-muted-foreground">
                  {t("matching.review.recordsSelected", { count: selectedKeys.length })}
                </span>
                <button
                  type="button"
                  onClick={() => onDecideGroup(group, "accept_match", "selected")}
                  disabled={!canDecide || !canAcceptGroup || Boolean(groupPending)}
                  className="cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {groupPending === "accept_match"
                    ? t("common.loading")
                    : t("matching.review.applySelectedAccept")}
                </button>
                <button
                  type="button"
                  onClick={() => onDecideGroup(group, "reject_match", "selected")}
                  disabled={!canDecide || !canAcceptGroup || Boolean(groupPending)}
                  className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {groupPending === "reject_match"
                    ? t("common.loading")
                    : t("matching.review.applySelectedReject")}
                </button>
                <button
                  type="button"
                  onClick={() => onDecideGroup(group, "mark_unmatched", "selected")}
                  disabled={!canDecide || Boolean(groupPending)}
                  className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {groupPending === "mark_unmatched"
                    ? t("common.loading")
                    : t("matching.review.applySelectedUnmatched")}
                </button>
                <button
                  type="button"
                  onClick={() => onReplaceSelectedKeys(group.id, [])}
                  className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px"
                >
                  {t("matching.review.clearSelection")}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="sticky top-0 z-10 bg-secondary/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={!canDecide || allSelectableKeys.length === 0 || Boolean(groupPending)}
                    aria-label={t("matching.review.selectAll")}
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">{t("matching.review.input")}</th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("matching.review.reference")}
                </th>
                <th className="w-28 px-3 py-2 text-right font-medium">
                  {t("matching.review.similarity")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("matching.review.differenceSummary")}
                </th>
                <th className="w-44 px-3 py-2 text-left font-medium">
                  {t("matching.review.decisionStatus")}
                </th>
                <th className="w-[320px] px-3 py-2 text-right font-medium">{t("common.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pagedGroupItems.map((item) => {
                const candidate = item.candidates[0] ?? null;
                const summary = buildIdentitySummary(item, candidate, identityMappings);
                const inputIdentity = candidate
                  ? buildSideIdentity(summary, "input")
                  : buildRecordIdentity(item.input_record, "input", identityMappings);
                const referenceIdentity = candidate?.reference_record_key
                  ? buildSideIdentity(summary, "reference")
                  : null;
                const rowPending = pendingRecords[item.input_record_key];
                const rowCanAccept = Boolean(candidate?.reference_record_key);

                return (
                  <tr key={item.input_record_key} className="align-top hover:bg-secondary/20">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(item.input_record_key)}
                        disabled={!canDecide || Boolean(rowPending) || Boolean(groupPending)}
                        onChange={() => onToggleKey(group, item.input_record_key)}
                        aria-label={t("matching.review.selectRecord")}
                      />
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <p className="truncate font-medium">{inputIdentity.headline}</p>
                      <p className="truncate text-xs text-muted-foreground">{inputIdentity.meta}</p>
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <p className="truncate font-medium">
                        {referenceIdentity?.headline ?? t("matching.review.noCandidate")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {referenceIdentity?.meta ?? t("matching.review.noCandidateDesc")}
                      </p>
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-semibold tabular-nums ${scoreTone(candidate?.score ?? 0)}`}
                    >
                      {candidate ? `${candidate.score}%` : "-"}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs text-muted-foreground">
                        {buildDifferenceSummary(candidate?.field_scores ?? [], t)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={statusBadgeClass(
                          item.status_code ?? item.display_status ?? item.status,
                        )}
                      >
                        {reviewStatusLabel(
                          item.status_code ?? item.display_status ?? item.status,
                          t,
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDecideRecord(item, "accept_match", candidate)}
                          disabled={!rowCanAccept || Boolean(rowPending)}
                          className="cursor-pointer rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {rowPending === "accept_match"
                            ? t("common.loading")
                            : t("matching.review.accept")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDecideRecord(item, "reject_match", candidate)}
                          disabled={!rowCanAccept || Boolean(rowPending)}
                          className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {rowPending === "reject_match"
                            ? t("common.loading")
                            : t("matching.review.reject")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDecideRecord(item, "mark_unmatched", null)}
                          disabled={Boolean(rowPending)}
                          className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {rowPending === "mark_unmatched"
                            ? t("common.loading")
                            : t("matching.review.markUnmatched")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenRecord(item, candidate?.id ?? null)}
                          className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary active:translate-y-px"
                        >
                          {t("matching.review.reviewDetail")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          currentPage={page}
          pageSize={pageSize}
          totalItems={groupItems.length}
          onPageChange={setPage}
          onPageSizeChange={(newPageSize) => {
            setPageSize(newPageSize);
            setPage(1);
          }}
          pageSizeOptions={[10, 25, 50]}
        />
      </div>

      <DecisionHistory history={group.decision_history ?? []} />
    </div>
  );
}

function RecordIdentityPanel({
  emptyText,
  identity,
  title,
}: {
  emptyText?: string;
  identity: ReturnType<typeof buildSideIdentity>;
  title: string;
}) {
  const { t } = usePreferences();
  const entries = identity.fields.slice(0, 6);

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      {identity.headline === "-" && entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{emptyText ?? "-"}</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold">{identity.headline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{identity.meta}</p>
          <dl className="mt-3 space-y-1.5">
            {entries.map((field) => (
              <div
                key={`${field.semantic}-${field.column ?? field.label}`}
                className="grid grid-cols-[120px_1fr] gap-2 text-xs"
              >
                <dt className="truncate text-muted-foreground">
                  {identityFieldLabel(field.semantic, field.label, t)}
                </dt>
                <dd className="break-words font-medium">{field.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

function mergeReviewSnapshot(
  current: ReviewResults | null,
  next: ReviewResults,
  affectedKeys: string[],
  caseGroupId?: string | null,
) {
  if (!current) return next;
  if (affectedKeys.length === 0 && !caseGroupId) return next;

  const affectedKeySet = new Set(affectedKeys);

  return {
    ...current,
    summary: next.summary,
    job: next.job,
    items: current.items.map((item) =>
      affectedKeySet.has(item.input_record_key)
        ? (next.items.find((nextItem) => nextItem.input_record_key === item.input_record_key) ??
          item)
        : item,
    ),
    case_groups: current.case_groups.map((group) => {
      if (caseGroupId && group.id === caseGroupId) {
        return next.case_groups.find((nextGroup) => nextGroup.id === group.id) ?? group;
      }

      if (affectedKeys.some((key) => group.item_keys.includes(key))) {
        return next.case_groups.find((nextGroup) => nextGroup.id === group.id) ?? group;
      }

      return group;
    }),
  };
}

function findDecisionGroupId(review: ReviewResults | null, decisionId: string) {
  if (!review) return null;

  return (
    review.case_groups.find((group) =>
      (group.decision_history ?? []).some((decision) => decision.id === decisionId),
    )?.id ?? null
  );
}

function identityFieldLabel(
  semantic: IdentitySemantic,
  fallback: string,
  t: ReturnType<typeof usePreferences>["t"],
) {
  switch (semantic) {
    case "name":
      return t("matching.review.name");
    case "strong_identifier":
      return t("matching.review.identifier");
    case "address":
      return t("matching.review.address");
    case "province":
      return t("results.identity.province");
    case "city":
      return t("results.identity.city");
    case "email":
      return t("results.identity.email");
    case "phone":
      return t("results.identity.phone");
    default:
      return fallback;
  }
}

function buildDifferenceSummary(
  scores: ReviewCandidate["field_scores"],
  t: ReturnType<typeof usePreferences>["t"],
) {
  const meaningful = sortFieldScores(scores)
    .filter((field) => field.comparison !== "same")
    .slice(0, 2)
    .map((field) => {
      const label = humanizeFieldLabel(field.input_column);
      return `${label}: ${comparisonLabel(field.comparison, t)}`;
    });

  if (meaningful.length > 0) return meaningful.join(" | ");
  if (scores.length > 0) return t("matching.review.same");
  return "-";
}

function humanizeFieldLabel(value: string) {
  return value
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRecordValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") return "-";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function scoreTone(score: number) {
  if (score >= 90) return "text-success";
  if (score >= 75) return "text-warning";
  return "text-muted-foreground";
}

function statusBadgeClass(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold";
  if (
    ["matched", "auto_matched", "manual_accepted", "AUTO_MATCHED", "MANUAL_ACCEPTED"].includes(
      status,
    )
  ) {
    return `${base} bg-success/10 text-success`;
  }
  if (
    ["possible_match", "need_review", "manual_rejected", "NEED_REVIEW", "MANUAL_REJECTED"].includes(
      status,
    )
  ) {
    return `${base} bg-warning/10 text-warning`;
  }
  if (["confirmed_unmatched", "CONFIRMED_UNMATCHED"].includes(status)) {
    return `${base} bg-destructive/10 text-destructive`;
  }
  return `${base} bg-secondary text-muted-foreground`;
}

function comparisonBadgeClass(comparison: string) {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold";
  if (comparison === "same") return `${base} bg-success/10 text-success`;
  if (comparison === "similar") return `${base} bg-warning/10 text-warning`;
  return `${base} bg-destructive/10 text-destructive`;
}

function reviewFilterLabel(filter: ReviewFilter, t: ReturnType<typeof usePreferences>["t"]) {
  if (filter === "all") return t("matching.review.allGroups");
  return reviewStatusLabel(filter, t);
}

function reviewStatusLabel(status: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (status === "NEED_REVIEW") return t("matching.review.statusNeedReview");
  if (status === "AUTO_MATCHED") return t("matching.review.statusAutoMatched");
  if (status === "MANUAL_ACCEPTED") return t("matching.review.statusManualAccepted");
  if (status === "MANUAL_REJECTED") return t("matching.review.statusManualRejected");
  if (status === "CONFIRMED_UNMATCHED") return t("matching.review.statusConfirmedUnmatched");
  if (status === "need_review") return t("matching.review.statusNeedReview");
  if (status === "auto_matched") return t("matching.review.statusAutoMatched");
  if (status === "manual_accepted") return t("matching.review.statusManualAccepted");
  if (status === "manual_rejected") return t("matching.review.statusManualRejected");
  if (status === "confirmed_unmatched") return t("matching.review.statusConfirmedUnmatched");
  if (status === "matched") return t("matching.review.statusAutoMatched");
  if (status === "possible_match") return t("matching.review.statusNeedReview");
  if (status === "unmatched") return t("matching.review.statusConfirmedUnmatched");
  return status;
}

function FieldComparison({
  field,
  inputRecord,
  referenceRecord,
}: {
  field: ReviewCandidate["field_scores"][number];
  inputRecord: Record<string, string | number | boolean | null>;
  referenceRecord: Record<string, string | number | boolean | null>;
}) {
  const { t } = usePreferences();

  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="truncate text-xs font-semibold">
          {field.reference_column} ↔ {field.input_column}
        </p>
        <span className={comparisonBadgeClass(field.comparison)}>
          {comparisonLabel(field.comparison, t)} · {Math.round(field.score)}%
        </span>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-2">
        <div className="rounded-md bg-secondary/40 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("matching.review.input")}
          </p>
          <p className="mt-1 break-words font-medium">
            {formatRecordValue(inputRecord[field.input_column])}
          </p>
        </div>
        <div className="rounded-md bg-secondary/40 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("matching.review.reference")}
          </p>
          <p className="mt-1 break-words font-medium">
            {formatRecordValue(referenceRecord[field.reference_column])}
          </p>
        </div>
      </div>
    </div>
  );
}

function DecisionHistory({ history }: { history: NonNullable<ReviewItem["decision_history"]> }) {
  const { t } = usePreferences();

  if (history.length === 0) return null;

  return (
    <details className="mt-5 rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-xs font-semibold">
        {t("matching.review.decisionHistory")}
      </summary>
      <div className="mt-3 space-y-2">
        {history.map((item) => (
          <div key={item.id} className="rounded-md bg-secondary/30 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{reviewDecisionLabel(item.decision, t)}</p>
              <span className="text-muted-foreground">{item.decided_at ?? item.created_at}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {t("matching.review.previousStatus")}:{" "}
              {reviewStatusLabel(item.previous_result_type ?? "-", t)} ·{" "}
              {t("matching.review.decisionSource")}: {decisionSourceLabel(item.source, t)} ·{" "}
              {t("matching.review.affectedRecords")}: {item.affected_records ?? 1}
            </p>
            <p className="mt-1 text-muted-foreground">
              {t("matching.review.reviewer")}: {item.reviewer ?? "-"}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function candidateScore(item: ReviewItem) {
  return item.candidates[0]?.score ?? 0;
}

function caseGroupFilterLabel(filter: CaseGroupFilter, t: ReturnType<typeof usePreferences>["t"]) {
  if (filter === "open") return t("matching.review.openGroups");
  if (filter === "resolved") return t("matching.review.resolvedGroups");
  return t("matching.review.allGroups");
}

function caseGroupStatusLabel(status: string, t: ReturnType<typeof usePreferences>["t"]) {
  return status === "resolved"
    ? t("matching.review.resolvedGroups")
    : t("matching.review.openGroups");
}

function caseGroupStatusClass(status: string) {
  const base = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
  return status === "resolved"
    ? `${base} bg-success/10 text-success`
    : `${base} bg-warning/10 text-warning`;
}

function reviewDecisionLabel(decision: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (decision === "accept_match" || decision === "select_candidate") {
    return t("matching.review.decisionAccepted");
  }
  if (decision === "reject_match") return t("matching.review.decisionRejected");
  if (decision === "mark_unmatched") return t("matching.review.decisionUnmatched");
  return decision;
}

function decisionSourceLabel(
  source: string | null | undefined,
  t: ReturnType<typeof usePreferences>["t"],
) {
  return source === "group"
    ? t("matching.review.sourceGroup")
    : t("matching.review.sourceIndividual");
}

function caseConfidenceLabel(confidence: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (confidence === "High") return t("matching.review.confidenceHigh");
  if (confidence === "Mixed") return t("matching.review.confidenceMixed");
  return t("matching.review.confidenceUnique");
}

function caseConfidenceClass(confidence: string) {
  if (confidence === "High") {
    return "rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success";
  }

  if (confidence === "Mixed") {
    return "rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning";
  }

  return "rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground";
}

function knowledgeLevelLabel(level: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (level === "KNOWN_PATTERN") return t("matching.review.knownPattern");
  if (level === "TRUSTED_PATTERN") return t("matching.review.trustedPattern");
  return t("matching.review.newPattern");
}

function knowledgeLevelClass(level: string) {
  const base = "rounded-full border px-2 py-0.5 text-[11px] font-semibold";

  if (level === "KNOWN_PATTERN") return `${base} border-brand/30 bg-brand/10 text-brand`;
  if (level === "TRUSTED_PATTERN") return `${base} border-success/30 bg-success/10 text-success`;

  return `${base} border-border bg-secondary text-muted-foreground`;
}

function comparisonLabel(comparison: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (comparison === "same") return t("matching.review.same");
  if (comparison === "similar") return t("matching.review.similar");
  return t("matching.review.different");
}

function normalizeSyncState(value: unknown): SyncState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as SyncState;
  return {
    ...state,
    confirmed: state.confirmed ?? Boolean(state.id || state.auditId),
    auditId: state.auditId ?? state.id,
    confirmedAt: state.confirmedAt ?? state.createdAt,
  };
}

function SyncMetric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 px-3 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <p
        className={`mt-1 tabular-nums ${strong ? "text-lg font-semibold" : "text-sm font-semibold"}`}
      >
        {value}
      </p>
    </div>
  );
}

function StepExport({
  jobId,
  canExecute,
  onExportHistoryChange,
}: {
  jobId: string | null;
  canExecute: boolean;
  onExportHistoryChange: Dispatch<SetStateAction<StoredExportHistoryEntry[]>>;
}) {
  const { t } = usePreferences();
  const [review, setReview] = useState<ReviewResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    setLoading(true);
    setError(null);
    fetchReviewResults(jobId)
      .then(setReview)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : t("matching.review.loadFailed")),
      )
      .finally(() => setLoading(false));
  }, [jobId, t]);

  return (
    <>
      <SectionTitle title={t("matching.export.title")} desc={t("matching.export.desc")} />

      {!jobId && (
        <EmptyState
          icon={FileSpreadsheet}
          title={t("matching.export.noRunTitle")}
          description={t("matching.export.noRunDesc")}
        />
      )}

      {jobId && loading && (
        <div className="rounded-lg border border-border bg-secondary/20 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-accent" />
            <p className="text-sm font-semibold">{t("matching.export.loading")}</p>
          </div>
        </div>
      )}

      {jobId && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-semibold">{t("feedback.error.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      {jobId && review && (
        <IntentExportPanel
          jobId={jobId}
          items={review.items}
          jobName={review.job.name}
          canExecute={canExecute}
          onExportHistoryChange={onExportHistoryChange}
        />
      )}
    </>
  );
}
