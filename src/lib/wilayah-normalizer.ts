import provincesData from "./wilayah/provinces.json";
import regenciesData from "./wilayah/regencies.json";

export interface ProvinceItem {
  kd_prov: string;
  nm_prov: string;
}

export interface RegencyItem {
  id_kab: string; // 4 digits e.g. '3515'
  kd_prov: string; // 2 digits e.g. '35'
  kd_kab: string; // 2 digits e.g. '15'
  nm_prov: string; // e.g. 'JAWA TIMUR'
  nm_kab: string; // e.g. 'SIDOARJO'
  tipe: "KABUPATEN" | "KOTA";
  full_name: string; // e.g. 'KAB. SIDOARJO'
}

export const WILAYAH_PROVINCES: Record<string, ProvinceItem> = provincesData as Record<string, ProvinceItem>;
export const WILAYAH_REGENCIES: Record<string, RegencyItem> = regenciesData as Record<string, RegencyItem>;

export const WILAYAH_PROVINCES_LIST: ProvinceItem[] = Object.values(WILAYAH_PROVINCES).sort((a, b) =>
  a.kd_prov.localeCompare(b.kd_prov)
);

export const WILAYAH_REGENCIES_LIST: RegencyItem[] = Object.values(WILAYAH_REGENCIES).sort((a, b) =>
  a.id_kab.localeCompare(b.id_kab)
);

// Keep every candidate for a name; bare names must not silently pick a city.
const NAME_TO_IDKAB_MAP = new Map<string, Set<string>>();
const regencyNameKey = (name: string) => name.toLowerCase().trim()
  .replace(/^(?:(?:kabupaten|kab|kota|administrasi|adm)\.?\s+)+/u, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");
function indexRegencyName(name: string, id: string) {
  const key = regencyNameKey(name);
  const ids = NAME_TO_IDKAB_MAP.get(key) ?? new Set<string>();
  ids.add(id);
  NAME_TO_IDKAB_MAP.set(key, ids);
}
for (const [id, item] of Object.entries(WILAYAH_REGENCIES)) indexRegencyName(item.nm_kab, id);

// Known historical renames & aliases
const KNOWN_ALIASES: Record<string, string> = {
  "toba samosir": "1206",
  "tobasamosir": "1206",
  "kabupaten toba samosir": "1206",
  "kab toba samosir": "1206",
  "mamuju utara": "7605",
  "mamujuutara": "7605",
  "kabupaten mamuju utara": "7605",
  "kab mamuju utara": "7605",
  "adm kepulauan seribu": "3101",
  "administrasi kepulauan seribu": "3101",
  "kepulauan seribu": "3101",
  "kep seribu": "3101",
  "pohuwato": "7504",
  "bone bolango": "7503",
};

for (const [alias, idKab] of Object.entries(KNOWN_ALIASES)) {
  if (WILAYAH_REGENCIES[idKab]) indexRegencyName(alias, idKab);
}

/**
 * Normalizes regency text or code to its canonical RegencyItem.
 */
export function resolveRegency(
  val: string | number | null | undefined,
  provCode?: string | null
): RegencyItem | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str) return null;

  if (/^\d{2}\.\d{2}$/.test(str)) return WILAYAH_REGENCIES[str.replace(".", "")] ?? null;

  // 0. Bracket composite format e.g. "[3515] SIDOARJO", "[15] SIDOARJO"
  const bracketMatch = str.match(/^\[?(\d{2,4})\]?[\s\-:]*(.*)$/);
  if (bracketMatch) {
    const code = bracketMatch[1];
    const namePart = bracketMatch[2]?.trim();
    if (code.length === 4 && WILAYAH_REGENCIES[code]) {
      return WILAYAH_REGENCIES[code];
    }
    if (code.length === 2 && provCode) {
      const combined = `${String(provCode).trim().padStart(2, "0")}${code.padStart(2, "0")}`;
      if (WILAYAH_REGENCIES[combined]) {
        return WILAYAH_REGENCIES[combined];
      }
    }
    if (namePart) {
      const res = findRegencyByName(namePart, provCode);
      if (res) return res;
    }
  }

  // 1. 4-digit code e.g. "3515"
  if (/^\d{4}$/.test(str) && WILAYAH_REGENCIES[str]) {
    return WILAYAH_REGENCIES[str];
  }

  // 2. Format with dot e.g. "35.15" (Kemendagri format)
  const cleanDot = str.replace(/\./g, "");
  if (/^\d{4}$/.test(cleanDot) && WILAYAH_REGENCIES[cleanDot]) {
    return WILAYAH_REGENCIES[cleanDot];
  }

  // 3. 2-digit kab code with provCode provided e.g. prov="35", kab="15"
  if (provCode && /^\d{1,2}$/.test(str)) {
    const p = String(provCode).trim().padStart(2, "0");
    const k = str.padStart(2, "0");
    const combined = `${p}${k}`;
    if (WILAYAH_REGENCIES[combined]) {
      return WILAYAH_REGENCIES[combined];
    }
  }

  // 4. Lookup by name
  return findRegencyByName(str, provCode);
}

