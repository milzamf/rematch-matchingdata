import { useState, useMemo } from "react";
import {
  FileSpreadsheet,
  Download,
  Database,
  FileText,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Eye,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/app-layout";
import { downloadCsv, downloadXlsx } from "@/lib/export-files";
import { usePreferences } from "@/lib/preferences";
import {
  buildIntentExportRows,
  buildIntentExportPreview,
  buildStoredExportHistoryEntry,
  type ExportFormat,
  type ExportPreset,
  type StoredExportHistoryEntry,
} from "@/lib/result-exports";
import type { ReviewItem } from "@/lib/api";

export interface IntentExportPanelProps {
  jobId: string | null;
  items: ReviewItem[];
  jobName?: string | null;
  canExecute?: boolean;
  onExportHistoryChange?: (
    updater: (prev: StoredExportHistoryEntry[]) => StoredExportHistoryEntry[],
  ) => void;
}

export function IntentExportPanel({
  jobId,
  items,
  jobName,
  canExecute = true,
  onExportHistoryChange,
}: IntentExportPanelProps) {
  const { t } = usePreferences();
  const [preset, setPreset] = useState<ExportPreset>("master_update");
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Calculate quick metrics for the preset cards
  const metrics = useMemo(() => {
    let matchedCount = 0;
    let newCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    for (const item of items) {
      const status = item.display_status ?? item.status;
      if (["matched", "auto_matched", "manual_accepted"].includes(status)) {
        matchedCount++;
      } else if (["unmatched", "confirmed_unmatched"].includes(status)) {
        newCount++;
      } else if (status === "manual_rejected") {
        rejectedCount++;
      } else {
        pendingCount++;
      }
    }

    return {
      matchedCount,
      newCount,
      pendingCount,
      rejectedCount,
      totalCount: items.length,
      masterUpdateCount: matchedCount + newCount,
    };
  }, [items]);

  // Live preview data (Top 3 sample rows)
  const previewTable = useMemo(() => {
    return buildIntentExportPreview(items, { preset, autoEnrich }, 3);
  }, [items, preset, autoEnrich]);

  // Full export rows
  const fullExportTable = useMemo(() => {
    return buildIntentExportRows(items, { preset, autoEnrich });
  }, [items, preset, autoEnrich]);

  const handleDownload = (format: ExportFormat) => {
    if (items.length === 0) {
      toast.error(t("results.export.emptyDesc") ?? "Tidak ada data untuk diekspor");
      return;
    }

    setIsExporting(true);
    try {
      const baseName = jobName ?? "matching-results";
      const presetSuffix =
        preset === "master_update"
          ? "master-update"
          : preset === "full_audit"
            ? "full-audit"
            : "pending-review";
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `batchmatch-${baseName}-${presetSuffix}-${dateStr}.${format}`;

      if (format === "csv") {
        downloadCsv(fileName, fullExportTable);
      } else {
        downloadXlsx(fileName, [fullExportTable]);
      }

      if (onExportHistoryChange) {
        const historyEntry = buildStoredExportHistoryEntry({
          fileName,
          format,
          recordCount: fullExportTable.rows.length,
          mode: "intent",
          statuses:
            preset === "master_update"
              ? ["matched", "new"]
              : preset === "pending_review"
                ? ["pending"]
                : ["matched", "new", "rejected", "pending"],
          columns: fullExportTable.columns,
          includeReferenceKey: true,
          includeReviewFields: preset !== "master_update",
          includeScore: preset !== "master_update",
          sourceJobId: jobId,
        });
        historyEntry.preset = preset;
        historyEntry.autoEnrich = autoEnrich;

        onExportHistoryChange((current) => [historyEntry, ...current]);
      }

      toast.success(
        t("matching.export.success") ??
          `File ${format.toUpperCase()} berhasil diunduh (${fullExportTable.rows.length} baris)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat file ekspor");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: Auto-Enrichment Toggle Card */}
      <Card className="p-5 border-border bg-card">
        <label className="flex items-start gap-3.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoEnrich}
            onChange={(e) => setAutoEnrich(e.target.checked)}
            className="mt-1 size-4 rounded border-border text-brand focus:ring-brand focus:ring-offset-background"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {t("matching.export.autoEnrichLabel") ??
                  "Lengkapi data referensi yang kosong dengan data input"}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                <Sparkles className="size-3" />
                Auto-Enrich
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("matching.export.autoEnrichDesc") ??
                "Jika kolom pada data referensi kosong/null, sistem akan otomatis mengisi nilai dari data input pada pasangan record yang cocok."}
            </p>
          </div>
        </label>
      </Card>

      {/* SECTION 2: Intent-Based Export Presets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">
            {t("matching.export.presetsTitle") ?? "Pilih Format & Tujuan Ekspor"}
          </h4>
          <span className="text-xs text-muted-foreground">
            {metrics.totalCount} Total Record Diproses
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Preset 1: Pemutakhiran Master Data */}
          <div
            onClick={() => setPreset("master_update")}
            className={[
              "relative cursor-pointer rounded-lg border p-4.5 transition-all flex flex-col justify-between space-y-3",
              preset === "master_update"
                ? "border-brand bg-brand/5 ring-2 ring-brand shadow-sm"
                : "border-border bg-card hover:border-brand/40 hover:bg-secondary/20",
            ].join(" ")}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`size-8 rounded-md grid place-items-center ${
                      preset === "master_update"
                        ? "bg-brand text-brand-foreground"
                        : "bg-secondary text-foreground"
                    }`}
                  >
                    <Database className="size-4" />
                  </div>
                  <h5 className="text-sm font-bold text-foreground">
                    {t("matching.export.presetMasterUpdate") ?? "Pemutakhiran Master Data"}
                  </h5>
                </div>
                {preset === "master_update" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetMasterUpdateDesc") ??
                  "Hanya mengekspor record yang sudah Cocok (Matched) dan Entitas Baru. Struktur bersih dengan kolom input dan ID referensi."}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">Cakupan Ekspor:</span>
              <span className="font-semibold tabular-nums text-success">
                {metrics.masterUpdateCount} Record Siap Pakai
              </span>
            </div>
          </div>

          {/* Preset 2: Laporan Audit Lengkap */}
          <div
            onClick={() => setPreset("full_audit")}
            className={[
              "relative cursor-pointer rounded-lg border p-4.5 transition-all flex flex-col justify-between space-y-3",
              preset === "full_audit"
                ? "border-brand bg-brand/5 ring-2 ring-brand shadow-sm"
                : "border-border bg-card hover:border-brand/40 hover:bg-secondary/20",
            ].join(" ")}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`size-8 rounded-md grid place-items-center ${
                      preset === "full_audit"
                        ? "bg-brand text-brand-foreground"
                        : "bg-secondary text-foreground"
                    }`}
                  >
                    <FileText className="size-4" />
                  </div>
                  <h5 className="text-sm font-bold text-foreground">
                    {t("matching.export.presetFullAudit") ?? "Laporan Audit Lengkap"}
                  </h5>
                </div>
                {preset === "full_audit" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetFullAuditDesc") ??
                  "Mengekspor seluruh record dengan struktur perbandingan berdampingan (input.X vs ref.X), skor kemiripan, dan status."}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">Cakupan Ekspor:</span>
              <span className="font-semibold tabular-nums text-foreground">
                Semua {metrics.totalCount} Record
              </span>
            </div>
          </div>

          {/* Preset 3: Sisa Perlu Reviu */}
          <div
            onClick={() => setPreset("pending_review")}
            className={[
              "relative cursor-pointer rounded-lg border p-4.5 transition-all flex flex-col justify-between space-y-3",
              preset === "pending_review"
                ? "border-brand bg-brand/5 ring-2 ring-brand shadow-sm"
                : "border-border bg-card hover:border-brand/40 hover:bg-secondary/20",
            ].join(" ")}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`size-8 rounded-md grid place-items-center ${
                      preset === "pending_review"
                        ? "bg-warning text-warning-foreground"
                        : "bg-secondary text-foreground"
                    }`}
                  >
                    <AlertCircle className="size-4" />
                  </div>
                  <h5 className="text-sm font-bold text-foreground">
                    {t("matching.export.presetPendingReview") ?? "Sisa Perlu Reviu"}
                  </h5>
                </div>
                {preset === "pending_review" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetPendingReviewDesc") ??
                  "Hanya mengekspor record yang belum diputuskan / berstatus Perlu Review untuk investigasi atau review manual lanjutan."}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">Cakupan Ekspor:</span>
              <span className="font-semibold tabular-nums text-warning">
                {metrics.pendingCount} Record Pending
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Live Table Preview */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Eye className="size-4 text-brand" />
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {t("matching.export.livePreviewTitle") ?? "Pratinjau Data Ekspor"}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t("matching.export.livePreviewDesc") ??
                  "Contoh 3 baris data yang akan dihasilkan dalam file Excel / CSV"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-mono text-muted-foreground">
              {fullExportTable.columns.length} Kolom · {fullExportTable.rows.length} Baris Total
            </span>
          </div>
        </div>

        {previewTable.rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <FileSpreadsheet className="mx-auto size-8 text-muted-foreground/40 mb-2" />
            Tidak ada baris data yang cocok dengan preset ini.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-2.5 py-2 text-center font-medium border-r border-border/50">
                    #
                  </th>
                  {previewTable.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left font-mono font-medium whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {previewTable.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-secondary/20">
                    <td className="px-2.5 py-2 text-center text-muted-foreground border-r border-border/50 font-sans text-xs">
                      {idx + 1}
                    </td>
                    {previewTable.columns.map((col) => {
                      const val = row[col];
                      const displayVal =
                        val === null || val === undefined || String(val).trim() === "" ? (
                          <span className="text-muted-foreground/40 italic">null</span>
                        ) : typeof val === "boolean" ? (
                          val ? (
                            "TRUE"
                          ) : (
                            "FALSE"
                          )
                        ) : (
                          String(val)
                        );

                      return (
                        <td
                          key={col}
                          className="px-3 py-2 whitespace-nowrap max-w-[220px] truncate text-foreground"
                          title={String(val ?? "")}
                        >
                          {col === "match_status" ? (
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${
                                val === "MATCHED"
                                  ? "bg-success/15 text-success"
                                  : val === "NEED_REVIEW"
                                    ? "bg-warning/15 text-warning"
                                    : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {String(val)}
                            </span>
                          ) : col === "matching_score" && typeof val === "number" ? (
                            <span className="font-semibold tabular-nums text-brand">
                              {val}%
                            </span>
                          ) : (
                            displayVal
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* SECTION 4: Final Download Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/60">
          <div className="text-xs text-muted-foreground">
            Klik tombol untuk mengunduh {fullExportTable.rows.length.toLocaleString()} record
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canExecute || isExporting || fullExportTable.rows.length === 0}
              onClick={() => handleDownload("xlsx")}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isExporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              <span>{t("matching.export.downloadXlsx") ?? "Unduh XLSX"}</span>
            </button>

            <button
              type="button"
              disabled={!canExecute || isExporting || fullExportTable.rows.length === 0}
              onClick={() => handleDownload("csv")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
            >
              <Download className="size-4" />
              <span>{t("matching.export.downloadCsv") ?? "Unduh CSV"}</span>
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
