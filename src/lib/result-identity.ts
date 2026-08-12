import type { ReviewCandidate, ReviewItem } from "@/lib/api";

type RecordValue = string | number | boolean | null;
type RecordData = Record<string, RecordValue>;

export type IdentitySemantic =
  | "name"
  | "primary_identifier"
  | "secondary_identifier"
  | "province"
  | "city"
  | "address"
  | "other";

export type IdentityFieldPair = {
  semantic: IdentitySemantic;
  inputColumn: string | null;
  referenceColumn: string | null;
  priority: number;
  source: "mapping" | "field_score" | "fallback";
};

export type IdentitySummaryRow = {
  semantic: IdentitySemantic;
  label: string;
  inputValue: string | null;
  referenceValue: string | null;
  changed: boolean;
};

export type IdentitySummary = {
  primary: IdentitySummaryRow | null;
  rows: IdentitySummaryRow[];
  detailRows: IdentitySummaryRow[];
  hasReference: boolean;
};

const EXCLUDED_HINTS = [
  "status",
  "sektor",
  "sector",
  "kategori",
  "category",
  "industry",
  "bidang",
  "jenis",
  "type",
];

const PRIMARY_IDENTIFIER_HINTS = [
  "npwp",
  "nib",
  "taxid",
  "taxnumber",
  "registrationnumber",
  "registrationid",
  "businessregistration",
  "permitnumber",
  "license",
  "legalid",
  "nomorinduk",
];

const SECONDARY_IDENTIFIER_HINTS = [
  "idusaha",
  "idperusahaan",
  "companyid",
  "entityid",
  "businessid",
  "kodeusaha",
  "kodeperusahaan",
  "kode",
  "code",
  "identifier",
  "registration",
  "id",
];

const NAME_HINTS = [
  "namaperusahaan",
  "namausaha",
  "namabadanusaha",
  "legalname",
  "tradingname",
  "entityname",
  "companyname",
  "businessname",
  "namaentitas",
  "perusahaan",
  "usaha",
  "entity",
  "company",
  "business",
  "nama",
];

const PROVINCE_HINTS = ["provinsi", "province", "nmprov", "prov"];
const CITY_HINTS = [
  "kabupatenkota",
  "kabkota",
  "kabkot",
  "kabupaten",
  "regency",
  "nmkab",
  "city",
  "kota",
  "kab",
];
const ADDRESS_HINTS = [
  "alamatoperasional",
  "alamatperusahaan",
  "address",
  "alamat",
  "street",
  "jalan",
  "addr",
  "lokasi",
  "location",
];

export function extractIdentityMappings(workflowState: unknown): IdentityFieldPair[] {
  const state = readRecord(workflowState);
  const columnMappings = Array.isArray(state.columnMappings) ? state.columnMappings : [];

  return dedupePairs(
    columnMappings
      .map((mapping) => {
        const item = readRecord(mapping);
        const inputColumn = readString(item.inputColumnName);
        const referenceColumn = readString(item.referenceColumnName);
        if (!inputColumn && !referenceColumn) return null;

        const semantic = classifyPairSemantic(inputColumn, referenceColumn);

        return {
          semantic,
          inputColumn: inputColumn ?? null,
          referenceColumn: referenceColumn ?? null,
          priority: semanticPriority(semantic),
          source: "mapping" as const,
        };
      })
      .filter((item): item is IdentityFieldPair => Boolean(item)),
  );
}

export function buildIdentitySummary(
  item: ReviewItem,
  candidate: ReviewCandidate | null,
  basePairs: IdentityFieldPair[],
): IdentitySummary {
  const candidatePairs = extractCandidatePairs(candidate);
  const pairs = dedupePairs([...basePairs, ...candidatePairs]);
  const inputRecord = item.input_record ?? {};
  const referenceRecord = candidate?.reference_record ?? null;

  const alignedRows = pairs
    .map((pair) => buildAlignedRow(pair, inputRecord, referenceRecord))
    .filter((row): row is IdentitySummaryRow => Boolean(row));

  const fallbackRows = alignedRows.length > 0
    ? []
    : buildFallbackRows(inputRecord, referenceRecord);

  const detailRows = dedupeRows([...alignedRows, ...fallbackRows]).sort(
    (left, right) => semanticPriority(left.semantic) - semanticPriority(right.semantic),
  );

  const primary =
    detailRows.find((row) => row.semantic === "name" && (row.inputValue || row.referenceValue)) ??
    detailRows.find((row) => row.inputValue || row.referenceValue) ??
    null;

  const rows = detailRows
    .filter((row) => !sameIdentityRow(row, primary))
    .slice(0, 4);

  return {
    primary,
    rows,
    detailRows,
    hasReference: Boolean(referenceRecord),
  };
}

