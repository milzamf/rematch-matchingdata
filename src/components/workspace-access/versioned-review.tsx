import { useEffect, useRef, useState } from "react";
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
  WorkspaceAccessError,
  decisionLabels,
  type Decision,
  type ReviewAck,
  type WorkspaceAccess,
  type WriteItem,
} from "@/lib/workspace-access";
import { AccessFeedback, accessButton } from "./access-feedback";

// A read-model interface, NOT an invented API response. Must come from an attested
// isolated state reader. Legacy ReviewItem has neither version nor protection.
export type VersionedReviewRecord = {
  key: string;
  version: number;
  decision: Decision | null;
  status: string;
  reviewerId: number | null;
  reviewerName: string | null;
  protection: string;
  origin: string;
  candidates: { id: string; referenceKey: string; label: string; disabled?: boolean }[];
};
function requiresProposal(record: VersionedReviewRecord, actorId: number): boolean {
  return (
    record.protection === "approved" ||
    (record.protection === "reviewer_owned" && record.reviewerId !== actorId)
  );
}
export function VersionedReview({
  jobId,
  record,
  access,
  actorId,
  reload,
}: {
  jobId: string;
  record: VersionedReviewRecord;
  access: WorkspaceAccess;
  actorId: number;
  reload: () => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [decision, setDecision] = useState<Decision>("accept_match");
  const [candidate, setCandidate] = useState(record.candidates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const [lastAck, setLastAck] = useState<ReviewAck | null>(null);
  useEffect(() => {
    setSubmitted(false);
  }, [record.version]);
  const manualReload = () => {
    setError(null);
    setSubmitted(false);
    reload();
  };
  const proposal = requiresProposal(record, actorId);
  const allowed = proposal ? access.permissions.propose : access.permissions.review;
  const needsCandidate = decision !== "mark_unmatched";
  const candidateValid =
    !needsCandidate ||
    (!!candidate &&
      record.candidates.some(
        (c) => c.id === candidate && (decision === "reject_match" || !c.disabled),
      ));
  const save = async () => {
    if (!allowed || busy || (proposal && !reason.trim()) || !candidateValid) return;
    const item: WriteItem = {
      input_record_key: record.key,
      expected_version: record.version,
      decision,
      ...(needsCandidate ? { candidate_id: candidate } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const ack = proposal
        ? await accessApi.propose(jobId, item, reason, crypto.randomUUID())
        : await accessApi.decide(jobId, [item], crypto.randomUUID());
      const failed = ack.items.find((i) => i.outcome !== "applied" && i.outcome !== "submitted");
      if (failed)
        throw new WorkspaceAccessError(
          409,
          failed.code ?? failed.conflict_code ?? "approval_required",
          undefined,
          ack,
        );
      if (proposal) {
        setSubmitted(true);
        toast.success("Revisi diajukan; keputusan efektif tetap");
        await reload();
      } else {
        setLastAck(ack);
        toast.success("Keputusan disimpan");
        await reload();
      }
      setOpen(false);
    } catch (e) {
      setError(e);
      setOpen(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!access.permissions.review || busy || !lastAck) return;
    const items = lastAck.items
      .filter((i) => i.outcome === "applied" && i.version !== undefined)
      .map((i) => ({ input_record_key: i.input_record_key, expected_version: record.version }));
    setBusy(true);
    setError(null);
    try {
      const ack = await accessApi.undo(jobId, lastAck.operation_id, items, crypto.randomUUID());
      if (ack.conflicted || ack.items.some((i) => i.outcome !== "applied"))
        throw new WorkspaceAccessError(
          409,
          ack.items.find((i) => i.outcome !== "applied")?.conflict_code ?? "stale_review_version",
          undefined,
          ack,
        );
      setLastAck(null);
      toast.success("Keputusan dibatalkan");
      await reload();
    } catch (e) {
      setError(e);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">Record {record.key}</p>
      <p>Keputusan efektif: {record.decision ? decisionLabels[record.decision] : record.status}</p>
      <p className="text-xs text-muted-foreground">
        Reviewer: {record.reviewerName ?? "Tidak diketahui"} · Versi {record.version}
      </p>
      <AccessFeedback error={open ? null : error} reload={manualReload} />
      {submitted && (
        <p role="status" className="text-xs">
          Menunggu persetujuan. Keputusan efektif belum berubah.
        </p>
      )}
      {allowed && (
        <button
          ref={triggerRef}
          type="button"
          className={accessButton}
          disabled={busy || submitted || !!error}
          onClick={() => setOpen(true)}
        >
          {proposal ? "Ajukan Revisi" : "Review Record"}
        </button>
      )}
      {lastAck && access.permissions.review && (
        <button
          type="button"
          className={accessButton}
          disabled={busy || !!error}
          onClick={() => void undo()}
        >
          Undo Keputusan
        </button>
      )}
      <Dialog
        open={open && allowed}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          className="w-[calc(100%-1.5rem)] max-h-[85dvh] overflow-y-auto rounded-lg"
        >
          <DialogHeader>
            <DialogTitle>{proposal ? "Ajukan Revisi" : "Review Record"}</DialogTitle>
            <DialogDescription>
              Record {record.key} · Reviewer sebelumnya: {record.reviewerName ?? "Tidak diketahui"}.{" "}
              {proposal
                ? "Usulan belum mengubah keputusan efektif."
                : "Server memeriksa versi dan assignment acuan."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Keputusan saat ini: {record.decision ? decisionLabels[record.decision] : record.status}
          </p>
          <div>
            <p className="mb-1 text-xs">Keputusan yang diusulkan</p>
            <SearchableSelect
              aria-label="Keputusan yang diusulkan"
              value={decision}
              onChange={(v) => setDecision(v as Decision)}
              searchable={false}
              options={Object.entries(decisionLabels).map(([value, label]) => ({ value, label }))}
              disabled={busy}
            />
          </div>
          {needsCandidate && (
            <div>
              <p className="mb-1 text-xs">Kandidat / acuan</p>
              <SearchableSelect
                aria-label="Kandidat acuan"
                value={candidate}
                onChange={setCandidate}
                options={record.candidates.map((c) => ({
                  value: c.id,
                  label: c.label,
                  description: c.referenceKey,
                  disabled: decision !== "reject_match" && c.disabled,
                }))}
                disabled={busy}
              />
            </div>
          )}
          {proposal && (
            <label className="text-sm">
              Alasan revisi (wajib)
              <textarea
                aria-label="Alasan revisi"
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2"
              />
            </label>
          )}
          <AccessFeedback error={error} reload={manualReload} />
          <button
            type="button"
            className={accessButton}
            disabled={busy || !!error || (proposal && !reason.trim()) || !candidateValid}
            onClick={() => void save()}
          >
            {busy ? "Menyimpan…" : proposal ? "Kirim Usulan" : "Simpan Keputusan"}
          </button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
