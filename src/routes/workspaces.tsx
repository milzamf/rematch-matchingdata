import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, Edit3, Inbox, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedState } from "@/components/access-denied-state";
import { workspaceSharingEnabled } from "@/lib/workspace-access";
import { SharedWorkspaces } from "@/components/workspace-access/shared-workspaces";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog, ErrorPanel } from "@/components/feedback-states";
import { PromptDialog } from "@/components/prompt-dialog";
import { TablePagination } from "@/components/ui/table-pagination";
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
  ssr: !workspaceSharingEnabled,
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
  return workspaceSharingEnabled ? <SharedWorkspaces /> : <LegacyWorkspacesPage />;
}

function LegacyWorkspacesPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canViewWorkspaces = can(PERMISSIONS.WORKSPACE_VIEW);

  const [workspaceToRename, setWorkspaceToRename] = useState<WorkspaceSummary | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<WorkspaceSummary | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => listWorkspaces(),
    enabled: canViewWorkspaces,
    staleTime: 5 * 60 * 1000,
  });

  const workspaces = workspacesQuery.data ?? [];
  const loading = workspacesQuery.isLoading && !workspacesQuery.data;
  const error =
    workspacesQuery.error instanceof ApiError
      ? workspacesQuery.error.message
      : workspacesQuery.error instanceof Error
        ? workspacesQuery.error.message
        : null;

  const paginatedWorkspaces = useMemo(() => {
    const from = (page - 1) * pageSize;
    return workspaces.slice(from, from + pageSize);
  }, [workspaces, page, pageSize]);

  if (!canViewWorkspaces) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <AccessDeniedState />
        </div>
      </AppLayout>
    );
  }

  const handleRenameConfirm = async (nextName: string) => {
    if (!workspaceToRename || !nextName || nextName === workspaceToRename.name) return;

    try {
      const updated = await updateWorkspace(workspaceToRename.id, { name: nextName });
      queryClient.setQueryData<WorkspaceSummary[]>(["workspaces"], (prev) =>
        prev ? prev.map((item) => (item.id === workspaceToRename.id ? updated : item)) : [updated],
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
      queryClient.setQueryData<WorkspaceSummary[]>(["workspaces"], (prev) =>
        prev ? prev.filter((item) => item.id !== workspaceToDelete.id) : [],
      );
      toast.success(t("workspace.deleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("workspace.deleteFailed"));
    } finally {
      setWorkspaceToDelete(null);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
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
                  onClick={() => workspacesQuery.refetch()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary cursor-pointer"
                >
                  {t("common.retry")}
                </button>
              }
            />
          </div>
        )}

        <Card className="overflow-hidden min-w-0">
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
            <div>
              {/* Mobile Card List View (< sm) */}
              <div className="sm:hidden divide-y divide-border">
                {paginatedWorkspaces.map((workspace) => (
                  <div key={workspace.id} className="p-4 space-y-3 hover:bg-secondary/20 transition-colors">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground break-words leading-snug">
                        {workspace.name}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {workspace.id}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                        {stepLabel(workspace.current_step, t)}
                      </span>
                      <span className="inline-flex rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {statusLabel(workspace.status, t)}
                      </span>
                      <span className="inline-flex rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                        {workspace.record_count ?? "-"} record
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs">
                      <span className="text-muted-foreground text-[11px]">
                        {formatDate(workspace.updated_at)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Link
                          to="/matching"
                          search={buildMatchingSearch(workspace.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 min-h-[36px] active:scale-95 shadow-2xs"
                        >
                          {t("workspace.continue")}
                        </Link>
                        {can(PERMISSIONS.WORKSPACE_UPDATE) && (
                          <button
                            onClick={() => setWorkspaceToRename(workspace)}
                            className="h-9 w-9 flex items-center justify-center rounded-md border border-border hover:bg-secondary cursor-pointer active:scale-95"
                            aria-label={t("workspace.rename")}
                          >
                            <Edit3 className="size-3.5" />
                          </button>
                        )}
                        {can(PERMISSIONS.WORKSPACE_DELETE) && (
                          <button
                            onClick={() => setWorkspaceToDelete(workspace)}
                            className="h-9 w-9 flex items-center justify-center rounded-md border border-border text-destructive hover:bg-destructive/10 cursor-pointer active:scale-95"
                            aria-label={t("workspace.delete")}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View (>= sm) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full table-fixed text-sm min-w-[760px]">
                  <colgroup>
                    <col style={{ width: "260px" }} />
                    <col style={{ width: "140px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "180px" }} />
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
                    {paginatedWorkspaces.map((workspace) => (
                      <tr key={workspace.id} className="h-[68px] hover:bg-secondary/30 transition-colors">
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
                              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 cursor-pointer"
                            >
                              {t("workspace.continue")}
                            </Link>
                            {can(PERMISSIONS.WORKSPACE_UPDATE) && (
                              <button
                                onClick={() => setWorkspaceToRename(workspace)}
                                className="grid size-8 place-items-center rounded-md border border-border hover:bg-secondary cursor-pointer"
                                aria-label={t("workspace.rename")}
                              >
                                <Edit3 className="size-3.5" />
                              </button>
                            )}
                            {can(PERMISSIONS.WORKSPACE_DELETE) && (
                              <button
                                onClick={() => setWorkspaceToDelete(workspace)}
                                className="grid size-8 place-items-center rounded-md border border-border text-destructive hover:bg-destructive/10 cursor-pointer"
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

              <TablePagination
                currentPage={page}
                pageSize={pageSize}
                totalItems={workspaces.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
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
