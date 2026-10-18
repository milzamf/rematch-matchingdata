import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Edit3, Inbox, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/ui/table-pagination";
import { ConfirmationDialog } from "@/components/feedback-states";
import { PromptDialog } from "@/components/prompt-dialog";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";
import { PERMISSIONS } from "@/lib/authorization";
import { accessApi, type AccessWorkspace } from "@/lib/workspace-access";
import { ManageAccessButton } from "./access-management";
import { AccessFeedback } from "./access-feedback";

export function SharedWorkspaces() {
  const { currentUser, isAuthenticated, can } = useAuth();
  const { t } = usePreferences();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [renaming, setRenaming] = useState<AccessWorkspace | null>(null);
  const [deleting, setDeleting] = useState<AccessWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["stage5a", "workspaces", currentUser?.id, page, pageSize],
    queryFn: ({ signal }) => accessApi.workspaces(page, signal, pageSize),
    enabled: isAuthenticated,
    retry: false,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["stage5a", "workspaces"] });
    await client.invalidateQueries({ queryKey: ["workspaces"] });
    await client.invalidateQueries({ queryKey: ["admin-workspaces"] });
  };
  const rename = async (name: string) => {
    if (!renaming || busy) return;
    setBusy(true);
    try {
      await accessApi.renameWorkspace(renaming.id, name, renaming.configuration_version);
      setRenaming(null);
      toast.success(t("workspace.renamed"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workspace.saveFailed"));
      await refresh();
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await accessApi.deleteWorkspace(deleting.id, deleting.configuration_version);
      setDeleting(null);
      toast.success(t("workspace.deleted"));
      if (list.data?.data.length === 1 && page > 1) setPage(page - 1);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workspace.deleteFailed"));
      await refresh();
    } finally { setBusy(false); }
  };
  const status = (w: AccessWorkspace) =>
    t(("workspace.status." + w.status) as Parameters<typeof t>[0]);
  const step = (w: AccessWorkspace) =>
    t((w.current_step === 2 ? "step.rules" : (w.current_step ?? 1) >= 3 ? "step.results" : "step.preparation"));
  const date = (value?: string | null) => value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";
  const managementAllowed = (w: AccessWorkspace) =>
    w.access_role === "owner" || w.access_role === "admin";
  const actions = (w: AccessWorkspace) => (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <Button asChild size="sm" className="h-9">
        <Link to="/matching" search={managementAllowed(w) ? { workspace: w.id, step: w.current_step ?? 1 } : { workspace: w.id, view: "shared" }}>
          {t("workspace.continue")}
        </Link>
      </Button>
      {managementAllowed(w) && (
        <ManageAccessButton workspaceId={w.id} name={w.name} owner={w.owner_name ?? ""} iconOnly />
      )}
      {managementAllowed(w) && can(PERMISSIONS.WORKSPACE_UPDATE) && (
        <Button variant="outline" size="icon" aria-label={t("workspace.rename")} title={t("workspace.rename")} disabled={busy} onClick={() => setRenaming(w)}>
          <Edit3 aria-hidden="true" />
        </Button>
      )}
      {managementAllowed(w) && can(PERMISSIONS.WORKSPACE_DELETE) && (
        <Button variant="outline" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={t("workspace.delete")} title={t("workspace.delete")} disabled={busy} onClick={() => setDeleting(w)}>
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    </div>
  );
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <PageHeader title={t("workspace.title")} description={t("workspace.description")}
          actions={can(PERMISSIONS.MATCHING_CREATE) ? (
            <Button asChild><Link to="/matching">{t("workspace.new")}<ArrowRight aria-hidden="true" /></Link></Button>
          ) : undefined}
        />
        <AccessFeedback error={list.error} reload={() => void list.refetch()} />
        <Card className="overflow-hidden">
          {list.isPending ? (
            <div role="status" className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{t("workspace.loading")}
            </div>
          ) : list.data?.total === 0 ? (
            <EmptyState icon={Inbox} title={t("workspace.emptyTitle")} description={t("workspace.emptyDesc")} />
          ) : list.data ? (
            <>
              <div className="sm:hidden divide-y divide-border">
                {list.data.data.map(w => (
                  <div key={w.id} className="space-y-3 p-4">
                    <div>
                      <p className="text-sm font-semibold break-words">{w.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{w.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full bg-secondary px-2 py-1">{status(w)}</span>
                      <span>{step(w)}</span>
                      <span className="tabular-nums">{w.record_count?.toLocaleString("id-ID") ?? "—"} record</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{date(w.updated_at)}</span>{actions(w)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full min-w-[1060px] table-fixed text-sm">
                  <colgroup><col className="w-[28%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[14%]" /><col className="w-[15%]" /><col className="w-[22%]" /></colgroup>
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">{t("workspace.name")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("common.status")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("workspace.records")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("workspace.step")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("workspace.updated")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("common.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.data.data.map(w => (
                      <tr key={w.id} className="h-[76px] hover:bg-secondary/20 transition-colors">
                        <td className="px-6 py-3 align-middle">
                          <p className="truncate font-semibold" title={w.name}>{w.name}</p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{w.id}
                            {!managementAllowed(w) && <span className="ml-2 font-sans">· Dibagikan</span>}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-middle"><span className="inline-flex rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">{status(w)}</span></td>
                        <td className="px-4 py-3 text-right align-middle tabular-nums">{w.record_count?.toLocaleString("id-ID") ?? "—"}</td>
                        <td className="px-4 py-3 align-middle text-xs">{step(w)}</td>
                        <td className="px-4 py-3 align-middle text-xs leading-5 text-muted-foreground">{date(w.updated_at)}</td>
                        <td className="px-4 py-3 align-middle">{actions(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination currentPage={page} pageSize={pageSize} totalItems={list.data.total} onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
            </>
          ) : null}
        </Card>
        <PromptDialog open={!!renaming} onOpenChange={open => { if (!open && !busy) setRenaming(null); }}
          title={t("workspace.rename")} description={t("workspace.renamePrompt")} defaultValue={renaming?.name ?? ""}
          confirmLabel={t("common.saveChanges")} cancelLabel={t("common.cancel")} onConfirm={rename} />
        <ConfirmationDialog open={!!deleting} setOpen={open => { if (!open && !busy) setDeleting(null); }}
          title={t("workspace.delete")} description={deleting ? t("workspace.deleteConfirm", { name: deleting.name }) : ""}
          actionLabel={t("workspace.delete")} cancelLabel={t("common.cancel")} onConfirm={remove} />
      </div>
    </AppLayout>
  );
}
