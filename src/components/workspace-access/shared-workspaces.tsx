import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppLayout, PageHeader } from "@/components/app-layout";
import { useAuth } from "@/lib/auth";
import { accessApi, type AccessWorkspace } from "@/lib/workspace-access";
import { ManageAccessButton } from "./access-management";
import { AccessFeedback, accessButton } from "./access-feedback";

export function SharedWorkspaces() {
  const { currentUser, isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["stage5a", "workspaces", currentUser?.id, page],
    queryFn: ({ signal }) => accessApi.workspaces(page, signal),
    enabled: isAuthenticated,
    retry: false,
  });
  return (
    <AppLayout>
      <main className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
        <PageHeader
          title="Workspace"
          description="Workspace milik sendiri dan workspace yang dibagikan"
        />
        <AccessFeedback error={list.error} reload={() => void list.refetch()} />
        {list.isPending && <p role="status">Memuat workspace…</p>}
        {list.data?.data.length === 0 && <p>Belum ada workspace yang dapat diakses.</p>}
        <div className="space-y-3">
          {!list.isError &&
            list.data?.data.map((w) => <WorkspaceAccessCard key={w.id} workspace={w} />)}
        </div>
        {list.data && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              className={accessButton}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </button>
            <span>
              {list.data.total} workspace · Halaman {page} / {list.data.last_page}
            </span>
            <button
              type="button"
              className={accessButton}
              disabled={page >= list.data.last_page}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </button>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
function WorkspaceAccessCard({ workspace: w }: { workspace: AccessWorkspace }) {
  const { currentUser } = useAuth();
  const owned = String(w.user_id) === String(currentUser?.id);
  const owner =
    w.owner_name ??
    (owned ? (currentUser?.name ?? `Pengguna #${w.user_id}`) : `Pengguna #${w.user_id}`);
  return (
    <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0">
        <h2 className="break-words text-sm font-semibold">{w.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pemilik: {owner} · {w.status}
        </p>
        <p className="mt-1 text-xs">
          {owned
            ? "Milik sendiri"
            : w.access_role === "editor" || w.access_role === "viewer"
              ? "Dibagikan"
              : "Lintas workspace"}{" "}
          · Akses: {w.access_role ?? "Memeriksa…"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {w.access_role && (
          <Link to="/matching" search={{ workspace: w.id }} className={accessButton}>
            Buka Workspace
          </Link>
        )}
        {(w.access_role === "owner" || w.access_role === "admin") && (
          <ManageAccessButton workspaceId={w.id} name={w.name} owner={owner} />
        )}
      </div>
    </article>
  );
}
