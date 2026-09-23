import { useState, useMemo, useEffect } from "react";
import {
  Maximize2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { parseEntityName, standardizeColumnValue } from "@/lib/data-normalizer";
import { usePreferences } from "@/lib/preferences";
import { fetchDatasetRows, fetchWorkspaceStandardizedPreview, type PaginatedDatasetRowsResult } from "@/lib/api";

function findCompanyValueInRow(row: Record<string, unknown>): string | null {
  const companyKeyRegex =
    /\b(perusahaan|company|nama|name|usaha|bu|vendor|client|customer|nama_bu|nm_perusahaan)\b/i;
  for (const [key, val] of Object.entries(row)) {
    if (
      !key.startsWith("[Generated]") &&
      !key.startsWith("gen_") &&
      !key.startsWith("std_") &&
      companyKeyRegex.test(key) &&
      val !== null &&
      val !== undefined &&
      String(val).trim() !== ""
    ) {
      return String(val).trim();
    }
  }
  for (const [key, val] of Object.entries(row)) {
    if (
      !key.startsWith("[Generated]") &&
      !key.startsWith("gen_") &&
      !key.startsWith("std_") &&
      val !== null &&
      val !== undefined &&
      typeof val === "string" &&
      val.trim() !== ""
    ) {
      return val.trim();
    }
  }
  return null;
}

function getRowValueCaseInsensitive(row: Record<string, unknown>, key: string): unknown {
  if (row[key] !== undefined && row[key] !== null) {
    return row[key];
  }
  const targetLower = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === targetLower && v !== undefined && v !== null) {
      return v;
    }
  }
  return undefined;
}

function resolveRowCellValue(row: Record<string, unknown>, colKey: string): unknown {
  if (row[colKey] !== undefined && row[colKey] !== null) {
    return row[colKey];
  }

  // Direct case-insensitive match
  const directVal = getRowValueCaseInsensitive(row, colKey);
  if (directVal !== undefined) {
    return directVal;
  }

  // Handle raw_ prefix (e.g. raw_nama_perusahaan -> nama_perusahaan)
  if (colKey.startsWith("raw_")) {
    const baseKey = colKey.slice(4);
    const rawVal = getRowValueCaseInsensitive(row, baseKey);
    if (rawVal !== undefined && rawVal !== null) {
      return rawVal;
    }
  }

  // Handle std_ prefix (e.g. std_nama_perusahaan -> standardize(nama_perusahaan))
  if (colKey.startsWith("std_")) {
    const baseKey = colKey.slice(4);
    const rawVal = getRowValueCaseInsensitive(row, baseKey) ?? getRowValueCaseInsensitive(row, `raw_${baseKey}`);
    if (rawVal !== undefined && rawVal !== null) {
      return standardizeColumnValue(rawVal, baseKey);
    }
  }

  // Handle gen_core_ prefix (e.g. gen_core_nama_perusahaan -> core_name)
  if (colKey.startsWith("gen_core_")) {
    const baseKey = colKey.slice(9);
    const rawVal =
      getRowValueCaseInsensitive(row, baseKey) ??
      getRowValueCaseInsensitive(row, `raw_${baseKey}`) ??
      findCompanyValueInRow(row);
    if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== "") {
      const parsed = parseEntityName(rawVal);
      return parsed.core_name || rawVal;
    }
  }

  // Handle gen_legal_ prefix (e.g. gen_legal_nama_perusahaan -> legal_form)
  if (colKey.startsWith("gen_legal_")) {
    const baseKey = colKey.slice(10);
    const rawVal =
      getRowValueCaseInsensitive(row, baseKey) ??
      getRowValueCaseInsensitive(row, `raw_${baseKey}`) ??
      findCompanyValueInRow(row);
    if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== "") {
      const parsed = parseEntityName(rawVal);
      return parsed.legal_form || "-";
    }
  }

  if (colKey.includes("[Generated] Nama Inti") || colKey.includes("Core Name") || colKey.includes("nama_inti")) {
    const rawVal = findCompanyValueInRow(row);
    if (rawVal) {
      const parsed = parseEntityName(rawVal);
      return parsed.core_name || rawVal;
    }
  }

  if (colKey.includes("[Generated] Badan Usaha") || colKey.includes("Legal Form") || colKey.includes("badan_usaha")) {
    const rawVal = findCompanyValueInRow(row);
    if (rawVal) {
      const parsed = parseEntityName(rawVal);
      return parsed.legal_form || "-";
    }
  }

  return undefined;
}

