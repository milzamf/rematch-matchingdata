import type { ReviewCandidate, ReviewItem } from "@/lib/api";

type RecordValue = string | number | boolean | null;
type RecordData = Record<string, RecordValue>;
export type IdentitySide = "input" | "reference";

export type IdentitySemantic =
  | "name"
  | "strong_identifier"
  | "address"
  | "province"
  | "city"
  | "email"
  | "phone"
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
  inputColumn: string | null;
  referenceColumn: string | null;
  inputValue: string | null;
  referenceValue: string | null;
  changed: boolean;
  priority: number;
};

export type IdentitySummary = {
  primary: IdentitySummaryRow | null;
  rows: IdentitySummaryRow[];
  detailRows: IdentitySummaryRow[];
  hasReference: boolean;
};

export type IdentityFieldValue = {
  semantic: IdentitySemantic;
  label: string;
  column: string | null;
  value: string;
  priority: number;
};

export type RecordIdentity = {
  headline: string;
  meta: string;
  fields: IdentityFieldValue[];
};

const EXCLUDED_HINTS = [
  "industry",
  "sector",
  "status",
  "kategori",
  "category",
  "sektor",
  "bidang",
  "jenis",
];

const NAME_HINTS = [
  "namaperusahaan",
  "namaperusahaanresmi",
  "namaperusahaanlengkap",
  "namaperusahaanbadanusaha",
  "namaperusahaanentitas",
  "namaperusahaanusaha",
  "namaperusahaanutama",
  "namaperusahaanoperasional",
  "namaperusahaandagang",
  "namausaha",
  "namausaharesmi",
  "namabadanusaha",
  "namaentitas",
  "namaentity",
  "nama",
  "companyname",
  "companylegalname",
  "companydisplayname",
  "businessname",
  "entityname",
  "legalname",
  "tradingname",
];

const STRONG_IDENTIFIER_HINTS = [
  "idperusahaan",
  "companyid",
  "idusaha",
  "businessid",
  "entityid",
  "nib",
  "npwp",
  "nomornpwp",
  "taxid",
  "kodeperusahaan",
  "kodeusaha",
  "registrationnumber",
  "registrationid",
  "businessregistration",
];

const EMAIL_HINTS = ["emailperusahaan", "emailusaha", "email"];
const PHONE_HINTS = ["notelp", "nomortelp", "notelepon", "telephone", "telepon", "phone", "nohp", "mobile"];
const ADDRESS_HINTS = ["alamatperusahaan", "alamatoperasional", "address", "alamat", "jalan", "street", "addr", "lokasi"];
const PROVINCE_HINTS = ["provinsi", "province", "nmprov", "prov"];
const CITY_HINTS = ["kabupatenkota", "kabkota", "kabupaten", "regency", "city", "kota", "nmkab", "kab"];

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
      .filter((item): item is NonNullable<typeof item> => item !== null),
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

  const fallbackRows = buildFallbackRows(inputRecord, referenceRecord, alignedRows);
  const detailRows = dedupeRows([...alignedRows, ...fallbackRows]).sort(
    (left, right) => left.priority - right.priority,
  );

  const primary =
    detailRows.find((row) => row.semantic === "name" && (row.inputValue || row.referenceValue)) ??
    detailRows.find((row) => row.inputValue || row.referenceValue) ??
    null;

  return {
    primary,
    rows: detailRows.filter((row) => !sameIdentityRow(row, primary)).slice(0, 5),
    detailRows,
    hasReference: Boolean(referenceRecord),
  };
}

