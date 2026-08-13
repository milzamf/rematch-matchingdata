import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyRound, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedState } from "@/components/access-denied-state";
import { AppLayout, Card, PageHeader } from "@/components/app-layout";
import { ErrorPanel } from "@/components/feedback-states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createAdminUser,
  listAdminUsers,
  listAdminWorkspaces,
  reassignWorkspaceOwner,
  setAdminUserPassword,
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

type UserFormState = {
  name: string;
  email: string;
  role: UserRole;
  password: string;
  passwordConfirmation: string;
};

type PasswordFormState = {
  password: string;
  passwordConfirmation: string;
};

const emptyCreateForm = (): UserFormState => ({
  name: "",
  email: "",
  role: "user",
  password: "",
  passwordConfirmation: "",
});

const emptyPasswordForm = (): PasswordFormState => ({
  password: "",
  passwordConfirmation: "",
});

function AdminPage() {
  const { t } = usePreferences();
  const { can } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUserSummary | null>(null);
  const [createForm, setCreateForm] = useState<UserFormState>(emptyCreateForm);
  const [editForm, setEditForm] = useState<UserFormState>(emptyCreateForm);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const canView = can(PERMISSIONS.ADMIN_ACCESS);

  const load = useCallback(
    (mode: "initial" | "refresh" = "initial") => {
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
    },
    [canView, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!editingUser) return;
    setEditForm({
      name: editingUser.name,
      email: editingUser.email,
      role: editingUser.role,
      password: "",
      passwordConfirmation: "",
    });
    setFormErrors({});
  }, [editingUser]);

  useEffect(() => {
    if (!passwordUser) return;
    setPasswordForm(emptyPasswordForm());
    setFormErrors({});
  }, [passwordUser]);

  const ownerOptions = useMemo(
    () => users.filter((user) => user.role !== "pimpinan"),
    [users],
  );

  const upsertUser = (next: AdminUserSummary) => {
    setUsers((current) => {
      const exists = current.some((item) => item.id === next.id);
      if (!exists) return [next, ...current];
      return current.map((item) => (item.id === next.id ? next : item));
    });
  };

  const extractFormErrors = (err: unknown) => {
    if (!(err instanceof ApiError)) return {};
    return Object.entries(err.errors ?? {}).reduce<Record<string, string>>((carry, [key, values]) => {
      if (values.length > 0) carry[key] = values[0] ?? "";
      return carry;
    }, {});
  };

  const resolveErrorMessage = (err: unknown, fallbackKey: Parameters<typeof t>[0]) => {
    if (!(err instanceof ApiError)) return t(fallbackKey);
    if (err.errors?.email?.length) return t("admin.emailInUse");
    return err.message;
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setCreateForm(emptyCreateForm());
    setFormErrors({});
  };

  const closeEditDialog = () => {
    setEditingUser(null);
    setFormErrors({});
  };

  const closePasswordDialog = () => {
    setPasswordUser(null);
    setPasswordForm(emptyPasswordForm());
    setFormErrors({});
  };

  const submitCreate = async () => {
    setSubmitting(true);
    setFormErrors({});

    try {
      const created = await createAdminUser(createForm);
      upsertUser(created);
      closeCreateDialog();
      toast.success(t("admin.userCreated"));
    } catch (err) {
      setFormErrors(extractFormErrors(err));
      toast.error(resolveErrorMessage(err, "admin.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editingUser) return;
    setSubmitting(true);
    setFormErrors({});

    try {
      const updated = await updateAdminUser(editingUser.id, {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
      });
      upsertUser(updated);
      closeEditDialog();
      toast.success(t("admin.userUpdated"));
    } catch (err) {
      setFormErrors(extractFormErrors(err));
      toast.error(resolveErrorMessage(err, "admin.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitPassword = async () => {
    if (!passwordUser) return;
    setSubmitting(true);
    setFormErrors({});

    try {
      await setAdminUserPassword(passwordUser.id, passwordForm);
      closePasswordDialog();
      toast.success(t("admin.passwordUpdated"));
    } catch (err) {
      setFormErrors(extractFormErrors(err));
      toast.error(resolveErrorMessage(err, "admin.saveFailed"));
    } finally {
      setSubmitting(false);
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
              <SectionHeader
                title={t("admin.users")}
                description={t("admin.usersDesc")}
                actions={
                  <button
                    onClick={() => {
                      setCreateForm(emptyCreateForm());
                      setFormErrors({});
                      setCreateOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
                  >
                    <Plus className="size-4" />
                    {t("admin.addUser")}
                  </button>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "170px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "220px" }} />
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
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground">
                            {t(`auth.role.${user.role}` as Parameters<typeof t>[0])}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.workspace_count}</td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.dataset_count}</td>
                        <td className="px-6 py-3 text-right align-middle tabular-nums">{user.matching_job_count}</td>
                        <td className="px-6 py-3 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => setEditingUser(user)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
                            >
                              <Pencil className="size-3.5" />
                              {t("admin.editUser")}
                            </button>
                            <button
                              onClick={() => setPasswordUser(user)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
                            >
                              <KeyRound className="size-3.5" />
                              {t("admin.setPassword")}
                            </button>
                          </div>
                        </td>
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

      <Dialog open={createOpen} onOpenChange={(open) => (!open ? closeCreateDialog() : setCreateOpen(true))}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.createUser")}</DialogTitle>
            <DialogDescription>{t("admin.createUserDesc")}</DialogDescription>
          </DialogHeader>
          <UserForm
            t={t}
            state={createForm}
            errors={formErrors}
            disabled={submitting}
            onChange={(field, value) => setCreateForm((current) => ({ ...current, [field]: value }))}
            includePassword
          />
          <DialogFooter>
            <button
              onClick={closeCreateDialog}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={submitCreate}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("admin.createUser")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => (!open ? closeEditDialog() : undefined)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.editUser")}</DialogTitle>
            <DialogDescription>{t("admin.editUserDesc")}</DialogDescription>
          </DialogHeader>
          <UserForm
            t={t}
            state={editForm}
            errors={formErrors}
            disabled={submitting}
            onChange={(field, value) => setEditForm((current) => ({ ...current, [field]: value }))}
          />
          <DialogFooter>
            <button
              onClick={closeEditDialog}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={submitEdit}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("common.saveChanges")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(passwordUser)} onOpenChange={(open) => (!open ? closePasswordDialog() : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.setPassword")}</DialogTitle>
            <DialogDescription>
              {t("admin.setPasswordDesc", { name: passwordUser?.name ?? "-" })}
            </DialogDescription>
          </DialogHeader>
          <PasswordForm
            t={t}
            state={passwordForm}
            errors={formErrors}
            disabled={submitting}
            onChange={(field, value) => setPasswordForm((current) => ({ ...current, [field]: value }))}
          />
          <DialogFooter>
            <button
              onClick={closePasswordDialog}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={submitPassword}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("admin.setPassword")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function UserForm({
  t,
  state,
  errors,
  disabled,
  onChange,
  includePassword = false,
}: {
  t: ReturnType<typeof usePreferences>["t"];
  state: UserFormState;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (field: keyof UserFormState, value: string) => void;
  includePassword?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <FormField label={t("admin.name")} error={errors.name}>
        <input
          value={state.name}
          onChange={(event) => onChange("name", event.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </FormField>
      <FormField label={t("admin.email")} error={errors.email}>
        <input
          type="email"
          value={state.email}
          onChange={(event) => onChange("email", event.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </FormField>
      <FormField label={t("admin.role")} error={errors.role}>
        <select
          value={state.role}
          onChange={(event) => onChange("role", event.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`auth.role.${role}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </FormField>
      {includePassword ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("admin.password")} error={errors.password}>
            <input
              type="password"
              value={state.password}
              onChange={(event) => onChange("password", event.target.value)}
              disabled={disabled}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label={t("admin.confirmPassword")} error={errors.password_confirmation}>
            <input
              type="password"
              value={state.passwordConfirmation}
              onChange={(event) => onChange("passwordConfirmation", event.target.value)}
              disabled={disabled}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}

function PasswordForm({
  t,
  state,
  errors,
  disabled,
  onChange,
}: {
  t: ReturnType<typeof usePreferences>["t"];
  state: PasswordFormState;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (field: keyof PasswordFormState, value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label={t("admin.password")} error={errors.password}>
        <input
          type="password"
          value={state.password}
          onChange={(event) => onChange("password", event.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </FormField>
      <FormField label={t("admin.confirmPassword")} error={errors.password_confirmation}>
        <input
          type="password"
          value={state.passwordConfirmation}
          onChange={(event) => onChange("passwordConfirmation", event.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </FormField>
    </div>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
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
