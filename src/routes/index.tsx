import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ErrorPanel, LoadingPanel } from "@/components/feedback-states";
import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { ApiError, listWorkspaces, type WorkspaceSummary } from "@/lib/api";
import { usePreferences } from "@/lib/preferences";
import { buildMatchingSearch } from "@/lib/workflow-route";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard - RE-MATCH" },
      {
        name: "description",
        content: "Dashboard pekerjaan matching aktif di RE-MATCH",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canViewDashboard = can(PERMISSIONS.DASHBOARD_VIEW);

  const loadDashboard = useCallback((mode: "initial" | "refresh" = "initial") => {
    if (!canViewDashboard) return;
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    listWorkspaces()
      .then(setWorkspaces)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("dashboard.real.loadFailed"));
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [canViewDashboard, t]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => buildDashboardSummary(workspaces), [workspaces]);
  const latestWorkspace = summary.latestActive ?? workspaces[0] ?? null;
  const actionItems = summary.actionItems;
  const reviewItems = summary.reviewItems;
  const canCreateMatching = can(PERMISSIONS.MATCHING_CREATE);

  if (!canViewDashboard) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-8 py-8">
          <AccessDeniedState />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <PageHeader
          title={t("dashboard.real.title")}
          description={t("dashboard.real.description")}
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => loadDashboard("refresh")}
                disabled={refreshing || loading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t("common.refresh")}
              </button>
              {canCreateMatching && (
                <Link
                  to="/matching"
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  <Plus className="size-4" />
                  {t("topbar.newMatching")}
                </Link>
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
                  onClick={() => loadDashboard()}
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
            title={t("dashboard.real.loadingTitle")}
            description={t("dashboard.real.loadingDesc")}
          />
        ) : workspaces.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              icon={Inbox}
              title={t("dashboard.real.emptyTitle")}
              description={t("dashboard.real.emptyDesc")}
              action={
                canCreateMatching ? (
                  <Link
                    to="/matching"
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                  >
                    <Plus className="size-4" />
                    {t("topbar.newMatching")}
                  </Link>
                ) : undefined
              }
            />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              {t("dashboard.real.workflow")}
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {latestWorkspace && <ContinueWork workspace={latestWorkspace} />}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-6">
                <ActionRequired items={actionItems} />
                <RecentWorkspaces workspaces={workspaces.slice(0, 8)} />
              </div>
              <div className="space-y-6">
                <WorkspaceSummaryCards summary={summary} />
                <ReviewQueue items={reviewItems} />
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("dashboard.real.poweredBy")}</p>
          <p className="mt-1">{t("brand.organizationUnit")}</p>
          <p>{t("brand.organization")}</p>
        </div>
      </div>
    </AppLayout>
  );
}

function ContinueWork({ workspace }: { workspace: WorkspaceSummary }) {
  const { t } = usePreferences();

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("dashboard.real.continueTitle")}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">{workspace.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span>{stepLabel(workspace.current_step, t)}</span>
            <span>{statusLabel(workspace.status, t)}</span>
            <span>{recordCountLabel(workspace.record_count, t)}</span>
            <span>{updatedLabel(workspace.updated_at, t)}</span>
          </div>
        </div>
        <Link
          to="/matching"
          search={buildMatchingSearch(workspace.id)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
        >
          {t("dashboard.real.continue")}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </Card>
  );
}

