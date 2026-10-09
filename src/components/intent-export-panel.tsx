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
  buildIntentExportTables,
  buildIntentExportPreview,
  buildStoredExportHistoryEntry,
  type ExportFormat,
  type ExportPreset,
  type StoredExportHistoryEntry,
} from "@/lib/result-exports";
import { type ReviewItem, downloadBackendExport } from "@/lib/api";

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
  summary?: {
    matched?: number;
    possible_match?: number;
    unmatched?: number;
    reviewed?: number;
    total_raw_input?: number;
    total_unique_input?: number;
    total_duplicates?: number;
  };
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
  summary,
}: IntentExportPanelProps) {
  const { t } = usePreferences();
  const [preset, setPreset] = useState<ExportPreset>("master_update");
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [splitSheets, setSplitSheets] = useState(true);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  // Calculate quick metrics for the preset cards based on summary when available
  const metrics = useMemo(() => {
    if (summary) {
      const matched = summary.matched ?? 0;
      const newCount = summary.unmatched ?? 0;
      const pending = summary.possible_match ?? 0;
      const total = summary.total_unique_input ?? (matched + newCount + pending);
      return {
        matchedCount: matched,
        newCount,
        pendingCount: pending,
        rejectedCount: 0,
        totalCount: total,
        masterUpdateCount: matched + newCount,
      };
    }

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
  }, [summary, items]);

  // Full export rows for live preview
  const fullExportTable = useMemo(() => {
    return buildIntentExportRows(items, { preset, autoEnrich });
  }, [items, preset, autoEnrich]);

  // Multi-sheet export tables per status for live preview
  const exportTables = useMemo(() => {
    return buildIntentExportTables(items, { preset, autoEnrich, splitSheets });
  }, [items, preset, autoEnrich, splitSheets]);

  const safeSheetIndex = Math.min(activeSheetIndex, Math.max(0, exportTables.length - 1));
  const activeTable = exportTables[safeSheetIndex] ?? fullExportTable;

  const handleDownload = async (format: ExportFormat) => {
    if (metrics.totalCount === 0 && items.length === 0) {
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

      // 1. If jobId is available and user requests CSV, use high-speed backend streaming
      if (jobId && format === "csv") {
        const activeSheetName = splitSheets && exportTables.length > 1 ? activeTable.name : undefined;
        let sheetParam = "";
        if (activeSheetName) {
          const lower = activeSheetName.toLowerCase();
          if (lower.includes("matched") && !lower.includes("unmatched")) sheetParam = "matched";
          else if (lower.includes("unmatched") || lower.includes("new")) sheetParam = "unmatched";
          else if (lower.includes("review") || lower.includes("pending")) sheetParam = "need_review";
          else if (lower.includes("reject")) sheetParam = "rejected";
        }

        const sheetSlug = sheetParam ? `-${sheetParam}` : "";
        const csvFileName = `batchmatch-${baseName}-${presetSuffix}${sheetSlug}-${dateStr}.csv`;

        await downloadBackendExport(
          jobId,
          {
            preset,
            format: "csv",
            autoEnrich,
            sheet: sheetParam,
          },
          csvFileName,
        );

        const exportedCount =
          sheetParam === "matched"
            ? metrics.matchedCount
            : sheetParam === "unmatched"
              ? metrics.newCount
              : sheetParam === "need_review"
                ? metrics.pendingCount
                : preset === "master_update"
                  ? metrics.masterUpdateCount
                  : preset === "pending_review"
                    ? metrics.pendingCount
                    : metrics.totalCount;

        if (onExportHistoryChange) {
          const historyEntry = buildStoredExportHistoryEntry({
            fileName: csvFileName,
            format: "csv",
            recordCount: exportedCount,
            mode: "intent",
            statuses:
              preset === "master_update"
                ? ["matched", "new"]
                : preset === "pending_review"
                  ? ["pending"]
                  : ["matched", "new", "rejected", "pending"],
            columns: activeTable.columns,
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
            format: "CSV",
            count: exportedCount.toLocaleString(),
          }),
        );
        return;
      }

      // 2. If format is XLSX on large datasets (> 5,000 records), browser client-side Excel generation will freeze or crash memory.
      if (format === "xlsx" && metrics.totalCount > 5000) {
        toast.warning(
          `Dataset berisi ${metrics.totalCount.toLocaleString()} record. Mengunduh via format CSV streaming untuk data besar agar browser tidak kehabisan memori.`,
        );
        if (jobId) {
          const csvFileName = `batchmatch-${baseName}-${presetSuffix}-${dateStr}.csv`;
          await downloadBackendExport(
            jobId,
            {
              preset,
              format: "csv",
              autoEnrich,
            },
            csvFileName,
          );

          const exportedCount =
            preset === "master_update"
              ? metrics.masterUpdateCount
              : preset === "pending_review"
                ? metrics.pendingCount
                : metrics.totalCount;

          if (onExportHistoryChange) {
            const historyEntry = buildStoredExportHistoryEntry({
              fileName: csvFileName,
              format: "csv",
              recordCount: exportedCount,
              mode: "intent",
              statuses:
                preset === "master_update"
                  ? ["matched", "new"]
                  : preset === "pending_review"
                    ? ["pending"]
                    : ["matched", "new", "rejected", "pending"],
              columns: activeTable.columns,
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
              format: "CSV",
              count: exportedCount.toLocaleString(),
            }),
          );
          return;
        }
      }

      // 3. Fallback client-side generation for small datasets or mock mode
      if (format === "csv") {
        const tableToExport = splitSheets && exportTables.length > 1 ? activeTable : fullExportTable;
        const sheetSlug =
          splitSheets && exportTables.length > 1
            ? `-${tableToExport.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
            : "";
        const csvFileName = `batchmatch-${baseName}-${presetSuffix}${sheetSlug}-${dateStr}.csv`;
        downloadCsv(csvFileName, tableToExport);
      } else {
        const tablesToExport = splitSheets ? exportTables : [fullExportTable];
        downloadXlsx(fileName, tablesToExport);
      }

      const exportedRowsCount =
        format === "csv" && splitSheets && exportTables.length > 1
          ? activeTable.rows.length
          : fullExportTable.rows.length;

      if (onExportHistoryChange) {
        const historyEntry = buildStoredExportHistoryEntry({
          fileName:
            format === "csv" && splitSheets && exportTables.length > 1
              ? `batchmatch-${baseName}-${presetSuffix}-${activeTable.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dateStr}.csv`
              : fileName,
          format,
          recordCount: exportedRowsCount,
          mode: "intent",
          statuses:
            preset === "master_update"
              ? ["matched", "new"]
              : preset === "pending_review"
                ? ["pending"]
                : ["matched", "new", "rejected", "pending"],
          columns: activeTable.columns,
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
          count: exportedRowsCount.toLocaleString(),
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
      {/* SECTION 1: Export Options (Auto-Enrichment & Multi-Sheet Excel) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4 border-border bg-card">
          <label className="flex items-start gap-3 cursor-pointer select-none">
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

        <Card className="p-4 border-border bg-card">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={splitSheets}
              onChange={(e) => {
                setSplitSheets(e.target.checked);
                setActiveSheetIndex(0);
              }}
              className="mt-1 size-4 rounded border-border text-emerald-600 focus:ring-emerald-500 focus:ring-offset-background cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {t("matching.export.splitSheetsLabel")}
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <FileSpreadsheet className="size-3" />
                  Multi-Sheet
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("matching.export.splitSheetsDesc")}
              </p>
            </div>
          </label>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">
            {t("matching.export.presetsTitle")}
          </h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t("matching.export.totalProcessed", { count: metrics.totalCount.toLocaleString() })}
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
                {t("matching.export.readyRecords", { count: metrics.masterUpdateCount.toLocaleString() })}
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
                {t("matching.export.allRecords", { count: metrics.totalCount.toLocaleString() })}
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
                {t("matching.export.pendingRecords", { count: metrics.pendingCount.toLocaleString() })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Live Table Preview with Safe Expansion Modal */}
      <div className="space-y-4">
        {splitSheets && exportTables.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileSpreadsheet className="size-4 text-emerald-600 dark:text-emerald-400" />
                {t("matching.export.previewSheet")}:
              </span>
              {exportTables.map((table, idx) => {
                const isSelected = safeSheetIndex === idx;
                return (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => setActiveSheetIndex(idx)}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer",
                      isSelected
                        ? "bg-brand text-brand-foreground shadow-sm ring-1 ring-brand font-semibold"
                        : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
                    ].join(" ")}
                  >
                    <span>{table.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                        isSelected
                          ? "bg-brand-foreground/20 text-brand-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {summary
                        ? (table.name.toLowerCase().includes("matched") && !table.name.toLowerCase().includes("unmatched")
                            ? metrics.matchedCount
                            : table.name.toLowerCase().includes("unmatched") || table.name.toLowerCase().includes("new")
                              ? metrics.newCount
                              : table.name.toLowerCase().includes("review") || table.name.toLowerCase().includes("pending")
                                ? metrics.pendingCount
                                : preset === "master_update"
                                  ? metrics.masterUpdateCount
                                  : metrics.totalCount
                          ).toLocaleString()
                        : table.rows.length}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("matching.export.activeSheetHint", { sheet: activeTable.name })}
            </div>
          </div>
        )}

        <DataPreviewTable
          jobId={jobId ?? undefined}
          exportPreset={preset}
          autoEnrich={autoEnrich}
          title={
            splitSheets && exportTables.length > 1
              ? `${t("matching.export.livePreviewTitle")} (${activeTable.name})`
              : t("matching.export.livePreviewTitle")
          }
          subtitle={t("matching.export.livePreviewDesc")}
          columns={activeTable.columns}
          rows={activeTable.rows}
          totalRows={
            summary
              ? preset === "master_update"
                ? metrics.masterUpdateCount
                : preset === "pending_review"
                  ? metrics.pendingCount
                  : metrics.totalCount
              : activeTable.rows.length
          }
          previewLimit={3}
          badgeColor="brand"
          badgeText={
            splitSheets && exportTables.length > 1
              ? activeTable.name
              : preset === "master_update"
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
            {splitSheets && exportTables.length > 1 ? (
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="size-3.5 text-emerald-600 shrink-0" />
                <span>
                  XLSX akan berisi <strong>{exportTables.length} sheet</strong> (
                  {exportTables
                    .map((t) => {
                      const count = summary
                        ? t.name.toLowerCase().includes("matched") && !t.name.toLowerCase().includes("unmatched")
                          ? metrics.matchedCount
                          : t.name.toLowerCase().includes("unmatched") || t.name.toLowerCase().includes("new")
                            ? metrics.newCount
                            : t.name.toLowerCase().includes("review") || t.name.toLowerCase().includes("pending")
                              ? metrics.pendingCount
                              : preset === "master_update"
                                ? metrics.masterUpdateCount
                                : metrics.totalCount
                        : t.rows.length;
                      return `${t.name}: ${count.toLocaleString()}`;
                    })
                    .join(", ")}
                  ).
                </span>
              </span>
            ) : (
              t("matching.export.downloadHint", {
                count: (preset === "master_update"
                  ? metrics.masterUpdateCount
                  : preset === "pending_review"
                    ? metrics.pendingCount
                    : metrics.totalCount
                ).toLocaleString(),
              })
            )}
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
              disabled={!canExecute || isExporting || activeTable.rows.length === 0}
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
