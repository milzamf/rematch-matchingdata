/**
 * Client-side data normalization and entity name parsing utilities.
 * Mirrors the logic from ValueNormalizer.php and EntityNameParser.php for instant client-side preview in Step 2.
 */

export interface ParsedEntityName {
  raw_name: string;
  core_name: string;
  legal_form: string | null;
  ownership_qualifier: string | null;
  public_status: string | null;
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddress(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value).trim().toLowerCase();
  if (!text) return "";

  text = text
    .replace(/\b(jl|jln)\b/gu, "jalan")
    .replace(/\bno\b/gu, "nomor")
    .replace(/\bgg\b/gu, "gang")
    .replace(/\bds\b/gu, "desa")
    .replace(/\bkp\b/gu, "kampung")
    .replace(/\bkab\b/gu, "kabupaten")
    .replace(/\bkec\b/gu, "kecamatan")
    .replace(/\bkel\b/gu, "kelurahan")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

export function normalizeIdentifier(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function parseEntityName(value: unknown): ParsedEntityName {
  const rawName = String(value ?? "").trim();
  if (!rawName) {
    return {
      raw_name: "",
      core_name: "",
      legal_form: null,
      ownership_qualifier: null,
      public_status: null,
    };
  }

  let text = rawName.toLowerCase().replace(/\s+/g, " ");

  // Legal forms
  let legalForm: string | null = null;
  const legalFormMatches = [
    { regex: /\b(pt|perseroan\s+terbatas)\b/i, label: "PT" },
    { regex: /\b(cv|commanditaire\s+vennootschap)\b/i, label: "CV" },
    { regex: /\b(ud|usaha\s+dagang)\b/i, label: "UD" },
    { regex: /\b(fa|firma)\b/i, label: "Firma" },
    { regex: /\b(koperasi|kopti|kopkar)\b/i, label: "Koperasi" },
    { regex: /\b(yayasan)\b/i, label: "Yayasan" },
  ];

  for (const match of legalFormMatches) {
    if (match.regex.test(text)) {
      legalForm = match.label;
      text = text.replace(match.regex, " ");
      break;
    }
  }

  // Ownership qualifiers
  let ownershipQualifier: string | null = null;
  const qualifierMatches = [
    { regex: /\b(persero)\b/i, label: "Persero" },
    { regex: /\b(perseroda)\b/i, label: "Perseroda" },
    { regex: /\b(perum)\b/i, label: "Perum" },
    { regex: /\b(bumn)\b/i, label: "BUMN" },
    { regex: /\b(bumd)\b/i, label: "BUMD" },
  ];

  for (const match of qualifierMatches) {
    if (match.regex.test(text)) {
      ownershipQualifier = match.label;
      text = text.replace(match.regex, " ");
      break;
    }
  }

  // Public status
  let publicStatus: string | null = null;
  if (/\b(tbk|terbuka)\b/i.test(text)) {
    publicStatus = "Tbk";
    text = text.replace(/\b(tbk|terbuka)\b/ig, " ");
  }

  const coreName = text
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw_name: rawName,
    core_name: coreName,
    legal_form: legalForm,
    ownership_qualifier: ownershipQualifier,
    public_status: publicStatus,
  };
}

export function standardizeColumnValue(
  value: unknown,
  columnName: string,
  dataType?: string,
): string {
  if (value === null || value === undefined) return "";
  const colLower = columnName.toLowerCase();
  const typeLower = (dataType ?? "").toLowerCase();

  if (
    typeLower === "identifier" ||
    colLower.includes("nik") ||
    colLower.includes("npwp") ||
    colLower.includes("nib") ||
    colLower.includes("kode") ||
    colLower.includes("code") ||
    colLower.includes("id")
  ) {
    return normalizeIdentifier(value);
  }

  if (
    colLower.includes("alamat") ||
    colLower.includes("address") ||
    colLower.includes("jalan") ||
    colLower.includes("street") ||
    colLower.includes("lokasi")
  ) {
    return normalizeAddress(value);
  }

  if (
    colLower.includes("nama") ||
    colLower.includes("name") ||
    colLower.includes("perusahaan") ||
    colLower.includes("company") ||
    colLower.includes("vendor") ||
    colLower.includes("customer")
  ) {
    const parsed = parseEntityName(value);
    return parsed.core_name || normalizeText(value);
  }

  return normalizeText(value);
}
