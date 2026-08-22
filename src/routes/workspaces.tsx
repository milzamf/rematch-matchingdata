import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Edit3, Inbox, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog, ErrorPanel } from "@/components/feedback-states";
import { PromptDialog } from "@/components/prompt-dialog";
import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import {
  ApiError,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceSummary,
} from "@/lib/api";
import { usePreferences } from "@/lib/preferences";
import { buildMatchingSearch } from "@/lib/workflow-route";

export const Route = createFileRoute("/workspaces")({
  head: () => ({
    meta: [
      { title: "Workspace - RE-MATCH" },
      {
        name: "description",
        content: "Workspace matching tersimpan yang dapat dilanjutkan kembali",
      },
    ],
  }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceToRename, setWorkspaceToRename] = useState<WorkspaceSummary | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<WorkspaceSummary | null>(null);
  const canViewWorkspaces = can(PERMISSIONS.WORKSPACE_VIEW);

  const load = useCallback(() => {
    if (!canViewWorkspaces) return;
    setLoading(true);
    setError(null);
    listWorkspaces()
      .then(setWorkspaces)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("workspace.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [canViewWorkspaces, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canViewWorkspaces) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-8 py-8">
          <AccessDeniedState />
        </div>
      </AppLayout>
    );
  }

  const handleRenameConfirm = async (nextName: string) => {
    if (!workspaceToRename || !nextName || nextName === workspaceToRename.name) return;

    try {
      const updated = await updateWorkspace(workspaceToRename.id, { name: nextName });
      setWorkspaces((current) =>
        current.map((item) => (item.id === workspaceToRename.id ? updated : item)),
      );
      toast.success(t("workspace.renamed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("workspace.saveFailed"));
    } finally {
      setWorkspaceToRename(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!workspaceToDelete) return;

    try {
      await deleteWorkspace(workspaceToDelete.id);
      setWorkspaces((current) => current.filter((item) => item.id !== workspaceToDelete.id));
      toast.success(t("workspace.deleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("workspace.deleteFailed"));
    } finally {
      setWorkspaceToDelete(null);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <PageHeader
          title={t("workspace.title")}
          description={t("workspace.description")}
          actions={
            can(PERMISSIONS.MATCHING_CREATE) ? (
              <Link
                to="/matching"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
              >
                {t("workspace.new")}
                <ArrowRight className="size-4" />
              </Link>
            ) : undefined
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
                          <Link
                            to="/matching"
                            search={buildMatchingSearch(workspace.id)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90"
                          >
                            {t("workspace.continue")}
                          </Link>
                          {can(PERMISSIONS.WORKSPACE_UPDATE) && (
                            <button
                              onClick={() => setWorkspaceToRename(workspace)}
                              className="grid size-8 place-items-center rounded-md border border-border hover:bg-secondary"
                              aria-label={t("workspace.rename")}
                            >
                              <Edit3 className="size-3.5" />
                            </button>
                          )}
                          {can(PERMISSIONS.WORKSPACE_DELETE) && (
                            <button
                              onClick={() => setWorkspaceToDelete(workspace)}
                              className="grid size-8 place-items-center rounded-md border border-border text-destructive hover:bg-destructive/10"
                              aria-label={t("workspace.delete")}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Rename Dialog */}
        <PromptDialog
          open={Boolean(workspaceToRename)}
          onOpenChange={(open) => {
            if (!open) setWorkspaceToRename(null);
          }}
          title={t("workspace.rename")}
          description={t("workspace.renamePrompt")}
          defaultValue={workspaceToRename?.name ?? ""}
          confirmLabel={t("common.saveChanges")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleRenameConfirm}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          open={Boolean(workspaceToDelete)}
          setOpen={(open) => {
            if (!open) setWorkspaceToDelete(null);
          }}
          title={t("workspace.delete")}
          description={
            workspaceToDelete
              ? t("workspace.deleteConfirm", { name: workspaceToDelete.name })
              : ""
          }
          actionLabel={t("workspace.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleDeleteConfirm}
        />
      </div>
    </AppLayout>
  );
}

function statusLabel(status: WorkspaceSummary["status"], t: ReturnType<typeof usePreferences>["t"]) {
  const key = `workspace.status.${status}` as Parameters<typeof t>[0];
  return t(key);
}

function stepLabel(step: number, t: ReturnType<typeof usePreferences>["t"]) {
  if (step <= 1) return t("step.preparation");
  if (step === 2) return t("step.rules");
  return t("step.results");
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
