import { useState, useMemo } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GitCompareArrows,
  Database,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReviewItem, ReviewCandidate } from "@/lib/api";
import type { IdentityFieldPair } from "@/lib/result-identity";
import { usePreferences } from "@/lib/preferences";

interface RecordComparisonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ReviewItem | null;
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
}

function scoreBadgeClass(score: number): string {
  if (score >= 85) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (score >= 70) return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20";
}

function scoreProgressBarClass(score: number): string {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

function statusBadgeInfo(status: string): { label: string; className: string } {
  const normalized = status.toUpperCase();
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
  return { label: status, className: "bg-secondary text-muted-foreground border-border" };
}

function comparisonLabel(comparison: string): { text: string; className: string } {
  if (comparison === "same") {
    return { text: "Sama Persis (100%)", className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  if (comparison === "similar") {
    return { text: "Mirip", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" };
  }
  return { text: "Berbeda", className: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20" };
}

function CopyButton({ text }: { text: string }) {
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
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground cursor-pointer"
      title="Salin teks"
    >
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
    </button>
  );
}

export function RecordComparisonModal({
  open,
  onOpenChange,
  item,
  initialCandidateId,
  identityMappings = [],
  canDecide,
  isPending = false,
  onDecide,
  onUndo,
}: RecordComparisonModalProps) {
  const { t } = usePreferences();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(initialCandidateId ?? null);
  const [attributeFilter, setAttributeFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "raw_table">("overview");

  // Keep selected candidate in sync
  const currentCandidate = useMemo(() => {
    if (!item || !item.candidates || item.candidates.length === 0) return null;
    if (selectedCandidateId) {
      const found = item.candidates.find((c) => c.id === selectedCandidateId);
      if (found) return found;
    }
    return item.candidates[0] ?? null;
  }, [item, selectedCandidateId]);

  if (!item) return null;

  const inputData = item.input_record ?? {};
  const referenceData = currentCandidate?.reference_record ?? {};

  // Build unified list of all raw attribute keys
  const allAttributeKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(inputData).forEach((k) => keys.add(k));
    Object.keys(referenceData).forEach((k) => keys.add(k));
    return Array.from(keys).sort();
  }, [inputData, referenceData]);

  // Filtered attribute keys
  const filteredAttributeKeys = useMemo(() => {
    if (!attributeFilter.trim()) return allAttributeKeys;
    const q = attributeFilter.toLowerCase();
    return allAttributeKeys.filter((key) => {
      const inKey = key.toLowerCase().includes(q);
      const inInput = String(inputData[key] ?? "").toLowerCase().includes(q);
      const inRef = String(referenceData[key] ?? "").toLowerCase().includes(q);
      return inKey || inInput || inRef;
    });
  }, [allAttributeKeys, attributeFilter, inputData, referenceData]);

  // Main status and score
  const statusInfo = statusBadgeInfo(item.status_code ?? item.display_status ?? item.status);
  const totalScore = currentCandidate ? currentCandidate.score : 0;
  const fieldScores = currentCandidate?.field_scores ?? [];

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[95vw] max-w-5xl max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95"
      >
        {/* Header */}
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
                  <GitCompareArrows className="size-4" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground tracking-tight">
                    Review & Perbandingan Pencocokan Data
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ID Record Input: <span className="font-mono font-medium text-foreground">{item.input_record_key}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusInfo.className}`}>
                {statusInfo.label}
              </span>
              {currentCandidate && (
                <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tabular-nums ${scoreBadgeClass(totalScore)}`}>
                  <span>Skor Kemiripan (WLS):</span>
                  <span className="text-sm font-black">{totalScore}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Top Candidate Switcher if multiple candidates */}
          {item.candidates && item.candidates.length > 1 && (
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground font-medium shrink-0">
                Pilih Kandidat Acuan ({item.candidates.length}):
              </span>
              <div className="flex items-center gap-1.5">
                {item.candidates.map((cand, idx) => {
                  const isSelected = (currentCandidate?.id ?? item.candidates[0].id) === cand.id;
                  const candName =
                    (cand.reference_record?.nama_perusahaan as string) ??
                    (cand.reference_record?.nama_penyedia as string) ??
                    `Kandidat #${cand.rank ?? idx + 1}`;
                  return (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => setSelectedCandidateId(cand.id)}
                      className={`cursor-pointer inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                        isSelected
                          ? "bg-brand text-brand-foreground shadow-xs"
                          : "border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <span className="font-semibold">#{cand.rank ?? idx + 1}</span>
                      <span className="max-w-[150px] truncate">{candName}</span>
                      <span className="font-bold tabular-nums">({cand.score}%)</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation View Switcher */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className={`cursor-pointer rounded-md px-3 py-1 transition-all ${
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
                className={`cursor-pointer rounded-md px-3 py-1 transition-all ${
                  activeTab === "raw_table"
                    ? "bg-secondary text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Tabel Perbandingan Data Asli Lengkap ({allAttributeKeys.length} Kolom)
              </button>
            </div>

            {activeTab === "raw_table" && (
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Cari atribut atau nilai..."
                  value={attributeFilter}
                  onChange={(e) => setAttributeFilter(e.target.value)}
                  className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "overview" ? (
            <>
              {/* 1. Entity Overview Side-by-Side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Input Card */}
                <div className="rounded-xl border border-border bg-secondary/15 p-4 relative overflow-hidden">
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
                  <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    {inputData.npwp_penyedia || inputData.npwp ? (
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-foreground shrink-0">NPWP:</span>
                        <span className="font-mono text-foreground">{String(inputData.npwp_penyedia ?? inputData.npwp)}</span>
                      </p>
                    ) : null}
                    {inputData.nib ? (
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-foreground shrink-0">NIB:</span>
                        <span className="font-mono text-foreground">{String(inputData.nib)}</span>
                      </p>
                    ) : null}
                    {inputData.bentuk_usaha ? (
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-foreground shrink-0">Bentuk Usaha:</span>
                        <span className="text-foreground">{String(inputData.bentuk_usaha)}</span>
                      </p>
                    ) : null}
                    {inputData.alamat ? (
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-foreground shrink-0">Alamat:</span>
                        <span className="text-foreground leading-relaxed">{String(inputData.alamat)}</span>
                      </p>
                    ) : null}
                    {inputData.nmkab || inputData.kabupaten || inputData.kab ? (
                      <p className="flex items-start gap-1.5">
                        <span className="font-semibold text-foreground shrink-0">Kabupaten/Kota:</span>
                        <span className="text-foreground">{String(inputData.nmkab ?? inputData.kabupaten ?? inputData.kab)}</span>
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Reference Card */}
                <div className="rounded-xl border border-border bg-secondary/15 p-4 relative overflow-hidden">
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
                      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                        {referenceData.npwp || referenceData.npwp_penyedia ? (
                          <p className="flex items-start gap-1.5">
                            <span className="font-semibold text-foreground shrink-0">NPWP:</span>
                            <span className="font-mono text-foreground">{String(referenceData.npwp ?? referenceData.npwp_penyedia)}</span>
                          </p>
                        ) : null}
                        {referenceData.nib ? (
                          <p className="flex items-start gap-1.5">
                            <span className="font-semibold text-foreground shrink-0">NIB:</span>
                            <span className="font-mono text-foreground">{String(referenceData.nib)}</span>
                          </p>
                        ) : null}
                        {referenceData.badan_usaha || referenceData.bentuk_usaha ? (
                          <p className="flex items-start gap-1.5">
                            <span className="font-semibold text-foreground shrink-0">Badan Usaha:</span>
                            <span className="text-foreground">{String(referenceData.badan_usaha ?? referenceData.bentuk_usaha)}</span>
                          </p>
                        ) : null}
                        {referenceData.alamat_perusahaan || referenceData.alamat ? (
                          <p className="flex items-start gap-1.5">
                            <span className="font-semibold text-foreground shrink-0">Alamat:</span>
                            <span className="text-foreground leading-relaxed">
                              {String(referenceData.alamat_perusahaan ?? referenceData.alamat)}
                            </span>
                          </p>
                        ) : null}
                        {referenceData.nm_kab || referenceData.nmkab || referenceData.kab ? (
                          <p className="flex items-start gap-1.5">
                            <span className="font-semibold text-foreground shrink-0">Kabupaten/Kota:</span>
                            <span className="text-foreground">{String(referenceData.nm_kab ?? referenceData.nmkab ?? referenceData.kab)}</span>
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center text-xs text-muted-foreground">
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
                        Perhitungan pembobotan linier (Weighted Linear Score) berdasarkan aturan pencocokan
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
                            <tr key={`${f.input_column}-${f.reference_column}-${i}`} className="hover:bg-secondary/20">
                              <td className="px-4 py-3 font-semibold text-foreground">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-muted-foreground">{f.input_column}</span>
                                  <ArrowRight className="size-3 text-muted-foreground/60 shrink-0" />
                                  <span className="text-foreground">{f.reference_column}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 max-w-[200px] break-words text-muted-foreground">
                                {String(inputVal)}
                              </td>
                              <td className="px-4 py-3 max-w-[200px] break-words text-foreground font-medium">
                                {String(refVal)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="inline-flex flex-col items-center gap-1">
                                  <span className={`font-bold tabular-nums ${scoreBadgeClass(f.score).split(" ")[1]}`}>
                                    {Math.round(f.score)}%
                                  </span>
                                  <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${scoreProgressBarClass(f.score)}`}
                                      style={{ width: `${Math.min(100, Math.max(0, f.score))}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                                {(f as { weight?: number }).weight ? `${(f as { weight?: number }).weight}%` : "-"}
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
            /* 3. Tabel Perbandingan Lengkap Data Asli */
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
              <div className="border-b border-border bg-muted/20 px-4 py-3 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Perbandingan Lengkap Data Asli (Raw Attributes)
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Menampilkan nilai asli seluruh kolom dari data input dan data referensi tanpa pemotongan
                  </p>
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  {filteredAttributeKeys.length} dari {allAttributeKeys.length} kolom
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <colgroup>
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "37.5%" }} />
                    <col style={{ width: "37.5%" }} />
                  </colgroup>
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Nama Kolom / Atribut</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-blue-600 dark:text-blue-400">
                        Data Asli Input
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-emerald-600 dark:text-emerald-400">
                        Data Asli Acuan (Referensi)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-sans">
                    {filteredAttributeKeys.map((key) => {
                      const inputRaw = inputData[key];
                      const refRaw = referenceData[key];
                      const hasInput = inputRaw !== undefined && inputRaw !== null && String(inputRaw).trim() !== "";
                      const hasRef = refRaw !== undefined && refRaw !== null && String(refRaw).trim() !== "";
                      const isMatch = hasInput && hasRef && String(inputRaw).trim().toLowerCase() === String(refRaw).trim().toLowerCase();

                      return (
                        <tr
                          key={key}
                          className={`group hover:bg-secondary/20 transition-colors ${
                            isMatch ? "bg-emerald-500/5" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 align-top font-semibold text-foreground">
                            <span className="font-mono text-[11px] bg-secondary/60 rounded px-1.5 py-0.5 border border-border">
                              {key}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="flex items-start justify-between gap-1">
                              <span
                                className={`break-words select-text ${
                                  hasInput ? "text-foreground font-medium" : "text-muted-foreground/60 italic"
                                }`}
                              >
                                {hasInput ? String(inputRaw) : "— (kosong)"}
                              </span>
                              {hasInput && <CopyButton text={String(inputRaw)} />}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="flex items-start justify-between gap-1">
                              <span
                                className={`break-words select-text ${
                                  hasRef ? "text-foreground font-medium" : "text-muted-foreground/60 italic"
                                }`}
                              >
                                {hasRef ? String(refRaw) : "— (kosong)"}
                              </span>
                              {hasRef && <CopyButton text={String(refRaw)} />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                        {hist.decision.replace("_", " ")}
                      </span>
                      <span className="text-muted-foreground">
                        via {hist.source}
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
        <div className="border-t border-border bg-muted/30 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
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
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 hover:border-rose-500/30 active:scale-95 transition-all disabled:opacity-50"
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
      </DialogContent>
    </Dialog>
  );
}
