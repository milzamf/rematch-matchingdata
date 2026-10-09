import type { ReviewCandidate, ReviewItem } from "@/lib/api";
import { normalizeLegalForm } from "@/lib/data-normalizer";

type RecordValue = string | number | boolean | null;
type RecordData = Record<string, RecordValue>;
export type IdentitySide = "input" | "reference";

export type IdentitySemantic =
  | "name"
  | "legal_form"
  | "strong_identifier"
  | "address"
  | "city"
  | "province"
  | "email"
  | "phone"
  | "person"
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
  "kategori",
  "category",
  "sektor",
  "bidang",
];

const COMPANY_NAME_HINTS = [
  "namaperusahaan",
  "namaperusahaanresmi",
  "namaperusahaanlengkap",
  "namaperusahaanbadanusaha",
  "namaperusahaanentitas",
  "namaperusahaanusaha",
  "namaperusahaanutama",
  "namaperusahaanoperasional",
  "namaperusahaandagang",
  "namapenyedia",
  "namausaha",
  "namausaharesmi",
  "namabadanusaha",
  "namabadan",
  "namaentitas",
  "namaentity",
  "namarekanan",
  "namakontraktor",
  "namavendor",
  "namamitra",
  "namainstansi",
  "namawajibpajak",
  "namakomersial",
  "companyname",
  "companylegalname",
  "companydisplayname",
  "businessname",
  "entityname",
  "legalname",
  "tradingname",
  "vendorname",
  "providername",
  "namainti",
  "corename",
];

const LEGAL_FORM_HINTS = [
  "badanusaha",
  "bentukusaha",
  "legalform",
  "jenisusaha",
  "jenisbadanusaha",
  "statususaha",
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
  "nomorizinusaha",
  "noizinusaha",
  "izinusaha",
  "nomorizin",
  "noizin",
];

const EMAIL_HINTS = ["emailperusahaan", "emailusaha", "email"];
const PHONE_HINTS = ["notelp", "nomortelp", "notelepon", "telephone", "telepon", "phone", "nohp", "mobile"];
const ADDRESS_HINTS = ["alamatperusahaan", "alamatoperasional", "alamatpenyedia", "address", "alamat", "jalan", "street", "addr", "lokasi"];
const PROVINCE_HINTS = ["provinsi", "province", "nmprov", "kdprov", "prov"];
const CITY_HINTS = ["kabupatenkota", "kabkota", "kabupaten", "regency", "city", "kota", "nmkab", "kdkab", "kab"];

export function formatLegalFormDisplay(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const raw = String(value).trim();
  if (!raw) return "-";
  const norm = normalizeLegalForm(raw);
  if (!norm) return raw;
  if (/^\d+$/.test(raw)) {
    return `${raw} (${norm})`;
  }
  if (raw.toUpperCase().includes(`(${norm})`) || raw.toUpperCase() === norm) {
    return raw;
  }
  return `${raw} (${norm})`;
}

export function isPersonOrContactColumn(columnName: string): boolean {
  const norm = normalizeColumnName(columnName);
  if (!norm) return false;

  const EXACT_PERSON = [
    "cp",
    "pic",
    "kontak",
    "contact",
    "pengusaha",
    "direktur",
    "director",
    "pimpinan",
    "leader",
    "pemilik",
    "owner",
    "penanggungjawab",
    "penanggung_jawab",
    "pj",
    "petugas",
    "person",
    "namacp",
    "namapic",
    "namapengusaha",
    "namadirektur",
    "namapemilik",
    "namapimpinan",
    "namapenanggungjawab",
    "namapj",
    "namapetugas",
    "nohpcp",
    "jabatancp",
  ];
  if (EXACT_PERSON.includes(norm)) return true;

  if (
    norm.endsWith("cp") ||
    norm.startsWith("cp") ||
    norm.includes("pic") ||
    norm.includes("contactperson") ||
    norm.includes("kontakperson") ||
    norm.includes("pengusaha") ||
    norm.includes("direktur") ||
    norm.includes("penanggungjawab") ||
    norm.includes("pimpinan") ||
    norm.includes("pemilik")
  ) {
    return true;
  }

  const tokens = columnName.toLowerCase().split(/[^a-z0-9]+/);
  if (
    tokens.some((t) =>
      [
        "cp",
        "pic",
        "kontak",
        "contact",
        "pengusaha",
        "direktur",
        "pimpinan",
        "pemilik",
        "penanggungjawab",
        "pj",
        "petugas",
      ].includes(t),
    )
  ) {
    return true;
  }

  return false;
}

