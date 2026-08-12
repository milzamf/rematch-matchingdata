import { createFileRoute, Link } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Stepper } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/feedback-states";
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
  ApiError,
  createWorkspace,
  fetchReviewResults,
  fetchWorkspace,
  inspectDataset,
  runMatching,
  saveReviewDecision,
  type DatasetInspectResult,
  type DatasetRole,
  type MatchingRunResult,
  type ReviewCaseGroup,
  type ReviewCandidate,
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
  Search,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/matching")({
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
  suggested: boolean;
  suggestionSource: MappingSuggestionSource;
  suggestionScore: number | null;
  referenceColumnName: string;
  inputColumnName: string;
  referenceDataType: string;
  inputDataType: string;
};
type Preset = "Balanced" | "Strict" | "Exploratory" | "Custom";
type Strategy = "Hybrid" | "Exact" | "Fuzzy" | "Composite" | "Rule-Based";
type FieldType = "text" | "number" | "date" | "boolean" | "unknown";
type CandidateCount = 1 | 3 | 5 | 10 | "custom";
type ConfigureAlgorithm =
  | "Exact"
  | "Normalized Exact"
  | "Case-Insensitive Exact"
  | "Numeric Exact"
  | "Date Exact"
  | "Jaro-Winkler"
  | "Levenshtein"
  | "Damerau-Levenshtein"
  | "Jaccard Similarity"
  | "Cosine Similarity"
  | "Sørensen-Dice"
  | "Ratcliff-Obershelp"
  | "Monge-Elkan"
  | "Smith-Waterman"
  | "Token Sort Ratio"
  | "Token Set Ratio"
  | "Partial Ratio"
  | "Partial Token Sort"
  | "Partial Token Set";

type ConfigurationField = {
  mappingId: string;
  referenceColumnId: string;
  inputColumnId: string;
  referenceColumnName: string;
  inputColumnName: string;
  dataType: FieldType;
  algorithm: ConfigureAlgorithm;
};