export function buildRecordIdentity(
  record: RecordData,
  side: IdentitySide,
  pairs: IdentityFieldPair[],
): RecordIdentity {
  const explicit = dedupeIdentityFields(
    pairs
      .map((pair) => {
        const column = side === "input" ? pair.inputColumn : pair.referenceColumn;
        if (!column) return null;
        const value = stringifyRecordValue(record[column]);
        if (!value) return null;

        return {
          semantic: pair.semantic,
          label: humanizeColumn(column),
          column,
          value,
          priority: semanticPriority(pair.semantic),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  );

  const fallback = dedupeIdentityFields(rankRecordFields(record));
  const fields = dedupeIdentityFields([...explicit, ...fallback]).sort(
    (left, right) => left.priority - right.priority,
  );

  const headlineField =
    fields.find((field) => field.semantic === "name") ??
    fields.find((field) => field.semantic === "strong_identifier") ??
    fields[0] ??
    null;

  const headline = headlineField?.value ?? "-";
  const location = buildLocationMeta(fields);
  const identifiers = fields
    .filter((field) => field.semantic === "strong_identifier" && field.value !== headline)
    .sort((left, right) => compareIdentifierFields(left, right))
    .slice(0, 2);
  const address = fields.find((field) => field.semantic === "address" && field.value !== headline);
  const email = fields.find((field) => field.semantic === "email" && field.value !== headline);
  const phone = fields.find((field) => field.semantic === "phone" && field.value !== headline);

  const metaParts = [
    ...identifiers.map((field) => formatIdentityField(field)),
    location,
    address ? formatIdentityField(address) : null,
    email ? formatIdentityField(email) : null,
    phone ? formatIdentityField(phone) : null,
  ].filter((value): value is string => Boolean(value));

  return {
    headline,
    meta: metaParts.join(" | ") || "-",
    fields,
  };
}

export function buildSideIdentity(summary: IdentitySummary, side: IdentitySide): RecordIdentity {
  const fields = summary.detailRows
    .map((row) => {
      const value = side === "input" ? row.inputValue : row.referenceValue;
      const column = side === "input" ? row.inputColumn : row.referenceColumn;
      if (!value) return null;

      return {
        semantic: row.semantic,
        label: row.label,
        column,
        value,
        priority: row.priority,
      };
    })
    .filter((item): item is IdentityFieldValue => Boolean(item));

  const headlineField =
    fields.find((field) => field.semantic === "name") ??
    fields.find((field) => field.semantic === "strong_identifier") ??
    fields[0] ??
    null;

  const headline = headlineField?.value ?? "-";
  const location = buildLocationMeta(fields);
  const identifiers = fields
    .filter((field) => field.semantic === "strong_identifier" && field.value !== headline)
    .sort((left, right) => compareIdentifierFields(left, right))
    .slice(0, 2);
  const address = fields.find((field) => field.semantic === "address" && field.value !== headline);
  const email = fields.find((field) => field.semantic === "email" && field.value !== headline);
  const phone = fields.find((field) => field.semantic === "phone" && field.value !== headline);

  const metaParts = [
    ...identifiers.map((field) => formatIdentityField(field)),
    location,
    address ? formatIdentityField(address) : null,
    email ? formatIdentityField(email) : null,
    phone ? formatIdentityField(phone) : null,
  ].filter((value): value is string => Boolean(value));

  return {
    headline,
    meta: metaParts.join(" | ") || "-",
    fields,
  };
}

export function sortFieldScores(
  scores: ReviewCandidate["field_scores"],
): ReviewCandidate["field_scores"] {
  return [...scores].sort((left, right) => {
    const leftSemantic = classifyPairSemantic(left.input_column, left.reference_column);
    const rightSemantic = classifyPairSemantic(right.input_column, right.reference_column);
    const semanticDiff = semanticPriority(leftSemantic) - semanticPriority(rightSemantic);
    if (semanticDiff !== 0) return semanticDiff;
    return left.reference_column.localeCompare(right.reference_column);
  });
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
      .filter((item): item is NonNullable<typeof item> => item !== null),
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
    label: bestLabel(pair.inputColumn, pair.referenceColumn, pair.semantic),
    inputColumn: pair.inputColumn,
    referenceColumn: pair.referenceColumn,
    inputValue,
    referenceValue,
    changed: normalizeValue(inputValue) !== normalizeValue(referenceValue),
    priority: pair.priority,
  };
}

function buildFallbackRows(
  inputRecord: RecordData,
  referenceRecord: RecordData | null,
  existingRows: IdentitySummaryRow[],
) {
  const seenSemantics = new Set(existingRows.map((row) => row.semantic));
  const inputFields = rankRecordFields(inputRecord);
  const referenceFields = referenceRecord ? rankRecordFields(referenceRecord) : [];
  const rows: IdentitySummaryRow[] = [];

  for (const semantic of ["name", "strong_identifier", "address", "province", "city", "email", "phone", "other"] as const) {
    if (seenSemantics.has(semantic)) continue;

    const inputField = inputFields.find((field) => field.semantic === semantic) ?? null;
    const referenceField = referenceFields.find((field) => field.semantic === semantic) ?? null;

    if (!inputField && !referenceField) continue;

    rows.push({
      semantic,
      label: bestLabel(inputField?.column ?? null, referenceField?.column ?? null, semantic),
      inputColumn: inputField?.column ?? null,
      referenceColumn: referenceField?.column ?? null,
      inputValue: inputField?.value ?? null,
      referenceValue: referenceField?.value ?? null,
      changed: normalizeValue(inputField?.value ?? null) !== normalizeValue(referenceField?.value ?? null),
      priority: semanticPriority(semantic),
    });
  }

  return rows;
}

function rankRecordFields(record: RecordData): IdentityFieldValue[] {
  return Object.entries(record)
    .map(([column, value]) => ({
      column,
      value: stringifyRecordValue(value),
      semantic: classifySemantic(column),
    }))
    .filter((item) => item.value && !isExcludedColumn(item.column))
    .map((item) => ({
      semantic: item.semantic,
      label: humanizeColumn(item.column),
      column: item.column,
      value: item.value as string,
      priority: semanticPriority(item.semantic),
    }))
    .sort((left, right) => left.priority - right.priority);
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

function dedupeIdentityFields(fields: IdentityFieldValue[]) {
  const seen = new Set<string>();

  return fields.filter((field) => {
    const key = `${field.semantic}:${normalizeValue(field.value)}`;
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

  if (matchesAny(normalized, NAME_HINTS) && !isExcludedColumn(columnName)) return "name";
  if (matchesAny(normalized, STRONG_IDENTIFIER_HINTS) && !isExcludedColumn(columnName)) return "strong_identifier";
  if (matchesAny(normalized, ADDRESS_HINTS)) return "address";
  if (matchesAny(normalized, PROVINCE_HINTS)) return "province";
  if (matchesAny(normalized, CITY_HINTS)) return "city";
  if (matchesAny(normalized, EMAIL_HINTS)) return "email";
  if (matchesAny(normalized, PHONE_HINTS)) return "phone";

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
    case "strong_identifier":
      return 2;
    case "address":
      return 3;
    case "province":
      return 4;
    case "city":
      return 5;
    case "email":
      return 6;
    case "phone":
      return 7;
    default:
      return 8;
  }
}

function bestLabel(
  inputColumn: string | null,
  referenceColumn: string | null,
  semantic: IdentitySemantic,
) {
  return humanizeColumn(inputColumn ?? referenceColumn ?? semanticLabel(semantic));
}

function semanticLabel(semantic: IdentitySemantic) {
  switch (semantic) {
    case "name":
      return "Company Name";
    case "strong_identifier":
      return "Identifier";
    case "address":
      return "Address";
    case "province":
      return "Province";
    case "city":
      return "Kabupaten/Kota";
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    default:
      return "Field";
  }
}

function buildLocationMeta(fields: IdentityFieldValue[]) {
  const city = fields.find((field) => field.semantic === "city");
  const province = fields.find((field) => field.semantic === "province");

  if (city && province) return `${city.value}, ${province.value}`;
  if (city) return city.value;
  if (province) return province.value;
  return null;
}

function formatIdentityField(field: IdentityFieldValue) {
  if (field.semantic === "strong_identifier" || field.semantic === "email" || field.semantic === "phone") {
    return `${field.label} ${field.value}`;
  }

  return field.value;
}

function humanizeColumn(value: string) {
  const normalized = value
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return value;

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function compareIdentifierFields(left: IdentityFieldValue, right: IdentityFieldValue) {
  const priorityDiff = identifierPriority(left.label, left.column) - identifierPriority(right.label, right.column);
  if (priorityDiff !== 0) return priorityDiff;
  return left.label.localeCompare(right.label);
}

function identifierPriority(label: string, column: string | null) {
  const normalized = normalizeColumnName(`${label}${column ?? ""}`);
  if (normalized.includes("nib")) return 1;
  if (normalized.includes("npwp") || normalized.includes("taxid")) return 2;
  if (normalized.includes("id")) return 3;
  return 4;
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
