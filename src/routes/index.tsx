import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { useAuth } from "@/lib/auth";
import {
  ArrowUpRight,
  ArrowRight,
  Play,
  Plus,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import {
  kpis,
  recentJobs,
  reviewQueue,
  qualityBreakdown,
  insights,
} from "@/lib/dummy-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — BatchMatch" },
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
  const firstName = user?.fullName.split(" ")[0] ?? "there";
  const lastJob = recentJobs[0];
  const pendingReviews = reviewQueue.length;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader
          title={`Welcome back, ${firstName}`}
          description="Pick up where you left off, start a new match, or clear your review queue."
        />

        {/* Action hero */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          <ActionCard
            tone="accent"
            eyebrow="Continue"
            title={lastJob ? lastJob.name : "No job in progress"}
            description={
              lastJob
                ? `${lastJob.id} · ${lastJob.records} records · ${lastJob.date}`
                : "Start a new matching job to see it here."
            }
            icon={Play}
            cta={lastJob ? "Resume job" : "Start first match"}
            to="/matching"
          />
          <ActionCard
            tone="brand"
            eyebrow="New"
            title="Start a matching job"
            description="Upload data, map columns, and reconcile against your reference set."
            icon={Plus}
            cta="New Matching"
            to="/matching"
            primary
          />
          <ActionCard
            tone="warning"
            eyebrow="Review queue"
            title={`${pendingReviews} pending manual reviews`}
            description="Records near your threshold that need a human decision."
            icon={ClipboardCheck}
            cta="Review now"
            to="/results"
            badge={pendingReviews > 0 ? String(pendingReviews) : undefined}
          />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {kpis.map((k) => (
            <Card key={k.label} className="p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {k.label}
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
                  {k.delta}
                </p>
              )}
              {k.progress !== undefined && (
                <p className="mt-2 text-xs text-muted-foreground">{k.delta}</p>
              )}
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Recent Matching Jobs */}
          <Card className="lg:col-span-2 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold">Recent Matching Jobs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Latest reconciliation runs in your workspace
                </p>
              </div>
              <Link
                to="/results"
                className="text-xs font-medium text-accent inline-flex items-center gap-1 hover:underline"
              >
                View all <ArrowUpRight className="size-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "130px" }} />
                </colgroup>
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-6 py-2.5 font-medium">Job Name</th>
                    <th className="text-right px-6 py-2.5 font-medium">Records</th>
                    <th className="text-right px-6 py-2.5 font-medium">Match Rate</th>
                    <th className="text-left px-6 py-2.5 font-medium">Status</th>
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
                          {job.reference} <span className="text-muted-foreground/60">→</span>{" "}
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
                          {job.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>


          {/* Data quality overview */}
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">Data Quality</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reference dataset · customer_master
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
              {qualityBreakdown.map((q) => {
                const color =
                  q.color === "success"
                    ? "bg-success"
                    : q.color === "accent"
                      ? "bg-accent"
                      : "bg-warning";
                return (
                  <div key={q.label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">{q.label}</span>
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

        {/* Insights */}
        <Card>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h3 className="text-base font-semibold">Matching Insights & Recommendations</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">Auto-generated · updated 10m ago</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {insights.map((ins, i) => (
              <div key={i} className="p-6 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" />
                  <p className="text-sm font-semibold">{ins.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {ins.body}
                </p>
                <button className="self-start text-xs font-medium text-accent hover:underline inline-flex items-center gap-1">
                  {ins.action} <ArrowRight className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
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
