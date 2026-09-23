<?php

namespace App\Services\Matching;

class EntityNameParser
{
    /**
     * Master Legal Entity Dictionary mapping normalized tokens/phrases to canonical legal forms.
     * Derived from D:\AI\Tools\kamus_badan_usaha.md
     *
     * @var array<string, string>
     */
    public const LEGAL_ENTITY_MAP = [
        // 1. Perseroan Terbatas (PT)
        'perseroan terbatas' => 'PT',
        'perseroan perorangan' => 'PT',
        'pt perorangan' => 'PT',
        'perseroan' => 'PT',
        'p t' => 'PT',
        'pt' => 'PT',

        // 2. Commanditaire Vennootschap (CV)
        'commanditaire vennootschap' => 'CV',
        'commanditer vennootschap' => 'CV',
        'commanditaire venoschaap' => 'CV',
        'commanditer venoschaap' => 'CV',
        'persekutuan komanditer' => 'CV',
        'komanditer' => 'CV',
        'c v' => 'CV',
        'cv' => 'CV',

        // 3. Firma (Fa)
        'persekutuan firma' => 'Firma',
        'firma' => 'Firma',
        'f a' => 'Firma',
        'fa' => 'Firma',

        // 4. Usaha Dagang (UD)
        'usaha dagang' => 'UD',
        'u d' => 'UD',
        'ud' => 'UD',

        // 5. Perusahaan Dagang (PD)
        'perusahaan dagang' => 'PD',
        'p d' => 'PD',
        'pd' => 'PD',

        // 6. Koperasi
        'koperasi simpan pinjam' => 'Koperasi',
        'koperasi serba usaha' => 'Koperasi',
        'koperasi unit desa' => 'Koperasi',
        'koperasi pegawai republik indonesia' => 'Koperasi',
        'koperasi karyawan' => 'Koperasi',
        'koperasi pasar' => 'Koperasi',
        'koperasi' => 'Koperasi',
        'kopti' => 'Koperasi',
        'kopkar' => 'Koperasi',
        'koppas' => 'Koperasi',
        'kpri' => 'Koperasi',
        'k s p' => 'Koperasi',
        'ksp' => 'Koperasi',
        'k u d' => 'Koperasi',
        'kud' => 'Koperasi',
        'k s u' => 'Koperasi',
        'ksu' => 'Koperasi',
        'kop' => 'Koperasi',

        // 7. Yayasan
        'yayasan' => 'Yayasan',
        'yys' => 'Yayasan',
        'ysn' => 'Yayasan',

        // 8. BUMN / BUMD / Pemerintah
        'perusahaan daerah air minum' => 'PDAM',
        'p d a m' => 'PDAM',
        'pdam' => 'PDAM',
        'perusahaan umum daerah' => 'Perumda',
        'perumda' => 'Perumda',
        'perusahaan perseroan daerah' => 'Perseroda',
        'perseroan daerah' => 'Perseroda',
        'pt perseroda' => 'Perseroda',
        'perseroda' => 'Perseroda',
        'perusahaan umum' => 'Perum',
        'perum' => 'Perum',
        'badan usaha milik desa bersama' => 'BUMDes',
        'badan usaha milik desa' => 'BUMDes',
        'bum desa' => 'BUMDes',
        'bum des' => 'BUMDes',
        'bumdesma' => 'BUMDes',
        'bumdesa' => 'BUMDes',
        'bumdes' => 'BUMDes',
        'badan usaha milik daerah' => 'BUMD',
        'b u m d' => 'BUMD',
        'bumd' => 'BUMD',
        'badan usaha milik negara' => 'BUMN',
        'b u m n' => 'BUMN',
        'bumn' => 'BUMN',

        // 9. Bentuk Khusus Lainnya
        'perusahaan otobus' => 'PO',
        'perusahaan perseorangan' => 'PO',
        'p o' => 'PO',
        'po' => 'PO',
        'kelompok usaha bersama' => 'UB',
        'usaha bersama' => 'UB',
        'k u b' => 'UB',
        'kub' => 'UB',
        'u b' => 'UB',
        'ub' => 'UB',
        'persekutuan perdata' => 'Maatschap',
        'maatschap' => 'Maatschap',
        'mts' => 'Maatschap',
        'bentuk usaha tetap' => 'BUT',
        'b u t' => 'BUT',
        'but' => 'BUT',
        'kantor perwakilan perusahaan asing' => 'KPPA',
        'kantor perwakilan perdagangan asing' => 'KPPA',
        'representative office' => 'KPPA',
        'kppa' => 'KPPA',
        'kppka' => 'KPPA',
        'usaha perseorangan' => 'Perorangan',
        'usaha perorangan' => 'Perorangan',
        'perseorangan' => 'Perorangan',
        'perorangan' => 'Perorangan',

        // 10. Asing / Multinasional
        'private limited' => 'Pte Ltd',
        'pte ltd' => 'Pte Ltd',
        'sendirian berhad' => 'Sdn Bhd',
        'sdn bhd' => 'Sdn Bhd',
        'berhad' => 'Bhd',
        'bhd' => 'Bhd',
        'company limited' => 'Co Ltd',
        'co ltd' => 'Co Ltd',
        'limited liability company' => 'LLC',
        'l l c' => 'LLC',
        'llc' => 'LLC',
        'limited liability partnership' => 'LLP',
        'l l p' => 'LLP',
        'llp' => 'LLP',
        'limited' => 'Ltd',
        'ltd' => 'Ltd',
        'incorporated' => 'Inc',
        'inc' => 'Inc',
        'corporation' => 'Corp',
        'corp' => 'Corp',
        'gesellschaft mit beschraenkter haftung' => 'GmbH',
        'gesellschaft mit beschrankter haftung' => 'GmbH',
        'gmbh' => 'GmbH',
        'aktiengesellschaft' => 'AG',
        'ag' => 'AG',
        'sociedad anonima' => 'SA',
        'societe anonyme' => 'SA',
        's a' => 'SA',
        'sa' => 'SA',
        'societa a responsabilita limitata' => 'SRL',
        's r l' => 'SRL',
        'srl' => 'SRL',
        'besloten vennootschap' => 'BV',
        'b v' => 'BV',
        'bv' => 'BV',
        'naamloze vennootschap' => 'NV',
        'n v' => 'NV',
        'nv' => 'NV',
        'kabushiki kaisha' => 'KK',
        'k k' => 'KK',
        'kk' => 'KK',
    ];