export interface DataPreviewColumn {
  key: string;
  label?: string;
  isVirtual?: boolean;
  isStandardized?: boolean;
}

export interface DataPreviewTableProps {
  datasetId?: string;
  workspaceId?: string;
  role?: "input" | "reference";
  title: string;
  subtitle?: string;
  filename?: string;
  columns: (string | DataPreviewColumn)[];
  rows: Record<string, unknown>[];
  totalRows?: number;
  previewLimit?: number;
  badgeColor?: "brand" | "secondary" | "success" | "warning";
  badgeText?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  headerAction?: React.ReactNode;
}

export function DataPreviewTable({
  datasetId,
  workspaceId,
  role,
  title,
  subtitle,
  filename,
  columns: rawColumns,
  rows,
  totalRows = rows.length,
  previewLimit = 5,
  badgeColor = "brand",
  badgeText,
  searchPlaceholder,
  emptyMessage,
  className = "",
  headerAction,
}: DataPreviewTableProps) {
  const { t } = usePreferences();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [serverData, setServerData] = useState<{ data: Record<string, unknown>[]; total: number } | null>(null);
  const [isLoadingServer, setIsLoadingServer] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const effectivePlaceholder = searchPlaceholder ?? t("preview.searchPlaceholder");
  const effectiveEmptyMessage = emptyMessage ?? t("preview.emptyMessage");

  // Fetch paginated rows from backend when datasetId or workspaceId is provided
  useEffect(() => {
    if (!isModalOpen || (!datasetId && !(workspaceId && role))) {
      setServerData(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingServer(true);
    setServerError(null);

    const timer = setTimeout(async () => {
      try {
        let res: PaginatedDatasetRowsResult;
        if (workspaceId && role) {
          res = await fetchWorkspaceStandardizedPreview(workspaceId, {
            role,
            page: currentPage,
            per_page: pageSize,
            search: searchQuery.trim() || undefined,
          });
        } else if (datasetId) {
          res = await fetchDatasetRows(datasetId, {
            page: currentPage,
            per_page: pageSize,
            search: searchQuery.trim() || undefined,
            standardized: Boolean(role || columns.some((c) => c.isStandardized || c.isVirtual)),
          });
        } else {
          return;
        }

        if (!isCancelled) {
          setServerData({
            data: res.data,
            total: res.total,
          });
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("fetch dataset preview rows error:", err);
          setServerError(err instanceof Error ? err.message : "Gagal memuat baris dataset");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingServer(false);
        }
      }
    }, 200);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isModalOpen, datasetId, workspaceId, role, currentPage, pageSize, searchQuery]);

  // Normalize and deduplicate column definitions
  const columns: DataPreviewColumn[] = useMemo(() => {
    const seenKeys = new Set<string>();
    const uniqueCols: DataPreviewColumn[] = [];
    for (const rawCol of rawColumns) {
      const col = typeof rawCol === "string" ? { key: rawCol, label: rawCol } : rawCol;
      if (!seenKeys.has(col.key)) {
        seenKeys.add(col.key);
        uniqueCols.push({
          ...col,
          label: col.label ?? col.key,
          isVirtual:
            col.isVirtual ??
            (col.key.startsWith("[Generated]") || col.key.startsWith("enriched.") || col.key.startsWith("gen_")),
          isStandardized:
            col.isStandardized ??
            (col.key.includes("Standardized") || col.key.includes("terstandardisasi") || col.key.startsWith("std_")),
        });
      }
    }
    return uniqueCols;
  }, [rawColumns]);

  // Base preview rows (First 3-5 rows)
  const previewRows = useMemo(() => {
    return rows.slice(0, previewLimit);
  }, [rows, previewLimit]);

  // Filtered rows for client fallback
  const filteredClientRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase().trim();

    return rows.filter((row) => {
      return columns.some((col) => {
        const val = resolveRowCellValue(row, col.key);
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(query);
      });
    });
  }, [rows, columns, searchQuery]);

  // Dynamic row counts & pagination bounds
  const activeTotalRows = serverData !== null
    ? serverData.total
    : (searchQuery.trim() ? filteredClientRows.length : (datasetId ? totalRows : filteredClientRows.length));
  const totalPages = Math.max(1, Math.ceil(activeTotalRows / pageSize));

  // Paginated rows for expanded modal
  const paginatedRows = useMemo(() => {
    if (serverData !== null) {
      return serverData.data;
    }
    const startIndex = (currentPage - 1) * pageSize;
    return filteredClientRows.slice(startIndex, startIndex + pageSize);
  }, [serverData, filteredClientRows, currentPage, pageSize]);

  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // Generate pagination buttons
  const paginationRange = useMemo(() => {
    const delta = 2;
    const range: (number | string)[] = [];
    for (
      let i = Math.max(2, currentPage - delta);
      i <= Math.min(totalPages - 1, currentPage + delta);
      i++
    ) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      range.unshift("...");
    }
    if (currentPage + delta < totalPages - 1) {
      range.push("...");
    }

    range.unshift(1);
    if (totalPages > 1 && !range.includes(totalPages)) {
      range.push(totalPages);
    }

    return range;
  }, [currentPage, totalPages]);

  const renderCellValue = (val: unknown, key: string) => {
    if (val === null || val === undefined || String(val).trim() === "") {
      return <span className="text-muted-foreground/40 italic">null</span>;
    }

    if (typeof val === "boolean") {
      return (
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${
            val ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
          }`}
        >
          {val ? "TRUE" : "FALSE"}
        </span>
      );
    }

    if (key === "match_status" || key === "final_status") {
      const s = String(val).toUpperCase();
      const isMatched = s.includes("MATCHED");
      const isNeedReview = s.includes("REVIEW") || s.includes("POSSIBLE");
      return (
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${
            isMatched
              ? "bg-success/15 text-success"
              : isNeedReview
                ? "bg-warning/15 text-warning"
                : "bg-secondary text-muted-foreground"
          }`}
        >
          {String(val)}
        </span>
      );
    }

    if (key === "matching_score" && typeof val === "number") {
      return <span className="font-semibold tabular-nums text-brand">{val}%</span>;
    }

    return String(val);
  };

  return (
    <>
      <div className={`rounded-lg border border-border bg-card p-3 sm:p-4 space-y-3 min-w-0 max-w-full overflow-hidden ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  badgeColor === "brand"
                    ? "text-brand"
                    : badgeColor === "success"
                      ? "text-success"
                      : badgeColor === "warning"
                        ? "text-warning"
                        : "text-foreground"
                }`}
              >
                {title}
              </span>
              {badgeText && (
                <span className="rounded bg-brand/10 px-1.5 py-0.2 text-[10px] font-semibold text-brand">
                  {badgeText}
                </span>
              )}
            </div>
            {filename && (
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground truncate max-w-[280px]">
                {filename}
              </p>
            )}
            {subtitle && !filename && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground hidden sm:inline-block">
              {t("preview.filteredRowsBadge", { count: totalRows.toLocaleString() })}
            </span>

            {headerAction}

            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCurrentPage(1);
                  setSearchQuery("");
                  setIsModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-secondary hover:text-brand transition-colors cursor-pointer"
                title={t("preview.expandTooltip")}
              >
                <Maximize2 className="size-3.5" />
                <span>{t("preview.expand_all")}</span>
              </button>
            )}
          </div>
        </div>

        {previewRows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <FileSpreadsheet className="mx-auto size-7 text-muted-foreground/40 mb-1.5" />
            {effectiveEmptyMessage}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-2.5 py-2 text-center font-medium border-r border-border/50">
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-left font-mono font-medium whitespace-nowrap ${
                        col.isVirtual
                          ? "bg-brand/10 text-brand font-semibold"
                          : col.isStandardized
                            ? "bg-accent/10 text-accent-foreground font-semibold"
                            : ""
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {col.isVirtual && (
                          <span className="rounded bg-brand/20 px-1 py-0.2 text-[9px] uppercase">
                            Gen
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-secondary/20">
                    <td className="px-2.5 py-2 text-center text-muted-foreground border-r border-border/50 font-sans text-xs">
                      {idx + 1}
                    </td>
                    {columns.map((col) => {
                      const val = resolveRowCellValue(row, col.key);
                      return (
                        <td
                          key={col.key}
                          className="px-3 py-2 whitespace-nowrap max-w-[220px] truncate text-foreground"
                          title={String(val ?? "")}
                        >
                          {renderCellValue(val, col.key)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] sm:max-w-[94vw] sm:w-[94vw] h-[88vh] max-h-[88vh] flex flex-col p-3 sm:p-6 gap-3">
          <DialogHeader className="border-b border-border/70 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
              <div>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <span>{title}</span>
                  {filename && (
                    <span className="text-xs font-normal text-muted-foreground font-mono">
                      ({filename})
                    </span>
                  )}
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
                    {t("preview.filteredRowsBadge", { count: activeTotalRows.toLocaleString() })}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {subtitle ?? t("preview.modalSubtitle")}
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={effectivePlaceholder}
                    className="h-8 w-52 sm:w-64 rounded-md border border-border bg-background pl-8 pr-7 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">{t("preview.perPage")}</span>
                  <select
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                </div>
              </div>
            </div>
          </DialogHeader>

          {serverError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive flex items-center justify-between">
              <span>{serverError}</span>
            </div>
          )}

          <div className="relative flex-1 overflow-auto rounded-md border border-border">
            {isLoadingServer && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold shadow-md">
                  <Loader2 className="size-4 animate-spin text-brand" />
                  <span>Memuat baris...</span>
                </div>
              </div>
            )}

            {paginatedRows.length === 0 && !isLoadingServer ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                <Search className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                {t("preview.noMatchQuery", { query: searchQuery })}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-secondary/80 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 backdrop-blur z-10 border-b border-border">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-center font-medium border-r border-border/50 bg-secondary/80">
                      #
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-3.5 py-2.5 text-left font-mono font-medium whitespace-nowrap ${
                          col.isVirtual
                            ? "bg-brand/10 text-brand font-semibold"
                            : col.isStandardized
                              ? "bg-accent/10 text-accent-foreground font-semibold"
                              : ""
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span>{col.label}</span>
                          {col.isVirtual && (
                            <span className="rounded bg-brand/20 px-1 py-0.2 text-[9px] uppercase">
                              Gen
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono text-[11px]">
                  {paginatedRows.map((row, idx) => {
                    const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                    return (
                      <tr key={idx} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2 text-center text-muted-foreground border-r border-border/50 font-sans text-xs">
                          {absoluteIndex}
                        </td>
                        {columns.map((col) => {
                          const val = resolveRowCellValue(row, col.key);
                          return (
                            <td
                              key={col.key}
                              className="px-3.5 py-2 whitespace-nowrap max-w-[280px] truncate text-foreground"
                              title={String(val ?? "")}
                            >
                              {renderCellValue(val, col.key)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/70 text-xs">
            <div className="text-muted-foreground">
              {t("preview.paginationShowing", {
                from: activeTotalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1,
                to: Math.min(currentPage * pageSize, activeTotalRows),
                total: activeTotalRows.toLocaleString(),
                filteredInfo: searchQuery ? t("preview.filteredSuffix", { total: totalRows.toLocaleString() }) : "",
              })}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t("preview.firstPage")}
              >
                <ChevronsLeft className="size-3.5" />
              </button>

              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t("preview.prevPage")}
              >
                <ChevronLeft className="size-3.5" />
              </button>

              <div className="flex items-center gap-1 px-1">
                {paginationRange.map((page, idx) =>
                  typeof page === "string" ? (
                    <span key={idx} className="px-1 text-muted-foreground">
                      ...
                    </span>
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`size-7 rounded text-xs font-semibold grid place-items-center transition-colors cursor-pointer ${
                        currentPage === page
                          ? "bg-brand text-brand-foreground"
                          : "border border-border bg-secondary/30 hover:bg-secondary text-foreground"
                      }`}
                    >
                      {page}
                    </button>
                  ),
                )}
              </div>

              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t("preview.nextPage")}
              >
                <ChevronRight className="size-3.5" />
              </button>

              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t("preview.lastPage")}
              >
                <ChevronsRight className="size-3.5" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
