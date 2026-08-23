import type { ReviewItem } from "@/lib/api";
import type { ExportTable } from "@/lib/export-files";

export type ExportStatus = "matched" | "new" | "rejected" | "pending";
export type ExportFormat = "xlsx" | "csv";
export type ExportPreset = "master_update" | "full_audit" | "pending_review";

export interface IntentExportOptions {
  preset: ExportPreset;
  autoEnrich: boolean;
}

export type StoredExportHistoryEntry = {
  id: string;
  fileName: string;
  format: ExportFormat | string;
  generatedAt: string;
  recordCount: number;
  mode: "default" | "custom" | "intent";
  preset?: ExportPreset;
  autoEnrich?: boolean;
  statuses: ExportStatus[];
  columns: string[];
  includeReferenceKey: boolean;
  includeReviewFields: boolean;
  includeScore: boolean;
  sourceJobId: string | null;
};

export function buildIntentExportRows(
  items: ReviewItem[],
  options: IntentExportOptions,
): ExportTable {
  const { preset, autoEnrich } = options;

  let filteredItems: ReviewItem[] = [];
  if (preset === "master_update") {
    filteredItems = items.filter((item) => {
      const s = exportStatus(item);
      return s === "matched" || s === "new";
    });
  } else if (preset === "pending_review") {
    filteredItems = items.filter((item) => {
      const s = exportStatus(item);
      return s === "pending";
    });
  } else {
    // full_audit
    filteredItems = items;
  }

  const inputColKeys = new Set<string>();
  const refColKeys = new Set<string>();
  items.forEach((item) => {
    Object.keys(item.input_record || {}).forEach((k) => inputColKeys.add(k));
    const ref = item.candidates[0]?.reference_record || {};
    Object.keys(ref).forEach((k) => refColKeys.add(k));
  });

  const inputCols = Array.from(inputColKeys);
  const refCols = Array.from(refColKeys);

  if (preset === "master_update") {
    const rows = filteredItems.map((item) => {
      const candidate = item.candidates[0] ?? null;
      const refRecord = candidate?.reference_record ?? {};
      const status = exportStatus(item);
      const isMatched = status === "matched";

      const row: Record<string, string | number | boolean | null> = {
        input_record_key: item.input_record_key,
        match_status: isMatched ? "MATCHED" : "NEW_ENTITY",
        reference_record_key: isMatched ? (candidate?.reference_record_key ?? null) : null,
      };

      inputCols.forEach((col) => {
        row[`input.${col}`] = (item.input_record[col] as string | number | boolean | null) ?? null;
      });

      if (autoEnrich && isMatched) {
        refCols.forEach((col) => {
          const refVal = refRecord[col];
          const inpVal = item.input_record[col];
          const enrichedVal =
            refVal !== undefined && refVal !== null && String(refVal).trim() !== ""
              ? refVal
              : inpVal !== undefined && inpVal !== null && String(inpVal).trim() !== ""
                ? inpVal
                : null;
          row[`enriched.${col}`] = enrichedVal as string | number | boolean | null;
        });
      }

      return row;
    });

    const columns = [
      "input_record_key",
      "match_status",
      "reference_record_key",
      ...inputCols.map((c) => `input.${c}`),
      ...(autoEnrich ? refCols.map((c) => `enriched.${c}`) : []),
    ];

    return {
      name: "Master Data Update",
      columns,
      rows,
    };
  }

  // full_audit or pending_review: Side-by-side structure
  const pairedFields = Array.from(new Set([...inputCols, ...refCols]));

  const rows = filteredItems.map((item) => {
    const candidate = item.candidates[0] ?? null;
    const refRecord = candidate?.reference_record ?? {};
    const status = exportStatus(item);

    const row: Record<string, string | number | boolean | null> = {
      input_record_key: item.input_record_key,
      match_status:
        status === "matched"
          ? "MATCHED"
          : status === "pending"
            ? "NEED_REVIEW"
            : status === "rejected"
              ? "REJECTED"
              : "UNMATCHED",
      matching_score: candidate?.score ?? (status === "new" ? 0 : null),
      reference_record_key: candidate?.reference_record_key ?? null,
    };

    pairedFields.forEach((field) => {
      const inpVal = item.input_record[field];
      const refVal = refRecord[field];

      row[`input.${field}`] = (inpVal as string | number | boolean | null) ?? null;
      row[`ref.${field}`] = (refVal as string | number | boolean | null) ?? null;

      if (autoEnrich && status === "matched") {
        const enriched =
          refVal !== undefined && refVal !== null && String(refVal).trim() !== ""
            ? refVal
            : inpVal !== undefined && inpVal !== null && String(inpVal).trim() !== ""
              ? inpVal
              : null;
        row[`enriched.${field}`] = enriched as string | number | boolean | null;
      }
    });

    if (item.decision) {
      row.review_decision = item.decision.decision;
      row.review_source = item.decision.source ?? null;
      row.review_reviewer = item.decision.reviewer ?? null;
    }

    return row;
  });

  const dynamicColumns: string[] = [];
  pairedFields.forEach((field) => {
    dynamicColumns.push(`input.${field}`);
    dynamicColumns.push(`ref.${field}`);
    if (autoEnrich) {
      dynamicColumns.push(`enriched.${field}`);
    }
  });

  const columns = [
    "input_record_key",
    "match_status",
    "matching_score",
    "reference_record_key",
    ...dynamicColumns,
    "review_decision",
    "review_reason",
  ];

  return {
    name: preset === "full_audit" ? "Audit Report" : "Pending Review Export",
    columns,
    rows,
  };
}

export function buildIntentExportPreview(
  items: ReviewItem[],
  options: IntentExportOptions,
  sampleLimit = 3,
): ExportTable {
  const table = buildIntentExportRows(items, options);
  return {
    ...table,
    rows: table.rows.slice(0, sampleLimit),
  };
}

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
  mode: "default" | "custom" | "intent";
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
    mode: record.mode === "custom" ? "custom" : record.mode === "intent" ? "intent" : "default",
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