function extractCandidatePairs(candidate: ReviewCandidate | null): IdentityFieldPair[] {
  if (!candidate) return [];

  return dedupePairs(
    (candidate.field_scores ?? [])
      .map((fieldScore) => {
        const inputColumn = readString(fieldScore.input_column);
        const referenceColumn = readString(fieldScore.reference_column);
        if (!inputColumn && !referenceColumn) return null;

        const semantic = classifyPairSemantic(inputColumn, referenceColumn);

        return {
          semantic,
          inputColumn: inputColumn ?? null,
          referenceColumn: referenceColumn ?? null,
          priority: semanticPriority(semantic),
          source: "field_score" as const,
        };
      })
      .filter((item): item is IdentityFieldPair => Boolean(item)),
  );
}

function buildAlignedRow(
  pair: IdentityFieldPair,
  inputRecord: RecordData,
  referenceRecord: RecordData | null,
): IdentitySummaryRow | null {
  const inputValue = pair.inputColumn ? stringifyRecordValue(inputRecord[pair.inputColumn]) : null;
  const referenceValue =
    pair.referenceColumn && referenceRecord
      ? stringifyRecordValue(referenceRecord[pair.referenceColumn])
      : null;

  if (!inputValue && !referenceValue) return null;

  return {
    semantic: pair.semantic,
    label: pair.inputColumn ?? pair.referenceColumn ?? "",
    inputValue,
    referenceValue,
    changed: normalizeValue(inputValue) !== normalizeValue(referenceValue),
  };
}

function buildFallbackRows(inputRecord: RecordData, referenceRecord: RecordData | null) {
  const inputFields = rankRecordFields(inputRecord);
  const referenceFields = referenceRecord ? rankRecordFields(referenceRecord) : [];
  const selected = new Map<string, IdentitySummaryRow>();

  for (const field of [...inputFields, ...referenceFields]) {
    const key = field.semantic;
    if (selected.has(key)) continue;

    const inputValue = inputFields.find((item) => item.semantic === field.semantic)?.value ?? null;
    const referenceValue =
      referenceFields.find((item) => item.semantic === field.semantic)?.value ?? null;

    if (!inputValue && !referenceValue) continue;

    selected.set(key, {
      semantic: field.semantic,
      label: field.column,
      inputValue,
      referenceValue,
      changed: normalizeValue(inputValue) !== normalizeValue(referenceValue),
    });
  }

  return Array.from(selected.values());
}

function rankRecordFields(record: RecordData) {
  return Object.entries(record)
    .map(([column, value]) => ({
      column,
      value: stringifyRecordValue(value),
      semantic: classifySemantic(column),
    }))
    .filter((item) => item.value && !isExcludedColumn(item.column))
    .sort((left, right) => semanticPriority(left.semantic) - semanticPriority(right.semantic))
    .slice(0, 5);
}

function dedupePairs(pairs: IdentityFieldPair[]) {
  const seen = new Set<string>();
  const ordered = [...pairs].sort((left, right) => left.priority - right.priority);

  return ordered.filter((pair) => {
    const key = `${pair.semantic}:${normalizeColumnName(pair.inputColumn)}:${normalizeColumnName(pair.referenceColumn)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeRows(rows: IdentitySummaryRow[]) {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const key = `${row.semantic}:${normalizeValue(row.inputValue)}:${normalizeValue(row.referenceValue)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameIdentityRow(row: IdentitySummaryRow, other: IdentitySummaryRow | null) {
  if (!other) return false;
  return (
    row.semantic === other.semantic &&
    normalizeValue(row.inputValue) === normalizeValue(other.inputValue) &&
    normalizeValue(row.referenceValue) === normalizeValue(other.referenceValue)
  );
}

function classifySemantic(columnName: string): IdentitySemantic {
  const normalized = normalizeColumnName(columnName);

  if (matchesAny(normalized, PROVINCE_HINTS)) return "province";
  if (matchesAny(normalized, CITY_HINTS)) return "city";
  if (matchesAny(normalized, ADDRESS_HINTS)) return "address";
  if (matchesAny(normalized, PRIMARY_IDENTIFIER_HINTS)) return "primary_identifier";
  if (matchesAny(normalized, NAME_HINTS) && !isExcludedColumn(columnName)) return "name";
  if (matchesAny(normalized, SECONDARY_IDENTIFIER_HINTS) && !isExcludedColumn(columnName)) {
    return normalized === "id" ? "secondary_identifier" : "secondary_identifier";
  }

  return "other";
}

function classifyPairSemantic(inputColumn: string | null, referenceColumn: string | null) {
  const candidates = [inputColumn, referenceColumn]
    .filter((value): value is string => Boolean(value))
    .map((value) => classifySemantic(value));

  return [...candidates].sort((left, right) => semanticPriority(left) - semanticPriority(right))[0] ?? "other";
}

function semanticPriority(semantic: IdentitySemantic) {
  switch (semantic) {
    case "name":
      return 1;
    case "primary_identifier":
      return 2;
    case "secondary_identifier":
      return 3;
    case "province":
      return 4;
    case "city":
      return 5;
    case "address":
      return 6;
    default:
      return 7;
  }
}

function normalizeColumnName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

function matchesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

function isExcludedColumn(columnName: string) {
  const normalized = normalizeColumnName(columnName);
  return EXCLUDED_HINTS.some((hint) => normalized.includes(hint));
}

function stringifyRecordValue(value: RecordValue | undefined) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function normalizeValue(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
