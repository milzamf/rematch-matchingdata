<?php

namespace App\Services\Datasets;

class DatasetProfiler
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function profile(ParsedDataset $dataset): array
    {
        $rowCount = count($dataset->rows);

        return collect($dataset->headers)
            ->values()
            ->map(function (string $header, int $index) use ($dataset, $rowCount) {
                $values = array_map(fn (array $row) => $row[$header] ?? null, $dataset->rows);
                $nonNullValues = array_values(array_filter($values, fn ($value) => ! $this->isBlank($value)));
                $uniqueValues = array_unique(array_map(fn ($value) => (string) $value, $nonNullValues));
                $nullCount = $rowCount - count($nonNullValues);
                $uniqueCount = count($uniqueValues);
                $duplicateCount = max(0, count($nonNullValues) - $uniqueCount);

                return [
                    'name' => $header,
                    'normalized_name' => $this->normalizeColumnName($header),
                    'data_type' => $this->detectType($nonNullValues),
                    'position' => $index + 1,
                    'null_count' => $nullCount,
                    'null_percentage' => $this->percentage($nullCount, $rowCount),
                    'unique_count' => $uniqueCount,
                    'duplicate_percentage' => $this->percentage($duplicateCount, $rowCount),
                    'sample_values' => array_slice(array_values($uniqueValues), 0, 5),
                ];
            })
            ->all();
    }

    private function normalizeColumnName(string $name): string
    {
        $normalized = preg_replace('/[^a-z0-9]+/', '_', strtolower(trim($name))) ?? '';

        return trim($normalized, '_');
    }

    /**
     * @param array<int, mixed> $values
     */
    private function detectType(array $values): string
    {
        if ($values === []) {
            return 'empty';
        }

        $sample = array_slice($values, 0, 100);

        if ($this->ratio($sample, fn ($value) => $this->isBoolean($value)) >= 0.8) {
            return 'boolean';
        }

        if ($this->ratio($sample, fn ($value) => is_numeric((string) $value)) >= 0.8) {
            return 'number';
        }

        if ($this->ratio($sample, fn ($value) => $this->isDateLike($value)) >= 0.8) {
            return 'date';
        }

        return 'text';
    }

    private function isBlank(mixed $value): bool
    {
        return $value === null || trim((string) $value) === '';
    }

    private function isBoolean(mixed $value): bool
    {
        return in_array(strtolower((string) $value), ['true', 'false', 'yes', 'no', '0', '1'], true);
    }

    private function isDateLike(mixed $value): bool
    {
        $text = trim((string) $value);

        if (! preg_match('/[-\/]/', $text)) {
            return false;
        }

        return strtotime($text) !== false;
    }

    /**
     * @param array<int, mixed> $values
     */
    private function ratio(array $values, callable $predicate): float
    {
        if ($values === []) {
            return 0;
        }

        $matches = count(array_filter($values, $predicate));

        return $matches / count($values);
    }

    private function percentage(int $count, int $total): float
    {
        if ($total === 0) {
            return 0;
        }

        return round(($count / $total) * 100, 2);
    }
}
