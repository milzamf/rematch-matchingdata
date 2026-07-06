import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import {
  matchedRecords,
  reviewQueue,
  recentJobs,
  auditTrail,
  synchronizationSummary,
} from "@/lib/dummy-data";
import {
  Download,
  FileDown,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  XCircle,
  FileSpreadsheet,
  Inbox,
} from "lucide-react";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Results — BatchMatch" },
      {
        name: "description",
        content:
          "Workspace for completed matching jobs — overview, matched, possible, unmatched, statistics, audit trail, and export.",
      },
    ],
  }),
  component: ResultsPage,
});

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "matched", label: "Matched" },
  { key: "possible", label: "Possible Match" },
  { key: "unmatched", label: "Unmatched" },
  { key: "stats", label: "Statistics" },
  { key: "audit", label: "Audit Trail" },
  { key: "export", label: "Export History" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function ResultsPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const hasResults = recentJobs.length > 0;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader
          title="Results"
          description="MJ-2481 · CRM Cleanup — Q1 Customers · Completed 2 hours ago"
          actions={
            <>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary">
                <Download className="size-4" />
                CSV
              </button>
              <button
                onClick={() => setTab("export")}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
              >
                <FileDown className="size-4" />
                Export Results
              </button>
            </>
          }
        />

        {!hasResults ? (
          <Card>
            <EmptyState
              icon={Inbox}
              title="No completed jobs yet"
              description="Start a matching job to see results, statistics, and audit trail here."
            />
          </Card>
        ) : (
          <>
            {/* Stat summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatChip label="Matched" value="12,482" tone="success" icon={CheckCircle2} />
              <StatChip label="Possible" value="842" tone="warning" icon={Clock} />
              <StatChip label="Unmatched" value="45" tone="destructive" icon={XCircle} />
              <StatChip label="Confidence" value="98.4%" tone="muted" icon={CheckCircle2} />
            </div>

            {/* Tabs */}
            <Card>
              <div className="border-b border-border px-2 flex items-center gap-1 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={[
                      "px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                      tab === t.key
                        ? "border-brand text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "overview" && <OverviewTab onExport={() => setTab("export")} />}
              {tab === "matched" && <MatchedTab />}
              {tab === "possible" && <PossibleTab />}
              {tab === "unmatched" && <UnmatchedTab />}
              {tab === "stats" && <StatsTab />}
              {tab === "audit" && <AuditTab />}
              {tab === "export" && <ExportTab />}
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function StatChip({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "destructive" | "muted";
  icon: typeof CheckCircle2;
}) {
  const toneClass =
    tone === "success"
      ? "text-success bg-success/10"
      : tone === "warning"
        ? "text-warning bg-warning/10"
        : tone === "destructive"
          ? "text-destructive bg-destructive/10"
          : "text-muted-foreground bg-secondary";
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`size-9 rounded-lg grid place-items-center ${toneClass}`}>
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </Card>
  );
}

function TableToolbar() {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border">
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background border border-border rounded-md px-2.5 py-1.5 w-64">
        <Search className="size-3.5" />
        <span>Filter records…</span>
      </div>
      <button className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:bg-secondary">
        <Filter className="size-3.5" />
        Filters
      </button>
    </div>
  );
}

