import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { usePreferences } from "@/lib/preferences";

export interface TablePaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function TablePagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = "",
}: TablePaginationProps) {
  const { t } = usePreferences();
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  // Generate pagination range with ellipses
  const getPaginationRange = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  const paginationRange = getPaginationRange();

  if (totalItems <= pageSize && !onPageSizeChange) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-3 sm:px-6 py-3 border-t border-border bg-card/60 text-xs ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground">
          {t("preview.paginationShowing", {
            from,
            to,
            total: totalItems.toLocaleString(),
            filteredInfo: "",
          })}
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>{t("preview.perPage")}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const nextSize = Number(e.target.value);
                if (onPageSizeChange) onPageSizeChange(nextSize);
                onPageChange(1);
              }}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <>
          {/* Mobile pagination controls */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="size-8 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.prevPage")}
            >
              <ChevronLeft className="size-4" />
            </button>

            <span className="text-xs font-semibold tabular-nums px-1 text-foreground">
              {currentPage} / {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="size-8 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.nextPage")}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Tablet & Desktop pagination controls */}
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap sm:flex-nowrap overflow-x-auto max-w-full py-0.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(1)}
              className="size-7 shrink-0 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.firstPage")}
            >
              <ChevronsLeft className="size-3.5" />
            </button>

            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="size-7 shrink-0 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.prevPage")}
            >
              <ChevronLeft className="size-3.5" />
            </button>

            <div className="flex items-center gap-1 px-0.5">
              {paginationRange.map((page, idx) =>
                typeof page === "string" ? (
                  <span key={idx} className="px-1 text-muted-foreground font-mono text-xs">
                    ...
                  </span>
                ) : (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onPageChange(page)}
                    className={`h-7 min-w-[28px] px-1.5 rounded text-xs font-semibold grid place-items-center tabular-nums transition-colors cursor-pointer shrink-0 ${
                      currentPage === page
                        ? "bg-brand text-brand-foreground shadow-sm"
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
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="size-7 shrink-0 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.nextPage")}
            >
              <ChevronRight className="size-3.5" />
            </button>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(totalPages)}
              className="size-7 shrink-0 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.lastPage")}
            >
              <ChevronsRight className="size-3.5" />
            </button>

            {totalPages > 5 && (
              <div className="flex items-center gap-1.5 text-muted-foreground ml-2 pl-2 border-l border-border/70 shrink-0">
                <span className="text-[11px] whitespace-nowrap">{t("preview.jumpTo") ?? "Hal:"}</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const target = parseInt(pageInput, 10);
                      if (!isNaN(target) && target >= 1 && target <= totalPages) {
                        onPageChange(target);
                      }
                    }
                  }}
                  onBlur={() => {
                    const target = parseInt(pageInput, 10);
                    if (!isNaN(target) && target >= 1 && target <= totalPages) {
                      onPageChange(target);
                    } else {
                      setPageInput(String(currentPage));
                    }
                  }}
                  className="w-16 h-7 rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-xs text-center text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-brand"
                  title={t("preview.jumpPrompt", { total: totalPages.toLocaleString() }) ?? `Ketik 1 - ${totalPages.toLocaleString()} lalu tekan Enter`}
                />
                <span className="text-[11px] tabular-nums whitespace-nowrap">/ {totalPages.toLocaleString()}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
