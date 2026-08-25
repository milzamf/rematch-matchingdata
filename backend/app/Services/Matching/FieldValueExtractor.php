<?php

namespace App\Services\Matching;

class FieldValueExtractor
{
    public function __construct(
        private readonly EntityNameParser $entityNameParser,
        private readonly ValueNormalizer $normalizer,
    ) {
    }

    /**
     * Extracts and resolves the value from a dataset row based on mapping configuration.
     *
     * @param array<string, mixed> $row
     * @param array<string, mixed> $mappingConfig
     * @param array<string, mixed>|null $cachedEntity
     */
    public function extract(
        array $row,
        array $mappingConfig,
        string $columnKey = 'input_column_name',
        ?array $cachedEntity = null,
    ): ?string {
        $fieldName = (string) ($mappingConfig[$columnKey] ?? $mappingConfig['field_name'] ?? '');

        $parentKey = $columnKey === 'reference_column_name' ? 'parent_reference_column' : 'parent_input_column';
        $parentColumn = (string) (
            $mappingConfig[$parentKey]
            ?? $mappingConfig['parent_column']
            ?? data_get($mappingConfig, "metadata.{$parentKey}")
            ?? data_get($mappingConfig, 'metadata.parent_column')
            ?? ''
        );

        $targetColumn = $parentColumn !== '' ? $parentColumn : $fieldName;
        $rawValue = $this->resolveDirectValue($row, $targetColumn);

        $transform = (string) (
            $mappingConfig['transform']
            ?? data_get($mappingConfig, 'metadata.transform')
            ?? ''
        );



        // If raw value is empty and an entity transform is requested, try finding entity name column in row
        if (($rawValue === null || trim($rawValue) === '') && in_array($transform, ['EXTRACT_CORE_NAME', 'EXTRACT_LEGAL_FORM', 'EXTRACT_LEGAL_STRUCTURE'], true)) {
            $rawValue = $this->findEntityNameValue($row);
        }

        if ($rawValue === null || trim($rawValue) === '') {
            return null;
        }

        if ($transform === 'EXTRACT_CORE_NAME') {
            if ($cachedEntity !== null && ! empty($cachedEntity['core_name'])) {
                return (string) $cachedEntity['core_name'];
            }
            $parsed = $this->entityNameParser->parse($rawValue);

            return $parsed['core_name'] !== '' ? $parsed['core_name'] : $rawValue;
        }

        if ($transform === 'EXTRACT_LEGAL_FORM' || $transform === 'EXTRACT_LEGAL_STRUCTURE') {
            if ($cachedEntity !== null && ! empty($cachedEntity['legal_form'])) {
                return (string) $cachedEntity['legal_form'];
            }
            $parsed = $this->entityNameParser->parse($rawValue);

            return $parsed['legal_form'] ?? '';
        }

        return $rawValue;
    }

    public function resolveDirectValue(array $row, string $columnName): ?string
    {
        if ($columnName === '') {
            return null;
        }

        // 1. Direct key match
        if (array_key_exists($columnName, $row) && $row[$columnName] !== null) {
            return (string) $row[$columnName];
        }

        // 2. Case-insensitive / trimmed lookup
        $normalizedSearch = mb_strtolower(trim($columnName));
        foreach ($row as $col => $val) {
            if (mb_strtolower(trim((string) $col)) === $normalizedSearch && $val !== null) {
                return (string) $val;
            }
        }

        return null;
    }

    /**
     * Find entity/company name value from the row based on keyword detection or first non-empty text column.
     *
     * @param array<string, mixed> $row
     */
    public function findEntityNameValue(array $row): ?string
    {
        // First priority: column with entity name keywords
        foreach ($row as $col => $val) {
            $colStr = (string) $col;
            if (! str_starts_with($colStr, '[Generated]') && $this->entityNameParser->isEntityNameColumn($colStr) && is_string($val) && trim($val) !== '') {
                return trim($val);
            }
        }

        // Second priority: first non-empty text column
        foreach ($row as $col => $val) {
            $colStr = (string) $col;
            if (! str_starts_with($colStr, '[Generated]') && is_string($val) && trim($val) !== '') {
                return trim($val);
            }
        }

        return null;
    }
}
