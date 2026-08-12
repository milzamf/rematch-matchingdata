import type { ReviewItem } from "@/lib/api";
import type { ExportTable } from "@/lib/export-files";

export type ExportStatus = "matched" | "new" | "rejected" | "pending";
export type ExportFormat = "xlsx" | "csv";

export type StoredExportHistoryEntry = {
  id: string;
  fileName: string;
  format: ExportFormat | string;
  generatedAt: string;
  recordCount: number;
  mode: "default" | "custom";
  statuses: ExportStatus[];
  columns: string[];
  includeReferenceKey: boolean;
  includeReviewFields: boolean;
  includeScore: boolean;
  sourceJobId: string | null;
};

export function buildExportRows(
  items: ReviewItem[],
  options: {
    columns: string[];
    includeReferenceKey: boolean;
    includeReviewFields: boolean;
    includeScore: boolean;
    statuses: ExportStatus[];
  },
): ExportTable {
  const rows = items
    .filter((item) => options.statuses.includes(exportStatus(item)))
    .map((item) => {
      const candidate = item.candidates[0] ?? null;
      const row: Record<string, string | number | boolean | null> = {
        input_record_key: item.input_record_key,
        final_status: exportStatus(item),
      };

      options.columns.forEach((column) => {
        row[column] = exportColumnValue(item, column);
      });

      if (options.includeReferenceKey) {
        row.reference_record_key = candidate?.reference_record_key ?? null;
      }

      if (options.includeScore) {
        row.matching_score = candidate?.score ?? null;
      }

      if (options.includeReviewFields) {
        row.review_decision = item.decision?.decision ?? null;
        row.review_decided_at = item.decision?.decided_at ?? item.decision?.created_at ?? null;
        row.review_source = item.decision?.source ?? null;
        row.review_reviewer = item.decision?.reviewer ?? null;
        row.affected_records = item.decision?.affected_records ?? null;
      }

      return row;
    });

  const staticColumns = ["input_record_key", "final_status"];
  const optionalColumns = [
    ...(options.includeReferenceKey ? ["reference_record_key"] : []),
    ...(options.includeScore ? ["matching_score"] : []),
    ...(options.includeReviewFields
      ? [
          "review_decision",
          "review_decided_at",
          "review_source",
          "review_reviewer",
          "affected_records",
        ]
      : []),
  ];

  return {
    name: "Final Results",
    columns: [...staticColumns, ...options.columns, ...optionalColumns],
    rows,
  };
}

export function exportSummaryRows(items: ReviewItem[]): ExportTable {
  const counts = countExportStatuses(items);

  return {
    name: "Review Summary",
    columns: ["category", "records"],
    rows: [
      { category: "matched", records: counts.matched },
      { category: "new_entities", records: counts.new },
      { category: "rejected", records: counts.rejected },
      { category: "pending_review", records: counts.pending },
    ],
  };
}

export function exportColumns(items: ReviewItem[]) {
  const columns = new Set<string>();

  items.forEach((item) => {
    Object.keys(item.input_record).forEach((column) => columns.add(`input.${column}`));
    const reference = item.candidates[0]?.reference_record ?? {};
    Object.keys(reference).forEach((column) => columns.add(`reference.${column}`));
  });

  return Array.from(columns);
}

export function exportStatus(item: ReviewItem): ExportStatus {
  const status = item.display_status ?? item.status;

  if (["matched", "auto_matched", "manual_accepted"].includes(status)) return "matched";
  if (["unmatched", "confirmed_unmatched"].includes(status)) return "new";
  if (status === "manual_rejected") return "rejected";

  return "pending";
}

export function countExportStatuses(items: ReviewItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[exportStatus(item)] += 1;
      return counts;
    },
    { matched: 0, new: 0, rejected: 0, pending: 0 } satisfies Record<ExportStatus, number>,
  );
}

export function buildStoredExportHistoryEntry(input: {
  fileName: string;
  format: ExportFormat;
  recordCount: number;
  mode: "default" | "custom";
  statuses: ExportStatus[];
  columns: string[];
  includeReferenceKey: boolean;
  includeReviewFields: boolean;
  includeScore: boolean;
  sourceJobId: string | null;
}): StoredExportHistoryEntry {
  return {
    id: `export-${Date.now()}`,
    fileName: input.fileName,
    format: input.format,
    generatedAt: new Date().toISOString(),
    recordCount: input.recordCount,
    mode: input.mode,
    statuses: input.statuses,
    columns: input.columns,
    includeReferenceKey: input.includeReferenceKey,
    includeReviewFields: input.includeReviewFields,
    includeScore: input.includeScore,
    sourceJobId: input.sourceJobId,
  };
}

export function normalizeStoredExportHistory(value: unknown): StoredExportHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeStoredExportHistoryEntry(item))
    .filter((item): item is StoredExportHistoryEntry => item !== null)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

function normalizeStoredExportHistoryEntry(value: unknown): StoredExportHistoryEntry | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const fileName =
    readString(record.fileName) ??
    readString(record.filename) ??
    readString(record.name);

  const format = readString(record.format);
  const generatedAt =
    readString(record.generatedAt) ??
    readString(record.generated_at) ??
    readString(record.createdAt);
  const recordCount = readNumber(record.recordCount) ?? readNumber(record.record_count) ?? 0;

  if (!fileName || !format || !generatedAt) return null;

  const statuses = Array.isArray(record.statuses)
    ? record.statuses.filter(isExportStatus)
    : [];
  const columns = Array.isArray(record.columns)
    ? record.columns.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id: readString(record.id) ?? `export-${fileName}-${generatedAt}`,
    fileName,
    format,
    generatedAt,
    recordCount,
    mode: record.mode === "custom" ? "custom" : "default",
    statuses,
    columns,
    includeReferenceKey: Boolean(record.includeReferenceKey ?? record.include_reference_key),
    includeReviewFields: Boolean(record.includeReviewFields ?? record.include_review_fields),
    includeScore: Boolean(record.includeScore ?? record.include_score),
    sourceJobId:
      readString(record.sourceJobId) ??
      readString(record.source_job_id) ??
      null,
  };
}

function exportColumnValue(item: ReviewItem, column: string) {
  if (column.startsWith("input.")) {
    return item.input_record[column.slice(6)] ?? null;
  }

  if (column.startsWith("reference.")) {
    return item.candidates[0]?.reference_record[column.slice(10)] ?? null;
  }

  return null;
}

function isExportStatus(value: unknown): value is ExportStatus {
  return ["matched", "new", "rejected", "pending"].includes(String(value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
