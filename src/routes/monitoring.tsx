import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { ErrorPanel } from "@/components/feedback-states";
import { useAuth } from "@/lib/auth";
import { ApiError, fetchMonitoringOverview, type MonitoringOverview } from "@/lib/api";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";
import { buildMatchingSearch } from "@/lib/workflow-route";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring - RE-MATCH" },
      { name: "description", content: "Monitoring progres workflow RE-MATCH" },
    ],
  }),
  component: MonitoringPage,
});

function MonitoringPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canView = can(PERMISSIONS.MONITORING_VIEW);

  const load = useCallback((mode: "initial" | "refresh" = "initial") => {
    if (!canView) return;

    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    fetchMonitoringOverview()
      .then(setData)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("monitoring.loadFailed"));
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [canView, t]);

  useEffect(() => {
    load();
  }, [load]);

  const statusRows = useMemo(
    () => Object.entries(data?.summary.status_counts ?? {}).sort((a, b) => b[1] - a[1]),
    [data],
  );

  if (!canView) {
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
          title={t("monitoring.title")}
          description={t("monitoring.description")}
          actions={
            <button
              onClick={() => load("refresh")}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("common.refresh")}
            </button>
          }
        />

        {error && (
          <div className="mb-6">
            <ErrorPanel
              title={t("feedback.error.title")}
              description={error}
              action={
                <button
                  onClick={() => load()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  {t("common.retry")}
                </button>
              }
            />
          </div>
        )}

        {loading || !data ? (
          <Card className="flex min-h-52 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("monitoring.loading")}
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label={t("monitoring.workspaceTotal")} value={data.summary.workspace_total} />
              <SummaryCard label={t("monitoring.userTotal")} value={data.summary.user_total} />
              <SummaryCard label={t("monitoring.jobTotal")} value={data.summary.matching_job_total} />
              <SummaryCard label={t("monitoring.pendingReviewTotal")} value={data.summary.pending_review_total} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="overflow-hidden">
                <SectionHeader
                  title={t("monitoring.recentWorkspaces")}
                  description={t("monitoring.recentWorkspacesDesc")}
                />
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col />
                      <col style={{ width: "170px" }} />
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "110px" }} />
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "120px" }} />
                    </colgroup>
                    <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium">{t("workspace.name")}</th>
                        <th className="px-6 py-3 text-left font-medium">{t("monitoring.owner")}</th>
                        <th className="px-6 py-3 text-left font-medium">{t("common.status")}</th>
                        <th className="px-6 py-3 text-right font-medium">{t("monitoring.pendingReview")}</th>
                        <th className="px-6 py-3 text-left font-medium">{t("workspace.updated")}</th>
                        <th className="px-6 py-3 text-right font-medium">{t("common.action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.recent_workspaces.map((workspace) => (
                        <tr key={workspace.id} className="h-[64px] hover:bg-secondary/30">
                          <td className="min-w-0 px-6 py-3 align-middle">
                            <p className="truncate font-semibold">{workspace.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {t("step." + ["upload", "profiling", "mapping", "configure", "run", "review", "sync", "export"][Math.max(0, Math.min(7, workspace.current_step - 1))] as Parameters<typeof t>[0])}
                            </p>
                          </td>
                          <td className="px-6 py-3 align-middle text-muted-foreground">
                            {workspace.owner?.name ?? t("monitoring.unassigned")}
                          </td>
                          <td className="px-6 py-3 align-middle">
                            <span className="inline-flex rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                              {t(`workspace.status.${workspace.status}` as Parameters<typeof t>[0])}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right align-middle tabular-nums">{workspace.pending_review}</td>
                          <td className="px-6 py-3 align-middle text-muted-foreground">{formatDate(workspace.updated_at)}</td>
                          <td className="px-6 py-3 text-right align-middle">
                            <Link
                              to="/matching"
                              search={buildMatchingSearch(workspace.id)}
                              className="inline-flex items-center whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
                            >
                              {t("monitoring.openWorkspace")}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="space-y-6">
                <Card className="overflow-hidden">
                  <SectionHeader
                    title={t("monitoring.ownerBreakdown")}
                    description={t("monitoring.ownerBreakdownDesc")}
                  />
                  <div className="divide-y divide-border">
                    {data.owner_breakdown.map((item) => (
                      <div key={`${item.owner}-${item.user_id ?? "none"}`} className="px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{item.owner}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {item.role ? t(`auth.role.${item.role}` as Parameters<typeof t>[0]) : t("monitoring.unassigned")}
                            </p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <p>{t("monitoring.workspaceCount", { count: item.workspace_count })}</p>
                            <p>{t("monitoring.pendingReviewCount", { count: item.pending_review })}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <SectionHeader
                    title={t("monitoring.statusDistribution")}
                    description={t("monitoring.statusDistributionDesc")}
                  />
                  <div className="divide-y divide-border">
                    {statusRows.map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                        <span>{t(`workspace.status.${status}` as Parameters<typeof t>[0])}</span>
                        <span className="font-semibold tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-5">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
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

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