    /**
     * Entities classified as Badan Hukum.
     *
     * @var array<int, string>
     */
    public const BADAN_HUKUM_SET = [
        'PT',
        'Koperasi',
        'Yayasan',
        'Perum',
        'Perumda',
        'Perseroda',
        'PDAM',
        'BUMDes',
        'Ltd',
        'Pte Ltd',
        'Sdn Bhd',
        'Bhd',
        'Co Ltd',
        'Inc',
        'Corp',
        'LLC',
        'GmbH',
        'AG',
        'SA',
        'SRL',
        'BV',
        'NV',
    ];

    /**
     * Cached sorted legal tokens (longest phrase first).
     *
     * @var array<string, string>|null
     */
    private static ?array $sortedLegalTokens = null;

    /**
     * @return array<string, mixed>
     */
    public function parse(mixed $value): array
    {
        $rawName = trim((string) ($value ?? ''));
        $normalized = $this->normalizeText($rawName);
        [$unitType, $unitName, $withoutUnit] = $this->extractUnit($normalized);

        $publicStatus = $this->firstToken($withoutUnit, [
            'tbk' => 'Tbk',
            'terbuka' => 'Terbuka',
        ]);

        $ownershipQualifier = $this->firstToken($withoutUnit, [
            'perseroan daerah' => 'Perseroda',
            'pt perseroda' => 'Perseroda',
            'perseroda' => 'Perseroda',
            'perusahaan umum daerah' => 'Perumda',
            'perumda' => 'Perumda',
            'perusahaan umum' => 'Perum',
            'perum' => 'Perum',
            'badan usaha milik desa bersama' => 'BUMDes',
            'badan usaha milik desa' => 'BUMDes',
            'bum desa' => 'BUMDes',
            'bum des' => 'BUMDes',
            'bumdesma' => 'BUMDes',
            'bumdesa' => 'BUMDes',
            'bumdes' => 'BUMDes',
            'badan usaha milik daerah' => 'BUMD',
            'bumd' => 'BUMD',
            'badan usaha milik negara' => 'BUMN',
            'bumn' => 'BUMN',
            'persero' => 'Persero',
        ]);

        $legalForm = null;
        foreach ($this->getSortedLegalTokens() as $token => $canonical) {
            if (preg_match('/\b'.preg_quote($token, '/').'\b/u', $withoutUnit) === 1) {
                $legalForm = $canonical;
                break;
            }
        }

        $coreName = $this->removeEntityMetadata($withoutUnit);

        return [
            'raw_name' => $rawName,
            'core_name' => $coreName,
            'legal_form' => $legalForm,
            'ownership_status_qualifier' => $ownershipQualifier,
            'public_status' => $publicStatus,
            'unit_type' => $unitType,
            'unit_name' => $unitName,
            'is_legal_entity' => $this->isBadanHukum($legalForm),
        ];
    }