/**
 * Searches regency by name e.g. "Sidoarjo", "KAB. SIDOARJO", "Kota Surabaya".
 */
export function findRegencyByName(
  name: string,
  provCode?: string | null
): RegencyItem | null {
  const key = regencyNameKey(name);
  const type = /^kota\b/i.test(name.trim()) ? "KOTA"
    : /^(kabupaten|kab)\b/i.test(name.trim()) ? "KABUPATEN" : null;
  const matches = [...(NAME_TO_IDKAB_MAP.get(key) ?? [])].map(id => WILAYAH_REGENCIES[id])
    .filter(item => (!provCode || item.kd_prov === String(provCode).trim().padStart(2, "0"))
      && (!type || item.tipe === type));
  return matches.length === 1 ? matches[0] : null;
}

/** Resolve a name using separate province/regency codes from its source row. */
export function resolveRegencyFromRow(value: string | number | null | undefined, row?: Record<string, unknown>): RegencyItem | null {
  const province = extractProvCode(row);
  if (value == null || String(value).trim() === "") return null;
  if (/^\[?\d/.test(String(value).trim())) {
    const explicit = resolveRegency(value, province);
    if (explicit) return explicit;
  }
  for (const role of ["KAB_CODE_FULL", "KAB_CODE_RAW", "KAB_NAME"]) {
    for (const [column, code] of Object.entries(row ?? {})) {
      if (detectWilayahColumnRole(column) !== role || code == null) continue;
      const digits = String(code).trim().match(/^\[?(\d{1,4}(?:\.\d{2})?)\]?$/)?.[1];
      if (digits) { const item = resolveRegency(digits, province); if (item) return item; }
    }
  }
  return resolveRegency(value, province);
}

/**
 * Compares two location values and determines if they refer to the same regency.
 */
export function isMatchingLocation(
  val1: string | number | null | undefined,
  val2: string | number | null | undefined,
  row1?: Record<string, unknown>,
  row2?: Record<string, unknown>
): boolean | null {
  const reg1 = resolveRegencyFromRow(val1, row1);
  const reg2 = resolveRegencyFromRow(val2, row2);

  if (reg1 && reg2) {
    return reg1.id_kab === reg2.id_kab;
  }

  return null;
}

/**
 * Detects semantic role for Indonesian wilayah column names.
 */
export function detectWilayahColumnRole(columnName: string): string | null {
  const c = columnName.toLowerCase().trim().replace(/[_\-.\s/]/g, "");

  if (["idkab", "idkabupaten", "kodekabbps", "kdkabbps", "idregency"].includes(c)) {
    return "KAB_CODE_FULL"; // 4-digit BPS code e.g. 3515
  }

  if (["kdkab", "kodekab", "kodekabupaten", "kdkota", "kodekota", "regencycode"].includes(c)) {
    return "KAB_CODE_RAW"; // 2-digit kab code e.g. 15
  }

  if (["nmkab", "namakab", "namakabupaten", "kabupaten", "nmkota", "namakota", "kota", "kab", "regency", "city"].includes(c)) {
    return "KAB_NAME"; // e.g. Sidoarjo
  }

  if (["kdprov", "kodeprov", "kodeprovinsi", "idprov", "idprovinsi", "provid", "provincecode"].includes(c)) {
    return "PROV_CODE"; // 2-digit prov code e.g. 35
  }

  if (["nmprov", "namaprov", "namaprovinsi", "provinsi", "prov", "propinsi", "province"].includes(c)) {
    return "PROV_NAME"; // e.g. Jawa Timur
  }

  if (["idkec", "kdkec", "kodekec", "kodekecamatan", "districtcode"].includes(c)) {
    return "KEC_CODE";
  }

  if (["nmkec", "namakec", "namakecamatan", "kecamatan", "kec", "district"].includes(c)) {
    return "KEC_NAME";
  }

  if (["iddesa", "kddesa", "kodedesa", "villagecode"].includes(c)) {
    return "DESA_CODE";
  }

  if (["nmdesa", "namadesa", "desa", "kelurahan", "village"].includes(c)) {
    return "DESA_NAME";
  }

  return null;
}

function extractProvCode(row?: Record<string, unknown>): string | null {
  if (!row) return null;
  for (const [k, v] of Object.entries(row)) {
    const role = detectWilayahColumnRole(k);
    if ((role === "PROV_CODE" || role === "PROV_NAME") && v !== null && v !== undefined) {
      const s = String(v).trim();
      const code = s.match(/^\[?(\d{1,2})\]?(?:$|\s)/)?.[1]?.padStart(2, "0");
      if (code && WILAYAH_PROVINCES[code]) return code;
      const name = s.toLowerCase().replace(/^(?:provinsi|prov\.?|propinsi)\s+/, "");
      const item = Object.values(WILAYAH_PROVINCES).find(p => p.nm_prov.toLowerCase() === name);
      if (item) return item.kd_prov;
    }
  }
  return null;
}
