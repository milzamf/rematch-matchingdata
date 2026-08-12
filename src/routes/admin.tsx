import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { ErrorPanel } from "@/components/feedback-states";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  listAdminUsers,
  listAdminWorkspaces,
  reassignWorkspaceOwner,
  updateAdminUser,
  type AdminUserSummary,
  type WorkspaceSummary,
} from "@/lib/api";
import { PERMISSIONS, ROLES, type UserRole } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin - RE-MATCH" },
      { name: "description", content: "Administrasi pengguna dan kepemilikan workspace RE-MATCH" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canView = can(PERMISSIONS.ADMIN_ACCESS);

  const load = useCallback((mode: "initial" | "refresh" = "initial") => {
    if (!canView) return;

    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    Promise.all([listAdminUsers(), listAdminWorkspaces()])
      .then(([nextUsers, nextWorkspaces]) => {
        setUsers(nextUsers);
        setWorkspaces(nextWorkspaces);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("admin.loadFailed"));
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [canView, t]);

  useEffect(() => {
    load();
  }, [load]);

  const ownerOptions = useMemo(
    () => users.filter((user) => user.role !== "pimpinan"),
    [users],
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

  const changeRole = async (userId: string | number, role: UserRole) => {
    try {
      const updated = await updateAdminUser(userId, { role });
      setUsers((current) => current.map((item) => (item.id === userId ? updated : item)));
      toast.success(t("admin.userUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("admin.saveFailed"));
    }
  };

  const changeOwner = async (workspaceId: string, userId: string) => {
    try {
      const updated = await reassignWorkspaceOwner(workspaceId, userId);
      setWorkspaces((current) => current.map((item) => (item.id === workspaceId ? updated : item)));
      toast.success(t("admin.workspaceReassigned"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("admin.saveFailed"));
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <PageHeader
          title={t("admin.title")}
          description={t("admin.description")}
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

        {loading ? (
          <Card className="flex min-h-52 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("admin.loading")}
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <SectionHeader title={t("admin.users")} description={t("admin.usersDesc")} />
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "170px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "150px" }} />
                  </colgroup>
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">{t("admin.user")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("admin.role")}</th>
                      <th className="px-6 py-3 text-right font-medium">{t("admin.workspaceCountHeader")}</th>
                      <th className="px-6 py-3 text-right font-medium">{t("admin.datasetCountHeader")}</th>
                      <th className="px-6 py-3 text-right font-medium">{t("admin.jobCountHeader")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("common.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((user) => (
                      <tr key={String(user.id)} className="h-[68px] hover:bg-secondary/30">
                        <td className="min-w-0 px-6 py-3 align-middle">
                          <p className="truncate font-semibold">{user.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                        </td>
                        <td className="px-6 py-3 align-middle">
                          <select
                            value={user.role}
                            onChange={(event) => changeRole(user.id, event.target.value as UserRole)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {t(`auth.role.${role}` as Parameters<typeof t>[0])}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.workspace_count}</td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.dataset_count}</td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.matching_job_count}</td>
                        <td className="px-6 py-3 align-middle text-xs text-muted-foreground">{t("admin.roleChangeHint")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <SectionHeader title={t("admin.workspaces")} description={t("admin.workspacesDesc")} />
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "170px" }} />
                    <col style={{ width: "140px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "190px" }} />
                    <col style={{ width: "170px" }} />
                  </colgroup>
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">{t("workspace.name")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("admin.owner")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("common.status")}</th>
                      <th className="px-6 py-3 text-right font-medium">{t("workspace.records")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("workspace.updated")}</th>
                      <th className="px-6 py-3 text-left font-medium">{t("common.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {workspaces.map((workspace) => (
                      <tr key={workspace.id} className="h-[68px] hover:bg-secondary/30">
                        <td className="min-w-0 px-6 py-3 align-middle">
                          <p className="truncate font-semibold">{workspace.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{workspace.id}</p>
                        </td>
                        <td className="px-6 py-3 align-middle">
                          <select
                            value={String(workspace.owner?.id ?? "")}
                            onChange={(event) => changeOwner(workspace.id, event.target.value)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          >
                            <option value="">{t("admin.selectOwner")}</option>
                            {ownerOptions.map((user) => (
                              <option key={String(user.id)} value={String(user.id)}>
                                {user.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-3 align-middle">
                          <span className="inline-flex rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            {t(`workspace.status.${workspace.status}` as Parameters<typeof t>[0])}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">
                          {workspace.record_count ?? "-"}
                        </td>
                        <td className="px-6 py-3 align-middle text-muted-foreground">{formatDate(workspace.updated_at)}</td>
                        <td className="px-6 py-3 align-middle text-xs text-muted-foreground">
                          {t("admin.workspaceOwnerHint")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
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
