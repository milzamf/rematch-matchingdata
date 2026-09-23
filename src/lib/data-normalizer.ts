/**
 * Client-side data normalization and entity name parsing utilities.
 * Mirrors the logic from ValueNormalizer.php and EntityNameParser.php for instant client-side preview and matching.
 * Based on Master Legal Entity Dictionary from D:\AI\Tools\kamus_badan_usaha.md
 */

export interface ParsedEntityName {
  raw_name: string;
  core_name: string;
  legal_form: string | null;
  ownership_qualifier: string | null;
  public_status: string | null;
  unit_type?: string | null;
  unit_name?: string | null;
  is_legal_entity?: boolean;
}

export interface LegalEntityDefinition {
  no: number;
  canonical: string;
  subForm?: string;
  fullName: string;
  origin: string;
  category: "domestik" | "asing" | "khusus";
  isLegalEntity: boolean; // Status Badan Hukum
  typicalPosition: "Prefix" | "Suffix" | "Prefix / Suffix";
  legalBasis: string;
  aliases: string[];
}

/**
 * Normalized token/phrase mapping to canonical legal form.
 * Sorted multi-word phrases match first before single abbreviations.
 */
export const LEGAL_ENTITY_MAP: Record<string, string> = {
  // 1. Perseroan Terbatas (PT)
  "perseroan terbatas": "PT",
  "perseroan perorangan": "PT",
  "pt perorangan": "PT",
  "perseroan": "PT",
  "p t": "PT",
  "pt": "PT",

  // 2. Commanditaire Vennootschap (CV)
  "commanditaire vennootschap": "CV",
  "commanditer vennootschap": "CV",
  "commanditaire venoschaap": "CV",
  "commanditer venoschaap": "CV",
  "persekutuan komanditer": "CV",
  "komanditer": "CV",
  "c v": "CV",
  "cv": "CV",

  // 3. Firma (Fa)
  "persekutuan firma": "Firma",
  "firma": "Firma",
  "f a": "Firma",
  "fa": "Firma",

  // 4. Usaha Dagang (UD)
  "usaha dagang": "UD",
  "u d": "UD",
  "ud": "UD",

  // 5. Perusahaan Dagang (PD)
  "perusahaan dagang": "PD",
  "p d": "PD",
  "pd": "PD",

  // 6. Koperasi
  "koperasi simpan pinjam": "Koperasi",
  "koperasi serba usaha": "Koperasi",
  "koperasi unit desa": "Koperasi",
  "koperasi pegawai republik indonesia": "Koperasi",
  "koperasi karyawan": "Koperasi",
  "koperasi pasar": "Koperasi",
  "koperasi": "Koperasi",
  "kopti": "Koperasi",
  "kopkar": "Koperasi",
  "koppas": "Koperasi",
  "kpri": "Koperasi",
  "k s p": "Koperasi",
  "ksp": "Koperasi",
  "k u d": "Koperasi",
  "kud": "Koperasi",
  "k s u": "Koperasi",
  "ksu": "Koperasi",
  "kop": "Koperasi",

  // 7. Yayasan
  "yayasan": "Yayasan",
  "yys": "Yayasan",
  "ysn": "Yayasan",

  // 8. BUMN / BUMD / Pemerintah
  "perusahaan daerah air minum": "PDAM",
  "p d a m": "PDAM",
  "pdam": "PDAM",
  "perusahaan umum daerah": "Perumda",
  "perumda": "Perumda",
  "perusahaan perseroan daerah": "Perseroda",
  "perseroan daerah": "Perseroda",
  "pt perseroda": "Perseroda",
  "perseroda": "Perseroda",
  "perusahaan umum": "Perum",
  "perum": "Perum",
  "badan usaha milik desa bersama": "BUMDes",
  "badan usaha milik desa": "BUMDes",
  "bum desa": "BUMDes",
  "bum des": "BUMDes",
  "bumdesma": "BUMDes",
  "bumdesa": "BUMDes",
  "bumdes": "BUMDes",
  "badan usaha milik daerah": "BUMD",
  "b u m d": "BUMD",
  "bumd": "BUMD",
  "badan usaha milik negara": "BUMN",
  "b u m n": "BUMN",
  "bumn": "BUMN",

  // 9. Bentuk Khusus Lainnya
  "perusahaan otobus": "PO",
  "perusahaan perseorangan": "PO",
  "p o": "PO",
  "po": "PO",
  "kelompok usaha bersama": "UB",
  "usaha bersama": "UB",
  "k u b": "UB",
  "kub": "UB",
  "u b": "UB",
  "ub": "UB",
  "persekutuan perdata": "Maatschap",
  "maatschap": "Maatschap",
  "mts": "Maatschap",
  "bentuk usaha tetap": "BUT",
  "b u t": "BUT",
  "but": "BUT",
  "kantor perwakilan perusahaan asing": "KPPA",
  "kantor perwakilan perdagangan asing": "KPPA",
  "representative office": "KPPA",
  "kppa": "KPPA",
  "kppka": "KPPA",
  "usaha perseorangan": "Perorangan",
  "usaha perorangan": "Perorangan",
  "perseorangan": "Perorangan",
  "perorangan": "Perorangan",

  // 10. Asing / Multinasional
  "private limited": "Pte Ltd",
  "pte ltd": "Pte Ltd",
  "sendirian berhad": "Sdn Bhd",
  "sdn bhd": "Sdn Bhd",
  "berhad": "Bhd",
  "bhd": "Bhd",
  "company limited": "Co Ltd",
  "co ltd": "Co Ltd",
  "limited liability company": "LLC",
  "l l c": "LLC",
  "llc": "LLC",
  "limited liability partnership": "LLP",
  "l l p": "LLP",
  "llp": "LLP",
  "limited": "Ltd",
  "ltd": "Ltd",
  "incorporated": "Inc",
  "inc": "Inc",
  "corporation": "Corp",
  "corp": "Corp",
  "gesellschaft mit beschraenkter haftung": "GmbH",
  "gesellschaft mit beschrankter haftung": "GmbH",
  "gmbh": "GmbH",
  "aktiengesellschaft": "AG",
  "ag": "AG",
  "sociedad anonima": "SA",
  "societe anonyme": "SA",
  "s a": "SA",
  "sa": "SA",
  "societa a responsabilita limitata": "SRL",
  "s r l": "SRL",
  "srl": "SRL",
  "besloten vennootschap": "BV",
  "b v": "BV",
  "bv": "BV",
  "naamloze vennootschap": "NV",
  "n v": "NV",
  "nv": "NV",
  "kabushiki kaisha": "KK",
  "k k": "KK",
  "kk": "KK",
};