type MatchingConfiguration = {
  preset: Preset;
  mode: "preset" | "custom";
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
  const searchParams = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const initialWorkspaceId = searchParams?.get("workspace") ?? null;
  const requestedStep = parseInitialStep(searchParams?.get("step"));
  const hasRequestedStep = searchParams?.has("step") ?? false;
  const [step, setStep] = useState(requestedStep);
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId);
  const [workspaceName, setWorkspaceName] = useState(t("workspace.untitled"));
  const [workspaceNameEdited, setWorkspaceNameEdited] = useState(false);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    initialWorkspaceId ? "saving" : "idle",
  );
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [reference, setReference] = useState<UploadedFile | null>(null);
  const [input, setInput] = useState<UploadedFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [runResult, setRunResult] = useState<MatchingRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [columnMappings, setColumnMappings] = useState<ColumnMappingDraft[]>([]);
  const [configureValid, setConfigureValid] = useState(true);
  const [matchingConfiguration, setMatchingConfiguration] = useState<MatchingConfiguration | null>(
    null,
  );
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [exportHistory, setExportHistory] = useState<StoredExportHistoryEntry[]>([]);
  const workspaceIdRef = useRef<string | null>(initialWorkspaceId);
  const suppressMappingSuggestRef = useRef(false);
  const restoringWorkspaceRef = useRef(false);

  const referenceColumns = reference?.result?.columns ?? [];
  const inputColumns = input?.result?.columns ?? [];
  const validMappings = columnMappings.filter(
    (mapping) => mapping.referenceColumnId && mapping.inputColumnId,
  );
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
  const activeStep = Math.min(step, highestAllowedStep);
  const canAdvance = activeStep < wizardSteps.length && activeStep + 1 <= highestAllowedStep;
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
        const restoredProgress =
          snapshot?.progress ??
          restoredRunResult?.progress.percentage ??
          0;
        const restoredRunError =
          snapshot?.runError ??
          restoredRunResult?.job.error_message ??
          null;
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

        if (options?.replaceUrl !== false && typeof window !== "undefined") {
          window.history.replaceState(
            null,
            "",
            `/matching?workspace=${workspace.id}&step=${nextStep}`,
          );
        }

        return workspace;
      } finally {
        window.setTimeout(() => {
          restoringWorkspaceRef.current = false;
          suppressMappingSuggestRef.current = false;
        }, 0);
      }
    },
    [t],
  );

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => {
    if (!initialWorkspaceId || !canViewMatching || !canViewWorkspaces) return;

    let mounted = true;
    setWorkspaceSaveState("saving");

    hydrateWorkspace(initialWorkspaceId, {
      requestedStep,
      preferRequestedStep: hasRequestedStep,
    })
      .then(() => {
        if (!mounted) return;
      })
      .catch((error) => {
        if (!mounted) return;
        setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.loadFailed"));
        setWorkspaceSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, [
    canViewMatching,
    canViewWorkspaces,
    hasRequestedStep,
    hydrateWorkspace,
    initialWorkspaceId,
    requestedStep,
    t,
  ]);

  useEffect(() => {
    if (!workspaceId || restoringWorkspaceRef.current || !canUpdateWorkspace) return;

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
          setWorkspaceSaveState("saved");
          setWorkspaceError(null);
        })
        .catch((error) => {
          setWorkspaceSaveState("error");
          setWorkspaceError(error instanceof ApiError ? error.message : t("workspace.saveFailed"));
        });
    }, 700);

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
  ]);

  const ensureWorkspace = async (role: DatasetRole, result: DatasetInspectResult) => {
    const existingWorkspaceId = workspaceIdRef.current;
    const nextName = workspaceNameEdited
      ? workspaceName
      : buildWorkspaceName(role, result, reference, input, t("workspace.untitled"));
    const nextReferenceDatasetId =
      role === "reference" ? result.dataset.id : reference?.result?.dataset.id ?? null;
    const nextInputDatasetId =
      role === "input" ? result.dataset.id : input?.result?.dataset.id ?? null;

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
      if (result.job.status !== "completed") {
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

    if (suppressMappingSuggestRef.current || columnMappings.length > 0) {
      return;
    }

    if (inspectedReferenceColumns.length === 0 || inspectedInputColumns.length === 0) {
      setColumnMappings([]);
      setMatchingConfiguration(null);
      return;
    }

    setColumnMappings(suggestColumnMappings(inspectedReferenceColumns, inspectedInputColumns));
    setMatchingConfiguration(null);
  }, [columnMappings.length, reference?.result, input?.result]);

  useEffect(() => {
    if (step > highestAllowedStep) {
      setStep(highestAllowedStep);
    }
  }, [highestAllowedStep, step]);

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

  const renameWorkspace = async () => {
    if (!canUpdateWorkspace) {
      toast.error(t("feedback.toast.accessDenied"));
      return;
    }

    const nextName = window.prompt(t("workspace.renamePrompt"), workspaceName)?.trim();
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

  const selectStep = (nextStep: number) => {
    if (nextStep <= highestAllowedStep) setStep(nextStep);
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
          {activeStep === 1 && (
            <StepUpload
              reference={reference}
              input={input}
              onInspectFile={handleInspectFile}
              onClearReference={() => {
                if (reference) toast.info(t("feedback.toast.removed", { name: reference.name }));
                setReference(null);
              }}
              onClearInput={() => {
                if (input) toast.info(t("feedback.toast.removed", { name: input.name }));
                setInput(null);
              }}
              error={uploadError}
            />
          )}
          {activeStep === 2 && <StepProfile reference={reference?.result} input={input?.result} />}
          {activeStep === 3 && (
            <StepColumnMapping
              referenceColumns={referenceColumns}
              inputColumns={inputColumns}
              mappings={columnMappings}
              setMappings={setColumnMappings}
            />
          )}
          {activeStep === 4 && (
            <StepConfig
              mappings={columnMappings}
              configuration={matchingConfiguration}
              onConfigurationChange={setMatchingConfiguration}
              onValidityChange={setConfigureValid}
            />
          )}
          {activeStep === 5 && (
            <StepRun
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
              onBack={() => setStep(4)}
              canRun={canRunMatching}
            />
          )}
          {activeStep === 6 && (
            <StepReview jobId={runResult?.job.id ?? null} canDecide={canReviewDecide} />
          )}
          {activeStep === 7 && (
            <StepSynchronize
              jobId={runResult?.job.id ?? null}
              syncState={syncState}
              onBackToReview={() => setStep(6)}
              onSyncStateChange={setSyncState}
              canExecute={canExecuteSync}
            />
          )}
          {activeStep === 8 && (
            <StepExport
              jobId={runResult?.job.id ?? null}
              canExecute={canExecuteExport}
              onExportHistoryChange={setExportHistory}
            />
          )}

          {/* Nav */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
            <button
              disabled={activeStep === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="size-4" />
              {t("common.back")}
            </button>
            <p className="text-xs text-muted-foreground">
              {t("common.stepOf", { current: activeStep, total: wizardSteps.length })}
            </p>
            {activeStep === wizardSteps.length ? (
              <a
                href={workspaceId ? `/results?workspace=${workspaceId}` : "/results"}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
              >
                {t("common.goToResults")}
                <ArrowRight className="size-4" />
              </a>
            ) : (
              <button
                disabled={!canAdvance}
                onClick={() => setStep((s) => Math.min(wizardSteps.length, s + 1))}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand text-brand-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("common.continue")}
                <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </Card>
        <ConfirmationDialog
          open={runConfirmOpen}
          setOpen={setRunConfirmOpen}
          title={t("feedback.confirm.runTitle")}
          description={t("feedback.confirm.runDesc")}
          cancelLabel={t("common.cancel")}
          actionLabel={t("matching.run.start")}
          onConfirm={startRun}
        />
      </div>
    </AppLayout>
  );
}

function stepKey(id: number) {
  return ["upload", "profiling", "mapping", "configure", "run", "review", "sync", "export"][
    id - 1
  ] as "upload" | "profiling" | "mapping" | "configure" | "run" | "review" | "sync" | "export";
}

function parseInitialStep(value: string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.min(8, Math.max(1, parsed));
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
  syncState,
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
  syncState: SyncState | null;
}) {
  const datasetsReady = reference?.status === "success" && input?.status === "success";
  const profilingReady = datasetsReady && referenceColumns.length > 0 && inputColumns.length > 0;
  const configurationReady = Boolean(
    matchingConfiguration?.isValid && configureValid && hasCompletedMapping,
  );
  const matchingReady = Boolean(runResult && runState === "success");

  if (!datasetsReady) return 1;
  if (!profilingReady) return 2;
  if (!hasCompletedMapping) return 3;
  if (!configurationReady) return 4;
  if (!matchingReady) return 5;
  if (!syncState?.confirmed) return 7;
  return 8;
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
  if (step >= 8) return "completed";
  if (step >= 7) return "ready_to_sync";
  if (step >= 6) return "reviewing";
  if (step >= 5 || runState === "running") return "matching";
  if (step >= 3) return "configuring";
  return "draft";
}

function workspaceStatusLabel(
  status: WorkspaceStatus,
  t: ReturnType<typeof usePreferences>["t"],
) {
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

function StepProfile({
  reference,
  input,
}: {
  reference?: DatasetInspectResult;
  input?: DatasetInspectResult;
}) {
  const { t } = usePreferences();
  const profiles = [
    { label: t("matching.upload.reference"), result: reference },
    { label: t("matching.upload.input"), result: input },
  ].filter((profile): profile is { label: string; result: DatasetInspectResult } =>
    Boolean(profile.result),
  );

  if (profiles.length === 0) {
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
    <>
      <SectionTitle title={t("matching.profile.title")} desc={t("matching.profile.desc")} />
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map(({ label, result }) => (
            <div key={result.dataset.id} className="rounded-lg border border-border p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {result.dataset.original_filename}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
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
          ))}
        </div>

        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-secondary/40">
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("matching.profile.dataset")}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("matching.profile.column")}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">{t("matching.profile.type")}</th>
                <th className="text-right px-4 py-2.5 font-medium">
                  {t("matching.profile.nulls")}
                </th>
                <th className="text-right px-4 py-2.5 font-medium">
                  {t("matching.profile.unique")}
                </th>
                <th className="text-right px-4 py-2.5 font-medium">
                  {t("matching.profile.duplicates")}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("matching.profile.samples")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {profiles.flatMap(({ label, result }) =>
                result.columns.map((column) => (
                  <tr key={`${result.dataset.id}-${column.id}`} className="hover:bg-secondary/30">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label}</td>
                    <td className="px-4 py-3 font-mono text-xs">{column.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex text-[10px] font-mono bg-secondary rounded px-1.5 py-0.5 uppercase">
                        {column.data_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      {column.null_count} ({column.null_percentage}%)
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      {column.unique_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      {column.duplicate_percentage}%
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {column.sample_values.length > 0 ? column.sample_values.join(", ") : "-"}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
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
  const usedReferenceIds = new Set(mappings.map((mapping) => mapping.referenceColumnId));
  const hasColumns = referenceColumns.length > 0 && inputColumns.length > 0;
  const hasAvailableReference = referenceColumns.some((column) => !usedReferenceIds.has(column.id));
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
        const referenceColumn = referenceColumns.find(
          (column) => column.id === next.referenceColumnId,
        );
        const inputColumn = inputColumns.find((column) => column.id === next.inputColumnId);

        if ((patch.referenceColumnId || patch.inputColumnId) && referenceColumn) {
          next.algorithm =
            inputColumn && patch.algorithm === undefined
              ? defaultMappingAlgorithm(referenceColumn, inputColumn)
              : defaultAlgorithmForColumn(referenceColumn);
          next.suggestionSource = "manual";
          next.suggestionScore = null;
          next.referenceColumnName = referenceColumn.name;
          next.referenceDataType = referenceColumn.data_type;
          next.inputColumnName = inputColumn?.name ?? "";
          next.inputDataType = inputColumn?.data_type ?? "";
        }

        return next;
      });
    });
  };

  const addMapping = () => {
    const referenceColumn = referenceColumns.find((column) => !usedReferenceIds.has(column.id));
    if (!referenceColumn || inputColumns.length === 0) {
      toast.error(t("matching.mapping.noAvailableReference"));
      return;
    }

    const suggestedInput = findBestInputColumn(referenceColumn, inputColumns, new Set());
    const inputColumn =
      suggestedInput && suggestedInput.score >= 0.6 ? suggestedInput.column : null;

    setMappings((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        referenceColumnId: referenceColumn.id,
        inputColumnId: inputColumn?.id ?? "",
        algorithm: inputColumn
          ? defaultMappingAlgorithm(referenceColumn, inputColumn)
          : defaultAlgorithmForColumn(referenceColumn),
        suggested: false,
        suggestionSource: inputColumn ? (suggestedInput?.source ?? "similarity") : "manual",
        suggestionScore: inputColumn ? (suggestedInput?.score ?? null) : null,
        referenceColumnName: referenceColumn.name,
        inputColumnName: inputColumn?.name ?? "",
        referenceDataType: referenceColumn.data_type,
        inputDataType: inputColumn?.data_type ?? "",
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MappingStat
              label={t("matching.mapping.referenceCount")}
              value={referenceColumns.length}
            />
            <MappingStat label={t("matching.mapping.inputCount")} value={inputColumns.length} />
            <MappingStat
              label={t("matching.mapping.mappedCount")}
              value={mappings.filter((mapping) => mapping.inputColumnId).length}
            />
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{t("matching.mapping.suggestionTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("matching.mapping.suggestionDesc")}
                </p>
              </div>
              <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
                {t("matching.mapping.suggestedCount", {
                  count: mappings.filter((mapping) => mapping.suggested).length,
                })}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_44px] items-center gap-4 px-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{t("matching.mapping.reference")}</span>
              <span className="text-center" aria-hidden="true">
                &harr;
              </span>
              <span>{t("matching.mapping.input")}</span>
              <span className="sr-only">{t("common.action")}</span>
            </div>

            {mappings.map((mapping, index) => {
              const referenceColumn = referenceColumns.find(
                (column) => column.id === mapping.referenceColumnId,
              );
              const inputColumn = inputColumns.find(
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
                  className="grid min-w-[720px] grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_44px] items-center gap-4 rounded-lg border border-border px-4 py-3"
                >
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
                      {referenceColumns.map((column) => (
                        <option
                          key={column.id}
                          value={column.id}
                          disabled={usedByOtherRows.has(column.id)}
                        >
                          {column.name}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {referenceColumn && (
                        <ColumnTypeBadge column={referenceColumn} testId="mapping-reference-type" />
                      )}
                      {mapping.suggested && (
                        <p className="text-[11px] text-muted-foreground">
                          {t("matching.mapping.autoSuggested")}
                        </p>
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
                      aria-label={t("matching.mapping.inputSelect", { row: index + 1 })}
                      data-testid="mapping-input-select"
                      value={mapping.inputColumnId}
                      onChange={(event) =>
                        updateMapping(mapping.id, { inputColumnId: event.target.value })
                      }
                      className={selectClass}
                    >
                      <option value="">{t("matching.mapping.noInputSelected")}</option>
                      {inputColumns.map((column) => (
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

function MappingStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
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

function suggestColumnMappings(
  referenceColumns: DatasetInspectResult["columns"],
  inputColumns: DatasetInspectResult["columns"],
): ColumnMappingDraft[] {
  const usedInputIds = new Set<string>();

  return referenceColumns.map((referenceColumn) => {
    const match = findBestInputColumn(referenceColumn, inputColumns, usedInputIds);
    const hasSuggestion = Boolean(match && match.score >= 0.6);
    const inputColumn = hasSuggestion ? match?.column : null;

    if (inputColumn) {
      usedInputIds.add(inputColumn.id);
    }

    return {
      id: inputColumn
        ? `suggested-${referenceColumn.id}-${inputColumn.id}`
        : `unmatched-${referenceColumn.id}`,
      referenceColumnId: referenceColumn.id,
      inputColumnId: inputColumn?.id ?? "",
      algorithm: inputColumn
        ? defaultMappingAlgorithm(referenceColumn, inputColumn)
        : defaultAlgorithmForColumn(referenceColumn),
      suggested: hasSuggestion,
      suggestionSource: hasSuggestion ? (match?.source ?? "similarity") : "none",
      suggestionScore: hasSuggestion ? (match?.score ?? null) : null,
      referenceColumnName: referenceColumn.name,
      inputColumnName: inputColumn?.name ?? "",
      referenceDataType: referenceColumn.data_type,
      inputDataType: inputColumn?.data_type ?? "",
    };
  });
}

function findBestInputColumn(
  referenceColumn: DatasetInspectResult["columns"][number],
  inputColumns: DatasetInspectResult["columns"],
  usedInputIds: Set<string>,
): {
  column: DatasetInspectResult["columns"][number];
  score: number;
  source: MappingSuggestionSource;
} | null {
  return inputColumns.reduce<{
    column: DatasetInspectResult["columns"][number];
    score: number;
    source: MappingSuggestionSource;
  } | null>((best, inputColumn) => {
    if (usedInputIds.has(inputColumn.id)) return best;

    const similarity = columnNameSimilarity(referenceColumn.name, inputColumn.name);
    if (!best || similarity.score > best.score) {
      return { column: inputColumn, score: similarity.score, source: similarity.source };
    }

    return best;
  }, null);
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

function columnNameSimilarity(
  referenceName: string,
  inputName: string,
): { score: number; source: MappingSuggestionSource } {
  if (referenceName === inputName) return { score: 1, source: "exact_name" };
  if (referenceName.toLowerCase() === inputName.toLowerCase()) {
    return { score: 1, source: "case_insensitive" };
  }

  const referenceNormalized = normalizeColumnName(referenceName);
  const inputNormalized = normalizeColumnName(inputName);

  if (referenceNormalized.compact === inputNormalized.compact) {
    return { score: 1, source: "normalized_name" };
  }

  if (
    referenceNormalized.compact.length > 2 &&
    inputNormalized.compact.length > 2 &&
    (referenceNormalized.compact.includes(inputNormalized.compact) ||
      inputNormalized.compact.includes(referenceNormalized.compact))
  ) {
    return { score: 0.8, source: "similarity" };
  }

  const referenceTokens = new Set(referenceNormalized.tokens);
  const inputTokens = new Set(inputNormalized.tokens);
  const shared = [...referenceTokens].filter((token) => inputTokens.has(token)).length;
  const total = new Set([...referenceTokens, ...inputTokens]).size;

  return {
    score: total === 0 ? 0 : shared / total,
    source: "similarity",
  };
}

function normalizeColumnName(name: string): { compact: string; tokens: string[] } {
  const separated = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const tokens = separated
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(expandColumnToken);

  return {
    compact: tokens.join(""),
    tokens,
  };
}

function expandColumnToken(token: string): string {
  const aliases: Record<string, string> = {
    kab: "kabupaten",
    kabkota: "kabupatenkota",
    kota: "kota",
  };

  return aliases[token] ?? token;
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
  if (type === "number") return "Numeric Exact";
  if (type === "date") return "Date Exact";
  if (type === "boolean") return "Exact";
  if (/(npwp|nik|id|kode|code|email)/.test(combinedName)) return "Normalized Exact";
  if (/(alamat|address)/.test(combinedName)) return "Token Set Ratio";
  if (/(perusahaan|company|entity|entitas|nama|name|vendor|customer)/.test(combinedName)) {
    return "Jaro-Winkler";
  }
  if (/[_\s-]/.test(combinedName)) return "Token Set Ratio";
  return "Jaro-Winkler";
}

function defaultExactAlgorithmForField(
  referenceName: string,
  inputName: string,
  type: FieldType,
): ConfigureAlgorithm {
  const combinedName = `${referenceName} ${inputName}`.toLowerCase();
  if (type === "number") return "Numeric Exact";
  if (type === "date") return "Date Exact";
  if (/(npwp|nik|id|kode|code|email)/.test(combinedName)) return "Normalized Exact";
  if (type === "text") return "Normalized Exact";
  return "Exact";
}

const RECOMMENDED_ALGORITHMS: ConfigureAlgorithm[] = [
  "Jaro-Winkler",
  "Levenshtein",
  "Token Sort Ratio",
  "Token Set Ratio",
];

const MORE_ALGORITHMS: ConfigureAlgorithm[] = [
  "Exact",
  "Normalized Exact",
  "Case-Insensitive Exact",
  "Numeric Exact",
  "Date Exact",
  "Damerau-Levenshtein",
  "Jaccard Similarity",
  "Cosine Similarity",
  "Sørensen-Dice",
  "Ratcliff-Obershelp",
  "Monge-Elkan",
  "Smith-Waterman",
  "Partial Ratio",
  "Partial Token Sort",
  "Partial Token Set",
];

const STANDARD_OUTPUTS = ["Matched", "Possible Match", "Unmatched", "Summary Report"];
const AUTO_RECOMMEND_KEYS = ["Province", "City", "Postal Code"];
const AVAILABLE_CANDIDATE_FIELDS = ["Province", "City", "Postal Code", "Industry", "Business Type"];
const NORMALIZATION_PRESETS = [
  "Basic",
  "Text Standardization",
  "Entity Name",
  "Address",
  "Identifier Strict",
];

const PRESET_DEFAULTS: Record<
  Preset,
  {
    autoMatch: number;
    review: number;
    noMatch: number;
    strategy: Strategy;
    candidates: 1 | 3 | 5 | 10;
    normalizationPreset: string;
    searchMode: "auto" | "manual";
    searchFields: string[];
  }
> = {
  Balanced: {
    autoMatch: 90,
    review: 75,
    noMatch: 60,
    strategy: "Hybrid",
    candidates: 3,
    normalizationPreset: "Entity Name",
    searchMode: "auto",
    searchFields: [],
  },
  Strict: {
    autoMatch: 95,
    review: 85,
    noMatch: 70,
    strategy: "Exact",
    candidates: 1,
    normalizationPreset: "Identifier Strict",
    searchMode: "manual",
    searchFields: ["City", "Postal Code"],
  },
  Exploratory: {
    autoMatch: 85,
    review: 65,
    noMatch: 50,
    strategy: "Fuzzy",
    candidates: 10,
    normalizationPreset: "Text Standardization",
    searchMode: "auto",
    searchFields: [],
  },
  Custom: {
    autoMatch: 90,
    review: 75,
    noMatch: 60,
    strategy: "Hybrid",
    candidates: 3,
    normalizationPreset: "Entity Name",
    searchMode: "auto",
    searchFields: [],
  },
};

function StepConfig({
  mappings,
  configuration,
  onConfigurationChange,
  onValidityChange,
}: {
  mappings: ColumnMappingDraft[];
  configuration: MatchingConfiguration | null;
  onConfigurationChange: (configuration: MatchingConfiguration) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const { t } = usePreferences();
  const defaultPreset = configuration?.preset ?? "Balanced";
  const defaultPresetValues = PRESET_DEFAULTS[defaultPreset];
  const defaultTopN = configuration?.candidateGeneration?.topN ?? defaultPresetValues.candidates;
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [strategy, setStrategy] = useState<Strategy>(
    configuration?.strategy ?? defaultPresetValues.strategy,
  );
  const [autoMatch, setAutoMatch] = useState(
    configuration?.thresholds?.autoMatch ?? defaultPresetValues.autoMatch,
  );
  const [review, setReview] = useState(
    configuration?.thresholds?.review ?? defaultPresetValues.review,
  );
  const [noMatch, setNoMatch] = useState(
    configuration?.thresholds?.noMatch ?? defaultPresetValues.noMatch,
  );
  const [searchMode, setSearchMode] = useState<"auto" | "manual">(
    configuration?.searchOptimization.mode ?? defaultPresetValues.searchMode,
  );
  const [manualBlocks, setManualBlocks] = useState<string[]>(
    configuration?.searchOptimization.fields.length
      ? configuration.searchOptimization.fields
      : defaultPresetValues.searchFields,
  );
  const [candidates, setCandidates] = useState<CandidateCount>(
    [1, 3, 5, 10].includes(defaultTopN) ? (defaultTopN as 1 | 3 | 5 | 10) : "custom",
  );
  const [customCandidateCount, setCustomCandidateCount] = useState(String(defaultTopN));
  const [normalizationPreset, setNormalizationPreset] = useState(
    configuration?.normalization.preset ?? defaultPresetValues.normalizationPreset,
  );
  const [normalizationMode, setNormalizationMode] = useState<"auto" | "manual">(
    configuration?.normalization.mode ?? "auto",
  );
  const [outputMode, setOutputMode] = useState<"standard" | "custom">(
    configuration?.output.mode ?? "standard",
  );
  const [manualWeights, setManualWeights] = useState(configuration?.weighting.mode === "manual");
  const [combinedScoring, setCombinedScoring] = useState(
    configuration?.rules?.combinedScoring ?? false,
  );
  const [showFormula, setShowFormula] = useState(Boolean(configuration?.rules?.similarityFormula));
  const [showMoreAlgorithms, setShowMoreAlgorithms] = useState(false);
  const [outputs, setOutputs] = useState<string[]>(configuration?.output.items ?? STANDARD_OUTPUTS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [weights, setWeights] = useState<{ field: string; weight: number; method: string }[]>(
    configuration?.weighting.fields.map((field) => ({
      field: field.field,
      weight: field.weight,
      method: field.algorithm,
    })) ?? [],
  );
  const [selectedFields, setSelectedFields] = useState<string[]>(
    configuration?.fields.map((field) => field.mappingId) ?? [],
  );
  const [fieldAlgorithms, setFieldAlgorithms] = useState<Record<string, ConfigureAlgorithm>>(
    Object.fromEntries(
      configuration?.fields.map((field) => [field.mappingId, field.algorithm]) ?? [],
    ),
  );
  const [ruleText, setRuleText] = useState(
    configuration?.rules?.mandatoryRule ?? "NPWP must match exactly when present",
  );

  const isCustom = preset === "Custom";
  const mappedFields = useMemo(
    () =>
      mappings
        .filter((mapping) => mapping.referenceColumnId && mapping.inputColumnId)
        .map((mapping) => {
          const type = normalizedDataType(mapping.referenceDataType || mapping.inputDataType);
          return {
            id: mapping.id,
            label: `${mapping.referenceColumnName} ↔ ${mapping.inputColumnName}`,
            referenceColumnId: mapping.referenceColumnId,
            inputColumnId: mapping.inputColumnId,
            reference: mapping.referenceColumnName,
            input: mapping.inputColumnName,
            type,
            algorithm: defaultAlgorithmForField(
              mapping.referenceColumnName,
              mapping.inputColumnName,
              type,
            ),
          };
        }),
    [mappings],
  );
  const activeFields = useMemo(
    () => mappedFields.filter((field) => selectedFields.includes(field.id)),
    [mappedFields, selectedFields],
  );
  const fieldsForConfiguration = isCustom ? activeFields : mappedFields;
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
  const hasNumberField = fieldsForConfiguration.some((field) => field.type === "number");
  const hasDateField = fieldsForConfiguration.some((field) => field.type === "date");
  const needsThreshold = isCustom && strategyNeedsThreshold(strategy);
  const needsCandidates = isCustom && strategyNeedsCandidates(strategy);
  const needsAlgorithms = isCustom && strategyNeedsAlgorithms(strategy);
  const canUseWeights = isCustom && (strategy === "Hybrid" || strategy === "Composite");
  const needsManualWeights =
    isCustom && (strategy === "Hybrid" || strategy === "Composite") && manualWeights;
  const needsRuleScoring = isCustom && strategy === "Rule-Based" && combinedScoring;
  const candidateCountValid =
    candidates !== "custom" ||
    (Number(customCandidateCount) > 0 && Number.isInteger(Number(customCandidateCount)));
  const thresholdValid = !needsThreshold || (autoMatch > review && review > noMatch);
  const fieldSelectionValid =
    strategy === "Hybrid" || strategy === "Composite"
      ? activeFields.length >= 2
      : activeFields.length >= 1;
  const algorithmValid =
    !needsAlgorithms || activeFields.every((field) => Boolean(fieldAlgorithms[field.id]));
  const weightsValid = !(needsManualWeights || needsRuleScoring) || totalWeight === 100;
  const ruleValid = strategy !== "Rule-Based" || ruleText.trim().length > 0;
  const outputValid = outputMode === "standard" || outputs.length > 0;
  const configValid =
    !isCustom ||
    (fieldSelectionValid &&
      thresholdValid &&
      algorithmValid &&
      candidateCountValid &&
      weightsValid &&
      ruleValid &&
      outputValid);
  const configurationSnapshot = useMemo<MatchingConfiguration>(() => {
    const thresholdEnabled = strategyNeedsThreshold(strategy);
    const candidateEnabled = strategyNeedsCandidates(strategy);
    const resolvedTopN =
      candidates === "custom" ? Number(customCandidateCount) || 0 : Number(candidates);
    const configurationFields = fieldsForConfiguration.map((field) => ({
      mappingId: field.id,
      referenceColumnId: field.referenceColumnId,
      inputColumnId: field.inputColumnId,
      referenceColumnName: field.reference,
      inputColumnName: field.input,
      dataType: field.type,
      algorithm: resolveConfiguredAlgorithm(field, strategy, fieldAlgorithms),
    }));
    const weightMode =
      strategy === "Hybrid" || strategy === "Composite"
        ? manualWeights
          ? "manual"
          : "auto"
        : strategy === "Rule-Based" && combinedScoring
          ? "manual"
          : "none";

    return {
      preset,
      mode: isCustom ? "custom" : "preset",
      strategy,
      isValid: configValid,
      fields: configurationFields,
      thresholds: thresholdEnabled
        ? {
            autoMatch,
            review,
            noMatch,
          }
        : null,
      candidateGeneration: candidateEnabled ? { topN: resolvedTopN } : null,
      searchOptimization: {
        enabled: candidateEnabled,
        mode: searchMode,
        fields: searchMode === "manual" && candidateEnabled ? manualBlocks : [],
        recommendedFields: candidateEnabled ? AUTO_RECOMMEND_KEYS : [],
      },
      normalization: {
        mode: normalizationMode,
        preset: normalizationPreset,
      },
      weighting: {
        mode: weightMode,
        fields:
          weightMode === "none"
            ? []
            : weights.map((field) => ({
                mappingId:
                  fieldsForConfiguration.find((mappedField) => mappedField.label === field.field)
                    ?.id ?? field.field,
                field: field.field,
                weight: weightMode === "auto" ? field.weight : field.weight,
                algorithm: normalizeConfiguredAlgorithm(field.method),
              })),
      },
      rules:
        strategy === "Rule-Based"
          ? {
              mandatoryRule: ruleText.trim(),
              numericTolerance: hasNumberField ? "+/- 0.5%" : null,
              dateTolerance: hasDateField ? "+/- 3 days" : null,
              combinedScoring,
              similarityFormula:
                combinedScoring && showFormula ? t("matching.config.weightedAverage") : null,
            }
          : null,
      output: {
        mode: outputMode,
        items: outputMode === "standard" ? STANDARD_OUTPUTS : outputs,
      },
    };
  }, [
    autoMatch,
    candidates,
    combinedScoring,
    configValid,
    customCandidateCount,
    fieldAlgorithms,
    fieldsForConfiguration,
    hasDateField,
    hasNumberField,
    isCustom,
    manualBlocks,
    manualWeights,
    noMatch,
    normalizationMode,
    normalizationPreset,
    outputMode,
    outputs,
    preset,
    review,
    ruleText,
    searchMode,
    showFormula,
    strategy,
    t,
    weights,
  ]);
  const summaryItems = [
    [t("matching.config.summaryPreset"), presetLabel(preset, t)],
    [t("matching.config.summaryStrategy"), strategyLabel(strategy, t)],
    [
      t("matching.config.summaryThreshold"),
      !isCustom
        ? t("matching.config.presetManaged")
        : needsThreshold
          ? `${autoMatch}% / ${review}%`
          : t("matching.config.notRequired"),
    ],
    [
      t("matching.config.summarySearch"),
      searchMode === "auto"
        ? t("matching.config.autoRecommend")
        : t("matching.config.manualCandidate"),
    ],
    [
      t("matching.config.summaryCandidates"),
      !isCustom
        ? t("matching.config.presetManaged")
        : needsCandidates
          ? candidates === "custom"
            ? customCandidateCount
            : t("matching.config.topN", { count: candidates })
          : t("matching.config.notRequired"),
    ],
    [t("matching.config.summaryFields"), String(activeFields.length)],
    [
      t("matching.config.summaryOutputs"),
      outputMode === "standard" ? t("matching.config.standardOutput") : String(outputs.length),
    ],
  ];

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const d = PRESET_DEFAULTS[p];
    setAutoMatch(d.autoMatch);
    setReview(d.review);
    setNoMatch(d.noMatch);
    setStrategy(d.strategy);
    if (p === "Strict") {
      setNormalizationPreset("Identifier Strict");
      setSearchMode("manual");
      setCandidates(1);
      setManualBlocks(["City", "Postal Code"]);
    } else if (p === "Exploratory") {
      setNormalizationPreset("Text Standardization");
      setSearchMode("auto");
      setCandidates(10);
    } else {
      setNormalizationPreset("Entity Name");
      setSearchMode("auto");
      setCandidates(3);
    }
    setOutputMode("standard");
    setManualWeights(false);
    setCombinedScoring(false);
    setShowFormula(false);
    if (p === "Custom") {
      setAdvancedOpen(true);
    }
  };

  useEffect(() => {
    if (mappedFields.length === 0) return;
    setSelectedFields((current) => {
      const validIds = new Set(mappedFields.map((field) => field.id));
      const next = current.filter((id) => validIds.has(id));
      return next.length > 0 ? next : mappedFields.map((field) => field.id);
    });
    setFieldAlgorithms((current) => {
      const next = { ...current };
      mappedFields.forEach((field) => {
        if (!next[field.id]) next[field.id] = field.algorithm;
      });
      return next;
    });
  }, [mappedFields]);

  useEffect(() => {
    const fields = activeFields.length > 0 ? activeFields : mappedFields;
    if (fields.length === 0) {
      setWeights([]);
      return;
    }
    const baseWeight = Math.floor(100 / fields.length);
    const remainder = 100 - baseWeight * fields.length;
    setWeights((current) =>
      fields.map((field, index) => {
        const existing = current.find((item) => item.field === field.label);
        return {
          field: field.label,
          weight: existing?.weight ?? baseWeight + (index === 0 ? remainder : 0),
          method: fieldAlgorithms[field.id] ?? field.algorithm,
        };
      }),
    );
  }, [activeFields, fieldAlgorithms, mappedFields]);

  useEffect(() => {
    onValidityChange(configValid);
  }, [configValid, onValidityChange]);

  useEffect(() => {
    onConfigurationChange(configurationSnapshot);
  }, [configurationSnapshot, onConfigurationChange]);

  const applyRecommendation = () => {
    applyPreset("Balanced");
    setSearchMode("auto");
    setNormalizationPreset("Entity Name");
    toast.success(t("feedback.toast.recommendationApplied"));
  };

  return (
    <>
      <SectionTitle title={t("matching.config.title")} desc={t("matching.config.desc")} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <ConfigSection
            title={t("matching.config.quickSetup")}
            desc={t("matching.config.quickSetupDesc")}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(["Balanced", "Strict", "Exploratory", "Custom"] as Preset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={[
                    "min-h-28 rounded-lg border p-4 text-left transition-colors",
                    preset === p
                      ? "border-brand bg-brand/10 text-foreground shadow-sm"
                      : "border-border text-muted-foreground hover:bg-secondary/50",
                  ].join(" ")}
                  aria-pressed={preset === p}
                  data-testid={`config-preset-${p.toLowerCase()}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{presetLabel(p, t)}</p>
                    {p === "Balanced" && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {t("matching.config.recommendedLabel")}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed">{presetDescription(p, t)}</p>
                </button>
              ))}
            </div>
          </ConfigSection>

          <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{t("matching.config.recommended")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("matching.config.recommendedDesc")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={applyRecommendation}
                className="shrink-0 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90"
              >
                {t("matching.config.applyRecommendation")}
              </button>
            </div>
          </div>
        </div>

        <aside className="rounded-lg border border-border bg-card p-5" data-testid="config-summary">
          <p className="text-sm font-semibold">{t("matching.config.summaryTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("matching.config.summaryDesc")}
          </p>
          <div className="mt-4 space-y-3">
            {summaryItems.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="max-w-44 text-right text-xs font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-border bg-secondary/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("matching.config.normalization")}
            </p>
            <p className="mt-1 text-xs font-medium">{normalizationPreset}</p>
          </div>
        </aside>
      </div>

      <section className="mt-5 rounded-lg border border-border px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold">{t("matching.config.useStandardOutput")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("matching.config.useStandardOutputDesc")}
            </p>
          </div>
          <div className="inline-flex rounded-md border border-border bg-secondary/30 p-1">
            {(["standard", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setOutputMode(mode)}
                className={[
                  "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                  outputMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                data-testid={`config-output-${mode}`}
              >
                {mode === "standard"
                  ? t("matching.config.standardOutput")
                  : t("matching.config.customOutput")}
              </button>
            ))}
          </div>
        </div>
        {outputMode === "custom" && (
          <div
            className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4"
            data-testid="config-output-options"
          >
            {[
              "Matched",
              "Possible Match",
              "Unmatched",
              "Synchronization Summary",
              "Mapping Table",
              "Foreign Key",
              "Audit Trail",
              "Summary Report",
            ].map((o) => {
              const on = outputs.includes(o);
              return (
                <label
                  key={o}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 hover:bg-secondary/30"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setOutputs((prev) => (on ? prev.filter((x) => x !== o) : [...prev, o]))
                    }
                    className="size-3.5 accent-brand"
                  />
                  <span className="text-xs">{outputLabel(o, t)}</span>
                </label>
              );
            })}
          </div>
        )}
        {!outputValid && (
          <p className="mt-3 text-xs font-medium text-destructive">
            {t("matching.config.validationOutput")}
          </p>
        )}
      </section>

      <div className="mt-5 rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          aria-expanded={advancedOpen}
          data-testid="config-advanced-toggle"
        >
          <div>
            <p className="text-sm font-semibold">{t("matching.config.advanced")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("matching.config.advancedDesc")}
            </p>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>

        {advancedOpen && (
          <div
            className="space-y-4 border-t border-border px-5 py-5"
            data-testid="config-advanced-panel"
          >
            {/* 2. Strategy */}
            <ConfigSection
              title={t("matching.config.strategy")}
              desc={t("matching.config.strategyDesc")}
            >
              <div className="inline-grid w-full grid-cols-2 rounded-md border border-border bg-secondary/30 p-1 md:grid-cols-4">
                {(
                  [
                    ["Exact", t("matching.config.exactMatch")],
                    ["Fuzzy", t("matching.config.fuzzyMatch")],
                    ["Hybrid", t("matching.config.compositeHybrid")],
                    ["Rule-Based", t("matching.config.ruleBased")],
                  ] as [Strategy, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setStrategy(key);
                      if (!isCustom) setPreset("Custom");
                      setManualWeights(false);
                      setCombinedScoring(false);
                      setShowFormula(false);
                      setShowMoreAlgorithms(false);
                    }}
                    className={[
                      "rounded px-3 py-2 text-sm font-medium transition-colors",
                      strategy === key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                    data-testid={`config-strategy-${key.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </ConfigSection>

            <ConfigSection
              title={t("matching.config.fieldSelection")}
              desc={fieldSelectionDescription(strategy, t)}
            >
              <div className="flex flex-wrap gap-2" data-testid="config-field-selection">
                {mappedFields.map((field) => {
                  const selected = selectedFields.includes(field.id);
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() =>
                        setSelectedFields((current) =>
                          selected
                            ? current.filter((id) => id !== field.id)
                            : [...current, field.id],
                        )
                      }
                      className={[
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        selected
                          ? "border-brand bg-brand/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      ].join(" ")}
                    >
                      {field.label}
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                        {field.type}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!fieldSelectionValid && (
                <p
                  className="mt-3 text-xs font-medium text-destructive"
                  data-testid="config-validation"
                >
                  {strategy === "Hybrid"
                    ? t("matching.config.validationTwoFields")
                    : t("matching.config.validationOneField")}
                </p>
              )}
            </ConfigSection>

            {needsAlgorithms && (
              <ConfigSection
                title={t("matching.config.algorithmPerField")}
                desc={t("matching.config.algorithmPerFieldDesc")}
              >
                <div className="space-y-3" data-testid="config-algorithm-section">
                  {activeFields.map((field) => {
                    const visibleAlgorithms = Array.from(
                      new Set(
                        showMoreAlgorithms
                          ? [...RECOMMENDED_ALGORITHMS, ...MORE_ALGORITHMS]
                          : [field.algorithm, ...RECOMMENDED_ALGORITHMS],
                      ),
                    );
                    return (
                      <div
                        key={field.id}
                        className="grid gap-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0 lg:grid-cols-[190px_1fr]"
                      >
                        <div>
                          <p className="truncate text-sm font-medium">{field.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("matching.config.defaultAlgorithm", {
                              algorithm: field.algorithm,
                            })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {visibleAlgorithms.map((algorithm) => {
                            const active = fieldAlgorithms[field.id] === algorithm;
                            const recommended =
                              algorithm === field.algorithm ||
                              algorithm === "Jaro-Winkler" ||
                              algorithm === "Levenshtein" ||
                              algorithm === "Token Sort Ratio" ||
                              algorithm === "Token Set Ratio";
                            return (
                              <button
                                key={algorithm}
                                type="button"
                                onClick={() =>
                                  setFieldAlgorithms((current) => ({
                                    ...current,
                                    [field.id]: algorithm,
                                  }))
                                }
                                className={[
                                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                  active
                                    ? "border-brand bg-brand/10 text-foreground"
                                    : "border-border text-muted-foreground hover:bg-secondary",
                                ].join(" ")}
                              >
                                {algorithm}
                                {recommended && (
                                  <span className="ml-1 text-[10px] text-accent">
                                    {t("matching.config.recommendedShort")}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMoreAlgorithms((value) => !value)}
                  className="mt-4 text-xs font-semibold text-accent hover:underline"
                >
                  {showMoreAlgorithms
                    ? t("matching.config.hideMoreAlgorithms")
                    : t("matching.config.moreAlgorithms")}
                </button>
              </ConfigSection>
            )}

            {needsThreshold && (
              <ConfigSection
                title={t("matching.config.threshold")}
                desc={t("matching.config.thresholdDesc", { preset })}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <ThresholdInput
                    label={t("matching.config.autoMatch")}
                    tone="success"
                    value={autoMatch}
                    onChange={setAutoMatch}
                  />
                  <ThresholdInput
                    label={t("matching.config.manualReview")}
                    tone="warning"
                    value={review}
                    onChange={setReview}
                  />
                  <ThresholdInput
                    label={t("matching.config.noMatch")}
                    tone="muted"
                    value={noMatch}
                    onChange={setNoMatch}
                  />
                </div>
                {!thresholdValid && (
                  <p className="mt-3 text-xs font-medium text-destructive">
                    {t("matching.config.validationThreshold")}
                  </p>
                )}
              </ConfigSection>
            )}

            {needsCandidates && (
              <ConfigSection
                title={t("matching.config.candidateFiltering")}
                desc={t("matching.config.candidateFilteringDesc")}
              >
                <div className="mb-3 inline-flex rounded-md border border-border bg-secondary/30 p-1">
                  {(["auto", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSearchMode(m)}
                      className={[
                        "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                        searchMode === m
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {m === "auto"
                        ? t("matching.config.autoFiltering")
                        : t("matching.config.manualFiltering")}
                    </button>
                  ))}
                </div>
                {searchMode === "auto" ? (
                  <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t("matching.config.autoFilteringDesc")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {AUTO_RECOMMEND_KEYS.map((k) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent"
                        >
                          <Sparkles className="size-3" />
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_CANDIDATE_FIELDS.map((c) => {
                      const on = manualBlocks.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setManualBlocks((prev) =>
                              on ? prev.filter((x) => x !== c) : [...prev, c],
                            )
                          }
                          className={[
                            "rounded-full border px-3 py-1.5 text-xs font-medium",
                            on
                              ? "border-brand bg-brand/10 text-foreground"
                              : "border-border text-muted-foreground hover:bg-secondary",
                          ].join(" ")}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                )}
              </ConfigSection>
            )}

            {/* 5. Data Normalization */}
            <ConfigSection
              title={t("matching.config.normalizationTitle")}
              desc={t("matching.config.normalizationDesc")}
            >
              <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {t("matching.config.autoNormalization")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {normalizationProfileDescription(normalizationPreset, t)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setNormalizationMode((mode) => (mode === "auto" ? "manual" : "auto"))
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                  >
                    {normalizationMode === "auto"
                      ? t("matching.config.manualNormalization")
                      : t("matching.config.useAutoNormalization")}
                  </button>
                </div>
              </div>
              {normalizationMode === "manual" && (
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
                  {NORMALIZATION_PRESETS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      title={normalizationProfileDescription(option, t)}
                      onClick={() => setNormalizationPreset(option)}
                      className={[
                        "rounded-md border px-3 py-2 text-left text-xs font-medium",
                        normalizationPreset === option
                          ? "border-brand bg-brand/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      ].join(" ")}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {normalizationMode === "manual" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {normalizationProfileDescription(normalizationPreset, t)}
                </p>
              )}
            </ConfigSection>

            {needsCandidates && (
              <ConfigSection
                title={t("matching.config.candidateTitle")}
                desc={t("matching.config.candidateDesc")}
              >
                <div className="flex flex-wrap gap-2">
                  {([1, 3, 5, 10, "custom"] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCandidates(n)}
                      className={[
                        "rounded-md border px-3 py-2 text-sm font-medium tabular-nums",
                        candidates === n
                          ? "border-brand bg-brand/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      ].join(" ")}
                      data-testid={`config-candidate-${n}`}
                    >
                      {n === "custom"
                        ? t("matching.config.customCandidate")
                        : t("matching.config.topN", { count: n })}
                    </button>
                  ))}
                </div>
                {candidates === "custom" && (
                  <div className="mt-3 max-w-xs">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("matching.config.customCandidateLabel")}
                    </label>
                    <input
                      value={customCandidateCount}
                      onChange={(event) => setCustomCandidateCount(event.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                      inputMode="numeric"
                      data-testid="config-custom-candidate-input"
                    />
                    {!candidateCountValid && (
                      <p className="mt-1 text-xs font-medium text-destructive">
                        {t("matching.config.validationCandidate")}
                      </p>
                    )}
                  </div>
                )}
              </ConfigSection>
            )}

            {canUseWeights && (
              <ConfigSection
                title={t("matching.config.weightMode")}
                desc={t("matching.config.weightModeDesc")}
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setManualWeights(false)}
                    className={[
                      "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      !manualWeights
                        ? "border-brand bg-brand/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {t("matching.config.autoWeights")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualWeights(true)}
                    className={[
                      "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      manualWeights
                        ? "border-brand bg-brand/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                    data-testid="config-manual-weights"
                  >
                    {t("matching.config.manualWeights")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFormula((value) => !value)}
                    className={[
                      "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      showFormula
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {t("matching.config.showFormula")}
                  </button>
                </div>
                {!manualWeights && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("matching.config.autoWeightsDesc")}
                  </p>
                )}
              </ConfigSection>
            )}

            {isCustom && strategy === "Rule-Based" && (
              <ConfigSection
                title={t("matching.config.ruleBuilder")}
                desc={t("matching.config.ruleBuilderDesc")}
              >
                <label className="text-xs font-medium text-muted-foreground">
                  {t("matching.config.mandatoryRules")}
                </label>
                <textarea
                  value={ruleText}
                  onChange={(event) => setRuleText(event.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                  data-testid="config-rule-text"
                />
                {!ruleValid && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    {t("matching.config.validationRule")}
                  </p>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {hasNumberField && (
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("matching.config.numericTolerance")}
                      </p>
                      <p className="mt-0.5 text-xs font-medium">+/- 0.5%</p>
                    </div>
                  )}
                  {hasDateField && (
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("matching.config.dateTolerance")}
                      </p>
                      <p className="mt-0.5 text-xs font-medium">+/- 3 days</p>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCombinedScoring((value) => !value)}
                    className={[
                      "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      combinedScoring
                        ? "border-brand bg-brand/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                    data-testid="config-combined-scoring"
                  >
                    {t("matching.config.combinedScoring")}
                  </button>
                  {combinedScoring && (
                    <button
                      type="button"
                      onClick={() => setShowFormula((value) => !value)}
                      className={[
                        "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        showFormula
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      ].join(" ")}
                    >
                      {t("matching.config.showFormula")}
                    </button>
                  )}
                </div>
              </ConfigSection>
            )}

            {(needsManualWeights || needsRuleScoring) && (
              <ConfigSection
                title={t("matching.config.fieldWeights")}
                desc={t("matching.config.fieldWeightsDesc")}
              >
                <div className="mb-3 flex items-center justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    {t("matching.config.fieldWeightsHint")}
                  </p>
                  <p
                    className={`text-xs font-medium tabular-nums ${
                      totalWeight === 100 ? "text-success" : "text-destructive"
                    }`}
                    data-testid="config-total-weight"
                  >
                    {t("matching.config.total", { value: totalWeight })}
                  </p>
                </div>
                <div className="space-y-3" data-testid="config-field-weights">
                  {weights.map((w, i) => (
                    <div
                      key={w.field}
                      className="grid grid-cols-[minmax(120px,180px)_1fr_50px] items-center gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-mono">{w.field}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{w.method}</p>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={w.weight}
                        onChange={(e) =>
                          setWeights((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], weight: Number(e.target.value) };
                            return next;
                          })
                        }
                        className="w-full accent-brand"
                      />
                      <p className="text-right text-sm font-semibold tabular-nums">{w.weight}%</p>
                    </div>
                  ))}
                </div>
              </ConfigSection>
            )}

            {showFormula && (canUseWeights || needsRuleScoring) && (
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("matching.config.similarityFormula")}
                </p>
                <p className="mt-1 text-xs font-medium">{t("matching.config.weightedAverage")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function presetLabel(preset: Preset, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<Preset, Parameters<typeof t>[0]> = {
    Balanced: "matching.config.presetBalanced",
    Strict: "matching.config.presetStrict",
    Exploratory: "matching.config.presetExploratory",
    Custom: "matching.config.presetCustom",
  };
  return t(labels[preset]);
}

function presetDescription(preset: Preset, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<Preset, Parameters<typeof t>[0]> = {
    Balanced: "matching.config.presetBalancedDesc",
    Strict: "matching.config.presetStrictDesc",
    Exploratory: "matching.config.presetExploratoryDesc",
    Custom: "matching.config.presetCustomDesc",
  };
  return t(labels[preset]);
}

function strategyLabel(strategy: Strategy, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<Strategy, string> = {
    Hybrid: t("matching.config.compositeHybrid"),
    Exact: t("matching.config.exactMatch"),
    Fuzzy: t("matching.config.fuzzyMatch"),
    Composite: t("matching.config.compositeHybrid"),
    "Rule-Based": t("matching.config.ruleBased"),
  };
  return labels[strategy];
}

function strategyNeedsThreshold(strategy: Strategy) {
  return strategy === "Fuzzy" || strategy === "Hybrid" || strategy === "Composite";
}

function strategyNeedsCandidates(strategy: Strategy) {
  return strategy === "Fuzzy" || strategy === "Hybrid" || strategy === "Composite";
}

function strategyNeedsAlgorithms(strategy: Strategy) {
  return strategy === "Fuzzy" || strategy === "Hybrid" || strategy === "Composite";
}

function resolveConfiguredAlgorithm(
  field: {
    id: string;
    reference: string;
    input: string;
    type: FieldType;
    algorithm: ConfigureAlgorithm;
  },
  strategy: Strategy,
  fieldAlgorithms: Record<string, ConfigureAlgorithm>,
): ConfigureAlgorithm {
  if (strategy === "Exact" || strategy === "Rule-Based") {
    return defaultExactAlgorithmForField(field.reference, field.input, field.type);
  }

  return fieldAlgorithms[field.id] ?? field.algorithm;
}

function normalizeConfiguredAlgorithm(value: string): ConfigureAlgorithm {
  const algorithms: ConfigureAlgorithm[] = [...RECOMMENDED_ALGORITHMS, ...MORE_ALGORITHMS];
  return algorithms.includes(value as ConfigureAlgorithm)
    ? (value as ConfigureAlgorithm)
    : "Jaro-Winkler";
}

function fieldSelectionDescription(strategy: Strategy, t: ReturnType<typeof usePreferences>["t"]) {
  if (strategy === "Hybrid" || strategy === "Composite")
    return t("matching.config.fieldSelectionHybridDesc");
  if (strategy === "Rule-Based") return t("matching.config.fieldSelectionRuleDesc");
  if (strategy === "Fuzzy") return t("matching.config.fieldSelectionFuzzyDesc");
  return t("matching.config.fieldSelectionExactDesc");
}

function normalizationProfileDescription(
  profile: string,
  t: ReturnType<typeof usePreferences>["t"],
) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    Basic: "matching.config.normBasicDesc",
    "Text Standardization": "matching.config.normTextDesc",
    "Entity Name": "matching.config.normEntityDesc",
    Address: "matching.config.normAddressDesc",
    "Identifier Strict": "matching.config.normIdentifierDesc",
  };
  return labels[profile] ? t(labels[profile]) : profile;
}

function ConfigSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  const { t } = usePreferences();
  return (
    <section className="border border-border rounded-lg p-5 mb-4">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {children}
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
              className="mt-5 grid gap-3 rounded-lg border border-border bg-secondary/20 p-4 md:grid-cols-4"
              data-testid="run-configuration-summary"
            >
              <RunConfigItem
                label={t("matching.run.configPreset")}
                value={presetLabel(configuration.preset, t)}
              />
              <RunConfigItem
                label={t("matching.run.configStrategy")}
                value={strategyLabel(configuration.strategy, t)}
              />
              <RunConfigItem
                label={t("matching.run.configFields")}
                value={String(configuration.fields.length)}
              />
              <RunConfigItem
                label={t("matching.run.configCandidates")}
                value={
                  configuration.candidateGeneration
                    ? t("matching.config.topN", {
                        count: configuration.candidateGeneration.topN,
                      })
                    : t("matching.config.notRequired")
                }
              />
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
}: {
  jobId: string | null;
  canDecide: boolean;
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
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 8;

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
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const selectedCandidate =
    selected?.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    selected?.candidates[0] ??
    null;

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

  const decide = async (
    item: ReviewItem,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    candidate?: ReviewCandidate | null,
  ) => {
    if (!jobId) return;
    setSaving(true);
    try {
      const next = await saveReviewDecision(jobId, {
        inputRecordKey: item.input_record_key,
        matchingResultId: candidate?.id,
        decision,
      });
      setReview(next.review);
      const updated = next.review.items.find(
        (nextItem) => nextItem.input_record_key === item.input_record_key,
      );
      setSelected(updated ?? null);
      toast.success(
        decision === "accept_match" || decision === "select_candidate"
          ? t("feedback.toast.approved")
          : t("feedback.toast.rejected"),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setSaving(false);
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

    setSaving(true);
    try {
      const next = await saveReviewDecision(jobId, {
        inputRecordKey: keys[0],
        inputRecordKeys: keys,
        decision,
        scope,
        caseGroupId: group.id,
      });
      setReview(next.review);
      setSelectedGroupKeys((current) => ({ ...current, [group.id]: [] }));
      toast.success(
        t("matching.review.groupDecisionSaved", {
          count: next.decision.affected_records,
          skipped: next.decision.skipped_count ?? 0,
        }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("matching.review.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const undo = async (item: ReviewItem) => {
    if (!item.decision) return;
    await undoDecision(item.decision.id, item.input_record_key);
  };

  const undoDecision = async (decisionId: string, selectedInputKey?: string) => {
    if (!jobId) return;
    setSaving(true);
    try {
      const next = await undoReviewDecision(jobId, decisionId);
      setReview(next);
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
      setSaving(false);
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

      {viewMode === "case_groups" && (
        <CaseGroupsReview
          groups={visibleCaseGroups}
          filter={caseGroupFilter}
          counts={caseGroupCounts}
          items={items}
          saving={saving}
          selectedKeysByGroup={selectedGroupKeys}
          onFilterChange={setCaseGroupFilter}
          onToggleKey={toggleSelectedGroupKey}
          onOpenRecord={(item) => {
            const candidate = item.candidates[0] ?? null;
            setSelected(item);
            setSelectedCandidateId(candidate?.id ?? null);
          }}
          onReviewIndividually={(item) => {
            const candidate = item.candidates[0] ?? null;
            setViewMode("all_records");
            setFilter("possible_match");
            setSelected(item);
            setSelectedCandidateId(candidate?.id ?? null);
          }}
          onDecide={decideCaseGroup}
          onUndo={undoDecision}
          canDecide={canDecide}
        />
      )}

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
                      return (
                        <tr
                          key={item.input_record_key}
                          onClick={() => {
                            setSelected(item);
                            setSelectedCandidateId(candidate?.id ?? null);
                          }}
                          className="hover:bg-secondary/40 cursor-pointer"
                        >
                          <td className="px-4 py-3 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {recordHeadline(item.input_record)}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {recordMeta(item.input_record)}
                            </p>
                          </td>
                          <td className="px-4 py-3 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {hasReferenceCandidate
                                ? recordHeadline(candidate?.reference_record ?? {})
                                : t("matching.review.noCandidate")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {hasReferenceCandidate
                                ? recordMeta(candidate?.reference_record ?? {})
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
                                  disabled={!hasReferenceCandidate || saving}
                                  className="px-2.5 py-1 rounded-md bg-brand text-brand-foreground text-xs font-medium"
                                >
                                  {t("matching.review.accept")}
                                </button>
                                <button
                                  onClick={() => decide(item, "mark_unmatched", null)}
                                  disabled={saving}
                                  className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-secondary"
                                >
                                  {t("matching.review.markUnmatched")}
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
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
                <span>
                  {t("matching.review.count", { filtered: filtered.length, total: items.length })} ·{" "}
                  {t("matching.review.page", { page, total: totalPages })}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2 py-1 rounded-md border border-border disabled:opacity-40 hover:bg-secondary"
                  >
                    {t("common.prev")}
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2 py-1 rounded-md border border-border disabled:opacity-40 hover:bg-secondary"
                  >
                    {t("common.next")}
                  </button>
                </div>
              </div>
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
                        disabled={saving}
                        className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                      >
                        {t("matching.review.undo")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <RecordPanel title={t("matching.review.input")} record={selected.input_record} />
                <RecordPanel
                  title={t("matching.review.reference")}
                  record={
                    selectedCandidate?.reference_record_key
                      ? selectedCandidate.reference_record
                      : {}
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
                          "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs",
                          selectedCandidate?.id === candidate.id
                            ? "border-brand bg-brand/10"
                            : "border-border hover:bg-secondary",
                        ].join(" ")}
                      >
                        <span className="min-w-0 truncate">
                          #{candidate.rank} {recordHeadline(candidate.reference_record)}
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

              <details className="mt-5 rounded-lg border border-border p-3" open>
                <summary className="cursor-pointer text-xs font-semibold">
                  {t("matching.review.supportingFields")}
                </summary>
                <div className="mt-3 space-y-2">
                  {(selectedCandidate?.field_scores ?? []).map((field) => (
                    <FieldComparison
                      key={`${field.reference_column}-${field.input_column}`}
                      field={field}
                      inputRecord={selected.input_record}
                      referenceRecord={selectedCandidate?.reference_record ?? {}}
                    />
                  ))}
                </div>
              </details>

              <DecisionHistory history={selected.decision_history ?? []} />

              <div className="mt-6 flex gap-2">
                {canDecide && (
                  <>
                    <button
                      onClick={() => decide(selected, "accept_match", selectedCandidate)}
                      disabled={!selectedCandidate?.reference_record_key || saving}
                      className="flex-1 px-3 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-40"
                    >
                      {t("matching.review.accept")}
                    </button>
                    <button
                      onClick={() => decide(selected, "reject_match", selectedCandidate)}
                      disabled={!selectedCandidate?.reference_record_key || saving}
                      className="flex-1 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary disabled:opacity-40"
                    >
                      {t("matching.review.reject")}
                    </button>
                    <button
                      onClick={() => decide(selected, "mark_unmatched", null)}
                      disabled={saving}
                      className="flex-1 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary disabled:opacity-40"
                    >
                      {t("matching.review.markUnmatched")}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary"
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
  items,
  canDecide,
  onDecide,
  onFilterChange,
  onOpenRecord,
  onReviewIndividually,
  onToggleKey,
  onUndo,
  saving,
  selectedKeysByGroup,
}: {
  counts: Record<CaseGroupFilter, number>;
  filter: CaseGroupFilter;
  groups: ReviewCaseGroup[];
  items: ReviewItem[];
  saving: boolean;
  canDecide: boolean;
  selectedKeysByGroup: Record<string, string[]>;
  onFilterChange: (filter: CaseGroupFilter) => void;
  onToggleKey: (group: ReviewCaseGroup, key: string) => void;
  onOpenRecord: (item: ReviewItem) => void;
  onReviewIndividually: (item: ReviewItem) => void;
  onUndo: (decisionId: string) => void;
  onDecide: (
    group: ReviewCaseGroup,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    scope: "selected" | "group",
  ) => void;
}) {
  const { t } = usePreferences();
  const itemsByKey = useMemo(
    () => new Map(items.map((item) => [item.input_record_key, item])),
    [items],
  );

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
          const selectedKeys = selectedKeysByGroup[group.id] ?? [];
          const representative = group.representative;
          const candidate = representative.candidates[0] ?? null;
          const previewItems =
            group.representative_samples ??
            group.item_keys
              .map((key) => itemsByKey.get(key))
              .filter((item): item is ReviewItem => Boolean(item))
              .slice(0, 3);
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
                      {recordHeadline(representative.input_record)}
                    </span>
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
                      disabled={saving}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                    >
                      {t("matching.review.undo")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenRecord(representative)}
                        disabled={saving}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                      >
                        {t("matching.review.reviewMore")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onReviewIndividually(representative)}
                        disabled={saving}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                      >
                        {t("matching.review.reviewIndividually")}
                      </button>
                      {canDecide && (
                        <>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "accept_match", "group")}
                            disabled={!group.eligible_for_bulk || !canAccept || saving}
                            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40"
                          >
                            {t("matching.review.applyGroupAccept")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "reject_match", "group")}
                            disabled={!group.eligible_for_bulk || !canAccept || saving}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                          >
                            {t("matching.review.applyGroupReject")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecide(group, "mark_unmatched", "group")}
                            disabled={!group.eligible_for_bulk || saving}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                          >
                            {t("matching.review.applyGroupUnmatched")}
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

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  {t("matching.review.groupExamples")}
                </summary>
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  <table className="w-full min-w-[780px] text-sm">
                    <thead className="bg-secondary/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left"></th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("matching.review.input")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("matching.review.reference")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("matching.review.group")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("matching.review.similarity")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">{t("common.action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewItems.map((item) => {
                        const rowCandidate = item.candidates[0] ?? null;
                        return (
                          <tr key={item.input_record_key}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedKeys.includes(item.input_record_key)}
                                disabled={!group.eligible_for_bulk || saving || !canDecide}
                                onChange={() => onToggleKey(group, item.input_record_key)}
                                aria-label={t("matching.review.selectRecord")}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <p className="truncate font-medium">
                                {recordHeadline(item.input_record)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {recordMeta(item.input_record)}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <p className="truncate font-medium">
                                {rowCandidate?.reference_record_key
                                  ? recordHeadline(rowCandidate.reference_record)
                                  : t("matching.review.noCandidate")}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {rowCandidate?.reference_record_key
                                  ? recordMeta(rowCandidate.reference_record)
                                  : t("matching.review.noCandidateDesc")}
                              </p>
                            </td>
                            <td className="px-3 py-2">
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
                            <td
                              className={`px-3 py-2 text-right tabular-nums font-semibold ${scoreTone(rowCandidate?.score ?? 0)}`}
                            >
                              {rowCandidate ? `${rowCandidate.score}%` : "-"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => onOpenRecord(item)}
                                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                              >
                                {t("matching.review.compare")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!isResolved && canDecide && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDecide(group, "accept_match", "selected")}
                      disabled={
                        !group.eligible_for_bulk ||
                        selectedKeys.length === 0 ||
                        !canAccept ||
                        saving
                      }
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40"
                    >
                      {t("matching.review.applySelectedAccept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(group, "mark_unmatched", "selected")}
                      disabled={!group.eligible_for_bulk || selectedKeys.length === 0 || saving}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                    >
                      {t("matching.review.applySelectedUnmatched")}
                    </button>
                  </div>
                )}
              </details>

              <DecisionHistory history={group.decision_history ?? []} />
            </section>
          );
        })
      )}
    </div>
  );
}

function RecordPanel({
  emptyText,
  record,
  title,
}: {
  emptyText?: string;
  record: Record<string, string | number | boolean | null>;
  title: string;
}) {
  const entries = Object.entries(record).slice(0, 6);

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{emptyText ?? "-"}</p>
      ) : (
        <dl className="mt-2 space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[110px_1fr] gap-2 text-xs">
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="break-words font-medium">{formatRecordValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
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

function recordHeadline(record: Record<string, string | number | boolean | null>) {
  const value = Object.values(record).find((item) => item !== null && String(item).trim() !== "");

  return value === undefined ? "-" : String(value);
}

function recordMeta(record: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(record)
    .filter(([, value]) => value !== null && String(value).trim() !== "")
    .slice(1, 3)
    .map(([key, value]) => `${key}: ${formatRecordValue(value)}`);

  return entries.length > 0 ? entries.join(" · ") : "-";
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
  if (status === "matched") return t("matching.review.groupMatched");
  if (status === "possible_match") return t("matching.review.groupPossible");
  if (status === "unmatched") return t("matching.review.groupUnmatched");
  return t("matching.review.groupUnmatched");
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

function StepSynchronize({
  jobId,
  syncState,
  onBackToReview,
  onSyncStateChange,
  canExecute,
}: {
  jobId: string | null;
  syncState: SyncState | null;
  onBackToReview: () => void;
  onSyncStateChange: (state: SyncState | null) => void;
  canExecute: boolean;
}) {
  const { t } = usePreferences();
  const [review, setReview] = useState<ReviewResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"recommended" | "custom">("recommended");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [conflictAction, setConflictAction] = useState("Keep reference and fill blanks");
  const [syncAudit, setSyncAudit] = useState<SyncState | null>(syncState);

  useEffect(() => {
    if (!jobId) return;

    const existing = localStorage.getItem(syncAuditKey(jobId));
    const restored = existing ? normalizeSyncState(JSON.parse(existing)) : syncState;
    setSyncAudit(restored ?? null);
    if (restored?.confirmed && !syncState?.confirmed) onSyncStateChange(restored);
    setLoading(true);
    setError(null);
    fetchReviewResults(jobId)
      .then(setReview)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : t("matching.review.loadFailed")),
      )
      .finally(() => setLoading(false));
  }, [jobId, onSyncStateChange, syncState, t]);

  const items = review?.items ?? [];
  const pendingReview = items.filter(
    (item) =>
      !item.decision &&
      ((item.display_status ?? item.status) === "need_review" || item.status === "possible_match"),
  ).length;
  const matched = items.filter((item) =>
    ["auto_matched", "manual_accepted", "matched"].includes(item.display_status ?? item.status),
  ).length;
  const newEntities = items.filter((item) =>
    ["confirmed_unmatched", "unmatched"].includes(item.display_status ?? item.status),
  ).length;
  const excluded = items.filter((item) => item.display_status === "manual_rejected").length;
  const referenceKeys = new Set(
    items.flatMap((item) =>
      item.candidates
        .map((candidate) => candidate.reference_record_key)
        .filter((key): key is string => Boolean(key)),
    ),
  );
  const referenceBefore = referenceKeys.size;
  const referenceAfter = referenceBefore + newEntities;
  const readyToSync = Boolean(jobId && !loading && !error && pendingReview === 0);

  const confirmSync = () => {
    if (!jobId || !readyToSync) return;
    const existing = localStorage.getItem(syncAuditKey(jobId));

    if (existing) {
      setSyncAudit(JSON.parse(existing));
      toast.info(t("matching.sync.alreadySynced"));
      return;
    }

    const audit = {
      confirmed: true,
      id: `sync-${jobId}`,
      auditId: `sync-${jobId}`,
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      planMode: mode,
      matched,
      newEntities,
      excluded,
      referenceBefore,
      referenceAfter,
      conflictAction,
    };
    localStorage.setItem(syncAuditKey(jobId), JSON.stringify(audit));
    setSyncAudit(audit);
    onSyncStateChange(audit);
    toast.success(t("matching.sync.confirmed"));
  };

  return (
    <>
      <SectionTitle title={t("matching.sync.title")} desc={t("matching.sync.desc")} />

      {!jobId && (
        <EmptyState
          icon={ClipboardCheck}
          title={t("matching.sync.noReviewTitle")}
          description={t("matching.sync.noReviewDesc")}
        />
      )}

      {jobId && loading && (
        <div className="rounded-lg border border-border bg-secondary/20 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-accent" />
            <p className="text-sm font-semibold">{t("matching.sync.loading")}</p>
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
        <div className="space-y-5">
          {pendingReview > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t("matching.sync.pendingTitle")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("matching.sync.pendingDesc", { count: pendingReview })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onBackToReview}
                  className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground"
                >
                  {t("matching.sync.backToReview")}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <SyncMetric label={t("matching.sync.previewMatched")} value={String(matched)} />
            <SyncMetric label={t("matching.sync.previewNew")} value={String(newEntities)} />
            <SyncMetric label={t("matching.sync.previewExcluded")} value={String(excluded)} />
            <SyncMetric label={t("matching.sync.previewPending")} value={String(pendingReview)} />
            <SyncMetric
              label={t("matching.sync.referenceBefore")}
              value={String(referenceBefore)}
            />
            <SyncMetric
              label={t("matching.sync.referenceAfter")}
              value={String(referenceAfter)}
              strong
            />
          </div>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{t("matching.sync.recommendedPlan")}</p>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  {t("matching.sync.recommendedDesc")}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
                {(["recommended", "custom"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={[
                      "rounded-md px-3 py-1.5 text-xs font-semibold",
                      mode === item
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {item === "recommended"
                      ? t("matching.sync.useRecommendation")
                      : t("matching.sync.customize")}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SyncPlanLine
                title={t("matching.sync.planMatched")}
                desc={t("matching.sync.planMatchedDesc")}
              />
              <SyncPlanLine
                title={t("matching.sync.planNew")}
                desc={t("matching.sync.planNewDesc")}
              />
              <SyncPlanLine
                title={t("matching.sync.planRejected")}
                desc={t("matching.sync.planRejectedDesc")}
              />
              <SyncPlanLine
                title={t("matching.sync.planConflict")}
                desc={t("matching.sync.planConflictDesc")}
              />
            </div>

            {mode === "custom" && (
              <details className="mt-5 rounded-lg border border-border p-4" open>
                <summary className="cursor-pointer text-sm font-semibold">
                  {t("matching.sync.manualSettings")}
                </summary>
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(event) => setUpdateExisting(event.target.checked)}
                  />
                  {t("matching.sync.updateExistingReference")}
                </label>
                {updateExisting && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold">{t("matching.sync.conflictTitle")}</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      {[
                        "Keep reference and fill blanks",
                        "Keep reference value",
                        "Merge non-empty fields",
                      ].map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setConflictAction(option)}
                          className={[
                            "rounded-md border px-3 py-2 text-left text-xs font-medium",
                            conflictAction === option
                              ? "border-brand bg-brand/10"
                              : "border-border text-muted-foreground hover:bg-secondary",
                          ].join(" ")}
                        >
                          {syncLabel(option, t)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </details>
            )}
          </section>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{t("matching.sync.previewTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {readyToSync ? t("matching.sync.readyDesc") : t("matching.sync.notReadyDesc")}
                </p>
                {syncAudit && (
                  <p className="mt-2 text-xs text-success">
                    {t("matching.sync.auditSaved")}: {syncAudit.auditId ?? syncAudit.id} ·{" "}
                    {syncAudit.confirmedAt ?? syncAudit.createdAt}
                  </p>
                )}
              </div>
              {canExecute && (
                <button
                  type="button"
                  onClick={confirmSync}
                  disabled={!readyToSync}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-40"
                >
                  {t("matching.sync.confirm")}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function SyncPlanLine({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-md bg-secondary/30 px-3 py-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function syncAuditKey(jobId: string) {
  return `batchmatch.sync.${jobId}`;
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

function syncLabel(value: string, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    "Keep reference and fill blanks": "matching.sync.keepReferenceFillBlanks",
    "Keep reference value": "matching.sync.keepReference",
    "Merge non-empty fields": "matching.sync.mergeNonEmpty",
  };
  return labels[value] ? t(labels[value]) : value;
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
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [selectedStatuses, setSelectedStatuses] = useState<ExportStatus[]>([
    "matched",
    "new",
    "rejected",
  ]);
  const [includeScore, setIncludeScore] = useState(true);
  const [includeReferenceKey, setIncludeReferenceKey] = useState(true);
  const [includeReviewFields, setIncludeReviewFields] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  useEffect(() => {
    if (!jobId) return;

    setLoading(true);
    setError(null);
    fetchReviewResults(jobId)
      .then((data) => {
        setReview(data);
        const columns = exportColumns(data.items);
        setSelectedColumns(columns.slice(0, 16));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : t("matching.review.loadFailed")),
      )
      .finally(() => setLoading(false));
  }, [jobId, t]);

  const items = review?.items ?? [];
  const allColumns = exportColumns(items);
  const activeStatuses =
    mode === "default" ? (["matched", "new", "rejected"] as ExportStatus[]) : selectedStatuses;
  const exportRows = buildExportRows(items, {
    columns: mode === "default" ? allColumns : selectedColumns,
    includeReferenceKey: mode === "default" || includeReferenceKey,
    includeReviewFields: mode === "default" || includeReviewFields,
    includeScore: mode === "default" || includeScore,
    statuses: activeStatuses,
  });
  const summaryRows = exportSummaryRows(items);
  const exportFileName = `batchmatch-${review?.job.name ?? "matching-results"}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const statusCounts = countExportStatuses(items);

  const toggleStatus = (status: ExportStatus) => {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  };

  const toggleColumn = (column: string) => {
    setSelectedColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  };

  const runExport = () => {
    if (!review || exportRows.rows.length === 0) return;

    setExporting(true);
    try {
      if (format === "csv") {
        downloadCsv(exportFileName, exportRows);
      } else {
        downloadXlsx(exportFileName, [exportRows, summaryRows]);
      }
      const historyEntry = buildStoredExportHistoryEntry({
        fileName: exportFileName,
        format,
        recordCount: exportRows.rows.length,
        mode,
        statuses: activeStatuses,
        columns: mode === "default" ? allColumns : selectedColumns,
        includeReferenceKey: mode === "default" || includeReferenceKey,
        includeReviewFields: mode === "default" || includeReviewFields,
        includeScore: mode === "default" || includeScore,
        sourceJobId: jobId,
      });
      onExportHistoryChange((current) => [historyEntry, ...current]);
      toast.success(t("matching.export.success"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("matching.export.failed"));
    } finally {
      setExporting(false);
    }
  };

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
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <SyncMetric
              label={t("matching.export.previewMatched")}
              value={String(statusCounts.matched)}
            />
            <SyncMetric label={t("matching.export.previewNew")} value={String(statusCounts.new)} />
            <SyncMetric
              label={t("matching.export.previewRejected")}
              value={String(statusCounts.rejected)}
            />
            <SyncMetric
              label={t("matching.export.previewRows")}
              value={String(exportRows.rows.length)}
              strong
            />
          </div>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{t("matching.export.defaultTitle")}</p>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  {t("matching.export.defaultDesc")}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
                {(["default", "custom"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={[
                      "rounded-md px-3 py-1.5 text-xs font-semibold",
                      mode === item
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {item === "default"
                      ? t("matching.export.defaultMode")
                      : t("matching.export.customMode")}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ExportPlanLine
                title={t("matching.export.finalMatched")}
                desc={t("matching.export.finalMatchedDesc")}
              />
              <ExportPlanLine
                title={t("matching.export.newEntities")}
                desc={t("matching.export.newEntitiesDesc")}
              />
              <ExportPlanLine
                title={t("matching.export.rejectedRecords")}
                desc={t("matching.export.rejectedRecordsDesc")}
              />
              <ExportPlanLine
                title={t("matching.export.reviewSummary")}
                desc={t("matching.export.reviewSummaryDesc")}
              />
            </div>

            {mode === "custom" && (
              <details className="mt-5 rounded-lg border border-border p-4" open>
                <summary className="cursor-pointer text-sm font-semibold">
                  {t("matching.export.customOptions")}
                </summary>

                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold">{t("matching.export.statusRecords")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["matched", "new", "rejected", "pending"] as ExportStatus[]).map(
                        (status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => toggleStatus(status)}
                            className={[
                              "rounded-md border px-3 py-1.5 text-xs font-semibold",
                              selectedStatuses.includes(status)
                                ? "border-brand bg-brand/10"
                                : "border-border text-muted-foreground hover:bg-secondary",
                            ].join(" ")}
                          >
                            {exportStatusLabel(status, t)}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold">{t("matching.export.includeFields")}</p>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeScore}
                          onChange={(event) => setIncludeScore(event.target.checked)}
                        />
                        {t("matching.export.includeScore")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeReferenceKey}
                          onChange={(event) => setIncludeReferenceKey(event.target.checked)}
                        />
                        {t("matching.export.includeReferenceKey")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeReviewFields}
                          onChange={(event) => setIncludeReviewFields(event.target.checked)}
                        />
                        {t("matching.export.includeReviewFields")}
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-xs font-semibold">{t("matching.export.columns")}</p>
                  <div className="mt-2 grid max-h-52 gap-2 overflow-auto rounded-md border border-border p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {allColumns.map((column) => (
                      <label key={column} className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(column)}
                          onChange={() => toggleColumn(column)}
                        />
                        <span className="truncate">{column}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </section>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{t("matching.export.fileReady")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{exportFileName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("matching.export.previewCount", { count: exportRows.rows.length })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["xlsx", "csv"] as ExportFormat[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFormat(item)}
                    className={[
                      "rounded-md border px-3 py-2 text-xs font-semibold uppercase",
                      format === item
                        ? "border-brand bg-brand/10"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {item}
                  </button>
                ))}
                {canExecute && (
                  <button
                    type="button"
                    onClick={runExport}
                    disabled={exporting || exportRows.rows.length === 0}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-40"
                  >
                    {exporting ? t("matching.export.exporting") : t("matching.export.download")}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ExportPlanLine({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-md bg-secondary/30 px-3 py-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function exportStatusLabel(status: ExportStatus, t: ReturnType<typeof usePreferences>["t"]) {
  if (status === "matched") return t("matching.export.statusMatched");
  if (status === "new") return t("matching.export.statusNew");
  if (status === "rejected") return t("matching.export.statusRejected");
  return t("matching.export.statusPending");
}
