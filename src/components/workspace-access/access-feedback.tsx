import { WorkspaceAccessError } from "@/lib/workspace-access";

export const accessButton =
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
export function AccessFeedback({ error, reload }: { error: unknown; reload: () => void }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p>{error instanceof Error ? error.message : "Permintaan gagal."}</p>
      {error instanceof WorkspaceAccessError && error.ack && (
        <p className="mt-1 text-xs">
          Status usulan: {error.ack.items[0]?.status}. Keputusan efektif tidak ditimpa.
        </p>
      )}
      <button type="button" className={`${accessButton} mt-2`} onClick={reload}>
        Muat data terbaru
      </button>
    </div>
  );
}
