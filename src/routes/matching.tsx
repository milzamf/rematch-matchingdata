import { createFileRoute, Link } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState, useRef } from "react";
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
      { title: "Matching Workflow â€” BatchMatch" },
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
type ColumnMappingDraft = {
  id: string;
  referenceColumnId: string;
  inputColumnId: string;
  algorithm: MatchingAlgorithm;
  suggested: boolean;
};

const ALLOWED = [".csv", ".xlsx"];
const MAX_MB = 50;
const MATCHING_ALGORITHMS: MatchingAlgorithm[] = [
  "Exact",
  "Normalized Exact",
  "Contains",
  "Starts With",
  "Ends With",
  "Fuzzy",
];

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

  const referenceColumns = reference?.result?.columns ?? [];
  const inputColumns = input?.result?.columns ?? [];
  const hasCompletedMapping = columnMappings.some((mapping) => mapping.inputColumnId);
  const canAdvance =
    (step !== 1 || (reference?.status === "success" && input?.status === "success")) &&
    (step !== 3 || hasCompletedMapping);
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
      return;
    }

    setColumnMappings(suggestColumnMappings(inspectedReferenceColumns, inspectedInputColumns));
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
          {step === 4 && <StepConfig />}
          {step === 5 && (
            <StepRun
              state={runState}
              progress={progress}
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
                {file.name} Â· {(file.size / 1024 / 1024).toFixed(2)} MB
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
            <div className="grid min-w-[860px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_44px] items-center gap-4 px-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{t("matching.mapping.reference")}</span>
              <span>{t("matching.mapping.input")}</span>
              <span>{t("matching.mapping.algorithm")}</span>
              <span className="sr-only">{t("common.action")}</span>
            </div>

            {mappings.map((mapping, index) => {
              const usedByOtherRows = new Set(
                mappings
                  .filter((item) => item.id !== mapping.id)
                  .map((item) => item.referenceColumnId),
              );

              return (
                <div
                  key={mapping.id}
                  data-testid="mapping-row"
                  className="grid min-w-[860px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_44px] items-center gap-4 rounded-lg border border-border px-4 py-3"
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
                          {columnLabel(column)}
                        </option>
                      ))}
                    </select>
                    {mapping.suggested && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("matching.mapping.autoSuggested")}
                      </p>
                    )}
                  </div>

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
                        {columnLabel(column)}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label={t("matching.mapping.algorithmSelect", { row: index + 1 })}
                    data-testid="mapping-algorithm-select"
                    value={mapping.algorithm}
                    onChange={(event) =>
                      updateMapping(mapping.id, {
                        algorithm: event.target.value as MatchingAlgorithm,
                      })
                    }
                    className={selectClass}
                  >
                    {MATCHING_ALGORITHMS.map((algorithm) => (
                      <option key={algorithm} value={algorithm}>
                        {algorithmLabel(algorithm, t)}
                      </option>
                    ))}
                  </select>

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
    };
  });
}

