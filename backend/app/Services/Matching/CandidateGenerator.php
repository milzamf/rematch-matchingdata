<?php

namespace App\Services\Matching;

class CandidateGenerator
{
    public function __construct(private readonly ValueNormalizer $normalizer)
    {
    }

    /**
     * @param array<int, array<string, mixed>> $referenceRows
     * @param array<int, array<string, mixed>> $mappings
     * @return array<string, mixed>
     */
    public function buildIndexes(array $referenceRows, array $mappings, string $strategy): array
    {
        $exact = [];
        $tokens = [];

        foreach ($referenceRows as $record) {
            foreach ($mappings as $mapping) {
                $field = $mapping['reference_column_name'];
                $value = $record['normalized'][$field] ?? '';

                if ($value === '') {
                    continue;
                }

                $exact[$field][$value][] = $record['key'];

                foreach ($this->candidateKeys($value) as $token) {
                    $tokens[$token][$record['key']] = true;
                }
            }
        }

        return [
            'exact' => $exact,
            'tokens' => $tokens,
            'strategy' => $strategy,
        ];
    }

    /**
     * @param array<string, mixed> $indexes
     * @param array<string, mixed> $inputRecord
     * @param array<int, array<string, mixed>> $mappings
     * @param array<int, array<string, mixed>> $referenceByKey
     * @return array<int, array<string, mixed>>
     */
    public function candidatesFor(
        array $indexes,
        array $inputRecord,
        array $mappings,
        array $referenceByKey,
        int $limit,
    ): array {
        $strategy = $indexes['strategy'] ?? 'Hybrid';
        $candidateKeys = [];

        if (in_array($strategy, ['Exact', 'Hybrid'], true)) {
            foreach ($mappings as $mapping) {
                $algorithm = (string) ($mapping['algorithm'] ?? '');

                if (! $this->isExactAlgorithm($algorithm) && $strategy !== 'Exact') {
                    continue;
                }

                $inputValue = $inputRecord['normalized'][$mapping['input_column_name']] ?? '';
                $field = $mapping['reference_column_name'];

                foreach (($indexes['exact'][$field][$inputValue] ?? []) as $key) {
                    $candidateKeys[$key] = true;
                }
            }
        }

        if ($candidateKeys === [] && $strategy !== 'Exact') {
            foreach ($mappings as $mapping) {
                $inputValue = $inputRecord['normalized'][$mapping['input_column_name']] ?? '';

                foreach ($this->candidateKeys($inputValue) as $token) {
                    foreach (array_keys($indexes['tokens'][$token] ?? []) as $key) {
                        $candidateKeys[$key] = true;
                    }
                }
            }
        }

        if ($candidateKeys === []) {
            $candidateKeys = array_fill_keys(array_slice(array_keys($referenceByKey), 0, $limit), true);
        }

        return array_values(array_filter(
            array_map(fn (string $key) => $referenceByKey[$key] ?? null, array_slice(array_keys($candidateKeys), 0, $limit * 10)),
        ));
    }

    private function isExactAlgorithm(string $algorithm): bool
    {
        return in_array($algorithm, ['Exact', 'Normalized Exact', 'Case-Insensitive Exact', 'Numeric Exact', 'Date Exact'], true);
    }

    /**
     * @return array<int, string>
     */
    private function candidateKeys(string $value): array
    {
        $tokens = $this->normalizer->tokens($value);
        $keys = [];

        foreach ($tokens as $token) {
            $keys[] = $token;

            if (mb_strlen($token) >= 4) {
                $keys[] = mb_substr($token, 0, 4);
            }
        }

        return array_values(array_unique($keys));
    }
}
