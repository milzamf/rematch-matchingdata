<?php

namespace App\Services\Matching;

class EntityNameParser
{
    /**
     * @return array<string, mixed>
     */
    public function parse(mixed $value): array
    {
        $rawName = trim((string) ($value ?? ''));
        $normalized = $this->normalizeText($rawName);
        [$unitType, $unitName, $withoutUnit] = $this->extractUnit($normalized);

        $legalForm = $this->firstToken($withoutUnit, [
            'pt' => 'PT',
            'cv' => 'CV',
            'firma' => 'Firma',
            'fa' => 'Firma',
            'ud' => 'UD',
            'koperasi' => 'Koperasi',
        ]);
        $ownershipQualifier = $this->firstToken($withoutUnit, [
            'persero' => 'Persero',
            'perseroda' => 'Perseroda',
            'perum' => 'Perum',
            'bumd' => 'BUMD',
            'bumn' => 'BUMN',
        ]);
        $publicStatus = $this->firstToken($withoutUnit, [
            'tbk' => 'Tbk',
            'terbuka' => 'Terbuka',
        ]);

        $coreName = $this->removeEntityMetadata($withoutUnit);

        return [
            'raw_name' => $rawName,
            'core_name' => $coreName,
            'legal_form' => $legalForm,
            'ownership_status_qualifier' => $ownershipQualifier,
            'public_status' => $publicStatus,
            'unit_type' => $unitType,
            'unit_name' => $unitName,
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

        $strictForms = ['PT', 'CV'];

        return in_array($referenceLegalForm, $strictForms, true)
            && in_array($inputLegalForm, $strictForms, true)
            && $referenceLegalForm !== $inputLegalForm;
    }

    public function normalizeLegalForm(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $str = mb_strtolower(trim((string) $value));

        // Exact code or text matches
        if (in_array($str, ['1', '01', 'pt', 'perseroan terbatas'], true) || str_contains($str, 'perseroan terbatas') || str_contains($str, 'pt perorangan')) {
            return 'PT';
        }
        if (in_array($str, ['2', '02'], true)) {
            return 'PT';
        }
        if (in_array($str, ['3', '03', 'cv'], true) || str_contains($str, 'komanditer') || str_contains($str, 'commandit')) {
            return 'CV';
        }
        if (in_array($str, ['4', '04', 'fa', 'firma'], true) || str_contains($str, 'firma')) {
            return 'Firma';
        }
        if (in_array($str, ['5', '05', 'koperasi'], true) || str_contains($str, 'koperasi')) {
            return 'Koperasi';
        }
        if (in_array($str, ['6', '06', 'yayasan'], true) || str_contains($str, 'yayasan')) {
            return 'Yayasan';
        }
        if (in_array($str, ['7', '07', 'bumn', 'bumd', 'perum'], true) || str_contains($str, 'bumn') || str_contains($str, 'bumd')) {
            return 'BUMN';
        }
        if (in_array($str, ['8', '08', 'ud', 'usaha dagang', 'perorangan'], true) || str_contains($str, 'usaha dagang') || str_contains($str, 'perorangan')) {
            return 'Perorangan';
        }

        // Regex boundary match
        if (preg_match('/\b(pt|perseroan)\b/i', $str)) {
            return 'PT';
        }
        if (preg_match('/\b(cv|komanditer)\b/i', $str)) {
            return 'CV';
        }
        if (preg_match('/\b(fa|firma)\b/i', $str)) {
            return 'Firma';
        }
        if (preg_match('/\b(ud)\b/i', $str)) {
            return 'UD';
        }

        return null;
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
        $metadataTokens = [
            'pt',
            'cv',
            'firma',
            'fa',
            'ud',
            'koperasi',
            'persero',
            'perseroda',
            'perum',
            'bumd',
            'bumn',
            'tbk',
            'terbuka',
        ];

        $core = preg_replace('/\b('.implode('|', array_map(fn (string $token) => preg_quote($token, '/'), $metadataTokens)).')\b/u', ' ', $value) ?? $value;
        $core = preg_replace('/\s+/', ' ', $core) ?? $core;

        return trim($core);
    }
}