function ActionRequired({ items }: { items: DashboardActionItem[] }) {
  const { t } = usePreferences();

  return (
    <Card className="overflow-hidden">
      <SectionHeader
        title={t("dashboard.real.actionRequired")}
        description={t("dashboard.real.actionRequiredDesc")}
      />
      {items.length === 0 ? (
        <div className="px-6 py-8 text-sm text-muted-foreground">
          {t("dashboard.real.noAction")}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            const Icon = item.kind === "failed" ? AlertCircle : item.kind === "ready" ? CheckCircle2 : ClipboardCheck;
            return (
              <Link
                key={`${item.workspace.id}-${item.kind}`}
                to="/matching"
                search={buildMatchingSearch(item.workspace.id)}
                className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-secondary/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className={`size-4 shrink-0 ${item.kind === "failed" ? "text-destructive" : "text-accent"}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {actionLabel(item, t)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{item.workspace.name}</p>
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function WorkspaceSummaryCards({ summary }: { summary: DashboardSummary }) {
  const { t } = usePreferences();
  const items = [
    { label: t("dashboard.real.summaryWorkspaces"), value: summary.total },
    { label: t("dashboard.real.summaryActive"), value: summary.active },
    { label: t("dashboard.real.summaryNeedReview"), value: summary.needReview },
    { label: t("dashboard.real.summaryCompleted"), value: summary.completed },
  ];

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold">{t("dashboard.real.summaryTitle")}</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentWorkspaces({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const { t } = usePreferences();

  return (
    <Card className="overflow-hidden">
      <SectionHeader
        title={t("dashboard.real.recentTitle")}
        description={t("dashboard.real.recentDesc")}
      />
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: "120px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "150px" }} />
            <col style={{ width: "110px" }} />
          </colgroup>
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left font-medium">{t("workspace.name")}</th>
              <th className="px-6 py-3 text-left font-medium">{t("workspace.step")}</th>
              <th className="px-6 py-3 text-left font-medium">{t("common.status")}</th>
              <th className="px-6 py-3 text-right font-medium">{t("workspace.records")}</th>
              <th className="px-6 py-3 text-left font-medium">{t("workspace.updated")}</th>
              <th className="px-6 py-3 text-right font-medium">{t("common.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {workspaces.map((workspace) => (
              <tr key={workspace.id} className="h-[64px] hover:bg-secondary/30">
                <td className="min-w-0 px-6 py-3 align-middle">
                  <p className="truncate font-semibold">{workspace.name}</p>
                </td>
                <td className="px-6 py-3 align-middle">{stepLabel(workspace.current_step, t)}</td>
                <td className="px-6 py-3 align-middle">
                  <span className="inline-flex rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {statusLabel(workspace.status, t)}
                  </span>
                </td>
                <td className="px-6 py-3 text-right align-middle tabular-nums">
                  {workspace.record_count ?? "-"}
                </td>
                <td className="px-6 py-3 align-middle text-muted-foreground">
                  {updatedLabel(workspace.updated_at, t)}
                </td>
                <td className="px-6 py-3 text-right align-middle">
                  <Link
                    to="/matching"
                    search={buildMatchingSearch(workspace.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                  >
                    {t("dashboard.real.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ReviewQueue({ items }: { items: WorkspaceSummary[] }) {
  const { t } = usePreferences();

  return (
    <Card className="overflow-hidden">
      <SectionHeader
        title={t("dashboard.real.reviewQueue")}
        description={t("dashboard.real.reviewQueueDesc")}
      />
      {items.length === 0 ? (
        <div className="px-6 py-8 text-sm text-muted-foreground">
          {t("dashboard.real.noReviewQueue")}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.slice(0, 5).map((workspace) => (
            <Link
              key={workspace.id}
              to="/matching"
              search={buildMatchingSearch(workspace.id)}
              className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-secondary/30"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.real.needReviewCount", { count: needReviewCount(workspace) })}
                </p>
              </div>
              <span className="text-xs font-semibold text-accent">
                {t("dashboard.real.reviewCases")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-border px-6 py-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

type DashboardActionItem = {
  kind: "review" | "failed" | "ready";
  workspace: WorkspaceSummary;
};

type DashboardSummary = {
  total: number;
  active: number;
  needReview: number;
  completed: number;
  latestActive: WorkspaceSummary | null;
  actionItems: DashboardActionItem[];
  reviewItems: WorkspaceSummary[];
};

function buildDashboardSummary(workspaces: WorkspaceSummary[]): DashboardSummary {
  const activeStatuses = new Set(["draft", "configuring", "matching", "reviewing", "ready_to_sync"]);
  const latestActive = workspaces.find((workspace) => activeStatuses.has(workspace.status)) ?? null;
  const reviewItems = workspaces.filter((workspace) => needReviewCount(workspace) > 0);
  const actionItems = workspaces.flatMap((workspace) => {
    const items: DashboardActionItem[] = [];
    const reviewCount = needReviewCount(workspace);

    if (reviewCount > 0) {
      items.push({ kind: "review", workspace });
    }

    if (workspace.status === "failed") {
      items.push({ kind: "failed", workspace });
    }

    if (workspace.status === "ready_to_sync") {
      items.push({ kind: "ready", workspace });
    }

    return items;
  });

  return {
    total: workspaces.length,
    active: workspaces.filter((workspace) => activeStatuses.has(workspace.status)).length,
    needReview: reviewItems.reduce((total, workspace) => total + needReviewCount(workspace), 0),
    completed: workspaces.filter((workspace) => workspace.status === "completed").length,
    latestActive,
    actionItems,
    reviewItems,
  };
}

function actionLabel(item: DashboardActionItem, t: ReturnType<typeof usePreferences>["t"]) {
  if (item.kind === "failed") return t("dashboard.real.actionFailed");
  if (item.kind === "ready") return t("dashboard.real.actionReadySync");
  return t("dashboard.real.needReviewCount", { count: needReviewCount(item.workspace) });
}

function needReviewCount(workspace: WorkspaceSummary) {
  return Number(workspace.matching_job?.record_counts?.possible_match ?? 0);
}

function stepLabel(step: number, t: ReturnType<typeof usePreferences>["t"]) {
  const key = ["upload", "profiling", "mapping", "configure", "run", "review", "sync", "export"][
    Math.max(0, Math.min(7, step - 1))
  ];

  return t(`step.${key}` as Parameters<typeof t>[0]);
}

function statusLabel(status: WorkspaceSummary["status"], t: ReturnType<typeof usePreferences>["t"]) {
  if (status === "draft") return t("workspace.status.draft");
  if (status === "configuring") return t("workspace.status.configuring");
  if (status === "matching") return t("workspace.status.matching");
  if (status === "reviewing") return t("workspace.status.reviewing");
  if (status === "ready_to_sync") return t("workspace.status.ready_to_sync");
  if (status === "completed") return t("workspace.status.completed");
  if (status === "failed") return t("workspace.status.failed");
  return status;
}

function recordCountLabel(count: number | null, t: ReturnType<typeof usePreferences>["t"]) {
  if (count === null) return t("dashboard.real.noRecordCount");
  return t("dashboard.real.records", { count });
}

function updatedLabel(value: string | null, t: ReturnType<typeof usePreferences>["t"]) {
  if (!value) return t("dashboard.real.updatedUnknown");

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));

  if (minutes < 1) return t("dashboard.real.updatedNow");
  if (minutes < 60) return t("dashboard.real.updatedMinutes", { count: minutes });

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("dashboard.real.updatedHours", { count: hours });

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}
