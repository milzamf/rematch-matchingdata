<?php

namespace App\Services\Matching;

use Illuminate\Support\Str;

class WilayahDictionaryService
{
    /** @var array<string, array<string, mixed>>|null */
    private static ?array $provinces = null;

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $regencies = null;

    /** @var array<string, string>|null */
    private static ?array $nameToProvCode = null;

    /** @var array<string, string>|null */
    private static ?array $nameToIdKab = null;

    public function __construct()
    {
        $this->ensureLoaded();
    }

    private function ensureLoaded(): void
    {
        if (self::$provinces !== null && self::$regencies !== null) {
            return;
        }

        $baseDir = storage_path('app/wilayah');
        $provFile = $baseDir . '/provinces.json';
        $regFile = $baseDir . '/regencies.json';

        if (file_exists($provFile)) {
            self::$provinces = json_decode(file_get_contents($provFile), true) ?? [];
        } else {
            self::$provinces = [];
        }

        if (file_exists($regFile)) {
            self::$regencies = json_decode(file_get_contents($regFile), true) ?? [];
        } else {
            self::$regencies = [];
        }

        self::$nameToProvCode = [];
        foreach (self::$provinces as $kdProv => $data) {
            $nmProv = mb_strtolower(trim((string) ($data['nm_prov'] ?? '')));
            if ($nmProv !== '') {
                self::$nameToProvCode[$nmProv] = (string) $kdProv;
                self::$nameToProvCode['provinsi ' . $nmProv] = (string) $kdProv;
                self::$nameToProvCode['prov. ' . $nmProv] = (string) $kdProv;
                self::$nameToProvCode['prov ' . $nmProv] = (string) $kdProv;
            }
        }

        self::$nameToIdKab = [];
        foreach (self::$regencies as $idKab => $data) {
            $nmKab = mb_strtolower(trim((string) ($data['nm_kab'] ?? '')));
            if ($nmKab !== '') {
                // Key by exact clean name e.g. 'sidoarjo'
                if (!isset(self::$nameToIdKab[$nmKab])) {
                    self::$nameToIdKab[$nmKab] = (string) $idKab;
                }
                // Key by with kab/kota prefix e.g. 'kabupaten sidoarjo', 'kab sidoarjo', 'kota surabaya'
                self::$nameToIdKab['kabupaten ' . $nmKab] = (string) $idKab;
                self::$nameToIdKab['kab. ' . $nmKab] = (string) $idKab;
                self::$nameToIdKab['kab ' . $nmKab] = (string) $idKab;
                self::$nameToIdKab['kota ' . $nmKab] = (string) $idKab;
            }
        }
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public function getProvinces(): array
    {
        $this->ensureLoaded();
        return self::$provinces ?? [];
    }

    /**
     * Resolve a province record by code, name, or bracket composite e.g. "[11] ACEH", "11", "Aceh".
     */
    public function resolveProvince(mixed $value): ?array
    {
        $this->ensureLoaded();
        if ($value === null) {
            return null;
        }

        $str = trim((string) $value);
        if ($str === '') {
            return null;
        }

        // 1. Bracket composite format e.g. "[11] ACEH" or "[11] - ACEH"
        if (preg_match('/^\[?(\d{2})\]?[\s\-:]*(.*)$/', $str, $matches)) {
            $code = $matches[1];
            if (isset(self::$provinces[$code])) {
                return self::$provinces[$code];
            }
            $name = trim($matches[2]);
            if ($name !== '') {
                $normName = mb_strtolower($name);
                if (isset(self::$nameToProvCode[$normName])) {
                    return self::$provinces[self::$nameToProvCode[$normName]] ?? null;
                }
            }
        }

        // 2. Direct 2-digit code e.g. "11" or "35"
        $cleanCode = str_pad($str, 2, '0', STR_PAD_LEFT);
        if (isset(self::$provinces[$cleanCode])) {
            return self::$provinces[$cleanCode];
        }

        // 3. Name lookup e.g. "Aceh", "Jawa Timur", "Provinsi Aceh"
        $norm = mb_strtolower($str);
        $norm = preg_replace('/^(provinsi|prov\.?|propinsi)\s+/i', '', $norm) ?? $norm;
        $norm = trim($norm);
        if (isset(self::$nameToProvCode[$norm])) {
            return self::$provinces[self::$nameToProvCode[$norm]] ?? null;
        }

        return null;
    }

    public function compareProvinces(mixed $val1, mixed $val2): ?bool
    {
        $prov1 = $this->resolveProvince($val1);
        $prov2 = $this->resolveProvince($val2);

        if ($prov1 !== null && $prov2 !== null) {
            return $prov1['kd_prov'] === $prov2['kd_prov'];
        }

        return null;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public function getRegencies(): array
    {
        $this->ensureLoaded();
        return self::$regencies ?? [];
    }

    /**
     * Resolve a regency record by code or composite (prov + kab).
     */
    public function resolveRegencyCode(string $code, ?string $provCode = null): ?array
    {
        $this->ensureLoaded();
        $code = trim($code);

        // 1. Direct 4-digit IDKAB e.g. "3515"
        if (strlen($code) === 4 && isset(self::$regencies[$code])) {
            return self::$regencies[$code];
        }

        // 2. Format with dot e.g. "35.15" (Kemendagri format)
        $cleanDot = str_replace('.', '', $code);
        if (strlen($cleanDot) === 4 && isset(self::$regencies[$cleanDot])) {
            return self::$regencies[$cleanDot];
        }

        // 3. 2-digit kab code with provCode provided e.g. prov="35", kab="15"
        if ($provCode !== null && $provCode !== '') {
            $cleanProv = str_pad(trim($provCode), 2, '0', STR_PAD_LEFT);
            $cleanKab = str_pad($code, 2, '0', STR_PAD_LEFT);
            $combined = $cleanProv . $cleanKab;
            if (isset(self::$regencies[$combined])) {
                return self::$regencies[$combined];
            }
        }

        // 4. If 2-digit and no provCode, see if it is numeric
        return null;
    }

    /**
     * Resolve a regency record by name (e.g. "Sidoarjo", "KAB. SIDOARJO", "KOTA SURABAYA").
     */
    public function findRegencyByName(string $name, ?string $provCode = null): ?array
    {
        $this->ensureLoaded();
        $norm = mb_strtolower(trim($name));
        $norm = preg_replace('/[^\pL\pN\s]+/u', ' ', $norm) ?? $norm;
        $norm = trim(preg_replace('/\s+/', ' ', $norm) ?? $norm);

        if ($norm === '') {
            return null;
        }

        // 1. Direct lookup from normalized map
        if (isset(self::$nameToIdKab[$norm])) {
            $idKab = self::$nameToIdKab[$norm];
            if ($provCode === null || str_starts_with($idKab, str_pad($provCode, 2, '0', STR_PAD_LEFT))) {
                return self::$regencies[$idKab] ?? null;
            }
        }

        // 2. Strip "kabupaten", "kab", "kota", "adm" prefixes
        $stripped = preg_replace('/^(kabupaten|kab|kota|adm\.?|administrasi)\s+/i', '', $norm) ?? $norm;
        $stripped = trim($stripped);
        if (isset(self::$nameToIdKab[$stripped])) {
            $idKab = self::$nameToIdKab[$stripped];
            if ($provCode === null || str_starts_with($idKab, str_pad($provCode, 2, '0', STR_PAD_LEFT))) {
                return self::$regencies[$idKab] ?? null;
            }
        }

        return null;
    }

    /**
     * Resolves value from a dataset row (checks whether it's code, name, or composite).
     *
     * @param mixed $value
     * @param array<string, mixed> $contextRow
     * @return array<string, mixed>|null
     */
    public function resolve(mixed $value, array $contextRow = []): ?array
    {
        if ($value === null) {
            return null;
        }

        $str = trim((string) $value);
        if ($str === '') {
            return null;
        }

        // Extract province code if available in context row
        $provCode = $this->extractProvCodeFromRow($contextRow);

        // 1. Bracket composite format e.g. "[3515] SIDOARJO", "[15] SIDOARJO", "[1101] BAKONGAN"
        if (preg_match('/^\[?(\d{2,4})\]?[\s\-:]*(.*)$/', $str, $matches)) {
            $extractedCode = $matches[1];
            $extractedName = trim($matches[2]);
            if (strlen($extractedCode) === 4) {
                $byCode = $this->resolveRegencyCode($extractedCode);
                if ($byCode !== null) {
                    return $byCode;
                }
            } elseif (strlen($extractedCode) === 2 && $provCode !== null) {
                $byCode = $this->resolveRegencyCode($extractedCode, $provCode);
                if ($byCode !== null) {
                    return $byCode;
                }
            }
            if ($extractedName !== '') {
                $byName = $this->findRegencyByName($extractedName, $provCode);
                if ($byName !== null) {
                    return $byName;
                }
            }
        }

        // 2. If numeric / code-like
        if (preg_match('/^\d{1,4}(\.\d{1,2})?$/', $str)) {
            $byCode = $this->resolveRegencyCode($str, $provCode);
            if ($byCode !== null) {
                return $byCode;
            }
        }

        // 3. Try by name
        $byName = $this->findRegencyByName($str, $provCode);
        if ($byName !== null) {
            return $byName;
        }

        return null;
    }

    /**
     * Determines if two values represent the same geographical regency.
     *
     * @param mixed $val1
     * @param mixed $val2
     * @param array<string, mixed> $row1
     * @param array<string, mixed> $row2
     * @return bool|null true if matched, false if different regencies, null if unresolved
     */
    public function compareRegencies(mixed $val1, mixed $val2, array $row1 = [], array $row2 = []): ?bool
    {
        $reg1 = $this->resolve($val1, $row1);
        $reg2 = $this->resolve($val2, $row2);

        if ($reg1 !== null && $reg2 !== null) {
            return $reg1['id_kab'] === $reg2['id_kab'];
        }

        // If at least one couldn't be resolved in MFD, return null (fallback to string compare)
        return null;
    }

    /**
     * Detects column role based on common Indonesian wilayah naming variations.
     */
    public function detectWilayahColumnRole(string $columnName): ?string
    {
        $c = mb_strtolower(trim($columnName));
        $c = str_replace(['_', '-', '.'], '', $c);

        if (in_array($c, ['idkab', 'idkabupaten', 'kodekabbps', 'kdkabbps', 'idregency'], true)) {
            return 'KAB_CODE_FULL'; // 4 digits e.g. 3515
        }

        if (in_array($c, ['kdkab', 'kodekab', 'kodekabupaten', 'kdkota', 'kodekota', 'regencycode'], true)) {
            return 'KAB_CODE_RAW'; // 2 digits e.g. 15
        }

        if (in_array($c, ['nmkab', 'namakab', 'namakabupaten', 'kabupaten', 'nmkota', 'namakota', 'kota', 'kab', 'regency', 'city'], true)) {
            return 'KAB_NAME'; // e.g. Sidoarjo
        }

        if (in_array($c, ['kdprov', 'kodeprov', 'kodeprovinsi', 'idprov', 'idprovinsi', 'provid', 'provincecode'], true)) {
            return 'PROV_CODE'; // 2 digits e.g. 35
        }

        if (in_array($c, ['nmprov', 'namaprov', 'namaprovinsi', 'provinsi', 'prov', 'propinsi', 'province'], true)) {
            return 'PROV_NAME'; // e.g. Jawa Timur
        }

        if (in_array($c, ['idkec', 'kdkec', 'kodekec', 'kodekecamatan', 'districtcode'], true)) {
            return 'KEC_CODE';
        }

        if (in_array($c, ['nmkec', 'namakec', 'namakecamatan', 'kecamatan', 'kec', 'district'], true)) {
            return 'KEC_NAME';
        }

        if (in_array($c, ['iddesa', 'kddesa', 'kodedesa', 'villagecode'], true)) {
            return 'DESA_CODE';
        }

        if (in_array($c, ['nmdesa', 'namadesa', 'desa', 'kelurahan', 'village'], true)) {
            return 'DESA_NAME';
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function extractProvCodeFromRow(array $row): ?string
    {
        foreach ($row as $k => $v) {
            $role = $this->detectWilayahColumnRole((string) $k);
            if (($role === 'PROV_CODE' || $role === 'PROV_NAME') && !empty($v)) {
                $clean = trim((string) $v);
                $prov = $this->resolveProvince($clean);
                if ($prov !== null) {
                    return $prov['kd_prov'];
                }
            }
        }

        return null;
    }
}