/**
 * Pre-compiled sorted legal token list (longest string length first).
 */
const SORTED_LEGAL_ENTITIES: Array<{ token: string; canonical: string; regex: RegExp }> =
  Object.entries(LEGAL_ENTITY_MAP)
    .sort(([a], [b]) => b.length - a.length)
    .map(([token, canonical]) => ({
      token,
      canonical,
      regex: new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu"),
    }));

/**
 * Set of legal forms that have the legal status of "Badan Hukum".
 */
export const BADAN_HUKUM_SET = new Set([
  "PT",
  "Koperasi",
  "Yayasan",
  "Perum",
  "Perumda",
  "Perseroda",
  "PDAM",
  "BUMDes",
  "Ltd",
  "Pte Ltd",
  "Sdn Bhd",
  "Bhd",
  "Co Ltd",
  "Inc",
  "Corp",
  "LLC",
  "GmbH",
  "AG",
  "SA",
  "SRL",
  "BV",
  "NV",
]);

export function isBadanHukum(legalForm: string | null | undefined): boolean {
  if (!legalForm) return false;
  return BADAN_HUKUM_SET.has(legalForm);
}

export function hasStrictLegalConflict(
  refLegalForm: string | null | undefined,
  inputLegalForm: string | null | undefined
): boolean {
  if (!refLegalForm || !inputLegalForm) return false;
  const strictForms = ["PT", "CV", "UD", "PD", "Firma", "Koperasi", "Yayasan"];
  return (
    strictForms.includes(refLegalForm) &&
    strictForms.includes(inputLegalForm) &&
    refLegalForm !== inputLegalForm
  );
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
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
    .replace(/\bprov\b/gu, "provinsi")
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

/**
 * Normalizes any business form string (including survey codes, full Dutch/Indonesian names, acronyms)
 * to its canonical legal form.
 */
export function normalizeLegalForm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const rawStr = String(value).trim();
  if (!rawStr) return null;

  const str = rawStr.toLowerCase();

  // 1. Standard BPS / OSS numeric or zero-padded codes
  if (str === "1" || str === "01" || str === "2" || str === "02") return "PT";
  if (str === "3" || str === "03") return "CV";
  if (str === "4" || str === "04") return "Firma";
  if (str === "5" || str === "05") return "Koperasi";
  if (str === "6" || str === "06") return "Yayasan";
  if (str === "7" || str === "07") return "BUMN";
  if (str === "8" || str === "08") return "Perorangan";

  // 2. Normalized text lookup
  const normalized = normalizeText(str);
  if (!normalized) return null;

  if (LEGAL_ENTITY_MAP[normalized]) {
    return LEGAL_ENTITY_MAP[normalized];
  }

  for (const item of SORTED_LEGAL_ENTITIES) {
    if (item.regex.test(normalized)) {
      return item.canonical;
    }
  }

  return null;
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
      is_legal_entity: false,
    };
  }

  let text = normalizeText(rawName);

  // 1. Extract Unit (Cabang, KCP, Divisi, etc.)
  let unitType: string | null = null;
  let unitName: string | null = null;
  const unitPatterns = [
    { regex: /\b(kantor\s+cabang\s+pembantu)\b\s*(.*)$/i, label: "KCP" },
    { regex: /\b(kantor\s+cabang\s+utama)\b\s*(.*)$/i, label: "KCU" },
    { regex: /\b(kantor\s+cabang)\b\s*(.*)$/i, label: "Kantor Cabang" },
    { regex: /\b(cabang)\b\s*(.*)$/i, label: "Cabang" },
    { regex: /\b(branch)\b\s*(.*)$/i, label: "Branch" },
    { regex: /\b(unit)\b\s*(.*)$/i, label: "Unit" },
    { regex: /\b(divisi|division)\b\s*(.*)$/i, label: "Divisi" },
    { regex: /\b(wilayah|regional)\b\s*(.*)$/i, label: "Regional" },
    { regex: /\b(departemen|department)\b\s*(.*)$/i, label: "Departemen" },
  ];

  for (const up of unitPatterns) {
    const match = text.match(up.regex);
    if (match) {
      unitType = up.label;
      unitName = (match[2] || "").trim() || null;
      text = text.replace(up.regex, " ").trim();
      break;
    }
  }

  // 2. Extract Public Status (Tbk / Terbuka)
  let publicStatus: string | null = null;
  if (/\b(tbk|terbuka)\b/i.test(text)) {
    publicStatus = "Tbk";
    text = text.replace(/\b(tbk|terbuka)\b/ig, " ");
  }

  // 3. Extract Ownership Qualifier (Persero, Perseroda, Perumda, Perum, BUMD, BUMN, BUMDes)
  let ownershipQualifier: string | null = null;
  const qualifierMatches = [
    { regex: /\b(perseroan\s+daerah|pt\s+perseroda|perseroda)\b/i, label: "Perseroda" },
    { regex: /\b(perusahaan\s+umum\s+daerah|perumda)\b/i, label: "Perumda" },
    { regex: /\b(perusahaan\s+umum|perum)\b/i, label: "Perum" },
    { regex: /\b(badan\s+usaha\s+milik\s+desa\s+bersama|badan\s+usaha\s+milik\s+desa|bumdesma|bumdesa|bumdes|bum\s*des)\b/i, label: "BUMDes" },
    { regex: /\b(badan\s+usaha\s+milik\s+daerah|bumd)\b/i, label: "BUMD" },
    { regex: /\b(badan\s+usaha\s+milik\s+negara|bumn)\b/i, label: "BUMN" },
    { regex: /\b(perusahaan\s+daerah\s+air\s+minum|pdam)\b/i, label: "PDAM" },
    { regex: /\b(persero)\b/i, label: "Persero" },
  ];

  for (const q of qualifierMatches) {
    if (q.regex.test(text)) {
      ownershipQualifier = q.label;
      text = text.replace(q.regex, " ");
      break;
    }
  }

  // 4. Identify Canonical Legal Form (sorted from longest to shortest)
  let legalForm: string | null = null;
  for (const item of SORTED_LEGAL_ENTITIES) {
    if (item.regex.test(text)) {
      legalForm = item.canonical;
      break;
    }
  }

  // 5. Clean all legal form tokens from core name
  for (const item of SORTED_LEGAL_ENTITIES) {
    text = text.replace(item.regex, " ");
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
    unit_type: unitType,
    unit_name: unitName,
    is_legal_entity: isBadanHukum(legalForm),
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

/**
 * Master Legal Entity Reference Dictionary for UI presentation and inspection.
 */
export const LEGAL_ENTITY_DICTIONARY: LegalEntityDefinition[] = [
  {
    no: 1,
    canonical: "PT",
    fullName: "Perseroan Terbatas",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "UU No. 40 Tahun 2007 jo. UU No. 6 Tahun 2023 Cipta Kerja",
    aliases: ["PT", "P.T.", "PT.", "Perseroan Terbatas", "Perseroan", "P T"],
  },
  {
    no: 2,
    canonical: "PT",
    subForm: "PT Perorangan",
    fullName: "Perseroan Perorangan",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "PP No. 8 Tahun 2021",
    aliases: ["PT Perorangan", "Perseroan Perorangan", "PT. Perorangan"],
  },
  {
    no: 3,
    canonical: "CV",
    fullName: "Commanditaire Vennootschap / Persekutuan Komanditer",
    origin: "Belanda",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "KUHD Pasal 19–21",
    aliases: ["CV", "C.V.", "CV.", "Commanditaire Vennootschap", "Persekutuan Komanditer", "Komanditer", "C V"],
  },
  {
    no: 4,
    canonical: "Firma",
    fullName: "Persekutuan Firma",
    origin: "Italia / Belanda",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "KUHD Pasal 16–18",
    aliases: ["Fa", "Fa.", "FA", "Firma", "Persekutuan Firma"],
  },
  {
    no: 5,
    canonical: "UD",
    fullName: "Usaha Dagang",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "Kebiasaan Dagang / Izin Pemda",
    aliases: ["UD", "U.D.", "UD.", "Usaha Dagang", "U D"],
  },
  {
    no: 6,
    canonical: "PD",
    fullName: "Perusahaan Dagang",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "Kebiasaan Dagang",
    aliases: ["PD", "P.D.", "PD.", "Perusahaan Dagang", "P D"],
  },
  {
    no: 7,
    canonical: "Koperasi",
    fullName: "Koperasi",
    origin: "Inggris (Cooperative)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "UU No. 25 Tahun 1992",
    aliases: ["Koperasi", "Kop", "Kop.", "KSP", "K.S.P.", "KSU", "K.S.U.", "KUD", "K.U.D.", "Koppas", "KPRI", "Kokarfi"],
  },
  {
    no: 8,
    canonical: "Yayasan",
    fullName: "Yayasan",
    origin: "Belanda (Stichting)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "UU No. 16/2001 jo. UU No. 28/2004",
    aliases: ["Yayasan", "Yys", "Yys.", "Ysn", "Ysn."],
  },
  {
    no: 9,
    canonical: "Perum",
    fullName: "Perusahaan Umum",
    origin: "Indonesia (BUMN/BUMD)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "UU No. 19 Tahun 2003",
    aliases: ["Perum", "Perum.", "Perusahaan Umum"],
  },
  {
    no: 10,
    canonical: "Persero",
    fullName: "Perusahaan Perseroan (BUMN)",
    origin: "Indonesia (BUMN)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "UU No. 19 Tahun 2003",
    aliases: ["(Persero)", "Persero", "PT (Persero)", "PT. (Persero)"],
  },
  {
    no: 11,
    canonical: "Tbk",
    fullName: "Perseroan Terbuka (Pasar Modal)",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "UU No. 8 Tahun 1995",
    aliases: ["Tbk", "Tbk.", "Terbuka", "(Tbk)", "(Tbk.)"],
  },
  {
    no: 12,
    canonical: "Perumda",
    fullName: "Perusahaan Umum Daerah",
    origin: "Indonesia (BUMD)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "PP No. 54 Tahun 2017",
    aliases: ["Perumda", "Perumda.", "Perusahaan Umum Daerah"],
  },
  {
    no: 13,
    canonical: "Perseroda",
    fullName: "Perusahaan Perseroan Daerah",
    origin: "Indonesia (BUMD)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "PP No. 54 Tahun 2017",
    aliases: ["Perseroda", "Perseroda.", "PT Perseroda"],
  },
  {
    no: 14,
    canonical: "PDAM",
    fullName: "Perusahaan Daerah Air Minum",
    origin: "Indonesia (BUMD)",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "Perda / PP No. 54 Tahun 2017",
    aliases: ["PDAM", "P.D.A.M.", "Perusahaan Daerah Air Minum"],
  },
  {
    no: 15,
    canonical: "BUMD",
    fullName: "Badan Usaha Milik Daerah",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Suffix / Prefix",
    legalBasis: "UU No. 23 Tahun 2014",
    aliases: ["BUMD", "B.U.M.D.", "Badan Usaha Milik Daerah"],
  },
  {
    no: 16,
    canonical: "BUMN",
    fullName: "Badan Usaha Milik Negara",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Suffix / Prefix",
    legalBasis: "UU No. 19 Tahun 2003",
    aliases: ["BUMN", "B.U.M.N.", "Badan Usaha Milik Negara"],
  },
  {
    no: 17,
    canonical: "BUMDes",
    fullName: "Badan Usaha Milik Desa",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: true,
    typicalPosition: "Prefix",
    legalBasis: "PP No. 11 Tahun 2021",
    aliases: ["BUMDes", "BUMDesa", "BUM-Des", "BUM Desa", "BUMDesma"],
  },
  {
    no: 18,
    canonical: "PO",
    fullName: "Perusahaan Otobus / Perseorangan",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "Kebiasaan Dagang / Dishub",
    aliases: ["PO", "P.O.", "PO.", "Perusahaan Otobus", "Perusahaan Perseorangan"],
  },
  {
    no: 19,
    canonical: "UB",
    fullName: "Usaha Bersama",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "Kebiasaan Dagang",
    aliases: ["UB", "U.B.", "UB.", "Usaha Bersama", "KUB"],
  },
  {
    no: 20,
    canonical: "Maatschap",
    fullName: "Persekutuan Perdata",
    origin: "Belanda (Burgerlijke Maatschap)",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "KUHPerdata Pasal 1618–1652",
    aliases: ["Maatschap", "Persekutuan Perdata", "Mts"],
  },
  {
    no: 21,
    canonical: "BUT",
    fullName: "Bentuk Usaha Tetap",
    origin: "Internasional (Permanent Establishment)",
    category: "khusus",
    isLegalEntity: false,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "UU Pajak Penghasilan (PPh)",
    aliases: ["BUT", "B.U.T.", "Bentuk Usaha Tetap"],
  },
  {
    no: 22,
    canonical: "KPPA",
    fullName: "Kantor Perwakilan Perusahaan Asing",
    origin: "Internasional (Representative Office)",
    category: "khusus",
    isLegalEntity: false,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "Peraturan BKPM",
    aliases: ["KPPA", "KPPKA", "Representative Office", "RO"],
  },
  {
    no: 23,
    canonical: "Perorangan",
    fullName: "Usaha Perseorangan / Informal",
    origin: "Indonesia",
    category: "domestik",
    isLegalEntity: false,
    typicalPosition: "Prefix",
    legalBasis: "IUMK / NIB Perseorangan",
    aliases: ["Perorangan", "Perseorangan", "Usaha Perseorangan", "Usaha Perorangan"],
  },
  // Asing / Internasional
  {
    no: 24,
    canonical: "Ltd",
    fullName: "Limited",
    origin: "UK / Commonwealth / Hong Kong",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["Ltd", "Ltd.", "Limited"],
  },
  {
    no: 25,
    canonical: "Pte Ltd",
    fullName: "Private Limited Company",
    origin: "Singapura / Afrika Selatan",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT Tertutup di RI",
    aliases: ["Pte Ltd", "Pte. Ltd.", "Private Limited"],
  },
  {
    no: 26,
    canonical: "Sdn Bhd",
    fullName: "Sendirian Berhad",
    origin: "Malaysia",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT Tertutup di RI",
    aliases: ["Sdn Bhd", "Sdn. Bhd.", "Sendirian Berhad"],
  },
  {
    no: 27,
    canonical: "Bhd",
    fullName: "Berhad",
    origin: "Malaysia",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT Terbuka (Tbk) di RI",
    aliases: ["Bhd", "Bhd.", "Berhad"],
  },
  {
    no: 28,
    canonical: "Inc",
    fullName: "Incorporated",
    origin: "Amerika Serikat / Filipina",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara Korporasi / PT di RI",
    aliases: ["Inc", "Inc.", "Incorporated"],
  },
  {
    no: 29,
    canonical: "Corp",
    fullName: "Corporation",
    origin: "Amerika Serikat / Global",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara Korporasi / PT di RI",
    aliases: ["Corp", "Corp.", "Corporation"],
  },
  {
    no: 30,
    canonical: "LLC",
    fullName: "Limited Liability Company",
    origin: "Amerika Serikat / Timur Tengah",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["LLC", "L.L.C.", "Limited Liability Company"],
  },
  {
    no: 31,
    canonical: "LLP",
    fullName: "Limited Liability Partnership",
    origin: "UK / Amerika Serikat / Singapura",
    category: "asing",
    isLegalEntity: false,
    typicalPosition: "Suffix",
    legalBasis: "Hibrida CV & Firma Modern",
    aliases: ["LLP", "L.L.P.", "Limited Liability Partnership"],
  },
  {
    no: 32,
    canonical: "GmbH",
    fullName: "Gesellschaft mit beschränkter Haftung",
    origin: "Jerman / Austria / Swiss",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["GmbH", "Gesellschaft mit beschränkter Haftung"],
  },
  {
    no: 33,
    canonical: "AG",
    fullName: "Aktiengesellschaft",
    origin: "Jerman / Austria / Swiss",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT Terbuka di RI",
    aliases: ["AG", "Aktiengesellschaft"],
  },
  {
    no: 34,
    canonical: "SA",
    fullName: "Sociedad Anónima / Société Anonyme",
    origin: "Spanyol / Perancis / Amerika Latin",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["SA", "S.A.", "Sociedad Anónima", "Société Anonyme"],
  },
  {
    no: 35,
    canonical: "SRL",
    fullName: "Società a responsabilità limitata",
    origin: "Italia / Rumania",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["SRL", "S.r.l.", "Società a responsabilità limitata"],
  },
  {
    no: 36,
    canonical: "BV",
    fullName: "Besloten Vennootschap",
    origin: "Belanda",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix / Prefix",
    legalBasis: "Setara PT Tertutup di RI",
    aliases: ["BV", "B.V.", "Besloten Vennootschap"],
  },
  {
    no: 37,
    canonical: "NV",
    fullName: "Naamloze Vennootschap",
    origin: "Belanda (Kolonial)",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Prefix / Suffix",
    legalBasis: "Setara PT Terbuka di RI",
    aliases: ["NV", "N.V.", "Naamloze Vennootschap"],
  },
  {
    no: 38,
    canonical: "Co Ltd",
    fullName: "Company Limited",
    origin: "Jepang / Korea / Tiongkok / Global",
    category: "asing",
    isLegalEntity: true,
    typicalPosition: "Suffix",
    legalBasis: "Setara PT di RI",
    aliases: ["Co., Ltd.", "Co Ltd", "Company Limited"],
  },
];