function OverviewTab({ onExport }: { onExport: () => void }) {
  const summary = [
    { label: "Job ID", value: "MJ-2481" },
    { label: "Reference", value: "customer_master.xlsx" },
    { label: "Input", value: "salesforce_export.csv" },
    { label: "Records", value: "24,109" },
    { label: "Duration", value: "2m 41s" },
    { label: "Completed", value: "2 hours ago" },
  ];
  const syncSummary = [
    { label: "Dropped matched records", value: synchronizationSummary.droppedMatched },
    { label: "Appended unmatched records", value: synchronizationSummary.appendedUnmatched },
    { label: "Updated reference records", value: synchronizationSummary.updatedReference },
    { label: "Conflicts sent to review", value: synchronizationSummary.conflictsToReview },
  ];
  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 border border-border rounded-lg p-5">
        <p className="text-sm font-semibold mb-4">Job summary</p>
        <div className="grid grid-cols-2 gap-4">
          {summary.map((s) => (
            <div key={s.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p className="text-sm font-medium mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-border rounded-lg p-5">
        <p className="text-sm font-semibold mb-4">Next steps</p>
        <div className="space-y-2">
          <button
            onClick={onExport}
            className="w-full text-left flex items-center justify-between p-3 rounded-lg border border-border hover:bg-secondary/40"
          >
            <span className="text-sm font-medium">Export results</span>
            <FileDown className="size-4 text-muted-foreground" />
          </button>
          <button className="w-full text-left flex items-center justify-between p-3 rounded-lg border border-border hover:bg-secondary/40">
            <span className="text-sm font-medium">Review 842 possible matches</span>
            <Clock className="size-4 text-warning" />
          </button>
        </div>
      </div>
      <div className="lg:col-span-3 border border-border rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Synchronization Summary</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Estimated merge actions applied to the reference dataset.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Final reference size
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {synchronizationSummary.finalReferenceSize}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {syncSummary.map((item) => (
            <div key={item.label} className="rounded-md border border-border bg-secondary/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchedTab() {
  return (
    <>
      <TableToolbar />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "120px" }} />
            <col />
            <col />
            <col style={{ width: "150px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "120px" }} />
          </colgroup>
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2.5 font-medium">ID</th>
              <th className="text-left px-6 py-2.5 font-medium">Reference</th>
              <th className="text-left px-6 py-2.5 font-medium">Input</th>
              <th className="text-left px-6 py-2.5 font-medium">Method</th>
              <th className="text-right px-6 py-2.5 font-medium">Score</th>
              <th className="text-left px-6 py-2.5 font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {matchedRecords.map((r) => (
              <tr key={r.id} className="hover:bg-secondary/30">
                <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{r.id}</td>
                <td className="px-6 py-3 font-medium truncate">{r.ref}</td>
                <td className="px-6 py-3 truncate">{r.input}</td>
                <td className="px-6 py-3">
                  <span className="text-[11px] bg-secondary rounded px-1.5 py-0.5 font-medium">
                    {r.method}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-success tabular-nums w-14">
                      {r.score}%
                    </span>
                    <div className="h-1 w-16 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-success" style={{ width: `${r.score}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-3 text-xs text-muted-foreground">{r.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PossibleTab() {
  return (
    <>
      <TableToolbar />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col />
            <col />
            <col style={{ width: "130px" }} />
            <col style={{ width: "160px" }} />
          </colgroup>
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2.5 font-medium">Reference</th>
              <th className="text-left px-6 py-2.5 font-medium">Input</th>
              <th className="text-right px-6 py-2.5 font-medium">Similarity</th>
              <th className="text-right px-6 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reviewQueue.map((r) => {
              const tone = r.score >= 90 ? "bg-success" : r.score >= 80 ? "bg-warning" : "bg-destructive";
              return (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="px-6 py-4 min-w-0">
                    <p className="text-sm font-medium truncate">{r.refName}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.refMeta}</p>
                  </td>
                  <td className="px-6 py-4 min-w-0">
                    <p className="text-sm font-medium truncate">{r.inputName}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.inputMeta}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="ml-auto flex w-32 items-center justify-end gap-2">
                      <span className="w-12 text-right text-sm font-semibold tabular-nums">{r.score}%</span>
                      <div className="h-1 flex-1 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full ${tone}`} style={{ width: `${r.score}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-1.5">
                      <button className="px-2.5 py-1 rounded-md bg-brand text-brand-foreground text-xs font-medium">
                        Approve
                      </button>
                      <button className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-secondary">
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UnmatchedTab() {
  const unmatched = [
    { id: "UM-4401", value: "Toko Berkah Jaya", reason: "No candidate above threshold" },
    { id: "UM-4402", value: "PT Indo Sejahtera Nusantara", reason: "Blocked by country mismatch" },
    { id: "UM-4403", value: "Andi Wijaya (individual)", reason: "Ambiguous — 3 candidates < 70%" },
    { id: "UM-4404", value: "CV Karya Mandiri 2024", reason: "Null NPWP + short name" },
  ];
  return (
    <>
      <TableToolbar />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "130px" }} />
            <col />
            <col />
            <col style={{ width: "130px" }} />
          </colgroup>
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2.5 font-medium">ID</th>
              <th className="text-left px-6 py-2.5 font-medium">Input Record</th>
              <th className="text-left px-6 py-2.5 font-medium">Reason</th>
              <th className="text-right px-6 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {unmatched.map((u) => (
              <tr key={u.id} className="hover:bg-secondary/30">
                <td className="px-6 py-4 font-mono text-[11px] text-muted-foreground">{u.id}</td>
                <td className="px-6 py-4 font-medium truncate">{u.value}</td>
                <td className="px-6 py-4 text-xs text-muted-foreground truncate">{u.reason}</td>
                <td className="px-6 py-4 text-right">
                  <button className="text-xs font-medium text-accent hover:underline">Force match</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatsTab() {
  const methodBreakdown = [
    { method: "Exact", count: 8210, pct: 66 },
    { method: "Fuzzy (Jaro-Winkler)", count: 2841, pct: 23 },
    { method: "Token Sort", count: 1108, pct: 9 },
    { method: "TF-IDF", count: 323, pct: 2 },
  ];
  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="border border-border rounded-lg p-5">
        <p className="text-sm font-semibold">Match Method Distribution</p>
        <div className="mt-4 space-y-3">
          {methodBreakdown.map((m) => (
            <div key={m.method}>
              <div className="flex justify-between text-xs mb-1.5">
                <span>{m.method}</span>
                <span className="tabular-nums text-muted-foreground">
                  {m.count.toLocaleString()} · {m.pct}%
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-brand" style={{ width: `${m.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-border rounded-lg p-5">
        <p className="text-sm font-semibold">Score Distribution</p>
        <div className="mt-4 flex items-end gap-1.5 h-40">
          {[6, 10, 14, 22, 30, 42, 58, 78, 88, 96].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${i >= 8 ? "bg-success" : i >= 6 ? "bg-warning" : "bg-secondary"}`}
                style={{ height: `${h}%` }}
              />
              <span className="text-[9px] text-muted-foreground">{i * 10}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Most records cluster in the ≥ 90 range — a healthy distribution.
        </p>
      </div>
    </div>
  );
}

function AuditTab() {
  return (
    <div className="divide-y divide-border">
      {auditTrail.map((a, i) => (
        <div key={i} className="px-6 py-3 flex items-center gap-4">
          <span className="font-mono text-xs text-muted-foreground w-20">{a.time}</span>
          <span className="text-sm font-medium w-40 truncate">{a.user}</span>
          <span className="text-sm text-muted-foreground w-40">{a.action}</span>
          <span className="text-sm truncate flex-1">{a.target}</span>
        </div>
      ))}
    </div>
  );
}

function ExportTab() {
  const [format, setFormat] = useState<"csv" | "xlsx" | "json">("xlsx");
  const [scope, setScope] = useState<"all" | "matched" | "possible" | "unmatched">("all");
  const recent = [
    { name: "MJ-2481-matched.xlsx", size: "1.8 MB", date: "2 hours ago" },
    { name: "MJ-2480-all.csv", size: "742 KB", date: "Yesterday" },
  ];
  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 border border-border rounded-lg p-5">
        <p className="text-sm font-semibold">Configure export</p>
        <p className="text-xs text-muted-foreground mt-1">
          Pick the format and which subset of records to include.
        </p>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Format
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(["xlsx", "csv", "json"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={[
                  "px-3 py-2 rounded-md border text-sm font-medium",
                  format === f
                    ? "border-brand bg-brand/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary",
                ].join(" ")}
              >
                .{f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Scope
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(["all", "matched", "possible", "unmatched"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={[
                  "px-3 py-2 rounded-md border text-sm font-medium capitalize",
                  scope === s
                    ? "border-brand bg-brand/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <button className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-4 py-2 text-sm font-semibold hover:opacity-90">
          <FileDown className="size-4" />
          Download {scope}.{format}
        </button>
      </div>

      <div className="border border-border rounded-lg p-5">
        <p className="text-sm font-semibold mb-3">Recent exports</p>
        <div className="space-y-2">
          {recent.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-3 border border-border rounded-md p-3"
            >
              <FileSpreadsheet className="size-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.size} · {r.date}
                </p>
              </div>
              <button className="text-muted-foreground hover:text-foreground">
                <Download className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
