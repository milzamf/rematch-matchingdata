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
