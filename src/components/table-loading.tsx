import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function TableLoadingSkeleton({ label, columns = 6, viewportHeight }: { label: string; columns?: number; viewportHeight?: number }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-lg border border-border">
      <span className="sr-only">{label}</span>
      <div style={viewportHeight ? { height: viewportHeight, overflow: "hidden" } : undefined}>
      <table aria-hidden="true" className="w-full table-fixed">
        <thead className="bg-secondary/60"><tr>
          {Array.from({ length: columns }, (_, index) => (
            <th key={index} className="px-4 py-3"><Skeleton className="h-3 w-2/3" /></th>
          ))}
        </tr></thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, row) => <tr key={row}>
            {Array.from({ length: columns }, (_, column) => (
              <td key={column} className="h-[88px] px-4 py-3">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="mt-3 h-3 w-3/5" />
              </td>
            ))}
          </tr>)}
        </tbody>
      </table>
      </div>
      <div className="h-12 border-t border-border bg-secondary/10" />
    </div>
  );
}

export function RefreshIndicator({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />{label}
    </span>
  );
}