export function extractIdentityMappings(workflowState: unknown): IdentityFieldPair[] {
  const state = readRecord(workflowState);
  const columnMappings = Array.isArray(state.columnMappings) ? state.columnMappings : [];
  const pairs: IdentityFieldPair[] = [];

  for (const mapping of columnMappings) {
    const item = readRecord(mapping);
    const inputCol = readString(item.inputColumnName) ?? readString(item.input_column_name);
    const refCol = readString(item.referenceColumnName) ?? readString(item.reference_column_name);
    const parentInp = readString(item.parent_input_column) ?? readString(item.parentInputColumn);
    const parentRef = readString(item.parent_reference_column) ?? readString(item.parentReferenceColumn);
    const transform = readString(item.transform);

    // If parent raw entity name columns exist, preserve them as primary entity name pair
    if (parentInp && parentRef) {
      pairs.push({
        semantic: "name",
        inputColumn: parentInp,
        referenceColumn: parentRef,
        priority: 1,
        source: "mapping",
      });
    }

    if (inputCol || refCol) {
      let semantic = classifyPairSemantic(inputCol, refCol);
      if (transform === "EXTRACT_LEGAL_FORM" || (inputCol && matchesAny(normalizeColumnName(inputCol), LEGAL_FORM_HINTS))) {
        semantic = "legal_form";
      } else if (transform === "EXTRACT_CORE_NAME" || (inputCol && matchesAny(normalizeColumnName(inputCol), COMPANY_NAME_HINTS))) {
        semantic = "name";
      }

      pairs.push({
        semantic,
        inputColumn: inputCol ?? null,
        referenceColumn: refCol ?? null,
        priority: semanticPriority(semantic),
        source: "mapping",
      });
    }
  }

  return dedupePairs(pairs);
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
        const res = resolveRecordValueForPair(record, column, pair.semantic);
        if (!res.value) return null;

        return {
          semantic: pair.semantic,
          label: bestLabel(res.column, null, pair.semantic),
          column: res.column,
          value: res.value,
          priority: semanticPriority(pair.semantic),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  );

  const fallback = dedupeIdentityFields(rankRecordFields(record));
  const fields = dedupeIdentityFields([...explicit, ...fallback]).sort(
    (left, right) => left.priority - right.priority,
  );

  const nameField = fields.find((field) => field.semantic === "name");
  const headline = nameField?.value ?? "-";

  const location = buildLocationMeta(fields);
  const legalForm = fields.find((field) => field.semantic === "legal_form" && field.value !== headline);
  const identifiers = fields
    .filter((field) => field.semantic === "strong_identifier" && field.value !== headline)
    .sort((left, right) => compareIdentifierFields(left, right))
    .slice(0, 2);
  const address = fields.find((field) => field.semantic === "address" && field.value !== headline);
  const email = fields.find((field) => field.semantic === "email" && field.value !== headline);
  const phone = fields.find((field) => field.semantic === "phone" && field.value !== headline);
  const person = fields.find((field) => field.semantic === "person" && field.value !== headline);

  const metaParts = [
    legalForm ? legalForm.value : null,
    ...identifiers.map((field) => formatIdentityField(field)),
    person ? formatIdentityField(person) : null,
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

  // The headline is strictly the entity name for symmetric alignment.
  const nameField = fields.find((field) => field.semantic === "name");
  const headline = nameField?.value ?? (side === "input" ? "-" : "(Nama tidak terisi di acuan)");

  const location = buildLocationMeta(fields);
  const legalForm = fields.find((field) => field.semantic === "legal_form" && field.value !== headline);
  const identifiers = fields
    .filter((field) => field.semantic === "strong_identifier" && field.value !== headline)
    .sort((left, right) => compareIdentifierFields(left, right))
    .slice(0, 2);
  const address = fields.find((field) => field.semantic === "address" && field.value !== headline);
  const email = fields.find((field) => field.semantic === "email" && field.value !== headline);
  const phone = fields.find((field) => field.semantic === "phone" && field.value !== headline);
  const person = fields.find((field) => field.semantic === "person" && field.value !== headline);

  const metaParts = [
    legalForm ? legalForm.value : null,
    ...identifiers.map((field) => formatIdentityField(field)),
    person ? formatIdentityField(person) : null,
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

function resolveRecordValueForPair(
  record: RecordData | null,
  column: string | null,
  semantic: IdentitySemantic,
): { value: string | null; column: string | null } {
  if (!record) return { value: null, column: null };

  // 1. Direct match with column
  if (column && record[column] !== undefined && record[column] !== null && String(record[column]).trim() !== "") {
    const rawVal = stringifyRecordValue(record[column]);
    return {
      value: semantic === "legal_form" ? formatLegalFormDisplay(rawVal) : rawVal,
      column,
    };
  }

  // 2. Adaptive fallback based on semantic
  if (semantic === "name") {
    for (const k of [
      "nama_penyedia",
      "nama_perusahaan",
      "[Generated] Nama Inti",
      "nama_inti",
      "nama_usaha",
      "nama_rekanan",
      "nama_kontraktor",
      "nama_vendor",
      "nama",
      "name",
      "company_name",
    ]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        return { value: stringifyRecordValue(record[k]), column: k };
      }
    }
  } else if (semantic === "legal_form") {
    for (const k of ["[Generated] Badan Usaha", "bentuk_usaha", "badan_usaha", "legal_form"]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        const rawVal = stringifyRecordValue(record[k]);
        return { value: formatLegalFormDisplay(rawVal), column: k };
      }
    }
  } else if (semantic === "address") {
    for (const k of ["alamat", "alamat_perusahaan", "alamat_operasional", "alamat_penyedia", "address", "jalan"]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        return { value: stringifyRecordValue(record[k]), column: k };
      }
    }
  } else if (semantic === "strong_identifier") {
    for (const k of ["nib", "nomor_izin_usaha", "no_nib", "npwp_penyedia", "npwp", "nik", "id_perusahaan"]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        return { value: stringifyRecordValue(record[k]), column: k };
      }
    }
  } else if (semantic === "city") {
    for (const k of ["kd_kab", "kab", "nmkab", "nm_kab", "kabupaten", "kota"]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        return { value: stringifyRecordValue(record[k]), column: k };
      }
    }
  } else if (semantic === "province") {
    for (const k of ["kdprov", "prov", "nmprov", "nm_prov", "provinsi"]) {
      if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== "") {
        return { value: stringifyRecordValue(record[k]), column: k };
      }
    }
  }

  return { value: null, column };
}

