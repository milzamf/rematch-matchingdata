import { useState, useMemo } from "react";
import {
  FileSpreadsheet,
  Download,
  Database,
  FileText,
  AlertCircle,
  CheckCircle2,
  Layers,
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

import { DataPreviewTable } from "@/components/data-preview-table";

export interface IntentExportPanelProps {
  jobId: string | null;
  items: ReviewItem[];
  jobName?: string | null;
  canExecute?: boolean;
  onExportHistoryChange?: (
    updater: (prev: StoredExportHistoryEntry[]) => StoredExportHistoryEntry[],
  ) => void;
  workspaceId?: string | null;
  totalRaw?: number;
  totalUnique?: number;
  totalDuplicates?: number;
}

export function IntentExportPanel({
  jobId,
  items,
  jobName,
  canExecute = true,
  onExportHistoryChange,
  workspaceId,
  totalRaw,
  totalUnique,
  totalDuplicates,
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

  // Full export rows
  const fullExportTable = useMemo(() => {
    return buildIntentExportRows(items, { preset, autoEnrich });
  }, [items, preset, autoEnrich]);

  const handleDownload = (format: ExportFormat) => {
    if (items.length === 0) {
      toast.error(t("results.export.emptyDesc"));
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
        t("matching.export.success", {
          format: format.toUpperCase(),
          count: fullExportTable.rows.length,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("matching.export.error"));
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
            className="mt-1 size-4 rounded border-border text-brand focus:ring-brand focus:ring-offset-background cursor-pointer"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {t("matching.export.autoEnrichLabel")}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                <Layers className="size-3" />
                Auto-Enrich
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("matching.export.autoEnrichDesc")}
            </p>
          </div>
        </label>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">
            {t("matching.export.presetsTitle")}
          </h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t("matching.export.totalProcessed", { count: metrics.totalCount })}
            </span>
            {(totalDuplicates ?? 0) > 0 && (
              <span className="rounded bg-secondary/80 px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
                {(totalDuplicates ?? 0).toLocaleString()} baris duplikat diabaikan dari {(totalRaw ?? metrics.totalCount).toLocaleString()} total baris input
              </span>
            )}
          </div>
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
                    {t("matching.export.presetMasterUpdate")}
                  </h5>
                </div>
                {preset === "master_update" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetMasterUpdateDesc")}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">{t("matching.export.scope")}:</span>
              <span className="font-semibold tabular-nums text-success">
                {t("matching.export.readyRecords", { count: metrics.masterUpdateCount })}
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
                    {t("matching.export.presetFullAudit")}
                  </h5>
                </div>
                {preset === "full_audit" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetFullAuditDesc")}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">{t("matching.export.scope")}:</span>
              <span className="font-semibold tabular-nums text-foreground">
                {t("matching.export.allRecords", { count: metrics.totalCount })}
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
                    {t("matching.export.presetPendingReview")}
                  </h5>
                </div>
                {preset === "pending_review" && (
                  <CheckCircle2 className="size-4 text-brand shrink-0" />
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.presetPendingReviewDesc")}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">{t("matching.export.scope")}:</span>
              <span className="font-semibold tabular-nums text-warning">
                {t("matching.export.pendingRecords", { count: metrics.pendingCount })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Live Table Preview with Safe Expansion Modal */}
      <div className="space-y-4">
        <DataPreviewTable
          title={t("matching.export.livePreviewTitle")}
          subtitle={t("matching.export.livePreviewDesc")}
          columns={fullExportTable.columns}
          rows={fullExportTable.rows}
          totalRows={fullExportTable.rows.length}
          previewLimit={3}
          badgeColor="brand"
          badgeText={
            preset === "master_update"
              ? t("matching.export.presetMaster")
              : preset === "full_audit"
                ? t("matching.export.presetAudit")
                : t("matching.export.presetPending")
          }
          emptyMessage={t("matching.export.presetEmptyMessage")}
        />

        {/* SECTION 4: Final Download Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border border-border bg-card">
          <div className="text-xs text-muted-foreground">
            {t("matching.export.downloadHint", {
              count: fullExportTable.rows.length.toLocaleString(),
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canExecute || isExporting || fullExportTable.rows.length === 0}
              onClick={() => handleDownload("xlsx")}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isExporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              <span>{t("matching.export.downloadXlsx")}</span>
            </button>

            <button
              type="button"
              disabled={!canExecute || isExporting || fullExportTable.rows.length === 0}
              onClick={() => handleDownload("csv")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Download className="size-4" />
              <span>{t("matching.export.downloadCsv")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
