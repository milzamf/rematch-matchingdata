import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  accessApi,
  decisionLabels,
  proposalLabels,
  type Proposal,
  type ProposalStatus,
} from "@/lib/workspace-access";
import { AccessFeedback, accessButton } from "./access-feedback";
import { useWorkspaceAccess } from "./use-workspace-access";

export function ApprovalInbox({
  workspaceId,
  name,
  jobId,
}: {
  workspaceId: string;
  name: string;
  jobId: string;
}) {
  const permission = useWorkspaceAccess(workspaceId);
  const sectionRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const allowed = !!permission.access?.permissions.approve;
  const client = useQueryClient();
  const [status, setStatus] = useState<ProposalStatus>("pending");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<{ proposal: Proposal; approve: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const proposals = useQuery({
    queryKey: ["stage5a", "proposals", jobId, permission.actorId, status, page],
    queryFn: ({ signal }) => accessApi.proposals(jobId, status, page, signal),
    enabled: allowed,
    retry: false,
    refetchInterval: 15_000,
  });
  const reload = async () => {
    setError(null);
    await permission.refetch();
    await client.invalidateQueries({ queryKey: ["stage5a", "proposals", jobId] });
  };
  const resolve = async () => {
    if (!allowed || !resolving || busy || (!resolving.approve && !reason.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await accessApi.resolve(
        jobId,
        resolving.proposal,
        resolving.approve,
        reason,
        crypto.randomUUID(),
      );
      toast.success(
        resolving.approve
          ? "Usulan disetujui"
          : "Usulan ditolak; keputusan sebelumnya dipertahankan",
      );
      setResolving(null);
      await reload();
      await client.invalidateQueries({ queryKey: ["stage5a", "review", jobId] });
    } catch (e) {
      setError(e);
      setResolving(null);
      await permission.refetch();
      await client.invalidateQueries({ queryKey: ["stage5a", "proposals", jobId] });
    } finally {
      setBusy(false);
    }
  };
  if (!allowed) return null;
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="mt-4 space-y-3 rounded-lg border border-border p-4"
      aria-label="Menunggu Persetujuan"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Menunggu Persetujuan</h2>
        <div className="w-44">
          <SearchableSelect
            aria-label="Status usulan"
            value={status}
            searchable={false}
            options={Object.entries(proposalLabels).map(([value, label]) => ({ value, label }))}
            onChange={(v) => {
              setStatus(v as ProposalStatus);
              setPage(1);
            }}
          />
        </div>
      </div>
      <AccessFeedback error={error ?? proposals.error} reload={() => void reload()} />
      {proposals.isPending && <p role="status">Memuat usulan…</p>}
      {proposals.isFetching && !proposals.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Memperbarui usulan…
        </p>
      )}
      {proposals.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada usulan dengan status ini.</p>
      )}
      {proposals.data?.data.map((p) => (
        <article key={p.id} className="space-y-2 rounded-lg border border-border p-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-semibold">
              {name} · Record <span className="font-mono">{p.input_record_key}</span>
            </p>
            <span className="rounded-full bg-secondary px-2 py-1">{proposalLabels[p.status]}</span>
          </div>
          <p>
            Pengusul: {p.proposer_name ?? `Pengguna #${p.proposed_by_user_id}`} · Reviewer
            sebelumnya: {p.previous_reviewer_name ?? "Tidak diketahui"}
          </p>
          <p>
            Keputusan lama:{" "}
            {p.before_decision ? decisionLabels[p.before_decision] : p.before_status} · Acuan:{" "}
            {p.before_reference_record_key ?? "—"}
          </p>
          <p>
            Usulan: {decisionLabels[p.proposed_decision]} · Acuan:{" "}
            {p.proposed_reference_record_key ?? "—"}
          </p>
          <p className="whitespace-pre-wrap break-words">Alasan: {p.reason}</p>
          <p className="text-muted-foreground">
            {p.created_at}
            {p.approver_name ? ` · Diselesaikan oleh ${p.approver_name}` : ""}
          </p>
          {p.resolution_reason && (
            <p className="break-words">Catatan penyelesaian: {p.resolution_reason}</p>
          )}
          {p.status === "pending" && (
            <div className="flex gap-2">
              <button
                type="button"
                className={accessButton}
                disabled={busy}
                onClick={(event) => {
                  triggerRef.current = event.currentTarget;
                  setReason("");
                  setResolving({ proposal: p, approve: true });
                }}
              >
                Setujui
              </button>
              <button
                type="button"
                className={accessButton}
                disabled={busy}
                onClick={(event) => {
                  triggerRef.current = event.currentTarget;
                  setReason("");
                  setResolving({ proposal: p, approve: false });
                }}
              >
                Tolak
              </button>
            </div>
          )}
        </article>
      ))}
      {proposals.data && proposals.data.last_page > 1 && (
        <div className="flex justify-between gap-2">
          <button
            className={accessButton}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Sebelumnya
          </button>
          <p className="text-xs">
            {page} / {proposals.data.last_page} · {proposals.data.total} usulan
          </p>
          <button
            className={accessButton}
            disabled={page >= proposals.data.last_page}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya
          </button>
        </div>
      )}
      <Dialog
        open={!!resolving && allowed}
        onOpenChange={(open) => {
          if (!open && !busy) setResolving(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (triggerRef.current?.isConnected ? triggerRef.current : sectionRef.current)?.focus();
          }}
          className="w-[calc(100%-1.5rem)] rounded-lg"
        >
          <DialogHeader>
            <DialogTitle>{resolving?.approve ? "Setujui usulan?" : "Tolak usulan?"}</DialogTitle>
            <DialogDescription>
              Record {resolving?.proposal.input_record_key}. Versi usulan dan keputusan diperiksa
              kembali oleh server.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            {resolving?.approve ? "Catatan (opsional)" : "Alasan penolakan (wajib)"}
            <textarea
              aria-label="Alasan penyelesaian"
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2"
            />
          </label>
          <button
            type="button"
            className={accessButton}
            disabled={busy || (!resolving?.approve && !reason.trim())}
            onClick={() => void resolve()}
          >
            {busy ? "Menyimpan…" : "Konfirmasi"}
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
