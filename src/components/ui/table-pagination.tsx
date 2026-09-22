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
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(1)}
              className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.firstPage")}
            >
              <ChevronsLeft className="size-3.5" />
            </button>

            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.prevPage")}
            >
              <ChevronLeft className="size-3.5" />
            </button>

            <div className="flex items-center gap-1 px-1">
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
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.nextPage")}
            >
              <ChevronRight className="size-3.5" />
            </button>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(totalPages)}
              className="size-7 rounded grid place-items-center border border-border bg-secondary/30 hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-foreground"
              title={t("preview.lastPage")}
            >
              <ChevronsRight className="size-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
