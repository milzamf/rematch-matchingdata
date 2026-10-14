import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/feedback-states";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { accessApi, type Member } from "@/lib/workspace-access";
import { useWorkspaceAccess } from "./use-workspace-access";
import { AccessFeedback, accessButton } from "./access-feedback";

const roles = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];
export function ManageAccessButton({
  workspaceId,
  name,
  owner,
  label = "Kelola Akses",
}: {
  workspaceId: string;
  name: string;
  owner: string;
  label?: string;
}) {
  const { access } = useWorkspaceAccess(workspaceId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!access?.permissions.members) return null;
  return (
    <>
      <button ref={triggerRef} type="button" className={accessButton} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <AccessManagementDialog
          workspaceId={workspaceId}
          name={name}
          owner={owner}
          onClose={() => setOpen(false)}
          restoreFocus={() => triggerRef.current?.focus()}
        />
      )}
    </>
  );
}

export function AccessManagementDialog({
  workspaceId,
  name,
  owner,
  onClose,
  restoreFocus,
}: {
  workspaceId: string;
  name: string;
  owner: string;
  onClose: () => void;
  restoreFocus?: () => void;
}) {
  const client = useQueryClient();
  const permission = useWorkspaceAccess(workspaceId);
  const allowed = !!permission.access?.permissions.members;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revoke, setRevoke] = useState<Member | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const members = useQuery({
    queryKey: ["stage5a", "members", workspaceId, permission.actorId, page],
    queryFn: ({ signal }) => accessApi.members(workspaceId, page, signal),
    enabled: allowed,
    retry: false,
  });
  const users = useQuery({
    queryKey: ["stage5a", "users", workspaceId, permission.actorId, debounced],
    queryFn: ({ signal }) => accessApi.users(workspaceId, debounced, signal),
    enabled: allowed && debounced.length >= 2,
    retry: false,
  });
  const reload = async () => {
    setError(null);
    await permission.refetch();
    await client.invalidateQueries({ queryKey: ["stage5a", "members", workspaceId] });
    await client.invalidateQueries({ queryKey: ["stage5a", "member-lookup", workspaceId] });
    await client.invalidateQueries({ queryKey: ["stage5a", "users", workspaceId] });
  };
  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(message);
      setSelected("");
      await reload();
    } catch (e) {
      setError(e);
      await permission.refetch();
    } finally {
      setBusy(false);
    }
  };
  const lookup = useQuery({
    queryKey: ["stage5a", "member-lookup", workspaceId, permission.actorId, selected],
    enabled: allowed && !!selected,
    retry: false,
    queryFn: async ({ signal }) => {
      // Include all pages and revoked membership tombstones in the CAS lookup.
      let lookupPage = 1;
      let last = 1;
      do {
        const result = await accessApi.members(workspaceId, lookupPage, signal);
        const member = result.data.find((m) => String(m.user_id) === selected);
        if (member) return member;
        last = result.last_page;
        lookupPage++;
      } while (lookupPage <= last);
      return null;
    },
  });
  const existing = lookup.data;
  const canAdd = allowed && !busy && !!selected && lookup.isSuccess;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (restoreFocus) {
            event.preventDefault();
            restoreFocus();
          }
        }}
        className="w-[calc(100%-1.5rem)] max-h-[85dvh] overflow-y-auto rounded-lg sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Kelola Akses</DialogTitle>
          <DialogDescription>
            {name} · Pemilik: {owner}
          </DialogDescription>
        </DialogHeader>
        <AccessFeedback
          error={error ?? permission.error ?? members.error ?? users.error ?? lookup.error}
          reload={() => void reload()}
        />
        {permission.isPending && <p role="status">Memuat hak akses…</p>}
        {!permission.isPending && !allowed && (
          <p role="alert">Pengelolaan akses tidak lagi diizinkan.</p>
        )}
        {allowed && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
              <div>
                <p className="mb-1 text-xs font-medium">Pengguna terdaftar</p>
                <SearchableSelect
                  aria-label="Pengguna terdaftar"
                  value={selected}
                  onChange={setSelected}
                  onSearchChange={(value) => {
                    setSearch(value);
                    setSelected("");
                  }}
                  options={(users.data ?? []).map((u) => ({
                    value: String(u.id),
                    label: u.name,
                    description: u.email,
                  }))}
                  searchPlaceholder="Ketik minimal 2 karakter"
                  placeholder="Cari pengguna"
                  emptyText={
                    users.isFetching ? "Mencari…" : "Ketik minimal 2 karakter untuk mencari"
                  }
                  disabled={busy}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Role anggota</p>
                <SearchableSelect
                  aria-label="Role anggota"
                  value={role}
                  onChange={(v) => setRole(v as Member["role"])}
                  options={roles}
                  searchable={false}
                  disabled={busy}
                />
              </div>
            </div>
            <button
              type="button"
              className={accessButton}
              disabled={!canAdd}
              onClick={() =>
                void mutate(
                  () =>
                    accessApi.setMember(
                      workspaceId,
                      Number(selected),
                      role,
                      existing?.version ?? 0,
                    ),
                  "Akses anggota disimpan",
                )
              }
            >
              {existing ? "Simpan Role Anggota" : "Tambah Anggota"}
            </button>
            {selected && lookup.isFetching && (
              <p role="status" className="text-xs text-muted-foreground">
                Memeriksa versi keanggotaan…
              </p>
            )}
            <div aria-busy={members.isFetching} className="space-y-2">
              {members.isPending && <p role="status">Memuat anggota…</p>}
              {members.data?.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada anggota.</p>
              )}
              {members.data?.data.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <p className="break-words text-sm font-medium">{member.name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {member.email} · {member.status === "active" ? "Aktif" : "Dicabut"}
                    </p>
                  </div>
                  <div className="w-28">
                    <SearchableSelect
                      aria-label={`Role ${member.name}`}
                      value={member.role}
                      options={roles}
                      searchable={false}
                      disabled={busy}
                      onChange={(next) =>
                        void mutate(
                          () =>
                            accessApi.setMember(
                              workspaceId,
                              member.user_id,
                              next as Member["role"],
                              member.version,
                            ),
                          "Role anggota diperbarui",
                        )
                      }
                    />
                  </div>
                  {member.status === "active" ? (
                    <button
                      type="button"
                      className={accessButton}
                      disabled={busy}
                      onClick={() => setRevoke(member)}
                    >
                      Cabut Akses
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={accessButton}
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            accessApi.setMember(
                              workspaceId,
                              member.user_id,
                              member.role,
                              member.version,
                            ),
                          "Akses diaktifkan kembali",
                        )
                      }
                    >
                      Aktifkan Kembali
                    </button>
                  )}
                </div>
              ))}
            </div>
            {members.data && members.data.last_page > 1 && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  className={accessButton}
                  disabled={page <= 1 || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Sebelumnya
                </button>
                <span>
                  Halaman {page} / {members.data.last_page}
                </span>
                <button
                  className={accessButton}
                  disabled={page >= members.data.last_page || busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                </button>
              </div>
            )}
          </>
        )}
        <ConfirmationDialog
          open={!!revoke}
          setOpen={(open) => {
            if (!open) setRevoke(null);
          }}
          title="Cabut akses anggota?"
          description={`${revoke?.name ?? "Anggota"} tidak lagi dapat menggunakan workspace ini.`}
          actionLabel="Ya, Cabut Akses"
          cancelLabel="Batal"
          onConfirm={() => {
            const member = revoke;
            setRevoke(null);
            if (member)
              void mutate(
                () => accessApi.revoke(workspaceId, member.user_id, member.version),
                "Akses dicabut",
              );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
