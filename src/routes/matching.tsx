import { createFileRoute, Link } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Stepper } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/feedback-states";
import { wizardSteps, reviewQueue, synchronizationSummary } from "@/lib/dummy-data";
import { ApiError, inspectDataset, type DatasetInspectResult, type DatasetRole } from "@/lib/api";
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
      { title: "Matching Workflow - BatchMatch" },
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
  const [step, setStep] = useState(1);
  const [reference, setReference] = useState<UploadedFile | null>(null);
  const [input, setInput] = useState<UploadedFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [columnMappings, setColumnMappings] = useState<ColumnMappingDraft[]>([]);
  const [configureValid, setConfigureValid] = useState(true);
  const [matchingConfiguration, setMatchingConfiguration] = useState<MatchingConfiguration | null>(
    null,
  );

  const referenceColumns = reference?.result?.columns ?? [];
  const inputColumns = input?.result?.columns ?? [];
  const hasCompletedMapping = columnMappings.some((mapping) => mapping.inputColumnId);
  const canAdvance =
    (step !== 1 || (reference?.status === "success" && input?.status === "success")) &&
    (step !== 3 || hasCompletedMapping) &&
    (step !== 4 || configureValid);
  const localizedSteps = wizardSteps.map((s) => ({
    ...s,
    title: t(`step.${stepKey(s.id)}`),
    desc: t(`step.${stepKey(s.id)}Desc`),
  }));

  const startRun = () => {
    toast.info(t("feedback.toast.runStarted"));
    setRunState("running");
    setProgress(0);
    const shouldFail = Math.random() < 0.15;
    const iv = window.setInterval(() => {
      setProgress((p) => {
        const next = p + 8 + Math.random() * 6;
        if (next >= 100) {
          window.clearInterval(iv);
          setRunState(shouldFail ? "failed" : "success");
          return 100;
        }
        return next;
      });
    }, 300);
  };

  const handleInspectFile = async (role: DatasetRole, file: File) => {
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
      setFile({ name: file.name, size: file.size, status: "success", result });
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

    if (inspectedReferenceColumns.length === 0 || inspectedInputColumns.length === 0) {
      setColumnMappings([]);
      setMatchingConfiguration(null);
      return;
    }

    setColumnMappings(suggestColumnMappings(inspectedReferenceColumns, inspectedInputColumns));
    setMatchingConfiguration(null);
  }, [reference?.result, input?.result]);

  useEffect(() => {
    if (runState === "success") toast.success(t("feedback.toast.runComplete"));
    if (runState === "failed") toast.error(t("feedback.toast.runFailed"));
  }, [runState, t]);

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader title={t("matching.title")} description={t("matching.description")} />

        {/* Horizontal stepper */}
        <Card className="p-5 mb-6 sticky top-16 z-10">
          <Stepper steps={localizedSteps} current={step} onSelect={setStep} />
        </Card>

        <Card className="p-6">
          {step === 1 && (
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
          {step === 2 && <StepProfile reference={reference?.result} input={input?.result} />}
          {step === 3 && (
            <StepColumnMapping
              referenceColumns={referenceColumns}
              inputColumns={inputColumns}
              mappings={columnMappings}
              setMappings={setColumnMappings}
            />
          )}
          {step === 4 && (
            <StepConfig
              mappings={columnMappings}
              configuration={matchingConfiguration}
              onConfigurationChange={setMatchingConfiguration}
              onValidityChange={setConfigureValid}
            />
          )}
          {step === 5 && (
            <StepRun
              state={runState}
              progress={progress}
              configuration={matchingConfiguration}
              onStart={() => setRunConfirmOpen(true)}
              onRetry={() => {
                setRunState("idle");
                setProgress(0);
              }}
              onBack={() => setStep(4)}
            />
          )}
          {step === 6 && <StepReview />}
          {step === 7 && <StepSynchronize />}
          {step === 8 && <StepExport />}

          {/* Nav */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
            <button
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="size-4" />
              {t("common.back")}
            </button>
            <p className="text-xs text-muted-foreground">
              {t("common.stepOf", { current: step, total: wizardSteps.length })}
            </p>
            {step === wizardSteps.length ? (
              <Link
                to="/results"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand text-brand-foreground hover:opacity-90"
              >
                {t("common.goToResults")}
                <ArrowRight className="size-4" />
              </Link>
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
  onStart,
  onRetry,
  onBack,
}: {
  state: RunState;
  progress: number;
  configuration: MatchingConfiguration | null;
  onStart: () => void;
  onRetry: () => void;
  onBack: () => void;
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
            <button
              onClick={onStart}
              className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90"
            >
              {t("matching.run.start")}
            </button>
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
            <p className="text-xs text-muted-foreground mt-1">{t("matching.run.completeDesc")}</p>
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
              {t("matching.run.failedDesc", { progress: Math.round(progress) })}
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

type ReviewRow = (typeof reviewQueue)[number];

function StepReview() {
  const { t } = usePreferences();
  const [items, setItems] = useState(reviewQueue);
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 8;

  const filtered = items
    .filter(
      (r) =>
        !query ||
        r.refName.toLowerCase().includes(query.toLowerCase()) ||
        r.inputName.toLowerCase().includes(query.toLowerCase()) ||
        r.id.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sortDesc ? b.score - a.score : a.score - b.score));

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const decide = (id: string, decision: "approved" | "rejected") => {
    setItems((prev) => prev.filter((p) => p.id !== id));
    setSelected(null);
    toast.success(
      t(decision === "approved" ? "feedback.toast.approved" : "feedback.toast.rejected"),
    );
  };

  const recommendation = (score: number) =>
    score >= 90
      ? t("matching.review.recApprove")
      : score >= 80
        ? t("matching.review.recReview")
        : t("matching.review.recReject");

  if (items.length === 0) {
    return (
      <>
        <SectionTitle title={t("matching.review.title")} desc={t("matching.review.emptyDesc")} />
        <EmptyState
          icon={ClipboardCheck}
          title={t("matching.review.allCaughtUp")}
          description={t("matching.review.none")}
        />
      </>
    );
  }

  return (
    <>
      <SectionTitle title={t("matching.review.title")} desc={t("matching.review.desc")} />

      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5 w-64 bg-background">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t("matching.review.search")}
            className="w-full bg-transparent outline-none text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("matching.review.count", { filtered: filtered.length, total: items.length })}
        </p>
      </div>

      {/* table */}
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
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col />
                <col />
                <col style={{ width: "140px" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "180px" }} />
              </colgroup>
              <thead className="bg-secondary/60 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">
                    {t("matching.review.reference")}
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium">
                    {t("matching.review.input")}
                  </th>
                  <th
                    className="text-right px-4 py-2.5 font-medium cursor-pointer select-none"
                    onClick={() => setSortDesc((v) => !v)}
                  >
                    {t("matching.review.similarity")} {sortDesc ? "↓" : "↑"}
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium">
                    {t("matching.review.recommendation")}
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium">{t("common.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map((r) => {
                  const tone =
                    r.score >= 90
                      ? "text-success"
                      : r.score >= 80
                        ? "text-warning"
                        : "text-destructive";
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="hover:bg-secondary/40 cursor-pointer"
                    >
                      <td className="px-4 py-3 min-w-0">
                        <p className="text-sm font-medium truncate">{r.refName}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.refMeta}</p>
                      </td>
                      <td className="px-4 py-3 min-w-0">
                        <p className="text-sm font-medium truncate">{r.inputName}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.inputMeta}</p>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${tone}`}>
                        {r.score}%
                      </td>
                      <td className="px-4 py-3 text-xs">{recommendation(r.score)}</td>
                      <td className="px-4 py-3">
                        <div
                          className="flex justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => decide(r.id, "approved")}
                            className="px-2.5 py-1 rounded-md bg-brand text-brand-foreground text-xs font-medium"
                          >
                            {t("common.approve")}
                          </button>
                          <button
                            onClick={() => decide(r.id, "rejected")}
                            className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-secondary"
                          >
                            {t("common.reject")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
            <span>{t("matching.review.page", { page, total: totalPages })}</span>
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

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{t("matching.review.compare")}</SheetTitle>
                <SheetDescription>
                  {selected.id} - {t("matching.review.similarity")} {selected.score}%
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 grid grid-cols-2 gap-4">
                {[
                  {
                    title: t("results.table.reference"),
                    name: selected.refName,
                    meta: selected.refMeta,
                  },
                  {
                    title: t("results.table.input"),
                    name: selected.inputName,
                    meta: selected.inputMeta,
                  },
                ].map((s) => (
                  <div key={s.title} className="border border-border rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {s.title}
                    </p>
                    <p className="text-sm font-medium mt-1 break-words">{s.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{s.meta}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold mb-2">{t("matching.review.columnScores")}</p>
                <div className="space-y-2">
                  {[
                    { col: t("matching.review.name"), score: selected.score },
                    {
                      col: t("matching.review.identifier"),
                      score: Math.min(100, selected.score + 4),
                    },
                    { col: t("matching.review.address"), score: Math.max(0, selected.score - 10) },
                  ].map((c) => (
                    <div key={c.col} className="grid grid-cols-[100px_1fr_50px] items-center gap-3">
                      <span className="text-xs">{c.col}</span>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-brand" style={{ width: `${c.score}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-right">
                        {Math.round(c.score)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => decide(selected.id, "approved")}
                  className="flex-1 px-3 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold"
                >
                  {t("common.approve")}
                </button>
                <button
                  onClick={() => decide(selected.id, "rejected")}
                  className="flex-1 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary"
                >
                  {t("common.reject")}
                </button>
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

function StepSynchronize() {
  const { t } = usePreferences();
  const [matchedAction, setMatchedAction] = useState("Drop / Skip matched input records");
  const [unmatchedAction, setUnmatchedAction] = useState("Append unmatched input records");
  const [possibleAction, setPossibleAction] = useState("Send to manual review");
  const [conflictAction, setConflictAction] = useState("Merge non-empty fields");

  return (
    <>
      <SectionTitle title={t("matching.sync.title")} desc={t("matching.sync.desc")} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <SyncOptionGroup
            title={t("matching.sync.matchedTitle")}
            desc={t("matching.sync.matchedDesc")}
            value={matchedAction}
            onChange={setMatchedAction}
            options={[
              "Drop / Skip matched input records",
              "Update existing reference records",
              "Keep both records",
            ]}
          />

          <SyncOptionGroup
            title={t("matching.sync.unmatchedTitle")}
            desc={t("matching.sync.unmatchedDesc")}
            value={unmatchedAction}
            onChange={setUnmatchedAction}
            options={[
              "Append unmatched input records",
              "Export unmatched separately",
              "Ignore unmatched records",
            ]}
          />

          <SyncOptionGroup
            title={t("matching.sync.possibleTitle")}
            desc={t("matching.sync.possibleDesc")}
            value={possibleAction}
            onChange={setPossibleAction}
            options={["Send to manual review", "Export separately", "Ignore until reviewed"]}
          />

          <SyncOptionGroup
            title={t("matching.sync.conflictTitle")}
            desc={t("matching.sync.conflictDesc")}
            value={conflictAction}
            onChange={setConflictAction}
            options={[
              "Keep reference value",
              "Replace with input value",
              "Merge non-empty fields",
              "Send conflict to manual review",
            ]}
          />
        </div>

        <aside className="h-fit rounded-lg border border-border bg-secondary/20 p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold">{t("matching.sync.summaryPreview")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("matching.sync.summaryDesc")}</p>
          </div>
          <div className="space-y-3">
            <SyncMetric
              label={t("matching.sync.drop")}
              value={synchronizationSummary.droppedMatched}
            />
            <SyncMetric
              label={t("matching.sync.append")}
              value={synchronizationSummary.appendedUnmatched}
            />
            <SyncMetric
              label={t("matching.sync.conflictReview")}
              value={synchronizationSummary.conflictsToReview}
            />
            <div className="border-t border-border pt-3">
              <SyncMetric
                label={t("matching.sync.finalSize")}
                value={synchronizationSummary.finalReferenceSize}
                strong
              />
            </div>
          </div>

          <div className="mt-5 rounded-md border border-border bg-background px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("matching.sync.selectedPlan")}
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li>
                {t("matching.sync.matched")}: {syncLabel(matchedAction, t)}
              </li>
              <li>
                {t("matching.sync.unmatched")}: {syncLabel(unmatchedAction, t)}
              </li>
              <li>
                {t("matching.sync.possible")}: {syncLabel(possibleAction, t)}
              </li>
              <li>
                {t("matching.sync.conflicts")}: {syncLabel(conflictAction, t)}
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function SyncOptionGroup({
  title,
  desc,
  options,
  value,
  onChange,
}: {
  title: string;
  desc: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = usePreferences();

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                toast.info(t("feedback.toast.syncUpdated"));
              }}
              className={[
                "min-h-16 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                selected
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
              ].join(" ")}
            >
              {syncLabel(option, t)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function syncLabel(value: string, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    "Drop / Skip matched input records": "matching.sync.dropMatched",
    "Update existing reference records": "matching.sync.updateReference",
    "Keep both records": "matching.sync.keepBoth",
    "Append unmatched input records": "matching.sync.appendUnmatched",
    "Export unmatched separately": "matching.sync.exportUnmatched",
    "Ignore unmatched records": "matching.sync.ignoreUnmatched",
    "Send to manual review": "matching.sync.sendReview",
    "Export separately": "matching.sync.exportSeparately",
    "Ignore until reviewed": "matching.sync.ignoreUntilReviewed",
    "Keep reference value": "matching.sync.keepReference",
    "Replace with input value": "matching.sync.replaceInput",
    "Merge non-empty fields": "matching.sync.mergeNonEmpty",
    "Send conflict to manual review": "matching.sync.sendConflict",
  };
  return labels[value] ? t(labels[value]) : value;
}

function SyncMetric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${strong ? "text-lg font-semibold" : "text-sm font-semibold"}`}
      >
        {value}
      </span>
    </div>
  );
}

function StepExport() {
  const { t } = usePreferences();
  const options = [
    { label: "Excel (.xlsx)", desc: t("matching.export.excelDesc") },
    { label: "CSV (.csv)", desc: t("matching.export.csvDesc") },
    { label: t("matching.export.referenceLabel"), desc: t("matching.export.referenceDesc") },
  ];
  return (
    <>
      <SectionTitle title={t("matching.export.title")} desc={t("matching.export.desc")} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => toast.success(t("feedback.toast.exportReady"))}
            className="text-left border border-border rounded-lg p-4 hover:border-accent/40 hover:bg-secondary/40"
          >
            <p className="text-sm font-semibold">{o.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
          </button>
        ))}
      </div>
    </>
  );
}