function buildAlignedRow(
  pair: IdentityFieldPair,
  inputRecord: RecordData,
  referenceRecord: RecordData | null,
): IdentitySummaryRow | null {
  const inputRes = resolveRecordValueForPair(inputRecord, pair.inputColumn, pair.semantic);
  const refRes = resolveRecordValueForPair(referenceRecord, pair.referenceColumn, pair.semantic);

  const inputValue = inputRes.value;
  const referenceValue = refRes.value;

  if (!inputValue && !referenceValue) return null;

  return {
    semantic: pair.semantic,
    label: bestLabel(inputRes.column ?? pair.inputColumn, refRes.column ?? pair.referenceColumn, pair.semantic),
    inputColumn: inputRes.column ?? pair.inputColumn,
    referenceColumn: refRes.column ?? pair.referenceColumn,
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

  for (const semantic of [
    "name",
    "legal_form",
    "address",
    "strong_identifier",
    "city",
    "province",
    "email",
    "phone",
    "person",
    "other",
  ] as const) {
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

function nameSubPriority(columnName: string): number {
  const norm = normalizeColumnName(columnName);
  if (norm.includes("namaperusahaan") || norm.includes("companyname")) return 1;
  if (norm.includes("namapenyedia") || norm.includes("vendorname") || norm.includes("providername")) return 2;
  if (norm.includes("namausaha") || norm.includes("businessname")) return 3;
  if (norm.includes("namabadanusaha") || norm.includes("legalname")) return 4;
  if (norm.includes("namainti") || norm.includes("corename")) return 5;
  if (norm === "nama" || norm === "name") return 6;
  return 10;
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
      value: item.semantic === "legal_form" ? formatLegalFormDisplay(item.value) : (item.value as string),
      priority: semanticPriority(item.semantic),
      subPriority: item.semantic === "name" ? nameSubPriority(item.column) : 100,
    }))
    .sort((left, right) => {
      const diff = left.priority - right.priority;
      if (diff !== 0) return diff;
      return left.subPriority - right.subPriority;
    });
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

  if (isPersonOrContactColumn(columnName)) return "person";
  if (matchesAny(normalized, COMPANY_NAME_HINTS)) return "name";
  if (matchesAny(normalized, LEGAL_FORM_HINTS)) return "legal_form";
  if (
    normalized === "nama" ||
    normalized === "name" ||
    normalized.startsWith("nama") ||
    normalized.endsWith("name")
  ) {
    return "name";
  }
  if (matchesAny(normalized, STRONG_IDENTIFIER_HINTS)) return "strong_identifier";
  if (matchesAny(normalized, ADDRESS_HINTS)) return "address";
  if (matchesAny(normalized, PROVINCE_HINTS)) return "province";
  if (matchesAny(normalized, CITY_HINTS)) return "city";
  if (matchesAny(normalized, EMAIL_HINTS)) return "email";
  if (matchesAny(normalized, PHONE_HINTS)) return "phone";
  if (isExcludedColumn(columnName)) return "other";

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
    case "legal_form":
      return 2;
    case "address":
      return 3;
    case "strong_identifier":
      return 4;
    case "city":
      return 5;
    case "province":
      return 6;
    case "email":
      return 7;
    case "phone":
      return 8;
    case "person":
      return 9;
    default:
      return 10;
  }
}

