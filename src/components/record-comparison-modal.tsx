import { useState, useMemo, useEffect, useCallback, Component, type ReactNode } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Database,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  Search,
  AlertTriangle,
  Columns,
  FileSpreadsheet,
  Filter,
} from "lucide-react";
import type { ReviewItem, ReviewCandidate } from "@/lib/api";
import type { IdentityFieldPair } from "@/lib/result-identity";

// Internal ErrorBoundary to prevent any modal render issues from bubbling to root
class ModalErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("RecordComparisonModal error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
          <div className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Gagal Menampilkan Detail Record</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {this.state.error?.message ?? "Terjadi kesalahan saat memproses data record ini."}
            </p>
          </div>
          <button
            type="button"
            onClick={this.props.onClose}
            className="cursor-pointer rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors"
          >
            Tutup Modal
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface RecordComparisonModalProps {
  open: boolean;
  onClose: () => void;
  item: ReviewItem | null;
  items?: ReviewItem[];
  initialCandidateId?: string | null;
  identityMappings?: IdentityFieldPair[];
  canDecide: boolean;
  isPending?: boolean;
  onDecide: (
    item: ReviewItem,
    decision: "accept_match" | "reject_match" | "select_candidate" | "mark_unmatched",
    candidate?: ReviewCandidate | null,
  ) => Promise<void>;
  onUndo?: (item: ReviewItem) => Promise<void>;
  onNavigate?: (nextItem: ReviewItem) => void;
}

function scoreBadgeClass(score?: number | null): string {
  const val = typeof score === "number" ? score : 0;
  if (val >= 85) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (val >= 70) return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20";
}

function scoreTextColor(score?: number | null): string {
  const val = typeof score === "number" ? score : 0;
  if (val >= 85) return "text-emerald-700 dark:text-emerald-400";
  if (val >= 70) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

function scoreProgressBarClass(score?: number | null): string {
  const val = typeof score === "number" ? score : 0;
  if (val >= 85) return "bg-emerald-500";
  if (val >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

function statusBadgeInfo(status?: string | null): { label: string; className: string } {
  if (!status) {
    return { label: "Need Review", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" };
  }
  const normalized = String(status).toUpperCase().replace(/\s+/g, "_");
  if (["AUTO_MATCHED", "MATCHED"].includes(normalized)) {
    return { label: "Auto Matched", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" };
  }
  if (["MANUAL_ACCEPTED"].includes(normalized)) {
    return { label: "Disetujui Manual", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" };
  }
  if (["NEED_REVIEW", "POSSIBLE_MATCH"].includes(normalized)) {
    return { label: "Need Review", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" };
  }
  if (["MANUAL_REJECTED"].includes(normalized)) {
    return { label: "Ditolak Manual", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20" };
  }
  if (["CONFIRMED_UNMATCHED", "UNMATCHED"].includes(normalized)) {
    return { label: "Terkonfirmasi Unmatched", className: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20" };
  }
  return { label: String(status), className: "bg-secondary text-muted-foreground border-border" };
}

function comparisonLabel(comparison?: string | null): { text: string; className: string } {
  if (comparison === "same") {
    return { text: "Sama Persis (100%)", className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  if (comparison === "similar") {
    return { text: "Mirip", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" };
  }
  return { text: "Berbeda", className: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20" };
}

function formatRawValue(val: unknown): string {
  if (val === null || val === undefined || val === "") return "— (kosong)";
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function CopyButton({ text, title = "Salin teks" }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
      title={title}
    >
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
    </button>
  );
}

function CopyAllButton({
  data,
  label,
}: {
  data: Record<string, unknown>;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const tsv = Object.entries(data)
      .map(([k, v]) => `${k}\t${formatRawValue(v)}`)
      .join("\n");
    navigator.clipboard.writeText(tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopyAll}
      className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all"
      title={`Salin semua kolom & nilai ${label} ke clipboard (format Excel/TSV)`}
    >
      {copied ? (
        <>
          <Check className="size-3 text-emerald-600" />
          <span className="text-emerald-600 font-semibold">Tersalin!</span>
        </>
      ) : (
        <>
          <Copy className="size-3" />
          <span>Salin Semua ({label})</span>
        </>
      )}
    </button>
  );
}

export function RecordComparisonModal({
  open,
  onClose,
  item,
  items = [],
  initialCandidateId,
  identityMappings = [],
  canDecide,
  isPending = false,
  onDecide,
  onUndo,
  onNavigate,
}: RecordComparisonModalProps) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(initialCandidateId ?? null);
  const [attributeFilter, setAttributeFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "raw_table">("overview");
  const [rawLayout, setRawLayout] = useState<"split" | "input_only" | "ref_only">("split");
  const [hideEmptyRaw, setHideEmptyRaw] = useState(false);

  // Keep selected candidate in sync when item changes
  useEffect(() => {
    if (item?.candidates && Array.isArray(item.candidates) && item.candidates.length > 0) {
      if (initialCandidateId) {
        const matchingCand = item.candidates.find((c) => c && c.id === initialCandidateId);
        if (matchingCand) {
          setSelectedCandidateId(matchingCand.id);
          return;
        }
      }
      setSelectedCandidateId(item.candidates[0].id);
    } else {
      setSelectedCandidateId(null);
    }
  }, [item?.input_record_key, initialCandidateId]);

  const currentCandidate = useMemo(() => {
    if (!item || !item.candidates || !Array.isArray(item.candidates) || item.candidates.length === 0) {
      return null;
    }
    if (selectedCandidateId) {
      const found = item.candidates.find((c) => c && c.id === selectedCandidateId);
      if (found) return found;
    }
    return item.candidates[0] ?? null;
  }, [item, selectedCandidateId]);

  // Navigation: Next and Prev calculation
  const currentIndex = useMemo(() => {
    if (!item || items.length === 0) return -1;
    return items.findIndex((entry) => entry.input_record_key === item.input_record_key);
  }, [item, items]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      const prevItem = items[currentIndex - 1];
      if (prevItem) onNavigate(prevItem);
    }
  }, [hasPrev, onNavigate, items, currentIndex]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate) {
      const nextItem = items[currentIndex + 1];
      if (nextItem) onNavigate(nextItem);
    }
  }, [hasNext, onNavigate, items, currentIndex]);

  // Keyboard navigation: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        handlePrev();
      } else if (e.key === "ArrowRight" && hasNext) {
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, hasPrev, hasNext, handlePrev, handleNext, onClose]);

  const inputData = useMemo(() => item?.input_record ?? {}, [item]);
  const referenceData = useMemo(() => currentCandidate?.reference_record ?? {}, [currentCandidate]);

  // Pure separate entries for Data Input (Excel LPSE)
  const inputAllEntries = useMemo(() => Object.entries(inputData), [inputData]);
  const inputFilteredEntries = useMemo(() => {
    const q = attributeFilter.toLowerCase().trim();
    return inputAllEntries.filter(([k, v]) => {
      if (hideEmptyRaw && (v === null || v === undefined || String(v).trim() === "")) return false;
      if (!q) return true;
      return k.toLowerCase().includes(q) || formatRawValue(v).toLowerCase().includes(q);
    });
  }, [inputAllEntries, attributeFilter, hideEmptyRaw]);

  // Pure separate entries for Data Acuan (Excel BPS)
  const refAllEntries = useMemo(() => Object.entries(referenceData), [referenceData]);
  const refFilteredEntries = useMemo(() => {
    const q = attributeFilter.toLowerCase().trim();
    return refAllEntries.filter(([k, v]) => {
      if (hideEmptyRaw && (v === null || v === undefined || String(v).trim() === "")) return false;
      if (!q) return true;
      return k.toLowerCase().includes(q) || formatRawValue(v).toLowerCase().includes(q);
    });
  }, [refAllEntries, attributeFilter, hideEmptyRaw]);

  const filledInputCount = useMemo(
    () => inputAllEntries.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").length,
    [inputAllEntries],
  );

  const filledRefCount = useMemo(
    () => refAllEntries.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").length,
    [refAllEntries],
  );

  if (!open || !item) return null;

  // Main status and score
  const statusInfo = statusBadgeInfo(item.status_code ?? item.display_status ?? item.status);
  const totalScore = typeof currentCandidate?.score === "number" ? currentCandidate.score : 0;
  const fieldScores = Array.isArray(currentCandidate?.field_scores) ? currentCandidate.field_scores : [];

  // Identify primary entity names
  const inputName =
    (inputData.nama_penyedia as string) ??
    (inputData.nama_perusahaan as string) ??
    (inputData.nama as string) ??
    (inputData.name as string) ??
    item.input_record_key;

  const referenceName =
    (referenceData.nama_perusahaan as string) ??
    (referenceData.nama_penyedia as string) ??
    (referenceData.nama as string) ??
    (referenceData.name as string) ??
    currentCandidate?.reference_record_key ??
    "-";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5 md:p-6 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-6xl h-[92vh] max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalErrorBoundary onClose={onClose}>
          {/* Header */}
          <div className="border-b border-border bg-secondary/30 px-6 py-4 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left: Title & Navigation */}
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand">
                  <GitCompareArrows className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground tracking-tight">
                      Review & Perbandingan Pencocokan Data
                    </h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ID Input: <span className="font-mono font-semibold text-foreground">{item.input_record_key}</span>
                  </p>
                </div>
              </div>

              {/* Center: Record Navigation (Prev / Next) */}
              {items.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2 py-1 shadow-2xs">
                  <button
                    type="button"
                    onClick={handlePrev}
                    disabled={!hasPrev}
                    className="cursor-pointer inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Record Sebelumnya (Shortcut: ←)"
                  >
                    <ChevronLeft className="size-3.5" />
                    <span className="hidden sm:inline">Prev</span>
                  </button>

                  <span className="px-2 text-xs font-bold tabular-nums text-foreground border-x border-border/60">
                    {currentIndex + 1} <span className="text-muted-foreground font-normal">/ {items.length}</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!hasNext}
                    className="cursor-pointer inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Record Berikutnya (Shortcut: →)"
                  >
                    <span className="hidden sm:inline">Next</span>
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Right: Badges & Close Button */}
              <div className="flex items-center gap-2.5">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusInfo.className}`}>
                  {statusInfo.label}
                </span>

                {currentCandidate && (
                  <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tabular-nums ${scoreBadgeClass(totalScore)}`}>
                    <span className="hidden sm:inline">Skor Total (WLS):</span>
                    <span className="text-sm font-black">{totalScore}%</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer ml-1"
                  title="Tutup (Esc)"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Candidate Selector Tabs (if multiple candidates) */}
            {item.candidates && item.candidates.length > 1 && (
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pt-2.5 border-t border-border/50 text-xs">
                <span className="text-muted-foreground font-medium shrink-0">
                  Pilih Kandidat Acuan ({item.candidates.length}):
                </span>
                <div className="flex items-center gap-1.5">
                  {item.candidates.map((cand, idx) => {
                    const isSelected = currentCandidate?.id === cand.id;
                    const candName =
                      (cand.reference_record?.nama_perusahaan as string) ??
                      (cand.reference_record?.nama_penyedia as string) ??
                      `Kandidat #${cand.rank ?? idx + 1}`;
                    return (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => setSelectedCandidateId(cand.id)}
                        className={`cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                          isSelected
                            ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                            : "border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <span className="font-bold">#{cand.rank ?? idx + 1}</span>
                        <span className="max-w-[150px] truncate">{candName}</span>
                        <span className="font-bold tabular-nums">({cand.score}%)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Navigation View Switcher (Overview vs Raw Separate Tables) */}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/50 pt-2.5">
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={`cursor-pointer rounded-md px-3.5 py-1.5 transition-all ${
                    activeTab === "overview"
                      ? "bg-secondary text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Ringkasan & Skor Similarity
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("raw_table")}
                  className={`cursor-pointer rounded-md px-3.5 py-1.5 transition-all flex items-center gap-1.5 ${
                    activeTab === "raw_table"
                      ? "bg-secondary text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileSpreadsheet className="size-3.5 text-brand" />
                  <span>Data Asli Excel (Input & Acuan Terpisah)</span>
                </button>
              </div>

              {activeTab === "raw_table" && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground hidden md:inline">
                    Input: <strong>{inputAllEntries.length}</strong> kolom • Acuan: <strong>{refAllEntries.length}</strong> kolom
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Modal Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeTab === "overview" ? (
              <>
                {/* 1. Entity Overview Side-by-Side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Input Card */}
                  <div className="rounded-xl border border-border bg-secondary/15 p-4.5 relative overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2.5 py-1 text-xs font-semibold">
                        <Database className="size-3.5" />
                        DATA INPUT (LPSE / Mitra)
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        Key: {item.input_record_key}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-foreground leading-snug break-words">
                      {inputName}
                    </h3>
                    <div className="mt-3.5 space-y-2 text-xs text-muted-foreground">
                      {inputData.npwp_penyedia || inputData.npwp ? (
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-foreground shrink-0 w-28">NPWP:</span>
                          <span className="font-mono text-foreground font-medium select-all">
                            {formatRawValue(inputData.npwp_penyedia ?? inputData.npwp)}
                          </span>
                        </p>
                      ) : null}
                      {inputData.nib ? (
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-foreground shrink-0 w-28">NIB:</span>
                          <span className="font-mono text-foreground font-medium select-all">
                            {formatRawValue(inputData.nib)}
                          </span>
                        </p>
                      ) : null}
                      {inputData.bentuk_usaha ? (
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-foreground shrink-0 w-28">Bentuk Usaha:</span>
                          <span className="text-foreground">{formatRawValue(inputData.bentuk_usaha)}</span>
                        </p>
                      ) : null}
                      {inputData.alamat ? (
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-foreground shrink-0 w-28">Alamat:</span>
                          <span className="text-foreground leading-relaxed">{formatRawValue(inputData.alamat)}</span>
                        </p>
                      ) : null}
                      {inputData.nmkab || inputData.kabupaten || inputData.kab ? (
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-foreground shrink-0 w-28">Kabupaten/Kota:</span>
                          <span className="text-foreground">
                            {formatRawValue(inputData.nmkab ?? inputData.kabupaten ?? inputData.kab)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Reference Card */}
                  <div className="rounded-xl border border-border bg-secondary/15 p-4.5 relative overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 text-xs font-semibold">
                        <Database className="size-3.5" />
                        DATA ACUAN / REFERENSI (BPS)
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        Key: {currentCandidate?.reference_record_key ?? "-"}
                      </span>
                    </div>
                    {currentCandidate ? (
                      <>
                        <h3 className="text-base font-bold text-foreground leading-snug break-words">
                          {referenceName}
                        </h3>
                        <div className="mt-3.5 space-y-2 text-xs text-muted-foreground">
                          {referenceData.npwp || referenceData.npwp_penyedia ? (
                            <p className="flex items-start gap-1.5">
                              <span className="font-semibold text-foreground shrink-0 w-28">NPWP:</span>
                              <span className="font-mono text-foreground font-medium select-all">
                                {formatRawValue(referenceData.npwp ?? referenceData.npwp_penyedia)}
                              </span>
                            </p>
                          ) : null}
                          {referenceData.nib ? (
                            <p className="flex items-start gap-1.5">
                              <span className="font-semibold text-foreground shrink-0 w-28">NIB:</span>
                              <span className="font-mono text-foreground font-medium select-all">
                                {formatRawValue(referenceData.nib)}
                              </span>
                            </p>
                          ) : null}
                          {referenceData.badan_usaha || referenceData.bentuk_usaha ? (
                            <p className="flex items-start gap-1.5">
                              <span className="font-semibold text-foreground shrink-0 w-28">Badan Usaha:</span>
                              <span className="text-foreground">
                                {formatRawValue(referenceData.badan_usaha ?? referenceData.bentuk_usaha)}
                              </span>
                            </p>
                          ) : null}
                          {referenceData.alamat_perusahaan || referenceData.alamat ? (
                            <p className="flex items-start gap-1.5">
                              <span className="font-semibold text-foreground shrink-0 w-28">Alamat:</span>
                              <span className="text-foreground leading-relaxed">
                                {formatRawValue(referenceData.alamat_perusahaan ?? referenceData.alamat)}
                              </span>
                            </p>
                          ) : null}
                          {referenceData.nm_kab || referenceData.nmkab || referenceData.kab ? (
                            <p className="flex items-start gap-1.5">
                              <span className="font-semibold text-foreground shrink-0 w-28">Kabupaten/Kota:</span>
                              <span className="text-foreground">
                                {formatRawValue(referenceData.nm_kab ?? referenceData.nmkab ?? referenceData.kab)}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="py-12 text-center text-xs text-muted-foreground">
                        Tidak ada kandidat acuan yang cocok ditemukan.
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Nilai Per Kolom Similarity & Total WLS */}
                {currentCandidate && (
                  <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
                    <div className="border-b border-border bg-muted/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                          Nilai Per Kolom Similarity & Kontribusi Total (WLS)
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Perhitungan pembobotan linier (Weighted Linear Score) berdasarkan parameter komparasi
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">Similarity Total (WLS):</span>
                        <span className={`rounded-md border px-2.5 py-0.5 text-xs font-bold tabular-nums ${scoreBadgeClass(totalScore)}`}>
                          {totalScore}%
                        </span>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold">Kolom (Input ↔ Acuan)</th>
                            <th className="px-4 py-2.5 text-left font-semibold">Nilai Data Input</th>
                            <th className="px-4 py-2.5 text-left font-semibold">Nilai Data Acuan</th>
                            <th className="px-4 py-2.5 text-center font-semibold">Skor Similarity</th>
                            <th className="px-4 py-2.5 text-center font-semibold">Bobot</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Status Evaluasi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {fieldScores.map((f, i) => {
                            const comp = comparisonLabel(f.comparison);
                            const inputVal = inputData[f.input_column] ?? "-";
                            const refVal = referenceData[f.reference_column] ?? "-";

                            return (
                              <tr key={`${f.input_column}-${f.reference_column}-${i}`} className="hover:bg-secondary/20 transition-colors">
                                <td className="px-4 py-3 font-semibold text-foreground">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground">{f.input_column}</span>
                                    <ArrowRight className="size-3 text-muted-foreground/60 shrink-0" />
                                    <span className="text-foreground">{f.reference_column}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 max-w-[220px] break-words text-muted-foreground">
                                  {formatRawValue(inputVal)}
                                </td>
                                <td className="px-4 py-3 max-w-[220px] break-words text-foreground font-medium">
                                  {formatRawValue(refVal)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <div className="inline-flex flex-col items-center gap-1">
                                    <span className={`font-bold tabular-nums ${scoreTextColor(f.score)}`}>
                                      {Math.round(typeof f.score === "number" ? f.score : 0)}%
                                    </span>
                                    <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${scoreProgressBarClass(f.score)}`}
                                        style={{ width: `${Math.min(100, Math.max(0, typeof f.score === "number" ? f.score : 0))}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                                  {(f as { weight?: number }).weight !== undefined ? `${(f as { weight?: number }).weight}%` : "-"}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${comp.className}`}>
                                    {comp.text}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* 3. DATA ASLI LENGKAP - DIPISAH SESUAI SUMBER EXCEL MASING-MASING */
              <div className="space-y-4">
                {/* Toolbar Data Asli */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-secondary/20 p-3.5 rounded-xl border border-border">
                  {/* Left: Layout view selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Columns className="size-3.5" />
                      Tata Letak:
                    </span>
                    <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setRawLayout("split")}
                        className={`cursor-pointer rounded px-3 py-1 font-medium transition-all ${
                          rawLayout === "split"
                            ? "bg-secondary text-foreground font-semibold shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Berdampingan (Input & Acuan)
                      </button>
                      <button
                        type="button"
                        onClick={() => setRawLayout("input_only")}
                        className={`cursor-pointer rounded px-3 py-1 font-medium transition-all ${
                          rawLayout === "input_only"
                            ? "bg-secondary text-foreground font-semibold shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Hanya Data Input ({inputFilteredEntries.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setRawLayout("ref_only")}
                        className={`cursor-pointer rounded px-3 py-1 font-medium transition-all ${
                          rawLayout === "ref_only"
                            ? "bg-secondary text-foreground font-semibold shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Hanya Data Acuan ({refFilteredEntries.length})
                      </button>
                    </div>
                  </div>

                  {/* Right: Filter & Search */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                      <input
                        type="checkbox"
                        checked={hideEmptyRaw}
                        onChange={(e) => setHideEmptyRaw(e.target.checked)}
                        className="rounded border-border accent-brand"
                      />
                      <span>Sembunyikan Kolom Kosong</span>
                    </label>

                    <div className="relative w-64">
                      <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Cari kolom atau nilai..."
                        value={attributeFilter}
                        onChange={(e) => setAttributeFilter(e.target.value)}
                        className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </div>
                  </div>
                </div>

                {/* Side-by-Side or Full-Width Tables */}
                <div
                  className={`grid gap-4 items-start ${
                    rawLayout === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                  }`}
                >
                  {/* TABEL DATA ASLI INPUT */}
                  {(rawLayout === "split" || rawLayout === "input_only") && (
                    <div className="rounded-xl border border-blue-500/30 bg-card overflow-hidden shadow-xs">
                      {/* Card Header */}
                      <div className="border-b border-border bg-blue-500/10 px-4 py-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="grid size-7 place-items-center rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400">
                            <Database className="size-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-blue-950 dark:text-blue-200">
                              DATA ASLI INPUT (Excel LPSE / Mitra)
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                              {filledInputCount} dari {inputAllEntries.length} kolom terisi di file aslinya
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <CopyAllButton data={inputData} label="Input" />
                        </div>
                      </div>

                      {/* Table Contents */}
                      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                        <table className="w-full text-xs">
                          <colgroup>
                            <col style={{ width: "40%" }} />
                            <col style={{ width: "60%" }} />
                          </colgroup>
                          <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 z-10 backdrop-blur-xs">
                            <tr>
                              <th className="px-3.5 py-2 text-left font-semibold">Nama Kolom Excel Input</th>
                              <th className="px-3.5 py-2 text-left font-semibold">Isian Data Asli</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border font-sans">
                            {inputFilteredEntries.length === 0 ? (
                              <tr>
                                <td colSpan={2} className="px-4 py-8 text-center text-xs text-muted-foreground">
                                  Tidak ada kolom yang cocok dengan filter.
                                </td>
                              </tr>
                            ) : (
                              inputFilteredEntries.map(([k, v]) => {
                                const hasVal = v !== null && v !== undefined && String(v).trim() !== "";
                                return (
                                  <tr key={`input-${k}`} className="group hover:bg-blue-500/5 transition-colors">
                                    <td className="px-3.5 py-2 align-top font-semibold text-foreground">
                                      <span className="font-mono text-[11px] bg-secondary/70 rounded px-1.5 py-0.5 border border-border break-words">
                                        {k}
                                      </span>
                                    </td>
                                    <td className="px-3.5 py-2 align-top">
                                      <div className="flex items-start justify-between gap-1">
                                        <span
                                          className={`break-words select-text ${
                                            hasVal ? "text-foreground font-medium" : "text-muted-foreground/60 italic"
                                          }`}
                                        >
                                          {formatRawValue(v)}
                                        </span>
                                        {hasVal && <CopyButton text={formatRawValue(v)} />}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* TABEL DATA ASLI ACUAN (REFERENSI) */}
                  {(rawLayout === "split" || rawLayout === "ref_only") && (
                    <div className="rounded-xl border border-emerald-500/30 bg-card overflow-hidden shadow-xs">
                      {/* Card Header */}
                      <div className="border-b border-border bg-emerald-500/10 px-4 py-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="grid size-7 place-items-center rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                            <Database className="size-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                              DATA ASLI ACUAN (Excel Referensi BPS)
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                              {filledRefCount} dari {refAllEntries.length} kolom terisi di file aslinya
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <CopyAllButton data={referenceData} label="Acuan" />
                        </div>
                      </div>

                      {/* Table Contents */}
                      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                        <table className="w-full text-xs">
                          <colgroup>
                            <col style={{ width: "40%" }} />
                            <col style={{ width: "60%" }} />
                          </colgroup>
                          <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 z-10 backdrop-blur-xs">
                            <tr>
                              <th className="px-3.5 py-2 text-left font-semibold">Nama Kolom Excel Acuan</th>
                              <th className="px-3.5 py-2 text-left font-semibold">Isian Data Asli</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border font-sans">
                            {refFilteredEntries.length === 0 ? (
                              <tr>
                                <td colSpan={2} className="px-4 py-8 text-center text-xs text-muted-foreground">
                                  {currentCandidate
                                    ? "Tidak ada kolom yang cocok dengan filter."
                                    : "Tidak ada data kandidat acuan."}
                                </td>
                              </tr>
                            ) : (
                              refFilteredEntries.map(([k, v]) => {
                                const hasVal = v !== null && v !== undefined && String(v).trim() !== "";
                                return (
                                  <tr key={`ref-${k}`} className="group hover:bg-emerald-500/5 transition-colors">
                                    <td className="px-3.5 py-2 align-top font-semibold text-foreground">
                                      <span className="font-mono text-[11px] bg-secondary/70 rounded px-1.5 py-0.5 border border-border break-words">
                                        {k}
                                      </span>
                                    </td>
                                    <td className="px-3.5 py-2 align-top">
                                      <div className="flex items-start justify-between gap-1">
                                        <span
                                          className={`break-words select-text ${
                                            hasVal ? "text-foreground font-medium" : "text-muted-foreground/60 italic"
                                          }`}
                                        >
                                          {formatRawValue(v)}
                                        </span>
                                        {hasVal && <CopyButton text={formatRawValue(v)} />}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. Decision History if available */}
            {item.decision_history && item.decision_history.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Riwayat Keputusan Sebelumnya ({item.decision_history.length})
                </h4>
                <div className="space-y-1.5">
                  {item.decision_history.map((hist) => (
                    <div key={hist.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground capitalize">
                          {String(hist.decision ?? "").replace(/_/g, " ")}
                        </span>
                        <span className="text-muted-foreground">
                          via {hist.source ?? "manual"}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {hist.decided_at ?? hist.created_at ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-border bg-secondary/30 px-6 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Left: Navigation & Undo */}
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <div className="flex items-center gap-1.5 mr-2">
                  <button
                    type="button"
                    onClick={handlePrev}
                    disabled={!hasPrev}
                    className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="size-3.5" />
                    <span>Sebelumnya</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!hasNext}
                    className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <span>Berikutnya</span>
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              )}

              {item.decision && onUndo && (
                <button
                  type="button"
                  onClick={() => onUndo(item)}
                  disabled={isPending}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Batalkan Keputusan (Undo)</span>
                </button>
              )}
            </div>

            {/* Right: Decision Actions & Close */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all"
              >
                Tutup
              </button>

              {canDecide && (
                <>
                  <button
                    type="button"
                    onClick={() => onDecide(item, "mark_unmatched", null)}
                    disabled={isPending}
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 hover:border-rose-500/30 active:scale-95 transition-all disabled:opacity-50 shadow-2xs"
                  >
                    <XCircle className="size-4" />
                    <span>Tandai Unmatched (Tolak)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDecide(item, "accept_match", currentCandidate)}
                    disabled={!currentCandidate?.reference_record_key || isPending}
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground shadow-xs hover:bg-brand/90 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4" />
                        <span>Terima Match</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </ModalErrorBoundary>
      </div>
    </div>
  );
}