    public function isEntityNameColumn(string $columnName): bool
    {
        $normalized = $this->normalizeText($columnName);

        foreach (['nama', 'name', 'company', 'perusahaan', 'entity', 'entitas', 'vendor', 'customer', 'client', 'instansi', 'organisasi', 'organization'] as $keyword) {
            if (str_contains($normalized, $keyword)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $metadata
     */
    public function hasEntityMetadata(array $metadata): bool
    {
        return ($metadata['legal_form'] ?? null) !== null
            || ($metadata['ownership_status_qualifier'] ?? null) !== null
            || ($metadata['public_status'] ?? null) !== null
            || ($metadata['unit_type'] ?? null) !== null
            || ($metadata['unit_name'] ?? null) !== null;
    }

    /**
     * @param array<string, mixed>|null $reference
     * @param array<string, mixed>|null $input
     */
    public function hasStrictLegalConflict(?array $reference, ?array $input): bool
    {
        $referenceLegalForm = $reference['legal_form'] ?? null;
        $inputLegalForm = $input['legal_form'] ?? null;

        if (! is_string($referenceLegalForm) || ! is_string($inputLegalForm)) {
            return false;
        }

        $strictForms = ['PT', 'CV', 'UD', 'PD', 'Firma', 'Koperasi', 'Yayasan'];

        return in_array($referenceLegalForm, $strictForms, true)
            && in_array($inputLegalForm, $strictForms, true)
            && $referenceLegalForm !== $inputLegalForm;
    }

    public function isBadanHukum(?string $legalForm): bool
    {
        if ($legalForm === null) {
            return false;
        }

        return in_array($legalForm, self::BADAN_HUKUM_SET, true);
    }

    public function normalizeLegalForm(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $rawStr = trim((string) $value);
        if ($rawStr === '') {
            return null;
        }

        $str = mb_strtolower($rawStr);

        // 1. Direct standard BPS / OSS Survey numeric or zero-padded codes
        if (in_array($str, ['1', '01'], true)) {
            return 'PT';
        }
        if (in_array($str, ['2', '02'], true)) {
            return 'PT';
        }
        if (in_array($str, ['3', '03'], true)) {
            return 'CV';
        }
        if (in_array($str, ['4', '04'], true)) {
            return 'Firma';
        }
        if (in_array($str, ['5', '05'], true)) {
            return 'Koperasi';
        }
        if (in_array($str, ['6', '06'], true)) {
            return 'Yayasan';
        }
        if (in_array($str, ['7', '07'], true)) {
            return 'BUMN';
        }
        if (in_array($str, ['8', '08'], true)) {
            return 'Perorangan';
        }

        // 2. Normalized text lookup
        $normalized = $this->normalizeText($str);
        if ($normalized === '') {
            return null;
        }

        // Exact match in dictionary
        if (isset(self::LEGAL_ENTITY_MAP[$normalized])) {
            return self::LEGAL_ENTITY_MAP[$normalized];
        }

        // Search through patterns from longest token to shortest
        foreach ($this->getSortedLegalTokens() as $token => $canonical) {
            if (preg_match('/\b'.preg_quote($token, '/').'\b/u', $normalized) === 1) {
                return $canonical;
            }
        }

        return null;
    }

    /**
     * Returns tokens sorted from longest string length to shortest.
     *
     * @return array<string, string>
     */
    public function getSortedLegalTokens(): array
    {
        if (self::$sortedLegalTokens !== null) {
            return self::$sortedLegalTokens;
        }

        $tokens = self::LEGAL_ENTITY_MAP;
        uksort($tokens, fn (string $a, string $b) => mb_strlen($b) <=> mb_strlen($a));

        self::$sortedLegalTokens = $tokens;

        return self::$sortedLegalTokens;
    }

    /**
     * Returns full legal entity master definitions for reference / UI consumption.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getLegalEntityDictionary(): array
    {
        return [
            [
                'no' => 1,
                'canonical' => 'PT',
                'full_name' => 'Perseroan Terbatas',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'UU No. 40 Tahun 2007 jo. UU No. 6 Tahun 2023 Cipta Kerja',
                'aliases' => ['PT', 'P.T.', 'PT.', 'Perseroan Terbatas', 'Perseroan', 'P T'],
            ],
            [
                'no' => 2,
                'canonical' => 'PT',
                'sub_form' => 'PT Perorangan',
                'full_name' => 'Perseroan Perorangan',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'PP No. 8 Tahun 2021',
                'aliases' => ['PT Perorangan', 'Perseroan Perorangan', 'PT. Perorangan'],
            ],
            [
                'no' => 3,
                'canonical' => 'CV',
                'full_name' => 'Commanditaire Vennootschap / Persekutuan Komanditer',
                'origin' => 'Belanda',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'KUHD Pasal 19–21',
                'aliases' => ['CV', 'C.V.', 'CV.', 'Commanditaire Vennootschap', 'Persekutuan Komanditer', 'Komanditer', 'C V'],
            ],
            [
                'no' => 4,
                'canonical' => 'Firma',
                'full_name' => 'Persekutuan Firma',
                'origin' => 'Italia / Belanda',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'KUHD Pasal 16–18',
                'aliases' => ['Fa', 'Fa.', 'FA', 'Firma', 'Persekutuan Firma'],
            ],
            [
                'no' => 5,
                'canonical' => 'UD',
                'full_name' => 'Usaha Dagang',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'Kebiasaan Dagang / Izin Pemda',
                'aliases' => ['UD', 'U.D.', 'UD.', 'Usaha Dagang', 'U D'],
            ],
            [
                'no' => 6,
                'canonical' => 'PD',
                'full_name' => 'Perusahaan Dagang',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'Kebiasaan Dagang',
                'aliases' => ['PD', 'P.D.', 'PD.', 'Perusahaan Dagang', 'P D'],
            ],
            [
                'no' => 7,
                'canonical' => 'Koperasi',
                'full_name' => 'Koperasi',
                'origin' => 'Inggris (Cooperative)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'UU No. 25 Tahun 1992',
                'aliases' => ['Koperasi', 'Kop', 'Kop.', 'KSP', 'K.S.P.', 'KSU', 'K.S.U.', 'KUD', 'K.U.D.', 'Koppas', 'KPRI', 'Kokarfi'],
            ],
            [
                'no' => 8,
                'canonical' => 'Yayasan',
                'full_name' => 'Yayasan',
                'origin' => 'Belanda (Stichting)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'UU No. 16/2001 jo. UU No. 28/2004',
                'aliases' => ['Yayasan', 'Yys', 'Yys.', 'Ysn', 'Ysn.'],
            ],
            [
                'no' => 9,
                'canonical' => 'Perum',
                'full_name' => 'Perusahaan Umum',
                'origin' => 'Indonesia (BUMN/BUMD)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'UU No. 19 Tahun 2003',
                'aliases' => ['Perum', 'Perum.', 'Perusahaan Umum'],
            ],
            [
                'no' => 10,
                'canonical' => 'Persero',
                'full_name' => 'Perusahaan Perseroan (BUMN)',
                'origin' => 'Indonesia (BUMN)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'UU No. 19 Tahun 2003',
                'aliases' => ['(Persero)', 'Persero', 'PT (Persero)', 'PT. (Persero)'],
            ],
            [
                'no' => 11,
                'canonical' => 'Tbk',
                'full_name' => 'Perseroan Terbuka (Pasar Modal)',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'UU No. 8 Tahun 1995',
                'aliases' => ['Tbk', 'Tbk.', 'Terbuka', '(Tbk)', '(Tbk.)'],
            ],
            [
                'no' => 12,
                'canonical' => 'Perumda',
                'full_name' => 'Perusahaan Umum Daerah',
                'origin' => 'Indonesia (BUMD)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'PP No. 54 Tahun 2017',
                'aliases' => ['Perumda', 'Perumda.', 'Perusahaan Umum Daerah'],
            ],
            [
                'no' => 13,
                'canonical' => 'Perseroda',
                'full_name' => 'Perusahaan Perseroan Daerah',
                'origin' => 'Indonesia (BUMD)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'PP No. 54 Tahun 2017',
                'aliases' => ['Perseroda', 'Perseroda.', 'PT Perseroda'],
            ],
            [
                'no' => 14,
                'canonical' => 'PDAM',
                'full_name' => 'Perusahaan Daerah Air Minum',
                'origin' => 'Indonesia (BUMD)',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'Perda / PP No. 54 Tahun 2017',
                'aliases' => ['PDAM', 'P.D.A.M.', 'Perusahaan Daerah Air Minum'],
            ],
            [
                'no' => 15,
                'canonical' => 'BUMD',
                'full_name' => 'Badan Usaha Milik Daerah',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Suffix / Prefix',
                'legal_basis' => 'UU No. 23 Tahun 2014',
                'aliases' => ['BUMD', 'B.U.M.D.', 'Badan Usaha Milik Daerah'],
            ],
            [
                'no' => 16,
                'canonical' => 'BUMN',
                'full_name' => 'Badan Usaha Milik Negara',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Suffix / Prefix',
                'legal_basis' => 'UU No. 19 Tahun 2003',
                'aliases' => ['BUMN', 'B.U.M.N.', 'Badan Usaha Milik Negara'],
            ],
            [
                'no' => 17,
                'canonical' => 'BUMDes',
                'full_name' => 'Badan Usaha Milik Desa',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix',
                'legal_basis' => 'PP No. 11 Tahun 2021',
                'aliases' => ['BUMDes', 'BUMDesa', 'BUM-Des', 'BUM Desa', 'BUMDesma'],
            ],
            [
                'no' => 18,
                'canonical' => 'PO',
                'full_name' => 'Perusahaan Otobus / Perseorangan',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'Kebiasaan Dagang / Dishub',
                'aliases' => ['PO', 'P.O.', 'PO.', 'Perusahaan Otobus', 'Perusahaan Perseorangan'],
            ],
            [
                'no' => 19,
                'canonical' => 'UB',
                'full_name' => 'Usaha Bersama',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'Kebiasaan Dagang',
                'aliases' => ['UB', 'U.B.', 'UB.', 'Usaha Bersama', 'KUB'],
            ],
            [
                'no' => 20,
                'canonical' => 'Maatschap',
                'full_name' => 'Persekutuan Perdata',
                'origin' => 'Belanda (Burgerlijke Maatschap)',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'KUHPerdata Pasal 1618–1652',
                'aliases' => ['Maatschap', 'Persekutuan Perdata', 'Mts'],
            ],
            [
                'no' => 21,
                'canonical' => 'BUT',
                'full_name' => 'Bentuk Usaha Tetap',
                'origin' => 'Internasional (Permanent Establishment)',
                'category' => 'khusus',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'UU Pajak Penghasilan (PPh)',
                'aliases' => ['BUT', 'B.U.T.', 'Bentuk Usaha Tetap'],
            ],
            [
                'no' => 22,
                'canonical' => 'KPPA',
                'full_name' => 'Kantor Perwakilan Perusahaan Asing',
                'origin' => 'Internasional (Representative Office)',
                'category' => 'khusus',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'Peraturan BKPM',
                'aliases' => ['KPPA', 'KPPKA', 'Representative Office', 'RO'],
            ],
            [
                'no' => 23,
                'canonical' => 'Perorangan',
                'full_name' => 'Usaha Perseorangan / Informal',
                'origin' => 'Indonesia',
                'category' => 'domestik',
                'is_legal_entity' => false,
                'typical_position' => 'Prefix',
                'legal_basis' => 'IUMK / NIB Perseorangan',
                'aliases' => ['Perorangan', 'Perseorangan', 'Usaha Perseorangan', 'Usaha Perorangan'],
            ],
            // Asing / Internasional
            [
                'no' => 24,
                'canonical' => 'Ltd',
                'full_name' => 'Limited',
                'origin' => 'UK / Commonwealth / Hong Kong',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['Ltd', 'Ltd.', 'Limited'],
            ],
            [
                'no' => 25,
                'canonical' => 'Pte Ltd',
                'full_name' => 'Private Limited Company',
                'origin' => 'Singapura / Afrika Selatan',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT Tertutup di RI',
                'aliases' => ['Pte Ltd', 'Pte. Ltd.', 'Private Limited'],
            ],
            [
                'no' => 26,
                'canonical' => 'Sdn Bhd',
                'full_name' => 'Sendirian Berhad',
                'origin' => 'Malaysia',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT Tertutup di RI',
                'aliases' => ['Sdn Bhd', 'Sdn. Bhd.', 'Sendirian Berhad'],
            ],
            [
                'no' => 27,
                'canonical' => 'Bhd',
                'full_name' => 'Berhad',
                'origin' => 'Malaysia',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT Terbuka (Tbk) di RI',
                'aliases' => ['Bhd', 'Bhd.', 'Berhad'],
            ],
            [
                'no' => 28,
                'canonical' => 'Inc',
                'full_name' => 'Incorporated',
                'origin' => 'Amerika Serikat / Filipina',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara Korporasi / PT di RI',
                'aliases' => ['Inc', 'Inc.', 'Incorporated'],
            ],
            [
                'no' => 29,
                'canonical' => 'Corp',
                'full_name' => 'Corporation',
                'origin' => 'Amerika Serikat / Global',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara Korporasi / PT di RI',
                'aliases' => ['Corp', 'Corp.', 'Corporation'],
            ],
            [
                'no' => 30,
                'canonical' => 'LLC',
                'full_name' => 'Limited Liability Company',
                'origin' => 'Amerika Serikat / Timur Tengah',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['LLC', 'L.L.C.', 'Limited Liability Company'],
            ],
            [
                'no' => 31,
                'canonical' => 'LLP',
                'full_name' => 'Limited Liability Partnership',
                'origin' => 'UK / Amerika Serikat / Singapura',
                'category' => 'asing',
                'is_legal_entity' => false,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Hibrida CV & Firma Modern',
                'aliases' => ['LLP', 'L.L.P.', 'Limited Liability Partnership'],
            ],
            [
                'no' => 32,
                'canonical' => 'GmbH',
                'full_name' => 'Gesellschaft mit beschränkter Haftung',
                'origin' => 'Jerman / Austria / Swiss',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['GmbH', 'Gesellschaft mit beschränkter Haftung'],
            ],
            [
                'no' => 33,
                'canonical' => 'AG',
                'full_name' => 'Aktiengesellschaft',
                'origin' => 'Jerman / Austria / Swiss',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT Terbuka di RI',
                'aliases' => ['AG', 'Aktiengesellschaft'],
            ],
            [
                'no' => 34,
                'canonical' => 'SA',
                'full_name' => 'Sociedad Anónima / Société Anonyme',
                'origin' => 'Spanyol / Perancis / Amerika Latin',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['SA', 'S.A.', 'Sociedad Anónima', 'Société Anonyme'],
            ],
            [
                'no' => 35,
                'canonical' => 'SRL',
                'full_name' => 'Società a responsabilità limitata',
                'origin' => 'Italia / Rumania',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['SRL', 'S.r.l.', 'Società a responsabilità limitata'],
            ],
            [
                'no' => 36,
                'canonical' => 'BV',
                'full_name' => 'Besloten Vennootschap',
                'origin' => 'Belanda',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix / Prefix',
                'legal_basis' => 'Setara PT Tertutup di RI',
                'aliases' => ['BV', 'B.V.', 'Besloten Vennootschap'],
            ],
            [
                'no' => 37,
                'canonical' => 'NV',
                'full_name' => 'Naamloze Vennootschap',
                'origin' => 'Belanda (Kolonial)',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Prefix / Suffix',
                'legal_basis' => 'Setara PT Terbuka di RI',
                'aliases' => ['NV', 'N.V.', 'Naamloze Vennootschap'],
            ],
            [
                'no' => 38,
                'canonical' => 'Co Ltd',
                'full_name' => 'Company Limited',
                'origin' => 'Jepang / Korea / Tiongkok / Global',
                'category' => 'asing',
                'is_legal_entity' => true,
                'typical_position' => 'Suffix',
                'legal_basis' => 'Setara PT di RI',
                'aliases' => ['Co., Ltd.', 'Co Ltd', 'Company Limited'],
            ],
        ];
    }

    private function normalizeText(string $value): string
    {
        $text = mb_strtolower($value);
        $text = preg_replace('/[^\pL\pN\s]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        return trim($text);
    }

    /**
     * @param array<string, string> $tokens
     */
    private function firstToken(string $value, array $tokens): ?string
    {
        foreach ($tokens as $token => $label) {
            if (preg_match('/\b'.preg_quote($token, '/').'\b/u', $value) === 1) {
                return $label;
            }
        }

        return null;
    }

    /**
     * @return array{0: string|null, 1: string|null, 2: string}
     */
    private function extractUnit(string $value): array
    {
        $unitPatterns = [
            'kantor cabang pembantu' => 'KCP',
            'kantor cabang utama' => 'KCU',
            'kantor cabang' => 'Kantor Cabang',
            'cabang' => 'Cabang',
            'branch' => 'Branch',
            'unit' => 'Unit',
            'divisi' => 'Divisi',
            'division' => 'Division',
            'wilayah' => 'Wilayah',
            'regional' => 'Regional',
            'departemen' => 'Departemen',
            'department' => 'Department',
            'kcu' => 'KCU',
            'kcp' => 'KCP',
            'kantor' => 'Kantor',
        ];

        foreach ($unitPatterns as $pattern => $label) {
            if (preg_match('/\b'.preg_quote($pattern, '/').'\b\s*(.*)$/u', $value, $matches) !== 1) {
                continue;
            }

            $unitName = trim($matches[1] ?? '');
            $withoutUnit = trim(preg_replace('/\b'.preg_quote($pattern, '/').'\b\s*.*$/u', ' ', $value) ?? $value);
            $withoutUnit = preg_replace('/\s+/', ' ', $withoutUnit) ?? $withoutUnit;

            return [$label, $unitName !== '' ? $unitName : null, trim($withoutUnit)];
        }

        return [null, null, $value];
    }

    private function removeEntityMetadata(string $value): string
    {
        $text = $value;

        // 1. Remove public status tokens
        $text = preg_replace('/\b(tbk|terbuka)\b/u', ' ', $text) ?? $text;

        // 2. Remove ownership qualifier tokens
        $text = preg_replace('/\b(perseroan daerah|pt perseroda|perseroda|perusahaan umum daerah|perumda|perusahaan umum|perum|badan usaha milik desa bersama|badan usaha milik desa|bum desa|bum des|bumdesma|bumdesa|bumdes|badan usaha milik daerah|bumd|badan usaha milik negara|bumn|perusahaan daerah air minum|pdam|persero)\b/u', ' ', $text) ?? $text;

        // 3. Remove legal forms from longest token phrase to shortest
        foreach ($this->getSortedLegalTokens() as $token => $canonical) {
            $text = preg_replace('/\b'.preg_quote($token, '/').'\b/u', ' ', $text) ?? $text;
        }

        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        return trim($text);
    }
}
