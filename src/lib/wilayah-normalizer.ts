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

// Reverse index: name -> id_kab
const NAME_TO_IDKAB_MAP: Map<string, string> = new Map();

for (const [idKab, item] of Object.entries(WILAYAH_REGENCIES)) {
  const nm = item.nm_kab.toLowerCase().trim();
  if (nm) {
    if (!NAME_TO_IDKAB_MAP.has(nm)) {
      NAME_TO_IDKAB_MAP.set(nm, idKab);
    }
    NAME_TO_IDKAB_MAP.set(`kabupaten ${nm}`, idKab);
    NAME_TO_IDKAB_MAP.set(`kab. ${nm}`, idKab);
    NAME_TO_IDKAB_MAP.set(`kab ${nm}`, idKab);
    NAME_TO_IDKAB_MAP.set(`kota ${nm}`, idKab);

    const spaceless = nm.replace(/[\s\-_.]+/g, "");
    if (!NAME_TO_IDKAB_MAP.has(spaceless)) {
      NAME_TO_IDKAB_MAP.set(spaceless, idKab);
    }
  }
}

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
  NAME_TO_IDKAB_MAP.set(alias, idKab);
  NAME_TO_IDKAB_MAP.set(alias.replace(/\s+/g, ""), idKab);
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
  const norm = name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");

  if (!norm) return null;

  // Direct lookup
  let idKab = NAME_TO_IDKAB_MAP.get(norm);
  if (!idKab) {
    // Strip prefixes
    const stripped = norm.replace(/^(kabupaten|kab|kota|adm\.?|administrasi)\s+/i, "").trim();
    idKab = NAME_TO_IDKAB_MAP.get(stripped);

    // Spaceless lookup e.g. "gunung kidul" -> "gunungkidul"
    if (!idKab) {
      const spaceless = stripped.replace(/[\s\-_.]+/g, "");
      idKab = NAME_TO_IDKAB_MAP.get(spaceless);
    }

    // Token containment (e.g. "toba samosir" contains "toba")
    if (!idKab) {
      const tokens = stripped.split(" ");
      for (const t of tokens) {
        if (t.length >= 4 && NAME_TO_IDKAB_MAP.has(t)) {
          idKab = NAME_TO_IDKAB_MAP.get(t);
          break;
        }
      }
    }
  }

  if (idKab) {
    const reg = WILAYAH_REGENCIES[idKab];
    if (reg) {
      if (!provCode || reg.kd_prov === String(provCode).trim().padStart(2, "0")) {
        return reg;
      }
    }
  }

  return null;
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
  const p1 = extractProvCode(row1);
  const p2 = extractProvCode(row2);

  const reg1 = resolveRegency(val1, p1);
  const reg2 = resolveRegency(val2, p2);

  if (reg1 && reg2) {
    return reg1.id_kab === reg2.id_kab;
  }

  return null;
}

/**
 * Detects semantic role for Indonesian wilayah column names.
 */
export function detectWilayahColumnRole(columnName: string): string | null {
  const c = columnName.toLowerCase().trim().replace(/[_\-.]/g, "");

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
    if (role === "PROV_CODE" && v !== null && v !== undefined) {
      const s = String(v).trim();
      if (/^\d{1,2}$/.test(s)) {
        return s.padStart(2, "0");
      }
    }
  }
  return null;
}
