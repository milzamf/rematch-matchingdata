import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileDown,
  FileSpreadsheet,
  Inbox,
  Layers,
  Loader2,
  RefreshCw,
  SearchX,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ErrorPanel, LoadingPanel } from "@/components/feedback-states";
import {
  ExploratoryDiagnosticsPanel,
  VerificationEvidenceBadge,
  VerificationEvidenceBreakdown,
} from "@/components/verification-evidence";
import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import {
  ApiError,
  fetchReviewResults,
  fetchWorkspace,
  listWorkspaces,
  type ReviewCandidate,
  type ReviewCaseGroup,
  type ReviewDecisionSummary,
  type ReviewItem,
  type ReviewResults,
  type WorkspaceSummary,
} from "@/lib/api";
import { downloadCsv, downloadXlsx } from "@/lib/export-files";
import { usePreferences } from "@/lib/preferences";
import {
  buildExportRows,
  exportColumns,
  exportSummaryRows,
  normalizeStoredExportHistory,
  type StoredExportHistoryEntry,
} from "@/lib/result-exports";
import {
  buildIdentitySummary,
  extractIdentityMappings,
  type IdentitySemantic,
  type IdentitySummary,
} from "@/lib/result-identity";
import { buildMatchingSearch, validateWorkflowSearch } from "@/lib/workflow-route";

export const Route = createFileRoute("/results")({
  validateSearch: validateWorkflowSearch,
  head: () => ({
    meta: [
      { title: "Results - RE-MATCH" },
      {
        name: "description",
        content: "Read matching outcomes, review decisions, and final workspace status",
      },
    ],
  }),
  component: ResultsPage,
});

const tabs = [
  "overview",
  "cases",
  "exploratory",
  "matched",
  "review",
  "unmatched",
  "statistics",
  "reviewHistory",
  "export",
] as const;

type TabKey = (typeof tabs)[number];
type ReviewHistoryView = "groups" | "records";

function ResultsPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const requestedWorkspaceId = search.workspace ?? null;

  const [tab, setTab] = useState<TabKey>("overview");
  const [selectedRuleFilter, setSelectedRuleFilter] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<ReviewHistoryView>("groups");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    requestedWorkspaceId,
  );
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [review, setReview] = useState<ReviewResults | null>(null);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const canViewResults = can(PERMISSIONS.EXPORT_VIEW);
  const canReview = can(PERMISSIONS.REVIEW_DECIDE);
  const canSync = can(PERMISSIONS.SYNC_EXECUTE);
  const canOpenExport = can(PERMISSIONS.EXPORT_EXECUTE);

  useEffect(() => {
    setSelectedWorkspaceId((current) =>
      requestedWorkspaceId && requestedWorkspaceId !== current ? requestedWorkspaceId : current,
    );
  }, [requestedWorkspaceId]);

  useEffect(() => {
    if (!canViewResults) return;

    setLoadingWorkspaces(true);
    setError(null);

    listWorkspaces()
      .then((items) => {
        setWorkspaces(items);
        const withResults = items.filter(
          (item) => Boolean(item.matching_job_id ?? item.matching_job?.id),
        );
        const fallbackWorkspaceId =
          requestedWorkspaceId ??
          withResults[0]?.id ??
          items[0]?.id ??
          null;
        setSelectedWorkspaceId((current) => current ?? fallbackWorkspaceId);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("results.loadFailed"));
      })
      .finally(() => setLoadingWorkspaces(false));
  }, [canViewResults, refreshNonce, requestedWorkspaceId, t]);

  useEffect(() => {
    if (!canViewResults || !selectedWorkspaceId) {
      setWorkspace(null);
      setReview(null);
      return;
    }

    setLoadingWorkspace(true);
    setError(null);

    fetchWorkspace(selectedWorkspaceId)
      .then((data) => {
        setWorkspace(data);
        setTab("overview");
        void navigate({ to: "/results", search: { workspace: data.id }, replace: true });
      })
      .catch((err) => {
        setWorkspace(null);
        setReview(null);
        setError(err instanceof ApiError ? err.message : t("results.loadFailed"));
      })
      .finally(() => setLoadingWorkspace(false));
  }, [canViewResults, navigate, refreshNonce, selectedWorkspaceId, t]);

  useEffect(() => {
    const jobId = workspace?.matching_job_id ?? workspace?.matching_job?.id ?? null;

    if (!canViewResults || !jobId) {
      setReview(null);
      return;
    }

    setLoadingReview(true);
    setError(null);

    fetchReviewResults(jobId)
      .then(setReview)
      .catch((err) => {
        setReview(null);
        setError(err instanceof ApiError ? err.message : t("results.loadFailed"));
      })
      .finally(() => setLoadingReview(false));
  }, [canViewResults, refreshNonce, workspace, t]);

  const items = review?.items ?? [];
  const matchedItems = useMemo(() => items.filter(isFinalMatched), [items]);
  const needReviewItems = useMemo(() => items.filter(isPendingReview), [items]);
  const unmatchedItems = useMemo(() => items.filter(isFinalUnmatched), [items]);
  const caseGroups = review?.case_groups ?? [];
  const exportHistory = useMemo(
    () =>
      normalizeStoredExportHistory(workspace?.export_history).filter((item) => {
        const jobId = workspace?.matching_job_id ?? workspace?.matching_job?.id ?? null;
        return !jobId || !item.sourceJobId || item.sourceJobId === jobId;
      }),
    [workspace],
  );
  const syncSummary = normalizeSyncSummary(workspace?.sync_state);
  const inputRecordCount =
    workspace?.input_dataset?.dataset.row_count ??
    workspace?.record_count ??
    items.length;
  const reviewCaseCount = caseGroups.filter((group) => group.status === "open").length;
  const workflowConfig = readRecord(workspace?.workflow_state);
  const matchingConfig = readRecord(workflowConfig.matchingConfiguration);
  const matchingPreset = readString(matchingConfig.preset);
  const matchingStrategy = readString(matchingConfig.strategy);
  const identityMappings = useMemo(
    () => extractIdentityMappings(workspace?.workflow_state),
    [workspace?.workflow_state],
  );
  const hasResults = Boolean(workspace && (workspace.matching_job_id ?? workspace.matching_job?.id) && items.length > 0);
  const activeStatuses = countFinalStatuses(items);
  const nextAction = buildNextAction({
    canOpenExport,
    canReview,
    canSync,
    exportHistoryCount: exportHistory.length,
    needReviewCount: needReviewItems.length,
    reviewCaseCount,
    syncConfirmed: Boolean(syncSummary?.confirmed),
    t,
    workspaceId: workspace?.id ?? null,
  });

  if (!canViewResults) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-8 py-8">
          <AccessDeniedState />
        </div>
      </AppLayout>
    );
  }

  const loading = loadingWorkspaces || loadingWorkspace || loadingReview;

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <PageHeader
          title={t("results.title")}
          description={t("results.description")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRefreshNonce((value) => value + 1)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
              >
                <RefreshCw className="size-4" />
                {t("common.refresh")}
              </button>
              {workspaces.length > 0 && (
                <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{t("results.workspace")}</span>
                  <select
                    value={selectedWorkspaceId ?? ""}
                    onChange={(event) => setSelectedWorkspaceId(event.target.value || null)}
                    className="min-w-[220px] bg-transparent text-sm outline-none"
                  >
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          }
        />

        {error && (
          <div className="mb-6">
            <ErrorPanel
              title={t("feedback.error.title")}
              description={error}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setRefreshNonce((value) => value + 1);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  {t("common.retry")}
                </button>
              }
            />
          </div>
        )}

        {loading ? (
          <LoadingPanel
            title={t("results.loadingTitle")}
            description={t("results.loadingDesc")}
          />
        ) : !workspace ? (
          <Card className="p-8">
            <EmptyState
              icon={SearchX}
              title={t("results.contextEmptyTitle")}
              description={t("results.contextEmptyDesc")}
              action={
                <Link
                  to="/matching"
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  <ArrowRight className="size-4" />
                  {t("results.openMatching")}
                </Link>
              }
            />
          </Card>
        ) : !hasResults ? (
          <Card className="p-8">
            <EmptyState
              icon={Inbox}
              title={t("results.emptyTitle")}
              description={t("results.emptyDesc")}
              action={
                <Link
                  to="/matching"
                  search={buildMatchingSearch(workspace.id)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  <ArrowRight className="size-4" />
                  {t("results.openMatching")}
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <ResultsContextHeader workspace={workspace} />

            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t("results.metric.input")} value={formatNumber(inputRecordCount)} />
              <StatCard
                label={t("results.metric.match")}
                value={formatNumber(activeStatuses.matched)}
                tone="success"
              />
              <StatCard
                label={t("results.metric.review")}
                value={formatNumber(activeStatuses.review)}
                tone="warning"
              />
              <StatCard
                label={t("results.metric.unmatched")}
                value={formatNumber(activeStatuses.unmatched)}
                tone="destructive"
              />
            </div>

            <Card className="mb-6 p-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-sm font-semibold">{t("results.nextAction.title")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{nextAction.description}</p>
                  {nextAction.step ? (
                    <Link
                      to="/matching"
                      search={buildMatchingSearch(workspace.id, nextAction.step)}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                    >
                      {nextAction.label}
                      <ArrowRight className="size-4" />
                    </Link>
                  ) : (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4 text-success" />
                      {nextAction.label}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <ContextMetric
                    label={t("results.summary.autoMatched")}
                    value={formatNumber(activeStatuses.autoMatched)}
                  />
                  <ContextMetric
                    label={t("results.summary.manualAccepted")}
                    value={formatNumber(activeStatuses.manualAccepted)}
                  />
                  <ContextMetric
                    label={t("results.summary.needReview")}
                    value={formatNumber(activeStatuses.review)}
                  />
                  <ContextMetric
                    label={t("results.summary.finalUnmatched")}
                    value={formatNumber(activeStatuses.unmatched)}
                  />
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2">
                {tabs.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={[
                      "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                      tab === item
                        ? "border-brand text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {t(`results.tab.${item}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>

              {tab === "overview" && (
                <OverviewTab
                  workspace={workspace}
                  activeStatuses={activeStatuses}
                  inputRecordCount={inputRecordCount}
                  matchingPreset={matchingPreset}
                  matchingStrategy={matchingStrategy}
                  syncSummary={syncSummary}
                />
              )}
              {tab === "cases" && (
                <CasesTab
                  items={items}
                  identityMappings={identityMappings}
                  selectedRuleFilter={selectedRuleFilter}
                  onClearRuleFilter={() => setSelectedRuleFilter(null)}
                />
              )}
              {tab === "exploratory" && (
                <ExploratoryDiagnosticsPanel
                  items={items}
                  selectedRuleFilter={selectedRuleFilter}
                  onFilterRule={(rule) => {
                    setSelectedRuleFilter(rule);
                    if (rule) setTab("cases");
                  }}
                />
              )}
              {tab === "matched" && <MatchedTab items={matchedItems} identityMappings={identityMappings} />}
              {tab === "review" && (
                <NeedReviewTab
                  caseGroupCount={reviewCaseCount}
                  identityMappings={identityMappings}
                  items={needReviewItems}
                  workspaceId={workspace.id}
                  canReview={canReview}
                />
              )}
              {tab === "unmatched" && (
                <UnmatchedTab
                  identityMappings={identityMappings}
                  items={unmatchedItems}
                  workspaceId={workspace.id}
                  canReview={canReview}
                />
              )}
              {tab === "statistics" && <StatisticsTab items={items} />}
              {tab === "reviewHistory" && (
                <ReviewHistoryTab
                  caseGroups={caseGroups}
                  historyView={historyView}
                  identityMappings={identityMappings}
                  items={items}
                  onViewChange={setHistoryView}
                />
              )}
              {tab === "export" && (
                <ExportTab
                  canOpenExport={canOpenExport}
                  downloadingId={downloadingId}
                  exportHistory={exportHistory}
                  items={items}
                  onDownload={async (entry) => {
                    try {
                      setDownloadingId(entry.id);
                      const rows = buildExportRows(items, {
                        columns: entry.columns.length > 0 ? entry.columns : exportColumns(items),
                        includeReferenceKey: entry.includeReferenceKey,
                        includeReviewFields: entry.includeReviewFields,
                        includeScore: entry.includeScore,
                        statuses: entry.statuses.length > 0 ? entry.statuses : ["matched", "new", "rejected"],
                      });
                      const summary = exportSummaryRows(items);
                      if (entry.format === "csv") {
                        downloadCsv(entry.fileName, rows);
                      } else {
                        downloadXlsx(entry.fileName, [rows, summary]);
                      }
                      toast.success(t("feedback.toast.exportReady"));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t("results.export.downloadFailed"));
                    } finally {
                      setDownloadingId(null);
                    }
                  }}
                  workspaceId={workspace.id}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function ResultsContextHeader({ workspace }: { workspace: WorkspaceSummary }) {
  const { t } = usePreferences();
  const jobId = workspace.matching_job_id ?? workspace.matching_job?.id ?? null;

  return (
    <Card className="mb-6 p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ContextMetric label={t("results.context.workspace")} value={workspace.name} />
        <ContextMetric
          label={t("results.context.reference")}
          value={workspace.reference_dataset?.dataset.original_filename ?? t("common.notAvailable")}
        />
        <ContextMetric
          label={t("results.context.input")}
          value={workspace.input_dataset?.dataset.original_filename ?? t("common.notAvailable")}
        />
        <ContextMetric
          label={t("results.context.status")}
          value={workspaceStatusLabel(workspace.status, t)}
        />
        <ContextMetric
          label={t("results.context.job")}
          value={jobId ?? t("common.notAvailable")}
        />
      </div>
    </Card>
  );
}

function OverviewTab({
  workspace,
  activeStatuses,
  inputRecordCount,
  matchingPreset,
  matchingStrategy,
  syncSummary,
}: {
  workspace: WorkspaceSummary;
  activeStatuses: FinalStatusCounts;
  inputRecordCount: number;
  matchingPreset: string | null;
  matchingStrategy: string | null;
  syncSummary: SyncSummary | null;
}) {
  const { t } = usePreferences();
  const job = workspace.matching_job;

  const total = activeStatuses.total || 1;
  const exactPercent = Math.round((activeStatuses.exactMatched / total) * 100);
  const fuzzyPercent = Math.round((activeStatuses.fuzzyMatched / total) * 100);
  const reviewPercent = Math.round((activeStatuses.review / total) * 100);
  const unmatchedPercent = Math.round((activeStatuses.unmatched / total) * 100);

  return (
    <div className="space-y-6 p-6">
      {/* Top Level Aggregate Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("results.summary.total")}
          </span>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
            {formatNumber(activeStatuses.total)}
          </p>
          <span className="text-[11px] text-muted-foreground">Total records processed</span>
        </div>

        <div className="rounded-lg border border-border border-l-4 border-l-success bg-card p-4">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-success">
            <CheckCircle2 className="size-3.5" />
            <span>{t("results.summary.exactMatched")}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-success">
            {formatNumber(activeStatuses.exactMatched)}
          </p>
          <span className="text-[11px] text-muted-foreground">{exactPercent}% of total</span>
        </div>

        <div className="rounded-lg border border-border border-l-4 border-l-brand bg-card p-4">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-brand">
            <ShieldCheck className="size-3.5" />
            <span>{t("results.summary.fuzzyMatched")}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-brand">
            {formatNumber(activeStatuses.fuzzyMatched)}
          </p>
          <span className="text-[11px] text-muted-foreground">{fuzzyPercent}% of total</span>
        </div>

        <div className="rounded-lg border border-border border-l-4 border-l-warning bg-card p-4">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-warning">
            <AlertTriangle className="size-3.5" />
            <span>{t("results.summary.needReview")}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-warning">
            {formatNumber(activeStatuses.review)}
          </p>
          <span className="text-[11px] text-muted-foreground">
            {activeStatuses.downgraded > 0
              ? `${activeStatuses.downgraded} downgraded`
              : `${reviewPercent}% of total`}
          </span>
        </div>

        <div className="rounded-lg border border-border border-l-4 border-l-destructive bg-card p-4">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-destructive">
            <XCircle className="size-3.5" />
            <span>{t("results.summary.finalUnmatched")}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-destructive">
            {formatNumber(activeStatuses.unmatched)}
          </p>
          <span className="text-[11px] text-muted-foreground">{unmatchedPercent}% of total</span>
        </div>
      </div>

      {/* Visual Proportional Distribution Bar */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between text-xs font-semibold mb-2">
          <span>Matching Outcome Distribution</span>
          <span className="text-muted-foreground font-normal">{activeStatuses.total} records</span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-secondary flex">
          {activeStatuses.exactMatched > 0 && (
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${(activeStatuses.exactMatched / total) * 100}%` }}
              title={`Exact Matches: ${activeStatuses.exactMatched} (${exactPercent}%)`}
            />
          )}
          {activeStatuses.fuzzyMatched > 0 && (
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${(activeStatuses.fuzzyMatched / total) * 100}%` }}
              title={`Auto Matches (Fuzzy): ${activeStatuses.fuzzyMatched} (${fuzzyPercent}%)`}
            />
          )}
          {activeStatuses.review > 0 && (
            <div
              className="h-full bg-warning transition-all"
              style={{ width: `${(activeStatuses.review / total) * 100}%` }}
              title={`Need Review: ${activeStatuses.review} (${reviewPercent}%)`}
            />
          )}
          {activeStatuses.unmatched > 0 && (
            <div
              className="h-full bg-destructive transition-all"
              style={{ width: `${(activeStatuses.unmatched / total) * 100}%` }}
              title={`Unmatched: ${activeStatuses.unmatched} (${unmatchedPercent}%)`}
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-full bg-success" />
            <span className="text-muted-foreground">Exact Match ({exactPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-full bg-brand" />
            <span className="text-muted-foreground">Auto Match ({fuzzyPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-full bg-warning" />
            <span className="text-muted-foreground">Need Review ({reviewPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-full bg-destructive" />
            <span className="text-muted-foreground">Unmatched ({unmatchedPercent}%)</span>
          </div>
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm font-semibold">{t("results.overview.processInfo")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ContextMetric label={t("results.context.workspace")} value={workspace.name} />
            <ContextMetric
              label={t("results.context.reference")}
              value={workspace.reference_dataset?.dataset.original_filename ?? t("common.notAvailable")}
            />
            <ContextMetric
              label={t("results.context.input")}
              value={workspace.input_dataset?.dataset.original_filename ?? t("common.notAvailable")}
            />
            <ContextMetric
              label={t("results.overview.totalInput")}
              value={formatNumber(inputRecordCount)}
            />
            <ContextMetric
              label={t("results.overview.configuration")}
              value={[matchingPreset, matchingStrategy].filter(Boolean).join(" / ") || t("common.notAvailable")}
            />
            <ContextMetric
              label={t("results.context.status")}
              value={workspaceStatusLabel(workspace.status, t)}
            />
            <ContextMetric
              label={t("results.overview.startedAt")}
              value={formatDateTime(job?.started_at)}
            />
            <ContextMetric
              label={t("results.overview.completedAt")}
              value={formatDateTime(job?.finished_at)}
            />
          </div>
          {job?.id && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t("results.overview.jobIdLabel")} {job.id}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border p-5">
          <p className="text-sm font-semibold">{t("results.overview.distribution")}</p>
          <div className="mt-4 space-y-3">
            <MetricRow label={t("results.summary.exactMatched")} value={activeStatuses.exactMatched} />
            <MetricRow label={t("results.summary.fuzzyMatched")} value={activeStatuses.fuzzyMatched} />
            <MetricRow label={t("results.summary.manualAccepted")} value={activeStatuses.manualAccepted} />
            <MetricRow label={t("results.summary.needReview")} value={activeStatuses.review} />
            <MetricRow label={t("results.summary.finalUnmatched")} value={activeStatuses.unmatched} />
            <MetricRow label={t("results.summary.total")} value={activeStatuses.total} strong />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border p-5">
        <p className="text-sm font-semibold">{t("results.sync.title")}</p>
        {syncSummary?.confirmed ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ContextMetric
              label={t("results.sync.linked")}
              value={formatNumber(syncSummary.matched)}
            />
            <ContextMetric
              label={t("results.sync.newEntities")}
              value={formatNumber(syncSummary.newEntities)}
            />
            <ContextMetric
              label={t("results.sync.excluded")}
              value={formatNumber(syncSummary.excluded)}
            />
            <ContextMetric
              label={t("results.sync.updatedReference")}
              value={formatNumber(syncSummary.updatedReference)}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("results.sync.notStarted")}</p>
        )}
      </section>
    </div>
  );
}

function CasesTab({
  items,
  identityMappings,
  selectedRuleFilter,
  onClearRuleFilter,
}: {
  items: ReviewItem[];
  identityMappings: ReturnType<typeof extractIdentityMappings>;
  selectedRuleFilter?: string | null;
  onClearRuleFilter?: () => void;
}) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "possible_match" | "matched" | "unmatched">("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(items[0]?.input_record_key ?? null);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (selectedRuleFilter) {
        const candidate = selectDisplayCandidate(item);
        const rules = candidate?.verification_evidence?.rules_evaluated ?? [];
        const hasFailedRule = rules.some((r) => r.field_name === selectedRuleFilter && !r.passed);
        if (!hasFailedRule) return false;
      }

      if (!query) return true;
      const haystack = JSON.stringify([
        item.input_record_key,
        item.input_record,
        item.candidates.map((c) => c.reference_record),
        item.candidates.map((c) => c.decision_reason),
      ]).toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [items, statusFilter, selectedRuleFilter, query]);

  const selectedItem = useMemo(() => {
    return (
      (selectedKey ? filteredItems.find((i) => i.input_record_key === selectedKey) : null) ??
      filteredItems[0] ??
      null
    );
  }, [filteredItems, selectedKey]);

  const selectedCandidate = selectDisplayCandidate(selectedItem);
  const selectedIdentity = selectedItem
    ? buildIdentitySummary(selectedItem, selectedCandidate, identityMappings)
    : null;

  if (items.length === 0) {
    return (
      <SimpleTabEmpty
        icon={ClipboardCheck}
        title={t("results.review.emptyTitle")}
        description={t("results.review.emptyDesc")}
      />
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4 bg-secondary/10">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search record key, values, reasons..."
            className="h-9 w-64 rounded-md border border-border bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs">
            {(["all", "possible_match", "matched", "unmatched"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={[
                  "rounded px-2.5 py-1 font-medium transition-colors",
                  statusFilter === st
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {st === "all"
                  ? "All"
                  : st === "possible_match"
                    ? t("results.metric.review")
                    : st === "matched"
                      ? t("results.metric.match")
                      : t("results.metric.unmatched")}
              </button>
            ))}
          </div>
        </div>

        {selectedRuleFilter && (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning font-semibold">
            <span>Filtered by Rule: {selectedRuleFilter}</span>
            <button
              type="button"
              onClick={onClearRuleFilter}
              className="rounded p-0.5 hover:bg-warning/20 text-warning"
            >
              <XCircle className="size-4" />
            </button>
          </div>
        )}
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-xs text-muted-foreground">
          No records match the current filters.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Master List */}
          <div className="max-h-[720px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {filteredItems.map((item) => {
              const candidate = selectDisplayCandidate(item);
              const isSelected = selectedItem?.input_record_key === item.input_record_key;
              const identity = buildIdentitySummary(item, candidate, identityMappings);
              const evidence = candidate?.verification_evidence;
              const isExact = evidence?.is_exact_match || evidence?.bypassed_fuzzy;

              return (
                <div
                  key={item.input_record_key}
                  onClick={() => setSelectedKey(item.input_record_key)}
                  className={[
                    "cursor-pointer p-4 transition-colors",
                    isSelected ? "bg-brand/10 border-l-4 border-l-brand" : "hover:bg-secondary/20",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-foreground">
                        Record #{item.input_record_key}
                      </span>
                      <StatusBadge
                        label={
                          item.status === "matched"
                            ? isExact
                              ? "Exact Match"
                              : "Auto-Match"
                            : item.status === "possible_match"
                              ? "Need Review"
                              : "Unmatched"
                        }
                        tone={
                          item.status === "matched"
                            ? "success"
                            : item.status === "possible_match"
                              ? "warning"
                              : "destructive"
                        }
                      />
                    </div>
                    {isExact ? (
                      <span className="rounded bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        Exact Match
                      </span>
                    ) : (
                      <span className="font-semibold text-xs tabular-nums text-foreground">
                        {formatScore(candidate?.score)}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 font-medium text-xs text-foreground truncate">
                    {identity.primary?.inputValue || "—"}
                  </p>
                  {candidate && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      ↔ {identity.primary?.referenceValue || "—"}
                    </p>
                  )}

                  {evidence?.downgraded && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      <AlertTriangle className="size-3" />
                      <span>Auto-Match Downgraded</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detailed Side-by-Side Comparison & Evidence Breakdown */}
          {selectedItem && (
            <div className="space-y-4">
              <Card className="p-5 border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Record #{selectedItem.input_record_key} Side-by-Side Comparison
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {selectedItem.status === "matched"
                        ? "Matched Record"
                        : selectedItem.status === "possible_match"
                          ? "Review Candidate"
                          : "Unmatched Record"}
                    </p>
                  </div>
                  <VerificationEvidenceBadge
                    evidence={selectedCandidate?.verification_evidence}
                    score={selectedCandidate?.score}
                  />
                </div>

                {/* Side-by-Side Values Comparison */}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-secondary/15 p-3.5">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                      Input Record
                    </p>
                    <div className="space-y-2 text-xs">
                      {Object.entries(selectedItem.input_record).map(([key, val]) => (
                        <div key={key} className="flex flex-col">
                          <span className="text-[11px] text-muted-foreground">{key}</span>
                          <span className="font-medium text-foreground">{String(val ?? "—")}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-secondary/15 p-3.5">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                      Reference Candidate
                    </p>
                    {selectedCandidate ? (
                      <div className="space-y-2 text-xs">
                        {Object.entries(selectedCandidate.reference_record).map(([key, val]) => (
                          <div key={key} className="flex flex-col">
                            <span className="text-[11px] text-muted-foreground">{key}</span>
                            <span className="font-medium text-foreground">{String(val ?? "—")}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No candidate matched</p>
                    )}
                  </div>
                </div>

                {/* Field Similarity Scores */}
                {selectedCandidate?.field_scores && selectedCandidate.field_scores.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-foreground mb-2">Field Similarities</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedCandidate.field_scores.map((field) => (
                        <div
                          key={`${field.reference_column}-${field.input_column}`}
                          className="flex items-center justify-between rounded-md border border-border bg-secondary/10 px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-muted-foreground">
                            {field.input_column} ↔ {field.reference_column}
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {field.score}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              {/* Evidence Breakdown */}
              <VerificationEvidenceBreakdown candidate={selectedCandidate} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchedTab({
  items,
  identityMappings,
}: {
  items: ReviewItem[];
  identityMappings: ReturnType<typeof extractIdentityMappings>;
}) {
  const { t } = usePreferences();

  if (items.length === 0) {
    return (
      <SimpleTabEmpty
        icon={ClipboardCheck}
        title={t("results.matched.emptyTitle")}
        description={t("results.matched.emptyDesc")}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-6 py-3 font-medium">{t("results.table.inputData")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.referenceData")}</th>
            <th className="px-6 py-3 text-right font-medium">{t("results.table.score")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.method")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.decision")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.source")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const candidate = selectDisplayCandidate(item);
            const identity = buildIdentitySummary(item, candidate, identityMappings);
            const isExact = Boolean(
              candidate?.verification_evidence?.is_exact_match ||
                candidate?.verification_evidence?.bypassed_fuzzy,
            );

            return (
              <tr key={item.input_record_key} className="align-top hover:bg-secondary/20">
                <td className="px-6 py-4">
                  <RecordIdentityPreview summary={identity} side="input" />
                </td>
                <td className="px-6 py-4">
                  <RecordIdentityPreview summary={identity} side="reference" showDetails />
                </td>
                <td className="px-6 py-4 text-right font-medium tabular-nums">
                  {isExact ? (
                    <span className="inline-flex rounded bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                      Exact Match
                    </span>
                  ) : (
                    formatScore(candidate?.score)
                  )}
                </td>
                <td className="px-6 py-4">
                  {isExact ? "Mandatory Exact Key" : methodDisplayLabel(candidate)}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge label={displayDecisionLabel(item, t)} tone="success" />
                </td>
                <td className="px-6 py-4">{decisionSourceLabel(item, t)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NeedReviewTab({
  caseGroupCount,
  identityMappings,
  items,
  workspaceId,
  canReview,
}: {
  caseGroupCount: number;
  identityMappings: ReturnType<typeof extractIdentityMappings>;
  items: ReviewItem[];
  workspaceId: string;
  canReview: boolean;
}) {
  const { t } = usePreferences();

  if (items.length === 0) {
    return (
      <SimpleTabEmpty
        icon={CheckCircle2}
        title={t("results.review.emptyTitle")}
        description={t("results.review.emptyDesc")}
      />
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-semibold">{t("results.review.pendingTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("results.review.pendingDesc", {
              records: items.length,
              groups: caseGroupCount,
            })}
          </p>
        </div>
        {canReview && (
          <Link
            to="/matching"
            search={buildMatchingSearch(workspaceId, 6)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
          >
            {t("results.review.open")}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-6 py-3 font-medium">{t("results.table.inputData")}</th>
              <th className="px-6 py-3 font-medium">{t("results.table.candidate")}</th>
              <th className="px-6 py-3 text-right font-medium">{t("results.table.score")}</th>
              <th className="px-6 py-3 font-medium">{t("results.table.reason")}</th>
              <th className="px-6 py-3 font-medium">{t("results.table.caseGroup")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => {
              const candidate = selectDisplayCandidate(item);
              const identity = buildIdentitySummary(item, candidate, identityMappings);
              return (
                <tr key={item.input_record_key} className="align-top hover:bg-secondary/20">
                  <td className="px-6 py-4">
                    <RecordIdentityPreview summary={identity} side="input" />
                  </td>
                  <td className="px-6 py-4">
                    <RecordIdentityPreview summary={identity} side="reference" showDetails />
                  </td>
                  <td className="px-6 py-4 text-right font-medium tabular-nums">
                    <div className="flex flex-col items-end gap-1">
                      <span>{formatScore(candidate?.score)}</span>
                      <VerificationEvidenceBadge evidence={candidate?.verification_evidence} />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-foreground">{caseReasonLabel(item, t)}</p>
                      {candidate?.verification_evidence?.downgraded && (
                        <p className="mt-1 text-xs text-warning">
                          {candidate.verification_evidence.downgrade_reason}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">{caseGroupLabel(item, t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnmatchedTab({
  identityMappings,
  items,
  workspaceId,
  canReview,
}: {
  identityMappings: ReturnType<typeof extractIdentityMappings>;
  items: ReviewItem[];
  workspaceId: string;
  canReview: boolean;
}) {
  const { t } = usePreferences();

  if (items.length === 0) {
    return (
      <SimpleTabEmpty
        icon={CheckCircle2}
        title={t("results.unmatched.emptyTitle")}
        description={t("results.unmatched.emptyDesc")}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-6 py-3 font-medium">{t("results.table.inputData")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.reason")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.decision")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.source")}</th>
            <th className="px-6 py-3 font-medium">{t("results.table.action")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const candidate = selectDisplayCandidate(item);
            const identity = buildIdentitySummary(item, candidate, identityMappings);
            return (
              <tr key={item.input_record_key} className="align-top hover:bg-secondary/20">
                <td className="px-6 py-4">
                  <RecordIdentityPreview summary={identity} side="input" />
                </td>
                <td className="px-6 py-4">{caseReasonLabel(item, t)}</td>
                <td className="px-6 py-4">
                  <StatusBadge
                    label={displayDecisionLabel(item, t)}
                    tone={item.display_status === "manual_rejected" ? "destructive" : "muted"}
                  />
                </td>
                <td className="px-6 py-4">{decisionSourceLabel(item, t)}</td>
                <td className="px-6 py-4">
                  {isPendingReview(item) && canReview ? (
                    <Link
                      to="/matching"
                      search={buildMatchingSearch(workspaceId, 6)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                    >
                      {t("results.review.open")}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("results.readOnly")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatisticsTab({ items }: { items: ReviewItem[] }) {
  const { t } = usePreferences();

  if (items.length === 0) {
    return (
      <SimpleTabEmpty
        icon={FileSpreadsheet}
        title={t("results.statistics.emptyTitle")}
        description={t("results.statistics.emptyDesc")}
      />
    );
  }

  const methodDistribution = countBy(items, (item) => primaryMethod(item) ?? t("results.statistics.unknown"));
  const scoreDistribution = countBy(items, (item) => scoreBucketLabel(selectDisplayCandidate(item)?.score, t));
  const sourceDistribution = countBy(items, (item) => decisionSourceLabel(item, t));
  const autoManualDistribution = {
    [t("results.statistics.auto")]: items.filter((item) => !item.decision).length,
    [t("results.statistics.manual")]: items.filter((item) => Boolean(item.decision)).length,
  };

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-2">
      <DistributionCard
        title={t("results.statistics.method")}
        values={methodDistribution}
      />
      <DistributionCard
        title={t("results.statistics.score")}
        values={scoreDistribution}
      />
      <DistributionCard
        title={t("results.statistics.source")}
        values={sourceDistribution}
      />
      <DistributionCard
        title={t("results.statistics.autoManual")}
        values={autoManualDistribution}
      />
    </div>
  );
}

function ReviewHistoryTab({
  caseGroups,
  historyView,
  identityMappings,
  items,
  onViewChange,
}: {
  caseGroups: ReviewCaseGroup[];
  historyView: ReviewHistoryView;
  identityMappings: ReturnType<typeof extractIdentityMappings>;
  items: ReviewItem[];
  onViewChange: (view: ReviewHistoryView) => void;
}) {
  const { t } = usePreferences();

  return (
    <div className="space-y-4 p-6">
      <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
        {(["groups", "records"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onViewChange(item)}
            className={[
              "rounded-md px-3 py-1.5 text-xs font-semibold",
              historyView === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            ].join(" ")}
          >
            {item === "groups" ? t("results.history.groups") : t("results.history.records")}
          </button>
        ))}
      </div>

      {historyView === "groups" ? (
        caseGroups.length === 0 ? (
          <SimpleTabEmpty
            icon={ClipboardCheck}
            title={t("results.history.emptyGroupsTitle")}
            description={t("results.history.emptyGroupsDesc")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">{t("results.table.caseGroup")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.inputData")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.referenceData")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.decision")}</th>
                  <th className="px-6 py-3 text-right font-medium">{t("results.table.affectedRecords")}</th>
                  <th className="px-6 py-3 text-right font-medium">{t("results.table.exceptions")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.reviewer")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.decidedAt")}</th>
                  <th className="px-6 py-3 font-medium">{t("results.table.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {caseGroups.map((group) => {
                  const latest = latestDecision(group.decision_history ?? []);
                  const exceptions = groupExceptions(group);
                  const representativeCandidate = selectDisplayCandidate(group.representative);
                  const identity = buildIdentitySummary(
                    group.representative,
                    representativeCandidate,
                    identityMappings,
                  );
                  return (
                    <tr key={group.id} className="align-top hover:bg-secondary/20">
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="font-medium">{caseGroupDisplayLabel(group, t)}</p>
                          <p className="text-xs text-muted-foreground">{caseGroupReason(group, t)}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <RecordIdentityPreview summary={identity} side="input" />
                      </td>
                      <td className="px-6 py-4">
                        <RecordIdentityPreview summary={identity} side="reference" showDetails />
                      </td>
                      <td className="px-6 py-4">{groupDecisionLabel(group, t)}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{formatNumber(group.item_count)}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{formatNumber(exceptions)}</td>
                      <td className="px-6 py-4">{latest?.reviewer ?? t("common.notAvailable")}</td>
                      <td className="px-6 py-4">{formatDateTime(latest?.decided_at ?? latest?.created_at ?? null)}</td>
                      <td className="px-6 py-4">
                        <StatusBadge
                          label={groupStatusLabel(group.status ?? "open", t)}
                          tone={group.status === "resolved" ? "success" : "warning"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : items.filter((item) => Boolean(item.decision)).length === 0 ? (
        <SimpleTabEmpty
          icon={ClipboardCheck}
          title={t("results.history.emptyRecordsTitle")}
          description={t("results.history.emptyRecordsDesc")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">{t("results.table.record")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.inputData")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.referenceData")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.decision")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.source")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.reviewer")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.decidedAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items
                .filter((item) => Boolean(item.decision))
                .map((item) => {
                  const candidate = selectDisplayCandidate(item);
                  const identity = buildIdentitySummary(item, candidate, identityMappings);
                  return (
                    <tr key={item.input_record_key} className="align-top hover:bg-secondary/20">
                      <td className="px-6 py-4 font-mono text-xs">{item.input_record_key}</td>
                      <td className="px-6 py-4">
                        <RecordIdentityPreview summary={identity} side="input" />
                      </td>
                      <td className="px-6 py-4">
                        <RecordIdentityPreview summary={identity} side="reference" showDetails />
                      </td>
                      <td className="px-6 py-4">{displayDecisionLabel(item, t)}</td>
                      <td className="px-6 py-4">{decisionSourceLabel(item, t)}</td>
                      <td className="px-6 py-4">{item.decision?.reviewer ?? t("common.notAvailable")}</td>
                      <td className="px-6 py-4">{formatDateTime(item.decision?.decided_at ?? item.decision?.created_at ?? null)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExportTab({
  canOpenExport,
  downloadingId,
  exportHistory,
  items,
  onDownload,
  workspaceId,
}: {
  canOpenExport: boolean;
  downloadingId: string | null;
  exportHistory: StoredExportHistoryEntry[];
  items: ReviewItem[];
  onDownload: (entry: StoredExportHistoryEntry) => Promise<void>;
  workspaceId: string;
}) {
  const { t } = usePreferences();

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-semibold">{t("results.export.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("results.export.desc")}</p>
        </div>
        {canOpenExport && (
          <Link
            to="/matching"
            search={buildMatchingSearch(workspaceId, 8)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
          >
            <FileDown className="size-4" />
            {t("results.export.openSettings")}
          </Link>
        )}
      </div>

      {exportHistory.length === 0 ? (
        <SimpleTabEmpty
          icon={FileSpreadsheet}
          title={t("results.export.emptyTitle")}
          description={t("results.export.emptyDesc")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">{t("results.export.fileName")}</th>
                <th className="px-6 py-3 font-medium">{t("results.export.format")}</th>
                <th className="px-6 py-3 text-right font-medium">{t("results.export.recordCount")}</th>
                <th className="px-6 py-3 font-medium">{t("results.export.generatedAt")}</th>
                <th className="px-6 py-3 font-medium">{t("results.table.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exportHistory.map((entry) => (
                <tr key={entry.id} className="hover:bg-secondary/20">
                  <td className="px-6 py-4">{entry.fileName}</td>
                  <td className="px-6 py-4 uppercase">{entry.format}</td>
                  <td className="px-6 py-4 text-right tabular-nums">{formatNumber(entry.recordCount)}</td>
                  <td className="px-6 py-4">{formatDateTime(entry.generatedAt)}</td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      disabled={items.length === 0 || downloadingId === entry.id}
                      onClick={() => void onDownload(entry)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                    >
                      {downloadingId === entry.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {t("common.download")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecordIdentityPreview({
  summary,
  side,
  showDetails = false,
}: {
  summary: IdentitySummary;
  side: "input" | "reference";
  showDetails?: boolean;
}) {
  const { t } = usePreferences();
  const primaryValue = side === "input" ? summary.primary?.inputValue : summary.primary?.referenceValue;
  const previewRows = summary.rows.filter((row) =>
    side === "input" ? Boolean(row.inputValue) : Boolean(row.referenceValue),
  );

  return (
    <div className="min-w-0 max-w-sm">
      <p className="truncate text-sm font-semibold text-foreground">
        {primaryValue ?? t("common.notAvailable")}
      </p>
      <div className="mt-2 space-y-1.5">
        {previewRows.length > 0 ? (
          previewRows.map((row) => (
            <IdentityLine
              key={`${side}-${row.semantic}-${row.label}`}
              label={semanticLabel(row.semantic, t)}
              value={side === "input" ? row.inputValue : row.referenceValue}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{t("common.notAvailable")}</p>
        )}
      </div>
      {showDetails && summary.hasReference && summary.detailRows.length > 1 && (
        <IdentityDetailDisclosure summary={summary} />
      )}
    </div>
  );
}

function IdentityLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

function IdentityDetailDisclosure({ summary }: { summary: IdentitySummary }) {
  const { t } = usePreferences();

  return (
    <details className="mt-3 rounded-md border border-border/70 bg-secondary/20 p-3">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        {t("results.identity.viewDetails")}
      </summary>
      <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_88px] gap-0 border-b border-border bg-secondary/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>{t("results.identity.field")}</span>
          <span>{t("results.table.inputData")}</span>
          <span>{t("results.table.referenceData")}</span>
          <span>{t("common.status")}</span>
        </div>
        {summary.detailRows.map((row) => (
          <div
            key={`${row.semantic}-${row.label}`}
            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_88px] gap-0 border-b border-border last:border-b-0 px-3 py-2 text-xs"
          >
            <span className="pr-3 text-muted-foreground">{semanticLabel(row.semantic, t)}</span>
            <span className="pr-3 text-foreground">{row.inputValue ?? t("common.notAvailable")}</span>
            <span className="pr-3 text-foreground">{row.referenceValue ?? t("common.notAvailable")}</span>
            <span className={row.changed ? "text-warning" : "text-success"}>
              {row.changed ? t("results.identity.different") : t("results.identity.same")}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function DistributionCard({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);

  return (
    <section className="rounded-lg border border-border p-5">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-4 space-y-3">
        {Object.entries(values).map(([label, value]) => {
          const width = total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums">{formatNumber(value)}</span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div className="h-2 rounded-full bg-brand" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SimpleTabEmpty({
  icon,
  title,
  description,
}: {
  icon: typeof Inbox;
  title: string;
  description: string;
}) {
  return (
    <div className="p-8">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "destructive" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "warning"
        ? "bg-warning/10 text-warning"
        : tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-secondary text-foreground";

  return (
    <Card className="p-4">
      <div className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${toneClass}`}>
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function MetricRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={strong ? "text-base font-semibold tabular-nums" : "text-sm font-semibold tabular-nums"}>
        {formatNumber(value)}
      </span>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "destructive" | "muted";
}) {
  const className =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "warning"
        ? "bg-warning/10 text-warning"
        : tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-secondary text-foreground";

  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

type FinalStatusCounts = {
  autoMatched: number;
  exactMatched: number;
  fuzzyMatched: number;
  manualAccepted: number;
  downgraded: number;
  review: number;
  unmatched: number;
  matched: number;
  total: number;
};

type SyncSummary = {
  confirmed: boolean;
  matched: number;
  newEntities: number;
  excluded: number;
  updatedReference: number;
};

function countFinalStatuses(items: ReviewItem[]): FinalStatusCounts {
  return items.reduce<FinalStatusCounts>(
    (counts, item) => {
      const candidate = selectDisplayCandidate(item);
      const ev = candidate?.verification_evidence;
      const isExact = Boolean(ev?.is_exact_match || ev?.bypassed_fuzzy);
      const isDowngraded = Boolean(ev?.downgraded);

      if (isPendingReview(item)) counts.review += 1;
      if (isAutoMatched(item)) {
        counts.autoMatched += 1;
        if (isExact) {
          counts.exactMatched += 1;
        } else {
          counts.fuzzyMatched += 1;
        }
      }
      if (isDowngraded) counts.downgraded += 1;
      if (isManualAccepted(item)) counts.manualAccepted += 1;
      if (isFinalMatched(item)) counts.matched += 1;
      if (isFinalUnmatched(item)) counts.unmatched += 1;
      counts.total += 1;
      return counts;
    },
    {
      autoMatched: 0,
      exactMatched: 0,
      fuzzyMatched: 0,
      manualAccepted: 0,
      downgraded: 0,
      review: 0,
      unmatched: 0,
      matched: 0,
      total: 0,
    },
  );
}

function buildNextAction(input: {
  canOpenExport: boolean;
  canReview: boolean;
  canSync: boolean;
  exportHistoryCount: number;
  needReviewCount: number;
  reviewCaseCount: number;
  syncConfirmed: boolean;
  t: ReturnType<typeof usePreferences>["t"];
  workspaceId: string | null;
}) {
  const { t, workspaceId } = input;

  if (!workspaceId) {
    return {
      label: t("results.nextAction.selectWorkspace"),
      description: t("results.nextAction.selectWorkspaceDesc"),
      step: null,
    };
  }

  if (input.needReviewCount > 0) {
    return {
      label: input.canReview ? t("results.review.open") : t("results.nextAction.reviewPending"),
      description: t("results.nextAction.reviewDesc", {
        records: input.needReviewCount,
        groups: input.reviewCaseCount,
      }),
      step: input.canReview ? 6 : null,
    };
  }

  if (!input.syncConfirmed) {
    return {
      label: input.canSync ? t("results.nextAction.sync") : t("results.nextAction.syncPending"),
      description: t("results.nextAction.syncDesc"),
      step: input.canSync ? 7 : null,
    };
  }

  if (input.exportHistoryCount === 0) {
    return {
      label: input.canOpenExport ? t("results.nextAction.export") : t("results.nextAction.exportPending"),
      description: t("results.nextAction.exportDesc"),
      step: input.canOpenExport ? 8 : null,
    };
  }

  return {
    label: t("results.nextAction.completed"),
    description: t("results.nextAction.completedDesc"),
    step: null,
  };
}

function isFinalMatched(item: ReviewItem) {
  const status = finalStatus(item);
  return status === "auto_matched" || status === "manual_accepted" || status === "matched";
}

function isAutoMatched(item: ReviewItem) {
  const status = finalStatus(item);
  return status === "auto_matched" || (!item.decision && status === "matched");
}

function isManualAccepted(item: ReviewItem) {
  return finalStatus(item) === "manual_accepted";
}

function isPendingReview(item: ReviewItem) {
  const status = finalStatus(item);
  return status === "need_review" || status === "possible_match";
}

function isFinalUnmatched(item: ReviewItem) {
  const status = finalStatus(item);
  return ["unmatched", "confirmed_unmatched", "manual_rejected"].includes(status);
}

function finalStatus(item: ReviewItem) {
  return item.display_status ?? item.status;
}

function selectDisplayCandidate(item: ReviewItem): ReviewCandidate | null {
  if (!item.candidates.length) return null;

  const selectedKey = item.decision?.selected_reference_record_key;
  if (selectedKey) {
    return item.candidates.find((candidate) => candidate.reference_record_key === selectedKey) ?? item.candidates[0];
  }

  return item.candidates[0];
}

function displayDecisionLabel(item: ReviewItem, t: ReturnType<typeof usePreferences>["t"]) {
  const status = finalStatus(item);

  if (status === "manual_accepted") return t("matching.review.statusManualAccepted");
  if (status === "manual_rejected") return t("matching.review.statusManualRejected");
  if (status === "confirmed_unmatched") return t("matching.review.statusConfirmedUnmatched");
  if (status === "need_review" || status === "possible_match") return t("matching.review.statusNeedReview");
  return t("matching.review.statusAutoMatched");
}

function decisionSourceLabel(item: ReviewItem, t: ReturnType<typeof usePreferences>["t"]) {
  if (!item.decision) return t("results.source.automatic");
  if (item.decision.source === "group") return t("results.source.group");
  return t("results.source.individual");
}

function workspaceStatusLabel(
  status: string,
  t: ReturnType<typeof usePreferences>["t"],
) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    draft: "workspace.status.draft",
    configuring: "workspace.status.configuring",
    matching: "workspace.status.matching",
    reviewing: "workspace.status.reviewing",
    ready_to_sync: "workspace.status.ready_to_sync",
    completed: "workspace.status.completed",
    failed: "workspace.status.failed",
  };

  return labels[status] ? t(labels[status]) : status;
}

function caseReasonLabel(item: ReviewItem, t: ReturnType<typeof usePreferences>["t"]) {
  const pattern = readString(item.case_features?.pattern) ?? "";
  const labels: Record<string, Parameters<typeof t>[0]> = {
    LEGAL_FORM_CONFLICT: "results.casePattern.legalFormConflict",
    FIELD_CONFLICT: "results.casePattern.fieldConflict",
    SIMILAR_NAME_REVIEW: "results.casePattern.similarName",
    NO_CANDIDATE: "results.casePattern.noCandidate",
    LOW_CONFIDENCE_MATCH: "results.casePattern.lowConfidence",
  };

  return labels[pattern]
    ? t(labels[pattern])
    : item.candidates[0]?.decision_reason ??
        item.case_features?.reason ??
        t("common.notAvailable");
}

function caseGroupLabel(item: ReviewItem, t: ReturnType<typeof usePreferences>["t"]) {
  const pattern = readString(item.case_features?.pattern) ?? "";
  return caseGroupDisplayLabel({ pattern, label: "", reason: "", id: "", fingerprint: "", conditions: {}, confidence: "", eligible_for_bulk: false, item_count: 0, reviewed_count: 0, item_keys: [], representative_input_key: null, representative: item } as ReviewCaseGroup, t);
}

function caseGroupDisplayLabel(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    LEGAL_FORM_CONFLICT: "results.casePattern.legalFormConflict",
    FIELD_CONFLICT: "results.casePattern.fieldConflict",
    SIMILAR_NAME_REVIEW: "results.casePattern.similarName",
    NO_CANDIDATE: "results.casePattern.noCandidate",
    LOW_CONFIDENCE_MATCH: "results.casePattern.lowConfidence",
  };
  const pattern = readString(group.pattern) ?? "";

  return labels[pattern] ? t(labels[pattern]) : group.label || pattern || t("common.notAvailable");
}

function caseGroupReason(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  const pattern = readString(group.pattern) ?? "";
  const labels: Record<string, Parameters<typeof t>[0]> = {
    LEGAL_FORM_CONFLICT: "results.caseReason.legalFormConflict",
    FIELD_CONFLICT: "results.caseReason.fieldConflict",
    SIMILAR_NAME_REVIEW: "results.caseReason.similarName",
    NO_CANDIDATE: "results.caseReason.noCandidate",
    LOW_CONFIDENCE_MATCH: "results.caseReason.lowConfidence",
  };

  return labels[pattern] ? t(labels[pattern]) : group.reason || t("common.notAvailable");
}

function groupDecisionLabel(group: ReviewCaseGroup, t: ReturnType<typeof usePreferences>["t"]) {
  const summary = group.decision_summary;

  if (!summary) {
    return group.status === "resolved" ? t("results.history.resolved") : t("results.history.open");
  }

  if (summary.mixed) {
    return t("results.history.mixedDecision", {
      accepted: summary.accepted,
      rejected: summary.rejected,
      unmatched: summary.unmatched,
    });
  }

  if (summary.pending > 0) return t("matching.review.statusNeedReview");
  if (summary.accepted > 0) return t("matching.review.statusManualAccepted");
  if (summary.rejected > 0) return t("matching.review.statusManualRejected");
  if (summary.unmatched > 0) return t("matching.review.statusConfirmedUnmatched");
  return t("common.notAvailable");
}

function groupStatusLabel(status: string, t: ReturnType<typeof usePreferences>["t"]) {
  return status === "resolved" ? t("results.history.resolved") : t("results.history.open");
}

function groupExceptions(group: ReviewCaseGroup) {
  return (group.decision_history ?? []).reduce((count, item) => {
    const skipped = item.safety_validation?.skipped_records?.length ?? 0;
    return count + skipped;
  }, 0);
}

function latestDecision(history: ReviewDecisionSummary[]) {
  return [...history].sort((left, right) => {
    const leftTime = left.decided_at ?? left.created_at ?? "";
    const rightTime = right.decided_at ?? right.created_at ?? "";
    return rightTime.localeCompare(leftTime);
  })[0] ?? null;
}

function methodDisplayLabel(candidate: ReviewCandidate | null) {
  const algorithms = Array.from(
    new Set(
      (candidate?.field_scores ?? [])
        .map((item) => readString(readRecord(item).algorithm))
        .filter((item): item is string => Boolean(item)),
    ),
  );

  if (algorithms.length === 0) return "-";
  if (algorithms.length === 1) return algorithms[0];
  return algorithms.join(", ");
}

function primaryMethod(item: ReviewItem) {
  const candidate = selectDisplayCandidate(item);
  const algorithms = Array.from(
    new Set(
      (candidate?.field_scores ?? [])
        .map((field) => readString(readRecord(field).algorithm))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (algorithms.length === 0) return null;
  if (algorithms.length === 1) return algorithms[0];
  return "Multiple";
}

function scoreBucketLabel(score: number | undefined, t: ReturnType<typeof usePreferences>["t"]) {
  const value = score ?? 0;
  if (value >= 95) return t("results.statistics.bucket95");
  if (value >= 85) return t("results.statistics.bucket85");
  if (value >= 75) return t("results.statistics.bucket75");
  return t("results.statistics.bucketLow");
}

function normalizeSyncSummary(value: unknown): SyncSummary | null {
  const record = readRecord(value);
  if (!record || !Boolean(record.confirmed)) return null;

  return {
    confirmed: true,
    matched: readNumber(record.matched) ?? 0,
    newEntities: readNumber(record.newEntities) ?? 0,
    excluded: readNumber(record.excluded) ?? 0,
    updatedReference: readNumber(record.updatedReference) ?? readNumber(record.matched) ?? 0,
  };
}

function semanticLabel(
  semantic: IdentitySemantic,
  t: ReturnType<typeof usePreferences>["t"],
) {
  if (semantic === "name") return t("results.identity.name");
  if (semantic === "strong_identifier") {
    return t("results.identity.identifier");
  }
  if (semantic === "province") return t("results.identity.province");
  if (semantic === "city") return t("results.identity.city");
  if (semantic === "address") return t("results.identity.address");
  return t("results.identity.identity");
}

function formatScore(score: number | undefined) {
  if (typeof score !== "number" || Number.isNaN(score)) return "-";
  return score.toFixed(2);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID").format(value ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function countBy(items: ReviewItem[], selector: (item: ReviewItem) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value !== "" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