function bestLabel(
  inputColumn: string | null,
  referenceColumn: string | null,
  semantic: IdentitySemantic,
) {
  switch (semantic) {
    case "name":
      return "Nama Entitas";
    case "legal_form":
      return "Bentuk Badan Usaha";
    case "address":
      return "Alamat";
    case "city":
      return "Kabupaten / Kota";
    case "province":
      return "Provinsi";
    case "strong_identifier": {
      const combined = `${inputColumn ?? ""} ${referenceColumn ?? ""}`.toLowerCase();
      if (combined.includes("nib") || combined.includes("izin")) return "NIB";
      if (combined.includes("npwp")) return "NPWP";
      return "Nomor Identitas";
    }
    case "email":
      return "Email";
    case "phone":
      return "Telepon";
    case "person":
      return "Penanggung Jawab / CP";
    default:
      return humanizeColumn(inputColumn ?? referenceColumn ?? semanticLabel(semantic));
  }
}

function semanticLabel(semantic: IdentitySemantic) {
  switch (semantic) {
    case "name":
      return "Nama Entitas";
    case "legal_form":
      return "Bentuk Badan Usaha";
    case "strong_identifier":
      return "NIB / Identitas";
    case "address":
      return "Alamat";
    case "province":
      return "Provinsi";
    case "city":
      return "Kabupaten / Kota";
    case "email":
      return "Email";
    case "phone":
      return "Telepon";
    case "person":
      return "Penanggung Jawab / CP";
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
  if (
    field.semantic === "strong_identifier" ||
    field.semantic === "email" ||
    field.semantic === "phone" ||
    field.semantic === "person"
  ) {
    return `${field.label} ${field.value}`;
  }

  return field.value;
}

function humanizeColumn(value: string) {
  const norm = value.toLowerCase().replace(/[_\-]+/g, " ").trim();
  if (norm === "nama cp" || norm === "namacp") return "Nama CP";
  if (norm === "cp") return "CP";
  if (norm === "nama pic" || norm === "namapic") return "Nama PIC";
  if (norm === "pic") return "PIC";
  if (norm === "npwp" || norm === "npwp penyedia") return "NPWP";
  if (norm === "nib" || norm === "nomor izin usaha" || norm === "no izin usaha") return "NIB";
  if (norm === "nama perusahaan") return "Nama Perusahaan";
  if (norm === "nama penyedia") return "Nama Penyedia";
  if (norm === "nama usaha") return "Nama Usaha";
  if (norm === "nama pengusaha") return "Nama Pengusaha";
  if (norm === "bentuk usaha" || norm === "badan usaha" || norm === "generated badan usaha") return "Bentuk Badan Usaha";
  if (norm === "generated nama inti" || norm === "nama inti") return "Nama Inti";
  if (norm === "kd kab" || norm === "kdkab" || norm === "kab" || norm === "nmkab" || norm === "nm kab") return "Kabupaten / Kota";
  if (norm === "kd prov" || norm === "kdprov" || norm === "prov" || norm === "nmprov" || norm === "nm prov") return "Provinsi";
  if (norm === "alamat" || norm === "alamat perusahaan" || norm === "alamat operasional") return "Alamat";

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
  if (normalized.includes("nib") || normalized.includes("izin")) return 1;
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
  if (
    matchesAny(normalized, COMPANY_NAME_HINTS) ||
    matchesAny(normalized, LEGAL_FORM_HINTS) ||
    matchesAny(normalized, STRONG_IDENTIFIER_HINTS) ||
    matchesAny(normalized, ADDRESS_HINTS) ||
    matchesAny(normalized, CITY_HINTS) ||
    matchesAny(normalized, PROVINCE_HINTS)
  ) {
    return false;
  }
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
