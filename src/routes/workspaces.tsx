import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Edit3, Inbox, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ErrorPanel } from "@/components/feedback-states";
import {
  ApiError,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceSummary,
} from "@/lib/api";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/workspaces")({
  head: () => ({
    meta: [
      { title: "Workspaces - BatchMatch" },
      {
        name: "description",
        content: "Saved BatchMatch matching workspaces and resumable workflow sessions.",
      },
    ],
  }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { t } = usePreferences();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listWorkspaces()
      .then(setWorkspaces)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("workspace.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const rename = async (workspace: WorkspaceSummary) => {
    const nextName = window.prompt(t("workspace.renamePrompt"), workspace.name)?.trim();
    if (!nextName || nextName === workspace.name) return;

    try {
      const updated = await updateWorkspace(workspace.id, { name: nextName });
      setWorkspaces((current) =>
        current.map((item) => (item.id === workspace.id ? updated : item)),
      );
      toast.success(t("workspace.renamed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("workspace.saveFailed"));
    }
  };

  const remove = async (workspace: WorkspaceSummary) => {
    if (!window.confirm(t("workspace.deleteConfirm", { name: workspace.name }))) return;

    try {
      await deleteWorkspace(workspace.id);
      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
      toast.success(t("workspace.deleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("workspace.deleteFailed"));
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <PageHeader
          title={t("workspace.title")}
          description={t("workspace.description")}
          actions={
            <Link
              to="/matching"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
            >
              {t("workspace.new")}
              <ArrowRight className="size-4" />
            </Link>
          }
        />

        {error && (
          <div className="mb-6">
            <ErrorPanel
              title={t("feedback.error.title")}
              description={error}
              action={
                <button
                  onClick={load}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  {t("common.retry")}
                </button>
              }
            />
          </div>
        )}

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("workspace.loading")}
            </div>
          ) : workspaces.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t("workspace.emptyTitle")}
              description={t("workspace.emptyDesc")}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "180px" }} />
                  <col style={{ width: "220px" }} />
                </colgroup>
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">{t("workspace.name")}</th>
                    <th className="px-6 py-3 text-left font-medium">{t("common.status")}</th>
                    <th className="px-6 py-3 text-right font-medium">
                      {t("workspace.records")}
                    </th>
                    <th className="px-6 py-3 text-left font-medium">{t("workspace.step")}</th>
                    <th className="px-6 py-3 text-left font-medium">
                      {t("workspace.updated")}
                    </th>
                    <th className="px-6 py-3 text-right font-medium">{t("common.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workspaces.map((workspace) => (
                    <tr key={workspace.id} className="h-[68px] hover:bg-secondary/30">
                      <td className="min-w-0 px-6 py-3 align-middle">
                        <p className="truncate font-semibold">{workspace.name}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {workspace.id}
                        </p>
                      </td>
                      <td className="px-6 py-3 align-middle">
                        <span className="inline-flex rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {statusLabel(workspace.status, t)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right align-middle tabular-nums">
                        {workspace.record_count ?? "-"}
                      </td>
                      <td className="px-6 py-3 align-middle">
                        {stepLabel(workspace.current_step, t)}
                      </td>
                      <td className="px-6 py-3 align-middle text-muted-foreground">
                        {formatDate(workspace.updated_at)}
                      </td>
                      <td className="px-6 py-3 align-middle">
                        <div className="flex justify-end gap-2">
                          <a
                            href={`/matching?workspace=${workspace.id}`}
                            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90"
                          >
                            {t("workspace.continue")}
                          </a>
                          <button
                            onClick={() => rename(workspace)}
                            className="grid size-8 place-items-center rounded-md border border-border hover:bg-secondary"
                            aria-label={t("workspace.rename")}
                          >
                            <Edit3 className="size-3.5" />
                          </button>
                          <button
                            onClick={() => remove(workspace)}
                            className="grid size-8 place-items-center rounded-md border border-border text-destructive hover:bg-destructive/10"
                            aria-label={t("workspace.delete")}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function statusLabel(status: WorkspaceSummary["status"], t: ReturnType<typeof usePreferences>["t"]) {
  const key = `workspace.status.${status}` as Parameters<typeof t>[0];
  return t(key);
}

function stepLabel(step: number, t: ReturnType<typeof usePreferences>["t"]) {
  const stepKey = ["upload", "profiling", "mapping", "configure", "run", "review", "sync", "export"][
    Math.max(0, Math.min(7, step - 1))
  ];
  return t(`step.${stepKey}` as Parameters<typeof t>[0]);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
