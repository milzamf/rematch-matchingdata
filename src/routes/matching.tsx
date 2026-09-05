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
import { ReviewDiagnosticCharts } from "@/components/review-diagnostic-charts";
import {
  DuplicateSummaryBanner,
  DuplicateRecordsDialog,
} from "@/components/duplicate-records-dialog";
import { IntentExportPanel } from "@/components/intent-export-panel";
import { DataPreviewTable } from "@/components/data-preview-table";
import { TablePagination } from "@/components/ui/table-pagination";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { standardizeColumnValue, parseEntityName } from "@/lib/data-normalizer";
import { ReviewRuleModal } from "@/components/review-rule-modal";
import { RecordComparisonModal } from "@/components/record-comparison-modal";
import {
  fetchAiMatchingConfiguration,
  fetchAiReviewAnalysis,
  fetchAiReviewRecommendation,
  fetchReviewKnowledge,
  ApiError,
  createWorkspace,
  fetchReviewResults,
  fetchMatchingJobStatus,
  fetchWorkspace,
  inspectDataset,
  runMatching,
  stopMatching,
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
  Building2,
  Sliders,
  SlidersHorizontal,
  Settings2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Search,
  RefreshCw,
  Split,
  BookmarkPlus,
  Activity,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { ExtractionModal } from "@/components/extraction-modal";

export const Route = createFileRoute("/matching")({
  validateSearch: validateWorkflowSearch,
  head: () => ({
    meta: [
      { title: "Matching Workflow - RE-MATCH" },
      {
        name: "description",
        content:
          "Step-by-step matching workflow: upload datasets, profile columns, configure rules, run, review, synchronize, and export results",
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
export type ColumnMappingDraft = {
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
  parent_input_column?: string;
  parent_reference_column?: string;
  transform?: "EXTRACT_CORE_NAME" | "EXTRACT_LEGAL_FORM" | "NONE" | string;
};
type Preset = "Default" | "Custom" | "Konstruksi";
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
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
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
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

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
  const validMappings = columnMappings?.filter(
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
      reference,
      input,
      columnMappings,
      matchingConfiguration,
      workspaceNameEdited,
      runState,
      progress,
      runResult,
      runError,
      syncState,
    ],
  );

  const referenceRef = useRef<UploadedFile | null>(reference);
  const inputRef = useRef<UploadedFile | null>(input);
  const workspaceMutexRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceNameRef = useRef(workspaceName);
  const workspaceNameEditedRef = useRef(workspaceNameEdited);
  const workspaceStatusRef = useRef(workspaceStatus);
  const activeStepRef = useRef(activeStep);

  useEffect(() => {
    referenceRef.current = reference;
  }, [reference]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    workspaceNameRef.current = workspaceName;
  }, [workspaceName]);

  useEffect(() => {
    workspaceNameEditedRef.current = workspaceNameEdited;
  }, [workspaceNameEdited]);

  useEffect(() => {
    workspaceStatusRef.current = workspaceStatus;
  }, [workspaceStatus]);

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  const pollMatchingJob = useCallback(
    (jobId: string, currentWorkspaceId: string | null) => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }

      const checkStatus = async () => {
        try {
          const statusResult = await fetchMatchingJobStatus(jobId);
          setRunResult(statusResult);

          const currentStatus = statusResult.job.status;
          const pct = statusResult.progress.percentage ?? 0;

          if (currentStatus === "completed" || pct >= 100) {
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
            }
            setProgress(100);
            setRunState("success");
            setStep(3);
            void navigate({
              to: "/matching",
              search: buildMatchingSearch(currentWorkspaceId, 3),
              replace: true,
            });
            return;
          }

          if (currentStatus === "cancelled" || currentStatus === "stopped") {
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
            }
            setProgress(0);
            setRunState("idle");
            return;
          }

          if (currentStatus === "failed") {
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
            }
            setProgress(0);
            setRunState("failed");
            setRunError(statusResult.job.error_message ?? t("matching.run.failedGeneric"));
            return;
          }

          if (currentStatus !== "processing" && currentStatus !== "queued") {
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
            }
            setRunState("idle");
            return;
          }

          // Job is still processing or queued
          setProgress(pct);
          setRunState("running");

          // Keep polling until the backend explicitly returns 'completed', 'cancelled', 'stopped', or 'failed'
          pollingTimeoutRef.current = setTimeout(checkStatus, 2000);
        } catch (error) {
          // On network errors, wait a bit longer and retry indefinitely
          pollingTimeoutRef.current = setTimeout(checkStatus, 3000);
        }
      };

      pollingTimeoutRef.current = setTimeout(checkStatus, 2000);
    },
    [navigate, t],
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
        const actualJobStatus = workspace.matching_job?.status ?? snapshot?.runResult?.job.status ?? null;
        
        let restoredRunState: RunState = "idle";
        if (actualJobStatus === "completed") {
          restoredRunState = "success";
        } else if (actualJobStatus === "failed") {
          restoredRunState = "failed";
        } else if (actualJobStatus === "cancelled" || actualJobStatus === "stopped") {
          restoredRunState = "idle";
        } else if (actualJobStatus === "processing" || actualJobStatus === "queued") {
          restoredRunState = (snapshot?.runState as RunState | undefined) === "running" ? "running" : "idle";
        } else {
          restoredRunState = (snapshot?.runState as RunState | undefined) ?? "idle";
        }

        const restoredSyncState = normalizeSyncState(
          (snapshot?.syncState as SyncState | null | undefined) ??
            (workspace.sync_state as SyncState | null | undefined) ??
            null,
        );
        const restoredProgress =
          actualJobStatus === "cancelled" || actualJobStatus === "stopped"
            ? 0
            : (snapshot?.progress ?? restoredRunResult?.progress.percentage ?? 0);
        const restoredRunError =
          actualJobStatus === "cancelled" || actualJobStatus === "stopped"
            ? null
            : (snapshot?.runError ?? restoredRunResult?.job.error_message ?? null);
        const restoredHasCompletedMapping =
          restoredMappings?.filter((mapping) => mapping.referenceColumnId && mapping.inputColumnId)
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

        if (
          restoredRunResult?.job.id &&
          (actualJobStatus === "processing" || actualJobStatus === "queued") &&
          restoredRunState === "running"
        ) {
          pollMatchingJob(restoredRunResult.job.id, workspace.id);
        }

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
      !canUpdateWorkspace ||
      runState === "running" ||
      reference?.status === "loading" ||
      input?.status === "loading"
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
    runState,
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

  const ensureWorkspace = (role: DatasetRole, result: DatasetInspectResult) => {
    const operation = async () => {
      const existingWorkspaceId = workspaceIdRef.current;
      const currentRef = role === "reference" ? result : referenceRef.current?.result;
      const currentInp = role === "input" ? result : inputRef.current?.result;
      const nextReferenceDatasetId = currentRef?.dataset?.id ?? null;
      const nextInputDatasetId = currentInp?.dataset?.id ?? null;

      try {
        if (existingWorkspaceId) {
          if (!canUpdateWorkspace) return;
          await updateWorkspace(existingWorkspaceId, {
            name: workspaceNameRef.current,
            status: workspaceStatusRef.current,
            referenceDatasetId: nextReferenceDatasetId,
            inputDatasetId: nextInputDatasetId,
            currentStep: activeStepRef.current,
          });
          setWorkspaceSaveState("saved");
          setWorkspaceError(null);
          return;
        }

        if (!canCreateMatching) return;
        setWorkspaceSaveState("saving");
        const nextName = workspaceNameEditedRef.current
          ? workspaceNameRef.current
          : buildWorkspaceName(
              role,
              result,
              referenceRef.current,
              inputRef.current,
              t("workspace.untitled"),
            );

        const workspace = await createWorkspace({
          name: nextName,
          status: "draft",
          currentStep: activeStepRef.current,
          referenceDatasetId: nextReferenceDatasetId,
          inputDatasetId: nextInputDatasetId,
        });

        workspaceIdRef.current = workspace.id;
        setWorkspaceId(workspace.id);
        setWorkspaceName(workspace.name);
        setWorkspaceSaveState("saved");
        setWorkspaceError(null);

        navigate({
          search: ((prev: Record<string, unknown>) => ({ ...prev, workspace: workspace.id })) as any,
          replace: true,
        });
      } catch (error) {
        setWorkspaceSaveState("error");
        setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.saveFailed"));
      }
    };

    workspaceMutexRef.current = workspaceMutexRef.current.then(operation, operation);
    return workspaceMutexRef.current;
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
      const inspectedRef = reference.result.columns ?? [];
      const inspectedInp = input.result.columns ?? [];

      const configuredFields = (matchingConfiguration?.fields ?? []).reduce<
        Record<string, { algorithm?: string; strict?: boolean }>
      >((acc, f) => {
        if (f.mappingId) acc[f.mappingId] = f;
        if (f.referenceColumnName && f.inputColumnName) {
          acc[`${f.referenceColumnName}|${f.inputColumnName}`] = f;
        }
        return acc;
      }, {});

      const result = await runMatching({
        workspaceId: workspaceId ?? undefined,
        name: `${reference.result.dataset.name} vs ${input.result.dataset.name}`,
        referenceDatasetId: reference.result.dataset.id,
        inputDatasetId: input.result.dataset.id,
        mappings: columnMappings
          .filter((mapping) => mapping.referenceColumnId && mapping.inputColumnId)
          .map((mapping) => {
            const parentRef = mapping.parent_reference_column;
            const parentInp = mapping.parent_input_column;
            const transform = mapping.transform;

            const configured =
              configuredFields[mapping.id] ||
              configuredFields[`${mapping.referenceColumnName}|${mapping.inputColumnName}`];
            const currentAlgorithm = configured?.algorithm || mapping.algorithm;

            return {
              id: mapping.id,
              referenceColumnId: mapping.referenceColumnId,
              inputColumnId: mapping.inputColumnId,
              referenceColumnName: mapping.referenceColumnName,
              inputColumnName: mapping.inputColumnName,
              algorithm: currentAlgorithm,
              required_match: mapping.required_match,
              parent_reference_column: parentRef,
              parent_input_column: parentInp,
              transform,
              metadata: {
                parent_reference_column: parentRef,
                parent_input_column: parentInp,
                transform,
                suggested: mapping.suggested,
                suggestion_source: mapping.suggestionSource,
                suggestion_score: mapping.suggestionScore,
              },
            };
          }),
        configuration: matchingConfiguration,
      });

      setRunResult(result);
      const initialStatus = result.job.status;

      if (initialStatus === "completed") {
        setProgress(100);
        setRunState("success");
        setStep(3);
        void navigate({
          to: "/matching",
          search: buildMatchingSearch(workspaceId, 3),
          replace: true,
        });
      } else if (initialStatus === "failed") {
        setProgress(0);
        setRunState("failed");
        setRunError(result.job.error_message ?? t("matching.run.failedGeneric"));
      } else {
        // "processing" | "queued"
        setProgress(result.progress.percentage || 0);
        setRunState("running");
        pollMatchingJob(result.job.id, workspaceId);
      }
    } catch (error) {
      setProgress(0);
      setRunState("failed");
      setRunError(error instanceof ApiError ? error.message : t("matching.run.failedGeneric"));
    }
  };

  const [isStopping, setIsStopping] = useState(false);

  const handleStopMatching = async () => {
    if (!runResult?.job?.id) return;
    
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    
    setIsCancelConfirmOpen(false);
    setRunState("idle");
    setProgress(0);
    
    const jobId = runResult.job.id;
    const cancelledRunResult: MatchingRunResult = {
      ...runResult,
      job: {
        ...runResult.job,
        status: "cancelled",
        error_message: "Matching stopped by user.",
      },
      progress: {
        ...runResult.progress,
        status: "cancelled",
        percentage: 0,
      },
    };
    setRunResult(cancelledRunResult);
    
    try {
      await stopMatching(jobId);
      if (workspaceId && canUpdateWorkspace) {
        void updateWorkspace(workspaceId, {
          status: "configuring",
          currentStep: 2,
          workflowState: {
            ...workspaceSnapshot,
            runState: "idle",
            progress: 0,
            runResult: cancelledRunResult,
          },
        });
      }
      toast.success("Proses matching berhasil dibatalkan");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Gagal menghentikan matching");
    }
  };

  const handleInspectFile = async (role: DatasetRole, file: File) => {
    if (!canCreateMatching) {
      toast.error(t("feedback.toast.accessDenied"));
      return;
    }

    const err = validateFile(file, t);

    if (err) {
      setUploadError(err);
      const errorState: UploadedFile = { name: file.name, size: file.size, status: "error", error: err };
      if (role === "reference") {
        referenceRef.current = errorState;
        setReference(errorState);
      } else {
        inputRef.current = errorState;
        setInput(errorState);
      }
      toast.error(t("feedback.toast.invalidFile"));
      return;
    }

    setUploadError(null);
    const loadingState: UploadedFile = { name: file.name, size: file.size, status: "loading" };
    if (role === "reference") {
      referenceRef.current = loadingState;
      setReference(loadingState);
    } else {
      inputRef.current = loadingState;
      setInput(loadingState);
    }

    try {
      const result = await inspectDataset({ file, datasetRole: role });
      const successState: UploadedFile = { name: file.name, size: file.size, status: "success", result };
      if (role === "reference") {
        referenceRef.current = successState;
        setReference(successState);
      } else {
        inputRef.current = successState;
        setInput(successState);
      }

      setColumnMappings([]);
      setMatchingConfiguration(null);
      setSyncState(null);

      await ensureWorkspace(role, result);
      toast.success(t("feedback.toast.uploaded", { name: file.name }));
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : t("matching.upload.inspectFailed");
      const failState: UploadedFile = { name: file.name, size: file.size, status: "error", error: message };
      if (role === "reference") {
        referenceRef.current = failState;
        setReference(failState);
      } else {
        inputRef.current = failState;
        setInput(failState);
      }
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

    const effectiveReference = inspectedReferenceColumns;
    const effectiveInput = inspectedInputColumns;
    const referenceIds = new Set(effectiveReference?.map((column) => column.id));
    const inputIds = new Set(effectiveInput?.map((column) => column.id));
    setColumnMappings((current) =>
      current?.filter(
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
                      if (referenceRef.current)
                        toast.info(t("feedback.toast.removed", { name: referenceRef.current.name }));
                      referenceRef.current = null;
                      setReference(null);
                    }}
                    onClearInput={() => {
                      if (inputRef.current) toast.info(t("feedback.toast.removed", { name: inputRef.current.name }));
                      inputRef.current = null;
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
                    workspaceId={workspaceId ?? undefined}
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
                      onStop={() => setIsCancelConfirmOpen(true)}
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
        <ConfirmationDialog
          open={isCancelConfirmOpen}
          setOpen={setIsCancelConfirmOpen}
          title="Batalkan Proses Matching?"
          description="Apakah Anda yakin ingin membatalkan proses matching ini? Progres data yang sudah selesai diproses akan tetap disimpan."
          cancelLabel="Lanjutkan Matching"
          actionLabel="Ya, Batalkan"
          onConfirm={handleStopMatching}
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

function hasDuplicateReference(mappings: { referenceColumnName: string }[]) {
  const references = mappings?.map((mapping) => mapping.referenceColumnName).filter(Boolean);
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
            {result.columns?.map((column) => (
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
                  {column.sample_values.length > 0 ? column.sample_values.join(", ") : "-"}
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
            datasetId={reference.dataset.id}
            title={t("matching.upload.reference")}
            subtitle={t("matching.preview.referenceSubtitle")}
            filename={reference.dataset.original_filename}
            columns={reference.columns?.map((c) => c.name)}
            rows={reference.preview_rows}
            totalRows={reference.dataset.row_count}
            badgeColor="brand"
            badgeText={t("matching.preview.referenceBadge")}
          />
        )}

        {input && (
          <DataPreviewTable
            datasetId={input.dataset.id}
            title={t("matching.upload.input")}
            subtitle={t("matching.preview.inputSubtitle")}
            filename={input.dataset.original_filename}
            columns={input.columns?.map((c) => c.name)}
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
  workspaceId,
  reference,
  input,
  mappings,
}: {
  workspaceId?: string;
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
      .map((m) => input.columns?.find((c) => c.id === m.inputColumnId))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const rawCols = mappedInputCols.length > 0 ? mappedInputCols : (input.columns ?? []);
    const seenColIds = new Set<string>();
    const columnsToUse = rawCols.filter((col) => {
      if (seenColIds.has(col.id)) return false;
      seenColIds.add(col.id);
      return true;
    });

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

    const rows = input.preview_rows?.map((rawRow) => {
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
      .map((m) => reference.columns?.find((c) => c.id === m.referenceColumnId))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const rawCols = mappedRefCols.length > 0 ? mappedRefCols : (reference.columns ?? []);
    const seenColIds = new Set<string>();
    const columnsToUse = rawCols.filter((col) => {
      if (seenColIds.has(col.id)) return false;
      seenColIds.add(col.id);
      return true;
    });

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

    const rows = reference.preview_rows?.map((rawRow) => {
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
          datasetId={input.dataset.id}
          workspaceId={workspaceId}
          role="input"
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
          datasetId={reference.dataset.id}
          workspaceId={workspaceId}
          role="reference"
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
  const effectiveReferenceColumns = referenceColumns;
  const effectiveInputColumns = inputColumns;
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);

  const handleExtraction = (config: any) => {
    const { extractLegalForm, extractCoreName, applyTo, refSourceId, inpSourceId } = config;

    const refColumn = effectiveReferenceColumns?.find(c => c.id === refSourceId);
    const inpColumn = effectiveInputColumns?.find(c => c.id === inpSourceId);

    const newMappings: ColumnMappingDraft[] = [];

    if (extractLegalForm) {
      newMappings.push({
        id: `virtual-legal-form-${Date.now()}`,
        referenceColumnId: applyTo === "input" ? "" : (refSourceId || ""),
        inputColumnId: applyTo === "reference" ? "" : (inpSourceId || ""),
        algorithm: "Exact",
        required_match: false,
        suggested: false,
        suggestionSource: "manual",
        suggestionScore: null,
        referenceColumnName: applyTo === "input" ? "" : "[Generated] Badan Usaha",
        inputColumnName: applyTo === "reference" ? "" : "[Generated] Badan Usaha",
        referenceDataType: "text",
        inputDataType: "text",
        transform: "EXTRACT_LEGAL_FORM",
        parent_reference_column: applyTo === "input" ? undefined : (refColumn?.name || ""),
        parent_input_column: applyTo === "reference" ? undefined : (inpColumn?.name || ""),
      });
    }

    if (extractCoreName) {
      newMappings.push({
        id: `virtual-core-name-${Date.now() + 1}`,
        referenceColumnId: applyTo === "input" ? "" : (refSourceId || ""),
        inputColumnId: applyTo === "reference" ? "" : (inpSourceId || ""),
        algorithm: "Fuzzy",
        required_match: false,
        suggested: false,
        suggestionSource: "manual",
        suggestionScore: null,
        referenceColumnName: applyTo === "input" ? "" : "[Generated] Nama Inti",
        inputColumnName: applyTo === "reference" ? "" : "[Generated] Nama Inti",
        referenceDataType: "text",
        inputDataType: "text",
        transform: "EXTRACT_CORE_NAME",
        parent_reference_column: applyTo === "input" ? undefined : (refColumn?.name || ""),
        parent_input_column: applyTo === "reference" ? undefined : (inpColumn?.name || ""),
      });
    }

    setMappings(current => [...current, ...newMappings]);
  };

  const usedReferenceIds = new Set(mappings?.map((mapping) => mapping.referenceColumnId));
  const hasColumns = effectiveReferenceColumns.length > 0 && effectiveInputColumns.length > 0;
  const hasAvailableReference = effectiveReferenceColumns.some((column) => !usedReferenceIds.has(column.id));
  const selectClass =
    "h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50";

  const updateMapping = (id: string, patch: Partial<ColumnMappingDraft>) => {
    setMappings((current) => {
      if (
        patch.referenceColumnId &&
        current.some(
          (mapping) => mapping.id !== id && mapping.referenceColumnId === patch.referenceColumnId && (!mapping.transform || mapping.transform === "NONE"),
        )
      ) {
        toast.error(t("matching.mapping.duplicateReference"));
        return current;
      }

      return current?.map((mapping) => {
        if (mapping.id !== id) return mapping;

        const next = { ...mapping, ...patch, suggested: false };
        const referenceColumn = effectiveReferenceColumns?.find(
          (column) => column.id === next.referenceColumnId,
        );
        const inputColumn = effectiveInputColumns?.find((column) => column.id === next.inputColumnId);

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
    setMappings((current) => current?.filter((mapping) => mapping.id !== id));
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

            {mappings?.map((mapping, index) => {
              const referenceColumn = effectiveReferenceColumns?.find(
                (column) => column.id === mapping.referenceColumnId,
              );
              const inputColumn = effectiveInputColumns?.find(
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
                    <SearchableSelect
                      aria-label={t("matching.mapping.inputSelect", { row: index + 1 })}
                      data-testid="mapping-input-select"
                      value={mapping.inputColumnId}
                      onChange={(value) =>
                        updateMapping(mapping.id, { inputColumnId: value })
                      }
                      options={[
                        { value: "", label: t("matching.mapping.noInputSelected") },
                        ...effectiveInputColumns.map((column) => ({
                          value: column.id,
                          label: column.name,
                          badge: <ColumnTypeBadge column={column} testId={`mapping-type-${column.id}`} />,
                        })),
                      ]}
                      placeholder={t("matching.mapping.noInputSelected")}
                      searchPlaceholder="Cari kolom input..."
                      disabled={Boolean(mapping.transform && mapping.transform !== "NONE")}
                    />
                    <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                      {inputColumn ? (
                        <>
                          <ColumnTypeBadge column={inputColumn} testId="mapping-input-type" />
                          {mapping.transform === "EXTRACT_LEGAL_FORM" && (
                            <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              [Extracted: Badan Usaha]
                            </span>
                          )}
                          {mapping.transform === "EXTRACT_CORE_NAME" && (
                            <span className="rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              [Extracted: Nama Inti]
                            </span>
                          )}
                        </>
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
                    <SearchableSelect
                      aria-label={t("matching.mapping.referenceSelect", { row: index + 1 })}
                      data-testid="mapping-reference-select"
                      value={mapping.referenceColumnId}
                      onChange={(value) =>
                        updateMapping(mapping.id, { referenceColumnId: value })
                      }
                      options={[
                        { value: "", label: t("matching.mapping.noReferenceSelected") },
                        ...effectiveReferenceColumns.map((column) => ({
                          value: column.id,
                          label: column.name,
                          badge: <ColumnTypeBadge column={column} testId={`mapping-type-${column.id}`} />,
                        })),
                      ]}
                      placeholder={t("matching.mapping.noReferenceSelected")}
                      searchPlaceholder="Cari kolom referensi..."
                      disabled={Boolean(mapping.transform && mapping.transform !== "NONE")}
                    />
                    <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                      {referenceColumn ? (
                        <>
                          <ColumnTypeBadge column={referenceColumn} testId="mapping-reference-type" />
                          {mapping.transform === "EXTRACT_LEGAL_FORM" && (
                            <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              [Extracted: Badan Usaha]
                            </span>
                          )}
                          {mapping.transform === "EXTRACT_CORE_NAME" && (
                            <span className="rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              [Extracted: Nama Inti]
                            </span>
                          )}
                        </>
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-xs font-semibold text-foreground hover:border-brand hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
              {t("matching.mapping.add")}
            </button>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-secondary/20 p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Split className="size-4.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Ekstraksi Bentuk Badan Usaha & Nama Inti</p>
                  <p className="text-[11px] text-muted-foreground">
                    Pemisahan bentuk badan usaha (PT, CV, UD) dan nama inti perusahaan untuk perbandingan nama yang lebih akurat
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExtractModalOpen(true)}
                disabled={!hasColumns}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs"
              >
                <span>Ekstrak Entitas</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ExtractionModal
        isOpen={isExtractModalOpen}
        onClose={() => setIsExtractModalOpen(false)}
        onConfirm={handleExtraction}
        referenceColumns={referenceColumns?.filter(c => !c.name.startsWith("[Generated]"))}
        inputColumns={inputColumns?.filter(c => !c.name.startsWith("[Generated]"))}
      />
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

  if (isIdentifierField(names) || isGenericIdentifierName(names)) {
    return {
      family: "Exact",
      algorithm: "Normalized Exact",
      normalization: "Automatic by field type",
      reason: "identifier",
      signal: 30 + completeness * 0.05,
    };
  }

  if (isEntityNameField(names) || names.includes("Nama Inti") || names.includes("Badan Usaha")) {
    return {
      family: "Character Similarity",
      algorithm: "Jaro-Winkler",
      normalization: "Automatic by field type",
      reason: "entity_name",
      signal: 40 + completeness * 0.05,
    };
  }

  if (isLocationField(names)) {
    return {
      family: "Exact",
      algorithm: "Normalized Exact",
      normalization: "Automatic by field type",
      reason: "location",
      signal: 15 + completeness * 0.05,
    };
  }

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
  const values = fields?.map((field) => ({
    ...field,
    raw: Math.max(0, source?.[field.id] ?? field.signal),
  }));
  const rawTotal = values.reduce((sum, field) => sum + field.raw, 0) || values.length;
  const weighted = values?.map((field) => ({
    ...field,
    exact: ((field.raw || 1) / rawTotal) * 100,
  }));
  const result = Object.fromEntries(weighted?.map((field) => [field.id, Math.floor(field.exact)]));
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
  const initialMode: "default" | "construction" | "custom" =
    configuration?.preset === "Konstruksi" || configuration?.mode === ("construction" as any)
      ? "construction"
      : configuration?.mode === "custom"
        ? "custom"
        : "default";
  const [mode, setMode] = useState<"default" | "construction" | "custom">(initialMode);
  const [showDetails, setShowDetails] = useState(false);
  const [autoMatchThreshold, setAutoMatchThreshold] = useState(
    configuration?.thresholds?.autoMatch ?? (initialMode === "construction" ? 90 : 90),
  );
  const [reviewThreshold, setReviewThreshold] = useState(
    configuration?.thresholds?.review ?? (initialMode === "construction" ? 80 : 75),
  );
  const [verificationEnabled, setVerificationEnabled] = useState(
    configuration?.rules?.verificationEnabled ?? true,
  );
  const [verificationOrder, setVerificationOrder] = useState<string[]>(
    () => configuration?.rules?.verificationOrder?.map((step) => step.mappingId) ?? [],
  );
  const [enabledVerificationIds, setEnabledVerificationIds] = useState<Record<string, boolean>>(() => {
    const existingOrder = configuration?.rules?.verificationOrder ?? [];
    if (existingOrder.length > 0) {
      const enabledSet = new Set(existingOrder.map((step) => step.mappingId));
      return Object.fromEntries(
        (configuration?.fields ?? []).map((field) => [field.mappingId, enabledSet.has(field.mappingId)]),
      );
    }
    return {};
  });
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
  const similarityFields = useMemo(() => fields?.filter((field) => !field.strict), [fields]);
  const strictFields = useMemo(() => fields?.filter((field) => field.strict), [fields]);

  const toggleVerificationField = (mappingId: string) => {
    setEnabledVerificationIds((current) => ({
      ...current,
      [mappingId]: current[mappingId] === false ? true : false,
    }));
  };

  const activeVerificationFields = useMemo(
    () => verificationOrder.filter((id) => enabledVerificationIds[id] !== false),
    [verificationOrder, enabledVerificationIds],
  );

  const verificationSteps = useMemo(
    () =>
      activeVerificationFields
        .map((id, index) => {
          const field = fields?.find((item) => item.id === id);
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
    [activeVerificationFields, fields, methods, reviewThreshold, verificationThresholds],
  );

  useEffect(() => {
    setMethods((current) => {
      const next: typeof current = {};
      fields.forEach((field) => {
        const existing = current[field.id];
        const configField = configuration?.fields?.find((f) => f.mappingId === field.id);
        const configuredAlgo = configField?.algorithm;
        const configuredFamily = configField?.comparisonFamily ?? (configuredAlgo ? comparisonFamilyForAlgorithm(configuredAlgo, field.type) : undefined);
        const activeFamily = existing?.family ?? configuredFamily ?? field.family;
        const allowed = algorithmsForField(activeFamily, field.type);

        if (existing && allowed.includes(existing.algorithm)) {
          next[field.id] = existing;
        } else if (configuredAlgo && allowed.includes(configuredAlgo as ConfigureAlgorithm)) {
          next[field.id] = {
            family: activeFamily,
            algorithm: configuredAlgo as ConfigureAlgorithm,
            normalization: configField?.normalization ?? field.normalization,
          };
        } else {
          next[field.id] = {
            family: activeFamily,
            algorithm: allowed.includes(field.algorithm)
              ? field.algorithm
              : allowed[0],
            normalization: field.normalization,
          };
        }
      });
      return next;
    });
    setWeights((current) => {
      const usable = Object.fromEntries(
        similarityFields?.map((field) => [field.id, current[field.id]]),
      );
      const hasCompleteWeights = similarityFields.every((field) =>
        Number.isFinite(usable[field.id]),
      );
      return hasCompleteWeights ? usable : normalizeIntegerWeights(similarityFields, usable);
    });
  }, [fields, similarityFields]);

  useEffect(() => {
    setVerificationOrder((current) => {
      const fieldIds = fields?.map((field) => field.id);
      const currentValid = current?.filter((id) => fieldIds.includes(id));
      const missing = fieldIds?.filter((id) => !currentValid.includes(id));
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
    (autoMatchThreshold > reviewThreshold &&
      autoMatchThreshold <= 100 &&
      reviewThreshold >= 0) &&
    (!verificationEnabled || verificationSteps.length > 0);

  const configurationSnapshot = useMemo<MatchingConfiguration>(
    () => ({
      preset: mode === "construction" ? "Konstruksi" : mode === "default" ? "Default" : "Custom",
      mode: mode === "custom" ? "custom" : "default",
      strategy: "Hybrid",
      isValid: configValid,
      fields: fields?.map((field) => {
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
          : mode === "construction"
            ? { autoMatch: 90, review: 80, noMatch: 80 }
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
        fields: fields?.map((field) => {
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
      const next = [...current];
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
          mappings: fields?.map((field) => ({
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
        // Heuristic configuration suggestion generated from mapped dataset schema
        const recommended_fields = fields?.map((f) => {
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
        const normalized_fields = recommended_fields?.map((rf) => ({
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
              "Rekomendasi konfigurasi dihitung berdasarkan tipe data, nama kolom, dan profil dataset yang dipetakan",
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
    const active = matches?.filter(({ field }) => !field.strict);
    if (active.length === 0) {
      setAiError(t("matching.ai.configNoMatchingFields"));
      return;
    }
    setMode("custom");
    setWeights(
      normalizeIntegerWeights(
        similarityFields,
        Object.fromEntries(
          active?.map(({ field, suggestion }) => [
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

  const applyPreset = (presetKey: "default" | "construction" | "custom") => {
    setMode(presetKey);

    if (presetKey === "default") {
      setAutoMatchThreshold(90);
      setReviewThreshold(75);
      setVerificationEnabled(true);
      setWeights(normalizeIntegerWeights(similarityFields, {}));
      toast.success("Preset Standar aktif: Ambang Auto-Match 90%, Reviu 75%");
    } else if (presetKey === "construction") {
      setAutoMatchThreshold(90);
      setReviewThreshold(80);
      setVerificationEnabled(true);

      const newWeights: Record<string, number> = {};
      const newThresholds: Record<string, number> = {};
      const newOrder: string[] = [];

      // Categorize fields specifically for construction
      const legalFormFields = fields.filter((f) => {
        const names = `${f.reference} ${f.input} ${f.label}`.toLowerCase();
        return names.includes("badan") || names.includes("bentuk") || names.includes("legal");
      });
      const locationFields = fields.filter((f) => {
        const names = `${f.reference} ${f.input} ${f.label}`.toLowerCase();
        return (
          !legalFormFields.includes(f) &&
          (isLocationField(names) || names.includes("kab") || names.includes("kota") || names.includes("wilayah"))
        );
      });
      const addressFields = fields.filter((f) => {
        const names = `${f.reference} ${f.input} ${f.label}`.toLowerCase();
        return (
          !legalFormFields.includes(f) &&
          !locationFields.includes(f) &&
          (names.includes("alamat") || names.includes("address") || names.includes("jalan"))
        );
      });
      const coreNameFields = fields.filter((f) => {
        const names = `${f.reference} ${f.input} ${f.label}`.toLowerCase();
        return (
          !legalFormFields.includes(f) &&
          !locationFields.includes(f) &&
          !addressFields.includes(f) &&
          (isEntityNameField(names) ||
            names.includes("nama") ||
            names.includes("perusahaan") ||
            names.includes("vendor") ||
            names.includes("penyedia") ||
            names.includes("inti"))
        );
      });
      const otherFields = fields.filter(
        (f) =>
          !legalFormFields.includes(f) &&
          !locationFields.includes(f) &&
          !addressFields.includes(f) &&
          !coreNameFields.includes(f),
      );

      setMethods((current) => {
        const next = { ...current };
        coreNameFields.forEach((f) => {
          next[f.id] = { family: "Character Similarity", algorithm: "Jaro-Winkler", normalization: f.normalization };
        });
        addressFields.forEach((f) => {
          next[f.id] = { family: "Character Similarity", algorithm: "Levenshtein", normalization: f.normalization };
        });
        legalFormFields.forEach((f) => {
          next[f.id] = { family: "Exact", algorithm: "Exact", normalization: f.normalization };
        });
        locationFields.forEach((f) => {
          next[f.id] = { family: "Exact", algorithm: "Exact", normalization: f.normalization };
        });
        return next;
      });

      similarityFields.forEach((f) => {
        if (coreNameFields.some((item) => item.id === f.id)) {
          newWeights[f.id] = 55;
        } else if (addressFields.some((item) => item.id === f.id)) {
          newWeights[f.id] = 30;
        } else if (legalFormFields.some((item) => item.id === f.id)) {
          newWeights[f.id] = 10;
        } else if (locationFields.some((item) => item.id === f.id)) {
          newWeights[f.id] = 5;
        } else {
          newWeights[f.id] = 5;
        }
      });
      setWeights(normalizeIntegerWeights(similarityFields, newWeights));

      fields.forEach((f) => {
        if (locationFields.some((item) => item.id === f.id)) {
          newThresholds[f.id] = 100;
        } else if (legalFormFields.some((item) => item.id === f.id)) {
          newThresholds[f.id] = 100;
        } else if (coreNameFields.some((item) => item.id === f.id)) {
          newThresholds[f.id] = 90;
        } else if (addressFields.some((item) => item.id === f.id)) {
          newThresholds[f.id] = 90;
        } else {
          newThresholds[f.id] = f.strict ? 100 : 80;
        }
      });
      setVerificationThresholds(newThresholds);

      [...locationFields, ...legalFormFields, ...coreNameFields, ...addressFields, ...otherFields].forEach((f) => {
        if (!newOrder.includes(f.id)) newOrder.push(f.id);
      });
      setVerificationOrder(newOrder);

      toast.success("Preset Konstruksi aktif: Nama Inti 55%, Alamat 30%, Badan Usaha 10%, Kode Kab 5%");
    } else if (presetKey === "custom") {
      toast.info("Mode Kustom Penuh aktif: Silakan sesuaikan parameter");
    }
  };

  return (
    <>
      <SectionTitle title={t("matching.config.title")} desc={t("matching.configV2.desc")} />

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => applyPreset("default")}
          className={`relative flex flex-col rounded-lg border p-3.5 text-left transition-all cursor-pointer ${
            mode === "default"
              ? "border-brand bg-brand/5 ring-2 ring-brand/20 shadow-xs"
              : "border-border bg-card hover:border-foreground/30 hover:bg-secondary/20"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex size-8 items-center justify-center rounded-md ${
                  mode === "default" ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground"
                }`}
              >
                <Sliders className="size-4" />
              </div>
              <p className="text-xs font-bold text-foreground">Standar (Default)</p>
            </div>
            {mode === "default" && <CheckCircle2 className="size-4 text-brand" />}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Konfigurasi umum seimbang. Ambang auto-match 90%, review 75%, pembobotan proporsional
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              Ambang 90% / 75%
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              Bobot Proporsional
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => applyPreset("construction")}
          className={`relative flex flex-col rounded-lg border p-3.5 text-left transition-all cursor-pointer ${
            mode === "construction"
              ? "border-brand bg-brand/5 ring-2 ring-brand/20 shadow-xs"
              : "border-border bg-card hover:border-foreground/30 hover:bg-secondary/20"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex size-8 items-center justify-center rounded-md ${
                  mode === "construction" ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground"
                }`}
              >
                <Building2 className="size-4" />
              </div>
              <p className="text-xs font-bold text-foreground">Konstruksi</p>
            </div>
            {mode === "construction" && <CheckCircle2 className="size-4 text-brand" />}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            WLS: Nama Inti 55%, Alamat 30%, Badan Usaha 10%, Kode Kab 5%. Ambang 90% / 80%
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
              Nama 55% • Alamat 30%
            </span>
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
              Badan 10% • Kab 5%
            </span>
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
              Ambang 90% / 80%
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => applyPreset("custom")}
          className={`relative flex flex-col rounded-lg border p-3.5 text-left transition-all cursor-pointer ${
            mode === "custom"
              ? "border-brand bg-brand/5 ring-2 ring-brand/20 shadow-xs"
              : "border-border bg-card hover:border-foreground/30 hover:bg-secondary/20"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex size-8 items-center justify-center rounded-md ${
                  mode === "custom" ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground"
                }`}
              >
                <Settings2 className="size-4" />
              </div>
              <p className="text-xs font-bold text-foreground">Kustom Penuh</p>
            </div>
            {mode === "custom" && <CheckCircle2 className="size-4 text-brand" />}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Sesuaikan seluruh bobot variabel, ambang batas auto-match/reviu, dan algoritma secara bebas
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              Parameter Manual
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              Multi-Algoritma
            </span>
          </div>
        </button>
      </div>

      <div className="mt-5 space-y-5">
        <div className="rounded-lg border border-border bg-secondary/20 px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold">{t("matching.configV2.strictFields")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {strictFields.length > 0
                  ? strictFields?.map((field) => field.label).join(", ")
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
            {fields?.map((field) => (
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
                    {fields?.map((field) => {
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
                {similarityFields?.map((field) => {
                  const method = methods[field.id] ?? field;
                  return (
                    <div
                      key={field.id}
                      className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-center"
                    >
                      <p className="text-sm font-medium">{field.label}</p>
                      <SearchableSelect
                        value={method.family}
                        onChange={(val) =>
                          changeFamily(field, val as ComparisonFamily)
                        }
                        options={(["Exact", "Character Similarity", "Token Similarity"] as ComparisonFamily[]).map(
                          (family) => ({
                            value: family,
                            label: comparisonFamilyLabel(family, t),
                          }),
                        )}
                        searchPlaceholder="Cari famili algoritma..."
                        className="h-9 text-xs"
                      />
                      <SearchableSelect
                        value={method.algorithm}
                        onChange={(val) =>
                          setMethods((current) => ({
                            ...current,
                            [field.id]: {
                              ...method,
                              algorithm: val as ConfigureAlgorithm,
                            },
                          }))
                        }
                        options={algorithmsForField(method.family, field.type).map((algorithm) => ({
                          value: algorithm,
                          label: algorithm === "Exact" ? "Raw Exact" : algorithm,
                        }))}
                        searchPlaceholder="Cari metode algoritma..."
                        className="h-9 text-xs"
                      />
                    </div>
                  );
                })}
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
                  label={t("matching.configV2.unmatched" as any)}
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
                        <th className="w-36 px-3 py-2 font-semibold">
                          {t("matching.configV2.status")}
                        </th>
                        <th className="w-20 px-3 py-2 font-semibold">
                          {t("matching.configV2.order")}
                        </th>
                        <th className="px-3 py-2 font-semibold">{t("matching.configV2.field")}</th>
                        <th className="px-3 py-2 font-semibold">{t("matching.configV2.method")}</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          {t("matching.configV2.threshold")}
                        </th>
                        <th className="w-28 px-3 py-2 text-right font-semibold">{t("common.action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {verificationOrder?.map((mappingId, index) => {
                        const field = fields?.find((item) => item.id === mappingId);
                        if (!field) return null;
                        const isEnabled = enabledVerificationIds[mappingId] !== false;
                        const activeIndex = activeVerificationFields.indexOf(mappingId);
                        const orderNumber = isEnabled && activeIndex >= 0 ? activeIndex + 1 : null;
                        const isDragging = draggedIndex === index;
                        const isDragOver = dragOverIndex === index;
                        const method: ConfigureAlgorithm = field.strict
                          ? "Exact"
                          : (methods[field.id]?.algorithm ?? field.algorithm);
                        const threshold = field.strict
                          ? 100
                          : (verificationThresholds[field.id] ?? reviewThreshold);

                        return (
                          <tr
                            key={mappingId}
                            draggable={isEnabled}
                            onDragStart={(e) => {
                              if (!isEnabled) return;
                              e.dataTransfer.setData("text/plain", String(index));
                              e.dataTransfer.effectAllowed = "move";
                              setDraggedIndex(index);
                            }}
                            onDragOver={(e) => {
                              if (!isEnabled) return;
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
                              if (!isEnabled) return;
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
                              !isEnabled
                                ? "bg-muted/10 text-muted-foreground opacity-60"
                                : isDragging
                                  ? "bg-secondary/40 opacity-50"
                                  : isDragOver
                                    ? "border-t-2 border-brand bg-brand/10"
                                    : "hover:bg-secondary/20"
                            }`}
                          >
                            <td className="px-3 py-2">
                              <label className="inline-flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() => toggleVerificationField(mappingId)}
                                  className="size-4 rounded border-border accent-brand"
                                />
                                <span
                                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                    isEnabled
                                      ? "bg-brand/10 text-brand dark:bg-brand/20"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {isEnabled
                                    ? t("matching.configV2.includeRule")
                                    : t("matching.configV2.skipRule")}
                                </span>
                              </label>
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {isEnabled ? (
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-flex cursor-grab items-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical className="size-3.5" />
                                  </span>
                                  <span className="font-semibold">{orderNumber}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-medium">
                              <span className={!isEnabled ? "text-muted-foreground" : ""}>
                                {field.label}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {field?.strict ? t("matching.mapping.strict") : method}
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
                                    disabled={!isEnabled}
                                    value={threshold}
                                    onChange={(event) =>
                                      setVerificationThresholds((current) => ({
                                        ...current,
                                        [field.id]: Math.max(
                                          0,
                                          Math.min(100, Number(event.target.value) || 0),
                                        ),
                                      }))
                                    }
                                    className="h-8 w-16 rounded-md border border-border bg-background px-2 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
                                  />
                                  <span>%</span>
                                </label>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => moveVerificationStep(mappingId, -1)}
                                  disabled={!isEnabled || index === 0}
                                  className="inline-flex size-7 items-center justify-center rounded border border-border bg-background text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
                                  aria-label={t("matching.configV2.moveUp")}
                                  title={t("matching.configV2.moveUp")}
                                >
                                  <ChevronUp className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveVerificationStep(mappingId, 1)}
                                  disabled={!isEnabled || index === verificationOrder.length - 1}
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
              <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-accent" />
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
                    {aiSuggestion.data.recommended_fields?.map((field, index) => (
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
    mappedFields?.find((field) => field.id === fieldName) ??
    mappedFields?.find((field) => field.label.toLowerCase() === fieldName) ??
    mappedFields?.find((field) => field.reference.toLowerCase() === fieldName) ??
    mappedFields?.find((field) => field.input.toLowerCase() === fieldName) ??
    mappedFields?.find(
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
          {items?.map((item, index) => (
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
  onStop,
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
  onStop?: () => void;
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
          <div className="flex justify-between items-center mt-2">
            <div className="flex items-center gap-3">
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="text-xs font-medium text-destructive hover:text-destructive/80"
                >
                  Batalkan Matching
                </button>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono hidden sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                  <Activity className="w-3 h-3 text-emerald-500"/>
                  Engine: Meilisearch MultiSearch Active (Batch Mode)
                </span>
              </div>
            </div>
            {result?.progress?.total ? (
              <p className="text-xs text-muted-foreground tabular-nums text-right">
                {result.progress.processed.toLocaleString()} / {result.progress.total.toLocaleString()} data diproses
              </p>
            ) : <div />}
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
            {(result.summary.total_duplicates ?? 0) > 0 && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                +{result.summary.total_duplicates?.toLocaleString()} duplikat diabaikan
              </p>
            )}
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
  const strictFields = configuration?.fields?.filter((field) => field.strict) ?? [];
  const similarityFields = configuration?.fields?.filter((field) => !field.strict) ?? [];
  const configuredWeights = new Map(
    configuration?.weighting.fields?.map((field) => [field.mappingId, field.weight]) ?? [],
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
          <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
          {result?.progress?.total ? (
            <p className="text-xs text-muted-foreground tabular-nums text-right mt-2">
              {result.progress.processed.toLocaleString()} / {result.progress.total.toLocaleString()} data diproses
            </p>
          ) : null}
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
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [reviewRuleModalOpen, setReviewRuleModalOpen] = useState(false);
  const [reviewRuleModalInitial, setReviewRuleModalInitial] = useState<{
    name?: string;
    description?: string;
    conditions?: any[];
    action_recommendation?: "accept" | "reject" | "manual";
  } | null>(null);
  const [ruleTabFilter, setRuleTabFilter] = useState<"all" | "system" | "custom" | "dynamic">("all");
  const [selectedSystemPresetNumber, setSelectedSystemPresetNumber] = useState<number | null>(null);
  const [selectedAllRecordKeys, setSelectedAllRecordKeys] = useState<string[]>([]);
  const [isBulkDecidingAllRecords, setIsBulkDecidingAllRecords] = useState<string | null>(null);
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
  const systemPresets = review?.system_presets ?? [];
  const customRules = review?.custom_rules ?? [];
  const dynamicPatterns = review?.dynamic_patterns ?? [];

  const visibleCaseGroups = caseGroups?.filter((group) => {
    if (caseGroupFilter !== "all" && (group.status ?? "open") !== caseGroupFilter) return false;

    if (ruleTabFilter === "system") {
      if (group.rule_type !== "system_preset") return false;
      if (selectedSystemPresetNumber !== null && group.preset_number !== selectedSystemPresetNumber) {
        return false;
      }
    } else if (ruleTabFilter === "custom") {
      if (group.rule_type !== "custom_rule") return false;
    } else if (ruleTabFilter === "dynamic") {
      if (group.rule_type !== "dynamic_fallback") return false;
    }

    if (!query) return true;
    const haystack = JSON.stringify([
      group.label,
      group.pattern,
      group.reason,
      group.description,
      group.confidence,
      group.representative?.input_record,
      group.representative?.candidates?.[0]?.reference_record,
    ]).toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const ruleCounts = {
    all: caseGroups.reduce((acc, g) => acc + (g.item_count ?? 0), 0),
    system: systemPresets.reduce((acc, g) => acc + (g.item_count ?? 0), 0),
    custom: customRules.reduce((acc, g) => acc + (g.item_count ?? 0), 0),
    dynamic: dynamicPatterns.reduce((acc, g) => acc + (g.item_count ?? 0), 0),
  };

  const handlePromoteRule = useCallback((group: ReviewCaseGroup) => {
    const candidate = group.representative?.candidates?.[0];
    const diffCols = (group.conditions?.different_fields as string[]) ?? [];
    const targetField = diffCols[0] ?? "alamat";
    setReviewRuleModalInitial({
      name: `Aturan: ${group.label.replace(/^Pola Dinamis:\s*/i, "")}`,
      description: group.reason ?? "Aturan kustom yang dipromosikan dari klaster pola dinamis.",
      conditions: [
        {
          source: "input",
          field: targetField,
          operator: "is_not_empty",
        },
      ],
      action_recommendation: "manual",
    });
    setReviewRuleModalOpen(true);
  }, []);

  const handleOpenAddRuleModal = useCallback(() => {
    setReviewRuleModalInitial(null);
    setReviewRuleModalOpen(true);
  }, []);

  const handleRuleSaved = useCallback(
    (newRule: any) => {
      toast.success(`Aturan review "${newRule.name}" berhasil disimpan.`);
      if (jobId) {
        fetchReviewResults(jobId).then((data) => setReview(data));
      }
    },
    [jobId],
  );

  const caseGroupCounts = {
    open: caseGroups?.filter((group) => (group.status ?? "open") === "open").length,
    resolved: caseGroups?.filter((group) => group.status === "resolved").length,
    all: caseGroups.length,
  };
  const selectedCaseGroup =
    (selectedGroupId ? caseGroups?.find((group) => group.id === selectedGroupId) : null) ?? null;
  const filtered = items
    .filter((item) => filter === "all" || item.status === filter)
    .filter((item) => {
      if (!query) return true;
      const haystack = JSON.stringify([
        item.input_record_key,
        item.status,
        item.input_record,
        item.candidates?.map((candidate) => candidate.reference_record),
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
  const activeReviewItems = useMemo(() => {
    if (viewMode === "case_groups" && selectedCaseGroup) {
      const keysSet = new Set(selectedCaseGroup.item_keys ?? []);
      return items.filter((item) => keysSet.has(item.input_record_key));
    }
    return filtered;
  }, [viewMode, selectedCaseGroup, items, filtered]);
  const selectedCandidate =
    selected?.candidates?.find((candidate) => candidate.id === selectedCandidateId) ??
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
      item.candidates?.find((entry) => entry.id === candidateId) ?? item.candidates[0] ?? null;
    setSelected(item);
    setSelectedCandidateId(candidate?.id ?? null);
  }, []);

  const toggleSelectedGroupKey = (group: ReviewCaseGroup, key: string) => {
    setSelectedGroupKeys((current) => {
      const selectedKeys = current[group.id] ?? [];
      const nextKeys = selectedKeys.includes(key)
        ? selectedKeys?.filter((item) => item !== key)
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

  const toggleAllRecordKey = useCallback((key: string) => {
    setSelectedAllRecordKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const toggleSelectAllAllRecords = useCallback(() => {
    const pagedKeys = paged.map((i) => i.input_record_key);
    const allPagedSelected =
      pagedKeys.length > 0 && pagedKeys.every((k) => selectedAllRecordKeys.includes(k));
    if (allPagedSelected) {
      setSelectedAllRecordKeys((prev) => prev.filter((k) => !pagedKeys.includes(k)));
    } else {
      setSelectedAllRecordKeys((prev) => Array.from(new Set([...prev, ...pagedKeys])));
    }
  }, [paged, selectedAllRecordKeys]);

  const decideBulkAllRecords = async (decision: "accept_match" | "mark_unmatched") => {
    if (!jobId || selectedAllRecordKeys.length === 0) return;
    setIsBulkDecidingAllRecords(decision);
    try {
      const next = await saveReviewDecision(jobId, {
        inputRecordKey: selectedAllRecordKeys[0],
        inputRecordKeys: selectedAllRecordKeys,
        decision,
        scope: "selected",
      });
      setReview((current) =>
        mergeReviewSnapshot(current, next.review, selectedAllRecordKeys, null),
      );
      setSelectedAllRecordKeys([]);
      toast.success(
        decision === "accept_match"
          ? `${selectedAllRecordKeys.length} record berhasil disetujui (Accept Match)`
          : `${selectedAllRecordKeys.length} record berhasil ditandai Unmatched`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setIsBulkDecidingAllRecords(null);
    }
  };

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
      const updated = next.review.items?.find(
        (nextItem) => nextItem.input_record_key === item.input_record_key,
      );
      if (updated) {
        setSelected((current) => {
          if (!current || current.input_record_key !== item.input_record_key) return current;
          return updated;
        });
        if (candidate?.id) {
          const matchedCandidate = updated.candidates?.find((entry) => entry.id === candidate.id);
          setSelectedCandidateId(matchedCandidate?.id ?? updated.candidates[0]?.id ?? null);
        } else {
          setSelectedCandidateId(updated.candidates[0]?.id ?? null);
        }
      }
      toast.success(
        decision === "accept_match" || decision === "select_candidate"
          ? t("feedback.toast.approved")
          : t("feedback.toast.unmatched"),
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

    if (scope === "group" && !group.eligible_for_bulk) {
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
          next.review.items?.find((item) => item.input_record_key === current.input_record_key) ??
          current
        );
      });
      // Auto-navigate back to open case groups view
      setSelectedGroupId(null);
      setCaseGroupFilter("open");
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
        const updated = next.items?.find(
          (nextItem) => nextItem.input_record_key === selectedInputKey,
        );
        setSelected((current) => {
          if (!current || current.input_record_key !== selectedInputKey) return current;
          return updated ?? null;
        });
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

  const totalRawInput = review?.summary?.total_raw_input ?? items.length;
  const totalUniqueInput = review?.summary?.total_unique_input ?? items.length;
  const totalDuplicates =
    review?.summary?.total_duplicates ?? Math.max(0, totalRawInput - totalUniqueInput);
  const duplicateDetails = review?.summary?.duplicate_details ?? [];

  return (
    <>
      <SectionTitle title={t("matching.review.title")} desc={t("matching.review.desc")} />

      {/* Deduplication Summary Banner */}
      {totalDuplicates > 0 && (
        <div className="mb-6">
          <DuplicateSummaryBanner
            totalRaw={totalRawInput}
            totalUnique={totalUniqueInput}
            totalDuplicates={totalDuplicates}
            duplicateDetails={duplicateDetails}
            onViewDetails={() => setShowDuplicateModal(true)}
          />
        </div>
      )}

      {/* Review Diagnostic Charts (Field Quality Summary & Pareto Breakdown) */}
      <div className="mb-6">
        <ReviewDiagnosticCharts
          items={items}
          columnMappings={columnMappings}
          thresholds={review?.job?.thresholds ?? review?.job?.configuration?.thresholds}
        />
      </div>

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
            tabCategory={ruleTabFilter}
            onTabCategoryChange={setRuleTabFilter}
            selectedPresetNumber={selectedSystemPresetNumber}
            onSelectPresetNumber={setSelectedSystemPresetNumber}
            systemPresets={systemPresets}
            customRules={customRules}
            dynamicPatterns={dynamicPatterns}
            ruleCounts={ruleCounts}
            onOpenAddRuleModal={handleOpenAddRuleModal}
            onPromoteRule={handlePromoteRule}
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
                        : items?.filter((item) => item.status === status).length}
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
            <div className="space-y-3">
              {selectedAllRecordKeys.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand/5 px-4 py-2.5 shadow-2xs animate-in fade-in-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">
                      {selectedAllRecordKeys.length} record dipilih
                    </span>
                    <span className="text-xs text-muted-foreground">
                      (untuk aksi keputusan kolektif)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decideBulkAllRecords("accept_match")}
                      disabled={Boolean(isBulkDecidingAllRecords)}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90 active:scale-95 transition-all disabled:opacity-50 shadow-2xs"
                    >
                      {isBulkDecidingAllRecords === "accept_match" ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Memproses...</span>
                        </span>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5" />
                          <span>Terima Match ({selectedAllRecordKeys.length})</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => decideBulkAllRecords("mark_unmatched")}
                      disabled={Boolean(isBulkDecidingAllRecords)}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-50 shadow-2xs"
                    >
                      {isBulkDecidingAllRecords === "mark_unmatched" ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Memproses...</span>
                        </span>
                      ) : (
                        <>
                          <XCircle className="size-3.5" />
                          <span>Tandai Unmatched ({selectedAllRecordKeys.length})</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAllRecordKeys([])}
                      className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[1120px] text-sm" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "44px" }} />
                      <col style={{ width: "310px" }} />
                      <col style={{ width: "310px" }} />
                      <col style={{ width: "100px" }} />
                      <col style={{ width: "140px" }} />
                      <col style={{ width: "90px" }} />
                      <col style={{ width: "210px" }} />
                    </colgroup>
                    <thead className="bg-secondary/60 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-11 px-3 py-2.5 text-left">
                          <input
                            type="checkbox"
                            checked={
                              paged.length > 0 &&
                              paged.every((i) => selectedAllRecordKeys.includes(i.input_record_key))
                            }
                            onChange={toggleSelectAllAllRecords}
                            disabled={!canDecide || paged.length === 0 || Boolean(isBulkDecidingAllRecords)}
                            aria-label="Pilih Semua di Halaman Ini"
                          />
                        </th>
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
                      {paged?.map((item) => {
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
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedAllRecordKeys.includes(item.input_record_key)}
                                disabled={!canDecide || Boolean(rowPending) || Boolean(isBulkDecidingAllRecords)}
                                onChange={() => toggleAllRecordKey(item.input_record_key)}
                                aria-label="Pilih Record"
                              />
                            </td>
                          <td className="px-4 py-3 min-w-0">
                            <IdentityCell identity={inputIdentity} />
                          </td>
                          <td className="px-4 py-3 min-w-0">
                            <IdentityCell
                              identity={referenceIdentity}
                              emptyHeadline={t("matching.review.noCandidate")}
                              emptyMeta={t("matching.review.noCandidateDesc")}
                            />
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
            </div>
          )}
        </>
      )}

      <RecordComparisonModal
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setSelectedCandidateId(null);
        }}
        item={selected}
        items={activeReviewItems}
        initialCandidateId={selectedCandidateId}
        identityMappings={identityMappings}
        canDecide={canDecide}
        isPending={Boolean(selected && pendingRecords[selected.input_record_key])}
        onDecide={decide}
        onUndo={undo}
        onNavigate={(nextItem) => openRecord(nextItem, nextItem.candidates?.[0]?.id ?? null)}
      />

      {jobId && (
        <ReviewRuleModal
          isOpen={reviewRuleModalOpen}
          onClose={() => setReviewRuleModalOpen(false)}
          jobId={jobId}
          initialData={reviewRuleModalInitial}
          onSaved={handleRuleSaved}
        />
      )}

      <DuplicateRecordsDialog
        open={showDuplicateModal}
        onOpenChange={setShowDuplicateModal}
        totalRaw={totalRawInput}
        totalUnique={totalUniqueInput}
        totalDuplicates={totalDuplicates}
        duplicateDetails={duplicateDetails}
      />
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
  tabCategory = "all",
  onTabCategoryChange,
  selectedPresetNumber,
  onSelectPresetNumber,
  systemPresets = [],
  customRules = [],
  dynamicPatterns = [],
  ruleCounts,
  onOpenAddRuleModal,
  onPromoteRule,
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
  tabCategory?: "all" | "system" | "custom" | "dynamic";
  onTabCategoryChange?: (cat: "all" | "system" | "custom" | "dynamic") => void;
  selectedPresetNumber?: number | null;
  onSelectPresetNumber?: (num: number | null) => void;
  systemPresets?: ReviewCaseGroup[];
  customRules?: ReviewCaseGroup[];
  dynamicPatterns?: ReviewCaseGroup[];
  ruleCounts?: { all: number; system: number; custom: number; dynamic: number };
  onOpenAddRuleModal?: () => void;
  onPromoteRule?: (group: ReviewCaseGroup) => void;
}) {
  const { t } = usePreferences();

  return (
    <div className="space-y-3.5">
      {/* Aturan Review Bar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-brand/10 text-brand">
              <SlidersHorizontal className="size-3.5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground">Aturan Review</span>
              <span className="ml-2 text-[11px] text-muted-foreground hidden sm:inline">
                Preset Sistem 1–6 · Aturan Kustom · Pola Dinamis
              </span>
            </div>
          </div>
          {onOpenAddRuleModal && (
            <button
              type="button"
              onClick={onOpenAddRuleModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90 transition-all cursor-pointer shadow-xs"
            >
              <Plus className="size-3.5" />
              Tambah Aturan Review
            </button>
          )}
        </div>

        {/* Tab categories: Semua, Aturan Bawaan, Aturan Kustom, Pola Dinamis */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onTabCategoryChange?.("all");
              onSelectPresetNumber?.(null);
            }}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
              tabCategory === "all"
                ? "border-brand bg-brand/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/70",
            ].join(" ")}
          >
            Semua Kasus
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono">
              {ruleCounts?.all ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onTabCategoryChange?.("system")}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
              tabCategory === "system"
                ? "border-brand bg-brand/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/70",
            ].join(" ")}
          >
            Aturan Bawaan (1–6)
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono">
              {ruleCounts?.system ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onTabCategoryChange?.("custom");
              onSelectPresetNumber?.(null);
            }}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
              tabCategory === "custom"
                ? "border-brand bg-brand/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/70",
            ].join(" ")}
          >
            Aturan Kustom
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono">
              {ruleCounts?.custom ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onTabCategoryChange?.("dynamic");
              onSelectPresetNumber?.(null);
            }}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
              tabCategory === "dynamic"
                ? "border-brand bg-brand/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/70",
            ].join(" ")}
          >
            Pola Dinamis (Sisa)
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono">
              {ruleCounts?.dynamic ?? 0}
            </span>
          </button>
        </div>

        {/* If 'system' tab is active, display the 6 sub-preset badges / pills */}
        {tabCategory === "system" && systemPresets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => onSelectPresetNumber?.(null)}
              className={[
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                selectedPresetNumber === null
                  ? "bg-foreground text-background font-semibold"
                  : "bg-secondary/50 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              Semua Preset (1–6)
            </button>
            {systemPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  onSelectPresetNumber?.(
                    selectedPresetNumber === preset.preset_number ? null : (preset.preset_number ?? null),
                  )
                }
                className={[
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors cursor-pointer",
                  selectedPresetNumber === preset.preset_number
                    ? "bg-brand text-brand-foreground font-semibold"
                    : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ")}
              >
                <span>{preset.label}</span>
                <span className="rounded-full bg-black/10 dark:bg-white/10 px-1.5 py-0.2 text-[10px] font-mono">
                  {preset.item_count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Case Group Status Filter (Open / Resolved / All) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap gap-2">
          {(["open", "resolved", "all"] as CaseGroupFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onFilterChange(item)}
              className={[
                "rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
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
        groups?.map((group) => {
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
                    <p className="text-sm font-semibold">{caseGroupDisplayLabel(group, t)}</p>
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
                  <p className="mt-1 text-xs text-muted-foreground">{caseGroupReason(group, t)}</p>
                  {group.recommendation && (
                    <p className="mt-2 text-xs font-medium text-foreground">
                      {t("matching.review.recommendation")}:{" "}
                      <span className="font-normal text-muted-foreground">
                        {caseGroupRecommendation(group, t)}
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
                      {onPromoteRule && (group.rule_type === "dynamic_fallback" || group.eligible_for_rule_promotion) && (
                        <button
                          type="button"
                          onClick={() => onPromoteRule(group)}
                          className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 transition-colors shadow-2xs"
                          title="Promosikan pola data sisa ini menjadi aturan kustom permanen"
                        >
                          <BookmarkPlus className="size-3.5" />
                          Jadikan Aturan Baru
                        </button>
                      )}
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
        .map((key) => items?.find((item) => item.input_record_key === key))
        .filter((item): item is ReviewItem => Boolean(item)),
    [group.item_keys, items],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pagedGroupItems = useMemo(
    () => groupItems.slice((page - 1) * pageSize, page * pageSize),
    [groupItems, page, pageSize],
  );
  const allSelectableKeys = groupItems?.map((item) => item.input_record_key);
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
            <p className="text-sm font-semibold">{caseGroupDisplayLabel(group, t)}</p>
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
          <p className="mt-1 text-xs text-muted-foreground">{caseGroupReason(group, t)}</p>
          {group.recommendation ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("matching.review.recommendation")}:{" "}
              <span className="font-medium text-foreground">
                {caseGroupRecommendation(group, t)}
              </span>
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
                  disabled={!canDecide || selectedKeys.length === 0 || Boolean(groupPending)}
                  className="cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {groupPending === "accept_match"
                    ? t("common.loading")
                    : t("matching.review.applySelectedAccept")}
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
                <th className="w-10 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={!canDecide || allSelectableKeys.length === 0 || Boolean(groupPending)}
                    aria-label={t("matching.review.selectAll")}
                  />
                </th>
                <th className="w-[320px] min-w-[260px] px-3 py-2 text-left font-medium">
                  {t("matching.review.input")}
                </th>
                <th className="w-[320px] min-w-[260px] px-3 py-2 text-left font-medium">
                  {t("matching.review.reference")}
                </th>
                <th className="w-24 px-3 py-2 text-right font-medium">
                  {t("matching.review.similarity")}
                </th>
                <th className="w-[280px] min-w-[240px] px-3 py-2 text-left font-medium">
                  {t("matching.review.differenceSummary")}
                </th>
                <th className="w-36 px-3 py-2 text-left font-medium">
                  {t("matching.review.decisionStatus")}
                </th>
                <th className="w-[230px] min-w-[210px] px-3 py-2 text-right font-medium">{t("common.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pagedGroupItems?.map((item) => {
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
                  <tr
                    key={item.input_record_key}
                    onClick={() => onOpenRecord(item, candidate?.id ?? null)}
                    className="align-top hover:bg-secondary/40 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(item.input_record_key)}
                        disabled={!canDecide || Boolean(rowPending) || Boolean(groupPending)}
                        onChange={() => onToggleKey(group, item.input_record_key)}
                        aria-label={t("matching.review.selectRecord")}
                      />
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <IdentityCell identity={inputIdentity} />
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <IdentityCell
                        identity={referenceIdentity}
                        emptyHeadline={t("matching.review.noCandidate")}
                        emptyMeta={t("matching.review.noCandidateDesc")}
                      />
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-semibold tabular-nums ${scoreTone(candidate?.score ?? 0)}`}
                    >
                      {candidate ? `${candidate.score}%` : "-"}
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <DifferenceSummaryCell scores={candidate?.field_scores ?? []} t={t} />
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
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {canDecide ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onDecideRecord(item, "accept_match", candidate)}
                            disabled={!rowCanAccept || Boolean(rowPending) || Boolean(groupPending)}
                            className="cursor-pointer rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground transition-all hover:bg-brand/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs whitespace-nowrap"
                          >
                            {rowPending === "accept_match" ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" />
                                <span className="text-[11px]">{t("common.loading")}</span>
                              </span>
                            ) : (
                              "Terima Match"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecideRecord(item, "mark_unmatched", null)}
                            disabled={Boolean(rowPending) || Boolean(groupPending)}
                            className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs whitespace-nowrap"
                          >
                            {rowPending === "mark_unmatched" ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" />
                                <span className="text-[11px]">{t("common.loading")}</span>
                              </span>
                            ) : (
                              "Tandai Unmatched"
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

function IdentityCell({
  identity,
  emptyHeadline = "-",
  emptyMeta = "-",
  className = "",
}: {
  identity: ReturnType<typeof buildSideIdentity> | null;
  emptyHeadline?: string;
  emptyMeta?: string;
  className?: string;
}) {
  if (!identity || !identity.headline || identity.headline === "-") {
    return (
      <div className={`space-y-0.5 ${className}`}>
        <p className="text-xs font-semibold text-muted-foreground">{emptyHeadline}</p>
        <p className="text-[11px] text-muted-foreground/70">{emptyMeta}</p>
      </div>
    );
  }

  const headline = identity.headline;

  // 1. Identifiers (NPWP, etc.) & contacts
  const identifiers = identity.fields
    .filter((f) => f.semantic === "strong_identifier" && f.value !== headline)
    .map((f) => (f.label ? `${f.label}: ${f.value}` : f.value));

  const contacts = identity.fields
    .filter(
      (f) =>
        (f.semantic === "email" || f.semantic === "phone") &&
        f.value !== headline &&
        f.value !== "-" &&
        f.value !== "Telepon -" &&
        f.value !== "Email -",
    )
    .map((f) => (f.label ? `${f.label}: ${f.value}` : f.value));

  const secondLineParts = [...identifiers, ...contacts].filter(Boolean);
  const secondLine = secondLineParts.join(" • ") || null;

  // 2. Address and City / Province
  const addressField = identity.fields.find(
    (f) => f.semantic === "address" && f.value !== headline,
  );
  const cityField = identity.fields.find((f) => f.semantic === "city" && f.value !== headline);
  const provField = identity.fields.find((f) => f.semantic === "province" && f.value !== headline);

  const locParts: string[] = [];
  if (addressField?.value && addressField.value !== "-") {
    locParts.push(addressField.value);
  }
  const cityProv = [cityField?.value, provField?.value].filter(Boolean).join(", ");
  if (cityProv && !locParts.some((p) => p.includes(cityProv))) {
    locParts.push(cityProv);
  }

  // Fallback: If secondLine or thirdLine are empty, use parts of identity.meta
  let thirdLine = locParts.join(" · ") || null;
  if (!secondLine && !thirdLine && identity.meta && identity.meta !== "-") {
    thirdLine = identity.meta;
  }

  return (
    <div className={`flex flex-col gap-0.5 max-w-[340px] min-w-0 ${className}`}>
      <p className="truncate text-xs font-bold text-foreground" title={headline}>
        {headline}
      </p>

      {secondLine && (
        <p className="truncate text-[11px] font-medium text-muted-foreground" title={secondLine}>
          {secondLine}
        </p>
      )}

      {thirdLine && (
        <p
          className="line-clamp-2 text-[11px] leading-tight text-muted-foreground/80"
          title={thirdLine}
        >
          {thirdLine}
        </p>
      )}
    </div>
  );
}

function DifferenceSummaryCell({
  scores,
  t,
}: {
  scores: ReviewCandidate["field_scores"];
  t: ReturnType<typeof usePreferences>["t"];
}) {
  const meaningful = sortFieldScores(scores).filter((field) => field.comparison !== "same");

  if (meaningful.length === 0) {
    if (scores && scores.length > 0) {
      return (
        <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          {t("matching.review.same")}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[280px]">
      {meaningful.slice(0, 3).map((field) => {
        const label = humanizeFieldLabel(field.input_column);
        const compLabel = comparisonLabel(field.comparison, t);
        const isDifferent = field.comparison === "different";
        const isSimilar = field.comparison === "similar";

        const badgeColor = isDifferent
          ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
          : isSimilar
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
            : "bg-secondary text-muted-foreground border-border";

        return (
          <span
            key={`${field.reference_column}-${field.input_column}`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-normal ${badgeColor}`}
            title={`${label}: ${compLabel}`}
          >
            <span className="font-semibold">{label}:</span>
            <span>{compLabel}</span>
          </span>
        );
      })}
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
            {entries?.map((field) => (
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
    items: current.items?.map((item) =>
      affectedKeySet.has(item.input_record_key)
        ? (next.items?.find((nextItem) => nextItem.input_record_key === item.input_record_key) ??
          item)
        : item,
    ),
    case_groups: current.case_groups?.map((group) => {
      if (caseGroupId && group.id === caseGroupId) {
        return next.case_groups?.find((nextGroup) => nextGroup.id === group.id) ?? group;
      }

      if (affectedKeys.some((key) => group.item_keys.includes(key))) {
        return next.case_groups?.find((nextGroup) => nextGroup.id === group.id) ?? group;
      }

      return group;
    }),
  };
}

function findDecisionGroupId(review: ReviewResults | null, decisionId: string) {
  if (!review) return null;

  return (
    review.case_groups?.find((group) =>
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
        {history?.map((item) => (
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

function caseGroupDisplayLabel(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  if (group.label) return group.label;
  const pattern = (group.pattern ?? "").toUpperCase();
  if (pattern === "IDENTIFIER_CONFLICT") return "1. NIB Beda / Konflik Identitas";
  if (pattern === "LEGAL_FORM_CONFLICT") return "2. Beda Bentuk Usaha (PT/CV)";
  if (pattern === "MULTI_CANDIDATE_AMBIGUITY") return "3. Kandidat Ganda (Ambiguitas)";
  if (pattern === "GEO_LOCATION_CONFLICT") return "4. Beda Wilayah (Kabupaten)";
  if (pattern === "ADDRESS_CONFLICT") return "5. Beda Alamat";
  if (pattern === "INACTIVE_BUSINESS_STATUS") return "6. Status Usaha Nonaktif";
  if (pattern === "FIELD_CONFLICT") return t("review.group.fieldConflict");
  if (pattern === "SIMILAR_NAME_REVIEW") return t("review.group.similarName");
  if (pattern === "LOW_CONFIDENCE_MATCH") return t("review.group.lowConfidence");
  if (pattern === "NO_CANDIDATE") return t("review.group.noCandidate");
  if (pattern === "NUMERIC_MISMATCH") return t("review.group.numericMismatch");
  return t("review.group.default");
}

function caseGroupReason(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  const pattern = (group.pattern ?? "").toUpperCase();
  if (pattern === "LEGAL_FORM_CONFLICT") return t("review.reason.legalConflict");
  if (pattern === "GEO_LOCATION_CONFLICT") return t("review.reason.locationConflict");
  if (pattern === "FIELD_CONFLICT") return t("review.reason.fieldConflict");
  if (pattern === "SIMILAR_NAME_REVIEW") return t("review.reason.similarName");
  if (pattern === "LOW_CONFIDENCE_MATCH") return t("review.reason.lowConfidence");
  if (pattern === "NO_CANDIDATE") return t("review.reason.noCandidate");
  if (pattern === "NUMERIC_MISMATCH") return t("review.reason.numericMismatch");
  return group.reason || "";
}

function caseGroupRecommendation(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  const raw = group.recommendation ?? "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("accept group after checking")) return t("review.recommendation.acceptGroup");
  if (lower.includes("reject or reassign")) return t("review.recommendation.rejectGroup");
  if (lower.includes("review individually") || lower.includes("confidence is mixed")) {
    return t("review.recommendation.reviewIndividually");
  }
  if (lower.includes("representative sample before accepting")) {
    return t("review.recommendation.reviewSamples");
  }
  if (lower.includes("no reference match") || lower.includes("confirm unmatched")) {
    return t("review.recommendation.confirmUnmatched");
  }
  return raw;
}

function formatAiRecommendation(
  recommendation: string | undefined | null,
  t: ReturnType<typeof usePreferences>["t"],
) {
  if (!recommendation) return "-";
  const lower = recommendation.toLowerCase();
  if (lower === "accept_match" || lower === "accept") return t("matching.review.recApprove");
  if (lower === "reject_match" || lower === "reject") return t("matching.review.recReject");
  if (lower === "needs_review" || lower === "review") return t("matching.review.recReview");
  if (lower === "mark_unmatched" || lower === "unmatched") return t("matching.review.markUnmatched");
  return recommendation;
}

function formatAiRationale(
  rationale: string | undefined | null,
  t: ReturnType<typeof usePreferences>["t"],
) {
  if (!rationale) return "";
  const lower = rationale.toLowerCase();
  if (lower.includes("legal form differs")) return t("review.reason.legalConflict");
  if (lower.includes("some supporting fields differ")) return t("review.reason.fieldConflict");
  if (lower.includes("candidate is similar but not strong")) return t("review.reason.similarName");
  if (lower.includes("score is inside the review band")) return t("review.reason.lowConfidence");
  if (lower.includes("no reference candidate was generated")) return t("review.reason.noCandidate");
  if (lower.includes("numeric sequence mismatch")) return t("review.reason.numericMismatch");
  return rationale;
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
          totalRaw={review.summary.total_raw_input}
          totalUnique={review.summary.total_unique_input}
          totalDuplicates={review.summary.total_duplicates}
        />
      )}
    </>
  );
}
