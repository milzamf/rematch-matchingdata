import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Inbox,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ErrorPanel, LoadingPanel } from "@/components/feedback-states";
import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";
import {
  insights,
  kpis,
  qualityBreakdown,
  recentJobs,
  reviewQueue,
} from "@/lib/dummy-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard - BatchMatch" },
      {
        name: "description",
        content:
          "Overview of your data matching jobs, records requiring review, data quality and recommendations.",
      },
    ],
  }),
  component: DashboardPage,
});

function statusStyles(status: string) {
  if (status === "Completed") return "bg-success/10 text-success";
  if (status === "Running") return "bg-accent/10 text-accent";
  return "bg-warning/10 text-warning";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "Completed") return <CheckCircle2 className="size-3" />;
  if (status === "Running") return <Loader2 className="size-3 animate-spin" />;
  return <Clock className="size-3" />;
}

function DashboardPage() {
  const { user } = useAuth();
  const { t } = usePreferences();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const firstName = user?.fullName.split(" ")[0] ?? "there";
  const lastJob = recentJobs[0];
  const pendingReviews = reviewQueue.length;
  const kpiText = [
    { label: t("dashboard.kpi.totalRecords"), delta: t("dashboard.kpi.totalDelta") },
    { label: t("dashboard.kpi.matchedRecords"), delta: t("dashboard.kpi.matchedDelta") },
    { label: t("dashboard.kpi.possibleMatches"), delta: t("dashboard.kpi.possibleDelta") },
    { label: t("dashboard.kpi.integrityScore"), delta: t("dashboard.kpi.integrityDelta") },
  ];
  const qualityText = [
    t("dashboard.quality.complete"),
    t("dashboard.quality.standardized"),
    t("dashboard.quality.unique"),
    t("dashboard.quality.missing"),
  ];
  const insightText = [
    {
      title: t("dashboard.insights.phoneticTitle"),
      body: t("dashboard.insights.phoneticBody"),
      action: t("dashboard.insights.apply"),
    },
    {
      title: t("dashboard.insights.weightTitle"),
      body: t("dashboard.insights.weightBody"),
      action: t("dashboard.insights.updateRule"),
    },
    {
      title: t("dashboard.insights.addressTitle"),
      body: t("dashboard.insights.addressBody"),
      action: t("dashboard.insights.enablePreset"),
    },
  ];
  const refreshDashboard = () => {
    setDashboardError(null);
    setIsRefreshing(true);
    window.setTimeout(() => {
      setIsRefreshing(false);
      toast.success(t("feedback.toast.refreshed"));
    }, 700);
  };

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader
          title={t("dashboard.title", { name: firstName })}
          description={t("dashboard.description")}
          actions={
            <button
              onClick={refreshDashboard}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              {isRefreshing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t("common.refresh")}
            </button>
          }
        />

        {dashboardError && (
          <div className="mb-6">
            <ErrorPanel
              title={t("feedback.error.title")}
              description={dashboardError}
              action={
                <button
                  onClick={refreshDashboard}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  {t("common.retry")}
                </button>
              }
            />
          </div>
        )}

        {isRefreshing && (
          <div className="mb-6">
            <LoadingPanel title={t("feedback.loading.title")} description={t("feedback.loading.desc")} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          <ActionCard
            tone="accent"
            eyebrow={t("dashboard.action.continue")}
            title={lastJob ? lastJob.name : t("dashboard.action.noJob")}
            description={
              lastJob
                ? `${lastJob.id} - ${lastJob.records} ${t("dashboard.recent.records").toLowerCase()} - ${displayDate(lastJob.date, t)}`
                : t("dashboard.noJobDesc")
            }
            icon={Play}
            cta={lastJob ? t("dashboard.action.resume") : t("dashboard.action.firstMatch")}
            to="/matching"
          />
          <ActionCard
            tone="brand"
            eyebrow={t("dashboard.action.new")}
            title={t("dashboard.action.startNewTitle")}
            description={t("dashboard.action.startNewDesc")}
            icon={Plus}
            cta={t("topbar.newMatching")}
            to="/matching"
            primary
          />
          <ActionCard
            tone="warning"
            eyebrow={t("dashboard.action.reviewQueue")}
            title={t("dashboard.action.pendingReviews", { count: pendingReviews })}
            description={t("dashboard.action.reviewDesc")}
            icon={ClipboardCheck}
            cta={t("dashboard.action.reviewNow")}
            to="/results"
            badge={pendingReviews > 0 ? String(pendingReviews) : undefined}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {kpis.map((k, index) => (
            <Card key={k.label} className="p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {kpiText[index]?.label ?? k.label}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                {k.value}
              </p>
              {k.progress !== undefined ? (
                <div className="mt-4 h-1 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${k.progress}%` }} />
                </div>
              ) : (
                <p
                  className={`mt-3 text-xs font-medium ${
                    k.tone === "warning" ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {kpiText[index]?.delta ?? k.delta}
                </p>
              )}
              {k.progress !== undefined && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {kpiText[index]?.delta ?? k.delta}
                </p>
              )}
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="lg:col-span-2 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold">{t("dashboard.recent.title")}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("dashboard.recent.desc")}
                </p>
              </div>
              <Link
                to="/results"
                className="text-xs font-medium text-accent inline-flex items-center gap-1 hover:underline"
              >
                {t("common.viewAll")} <ArrowUpRight className="size-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              {recentJobs.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title={t("dashboard.action.noJob")}
                  description={t("dashboard.noJobDesc")}
                />
              ) : (
              <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "130px" }} />
                </colgroup>
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-6 py-2.5 font-medium">
                      {t("dashboard.recent.jobName")}
                    </th>
                    <th className="text-right px-6 py-2.5 font-medium">
                      {t("dashboard.recent.records")}
                    </th>
                    <th className="text-right px-6 py-2.5 font-medium">
                      {t("dashboard.recent.matchRate")}
                    </th>
                    <th className="text-left px-6 py-2.5 font-medium">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentJobs.map((job) => (
                    <tr key={job.id} className="h-[68px] hover:bg-secondary/30">
                      <td className="px-6 py-3 align-middle min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-semibold truncate">{job.name}</p>
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                            {job.id}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {job.reference} <span className="text-muted-foreground/60">-&gt;</span>{" "}
                          {job.input}
                        </p>
                      </td>
                      <td className="px-6 py-3 align-middle text-right tabular-nums text-sm font-medium">
                        {job.records}
                      </td>
                      <td className="px-6 py-3 align-middle text-right tabular-nums text-sm font-medium">
                        {job.accuracy}
                      </td>
                      <td className="px-6 py-3 align-middle">
                        <span
                          className={`inline-flex min-w-24 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${statusStyles(job.status)}`}
                        >
                          <StatusIcon status={job.status} />
                          {displayStatus(job.status, t)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">{t("dashboard.quality.title")}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("dashboard.quality.reference")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">86</p>
                <p className="text-[10px] text-success flex items-center gap-1 justify-end">
                  <TrendingUp className="size-3" /> +4.2
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3.5">
              {qualityBreakdown.map((q, index) => {
                const color =
                  q.color === "success"
                    ? "bg-success"
                    : q.color === "accent"
                      ? "bg-accent"
                      : "bg-warning";
                return (
                  <div key={q.label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">{qualityText[index] ?? q.label}</span>
                      <span className="font-medium tabular-nums">{q.value}%</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className={`h-full ${color}`} style={{ width: `${q.value}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h3 className="text-base font-semibold">{t("dashboard.insights.title")}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {t("dashboard.insights.generated")}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {insights.map((ins, i) => (
              <div key={i} className="p-6 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" />
                  <p className="text-sm font-semibold">{insightText[i]?.title ?? ins.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {insightText[i]?.body ?? ins.body}
                </p>
                <button
                  onClick={() => toast.info(t("feedback.toast.actionQueued"))}
                  className="self-start text-xs font-medium text-accent hover:underline inline-flex items-center gap-1"
                >
                  {insightText[i]?.action ?? ins.action} <ArrowRight className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function displayStatus(status: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (status === "Completed") return t("common.completed");
  if (status === "Running") return t("common.running");
  if (status === "Review") return t("common.review");
  return status;
}

function displayDate(date: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (date === "Yesterday") return t("results.export.scope.all") === "semua" ? "Kemarin" : date;
  if (date.startsWith("Today")) return t("results.export.scope.all") === "semua" ? date.replace("Today", "Hari ini") : date;
  if (date === "2 hours ago") return t("results.export.scope.all") === "semua" ? "2 jam lalu" : date;
  if (date === "5 hours ago") return t("results.export.scope.all") === "semua" ? "5 jam lalu" : date;
  return date;
}

function ActionCard({
  eyebrow,
  title,
  description,
  icon: Icon,
  cta,
  to,
  tone,
  primary,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Play;
  cta: string;
  to: string;
  tone: "brand" | "accent" | "warning";
  primary?: boolean;
  badge?: string;
}) {
  const toneClass =
    tone === "brand"
      ? "text-brand bg-brand/10"
      : tone === "accent"
        ? "text-accent bg-accent/10"
        : "text-warning bg-warning/10";
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className={`size-10 rounded-lg grid place-items-center ${toneClass}`}>
          <Icon className="size-5" />
        </div>
        {badge && (
          <span className="text-[11px] font-semibold text-warning bg-warning/10 rounded-full px-2 py-0.5">
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {eyebrow}
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground line-clamp-2">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {description}
        </p>
      </div>
      <Link
        to={to}
        className={
          primary
            ? "inline-flex items-center justify-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-2 text-sm font-semibold hover:opacity-90"
            : "inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-accent"
        }
      >
        {cta}
        <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}