function findBestInputColumn(
  referenceColumn: DatasetInspectResult["columns"][number],
  inputColumns: DatasetInspectResult["columns"],
  usedInputIds: Set<string>,
): { column: DatasetInspectResult["columns"][number]; score: number } | null {
  return inputColumns.reduce<{
    column: DatasetInspectResult["columns"][number];
    score: number;
  } | null>((best, inputColumn) => {
    if (usedInputIds.has(inputColumn.id)) return best;

    const score = columnNameSimilarity(referenceColumn.name, inputColumn.name);
    if (!best || score > best.score) return { column: inputColumn, score };

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

function columnNameSimilarity(referenceName: string, inputName: string): number {
  const referenceNormalized = normalizeColumnName(referenceName);
  const inputNormalized = normalizeColumnName(inputName);

  if (referenceNormalized.compact === inputNormalized.compact) return 1;
  if (
    referenceNormalized.compact.length > 2 &&
    inputNormalized.compact.length > 2 &&
    (referenceNormalized.compact.includes(inputNormalized.compact) ||
      inputNormalized.compact.includes(referenceNormalized.compact))
  ) {
    return 0.8;
  }

  const referenceTokens = new Set(referenceNormalized.tokens);
  const inputTokens = new Set(inputNormalized.tokens);
  const shared = [...referenceTokens].filter((token) => inputTokens.has(token)).length;
  const total = new Set([...referenceTokens, ...inputTokens]).size;

  return total === 0 ? 0 : shared / total;
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

function columnLabel(column: DatasetInspectResult["columns"][number]): string {
  return `${column.name} - ${column.data_type.toUpperCase()}`;
}

function algorithmLabel(
  algorithm: MatchingAlgorithm,
  t: ReturnType<typeof usePreferences>["t"],
): string {
  if (algorithm === "Exact") return t("matching.mapping.algorithm.exact");
  if (algorithm === "Normalized Exact") return t("matching.mapping.algorithm.normalizedExact");
  if (algorithm === "Contains") return t("matching.mapping.algorithm.contains");
  if (algorithm === "Starts With") return t("matching.mapping.algorithm.startsWith");
  if (algorithm === "Ends With") return t("matching.mapping.algorithm.endsWith");
  return t("matching.mapping.algorithm.fuzzy");
}

type Preset = "Balanced" | "Strict" | "Exploratory" | "Custom";
type Strategy = "Hybrid" | "Exact" | "Fuzzy" | "Composite" | "Rule-Based";

const PRESET_DEFAULTS: Record<
  Preset,
  { autoMatch: number; review: number; noMatch: number; strategy: Strategy }
> = {
  Balanced: { autoMatch: 90, review: 75, noMatch: 60, strategy: "Hybrid" },
  Strict: { autoMatch: 95, review: 85, noMatch: 70, strategy: "Exact" },
  Exploratory: { autoMatch: 85, review: 65, noMatch: 50, strategy: "Fuzzy" },
  Custom: { autoMatch: 90, review: 75, noMatch: 60, strategy: "Hybrid" },
};

function StepConfig() {
  const { t } = usePreferences();
  const [preset, setPreset] = useState<Preset>("Balanced");
  const [strategy, setStrategy] = useState<Strategy>("Hybrid");
  const [autoMatch, setAutoMatch] = useState(90);
  const [review, setReview] = useState(75);
  const [noMatch, setNoMatch] = useState(60);
  const [searchMode, setSearchMode] = useState<"auto" | "manual">("auto");
  const [manualBlocks, setManualBlocks] = useState<string[]>(["company_name", "npwp"]);
  const [candidates, setCandidates] = useState<1 | 3 | 5 | 10>(3);
  const [outputs, setOutputs] = useState<string[]>([
    "Matched",
    "Possible Match",
    "Unmatched",
    "Synchronization Summary",
    "Summary Report",
  ]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [weights, setWeights] = useState([
    { field: "company_name", weight: 45, method: "Token Sort Ratio" },
    { field: "npwp", weight: 30, method: "Exact Strict" },
    { field: "address", weight: 15, method: "TF-IDF Cosine" },
    { field: "email", weight: 10, method: "Normalized Exact" },
  ]);
  const [norm, setNorm] = useState<Record<string, boolean>>({
    Lowercase: true,
    "Trim Spaces": true,
    "Remove Punctuation": true,
    "Ignore Legal Entity (PT, CV, Ltd, Inc)": true,
    "Normalize Address": true,
    "Normalize Phone Number": false,
    "Normalize Date Format": false,
  });

  const isCustom = preset === "Custom";
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const d = PRESET_DEFAULTS[p];
    setAutoMatch(d.autoMatch);
    setReview(d.review);
    setNoMatch(d.noMatch);
    setStrategy(d.strategy);
  };

  const AUTO_RECOMMEND_KEYS = ["Company Name Prefix", "NPWP", "Email Domain", "Postal Code"];
  const AVAILABLE_COLUMNS = [
    "customer_id",
    "company_name",
    "npwp",
    "address",
    "phone",
    "email",
    "city",
    "postal_code",
  ];

  const applyRecommendation = () => {
    setStrategy("Hybrid");
    applyPreset("Balanced");
    setSearchMode("auto");
    toast.success(t("feedback.toast.recommendationApplied"));
  };

  return (
    <>
      <SectionTitle title={t("matching.config.title")} desc={t("matching.config.desc")} />

      {/* Smart Recommendation */}
      <div className="border border-accent/30 bg-accent/5 rounded-lg p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{t("matching.config.recommended")}</p>
              <span className="text-[10px] font-semibold bg-accent/15 text-accent rounded-full px-1.5 py-0.5">
                {t("matching.config.confidence")}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                [t("matching.config.strategy"), "Hybrid"],
                [t("matching.config.preset"), "Balanced"],
                [t("matching.config.search"), "Company Name Prefix"],
                [t("matching.config.normalization"), "Entity Name"],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="text-sm font-medium mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={applyRecommendation}
            className="shrink-0 px-3 py-2 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90"
          >
            {t("matching.config.applyRecommendation")}
          </button>
        </div>
      </div>

      {/* 1. Preset */}
      <ConfigSection title={t("matching.config.preset")} desc={t("matching.config.presetDesc")}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["Balanced", "Strict", "Exploratory", "Custom"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium",
                preset === p
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {p}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 2. Strategy */}
      <ConfigSection title={t("matching.config.strategy")} desc={t("matching.config.strategyDesc")}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {(
            [
              ["Hybrid", t("matching.config.recommendedLabel")],
              ["Exact", t("matching.config.exactMatch")],
              ["Fuzzy", t("matching.config.fuzzyMatch")],
              ["Composite", "Composite"],
              ["Rule-Based", "Rule-Based"],
            ] as [Strategy, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setStrategy(key);
                if (!isCustom) setPreset("Custom");
              }}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium",
                strategy === key
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 3. Similarity Threshold */}
      <ConfigSection
        title={t("matching.config.threshold")}
        desc={t("matching.config.thresholdDesc", { preset })}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </ConfigSection>

      {/* 4. Search Optimization */}
      <ConfigSection title={t("matching.config.search")} desc={t("matching.config.searchDesc")}>
        <div className="flex gap-2 mb-3">
          {(["auto", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setSearchMode(m)}
              className={[
                "px-3 py-1.5 rounded-md border text-xs font-medium",
                searchMode === m
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {m === "auto"
                ? t("matching.config.autoRecommend")
                : t("matching.config.manualCandidate")}
            </button>
          ))}
        </div>
        {searchMode === "auto" ? (
          <div className="border border-border rounded-lg p-4 bg-secondary/30">
            <p className="text-xs text-muted-foreground mb-2">{t("matching.config.recommends")}</p>
            <div className="flex flex-wrap gap-1.5">
              {AUTO_RECOMMEND_KEYS.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-md bg-accent/10 text-accent px-2 py-1 text-xs font-medium"
                >
                  <Sparkles className="size-3" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {AVAILABLE_COLUMNS.map((c) => {
              const on = manualBlocks.includes(c);
              return (
                <button
                  key={c}
                  onClick={() =>
                    setManualBlocks((prev) => (on ? prev.filter((x) => x !== c) : [...prev, c]))
                  }
                  className={[
                    "px-3 py-1.5 rounded-md border text-xs font-mono text-left",
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

      {/* 5. Data Normalization */}
      <ConfigSection
        title={t("matching.config.normalizationTitle")}
        desc={t("matching.config.normalizationDesc")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.keys(norm).map((k) => (
            <label
              key={k}
              className="flex items-center gap-2.5 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-secondary/30"
            >
              <input
                type="checkbox"
                checked={norm[k]}
                onChange={(e) => setNorm((prev) => ({ ...prev, [k]: e.target.checked }))}
                className="size-3.5 accent-brand"
              />
              <span className="text-xs">{normalizationLabel(k, t)}</span>
            </label>
          ))}
        </div>
      </ConfigSection>

      {/* 6. Candidate Generation */}
      <ConfigSection
        title={t("matching.config.candidateTitle")}
        desc={t("matching.config.candidateDesc")}
      >
        <div className="grid grid-cols-4 gap-2 max-w-md">
          {([1, 3, 5, 10] as const).map((n) => (
            <button
              key={n}
              onClick={() => setCandidates(n)}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium tabular-nums",
                candidates === n
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {t("matching.config.topN", { count: n })}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 7. Output Configuration */}
      <ConfigSection
        title={t("matching.config.outputTitle")}
        desc={t("matching.config.outputDesc")}
      >
        <div className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-semibold">{t("matching.config.mergeIncluded")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("matching.config.mergeIncludedDesc")}
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                className="flex items-center gap-2.5 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-secondary/30"
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
      </ConfigSection>

      {/* 8. Advanced */}
      <div className="border border-border rounded-lg mb-2">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <p className="text-sm font-semibold">{t("matching.config.advanced")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("matching.config.advancedDesc")}
            </p>
          </div>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>
        {advancedOpen && (
          <div className="border-t border-border px-5 py-5 space-y-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">{t("matching.config.fieldWeights")}</p>
                <p
                  className={`text-xs font-medium tabular-nums ${
                    totalWeight === 100 ? "text-success" : "text-destructive"
                  }`}
                >
                  {t("matching.config.total", { value: totalWeight })}
                </p>
              </div>
              <div className="space-y-3">
                {weights.map((w, i) => (
                  <div key={w.field} className="grid grid-cols-[160px_1fr_50px] items-center gap-4">
                    <div>
                      <p className="text-sm font-mono truncate">{w.field}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{w.method}</p>
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
                    <p className="text-sm font-semibold tabular-nums text-right">{w.weight}%</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                [t("matching.config.mandatoryRules"), t("matching.config.mandatoryRulesValue")],
                [t("matching.config.numericTolerance"), "+/- 0.5%"],
                [t("matching.config.dateTolerance"), "+/- 3 days"],
                [t("matching.config.similarityFormula"), t("matching.config.weightedAverage")],
              ].map(([k, v]) => (
                <div key={k} className="border border-border rounded-md px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="text-xs font-medium mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
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

function normalizationLabel(value: string, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    Lowercase: "matching.norm.lowercase",
    "Trim Spaces": "matching.norm.trim",
    "Remove Punctuation": "matching.norm.punctuation",
    "Ignore Legal Entity (PT, CV, Ltd, Inc)": "matching.norm.legal",
    "Normalize Address": "matching.norm.address",
    "Normalize Phone Number": "matching.norm.phone",
    "Normalize Date Format": "matching.norm.date",
  };
  return labels[value] ? t(labels[value]) : value;
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
        <span className={`text-sm font-semibold tabular-nums ${color}`}>â‰¥ {value}%</span>
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

function StepRun({
  state,
  progress,
  onStart,
  onRetry,
  onBack,
}: {
  state: RunState;
  progress: number;
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
                    {t("matching.review.similarity")} {sortDesc ? "â†“" : "â†‘"}
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
