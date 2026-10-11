<?php

namespace App\Services\Matching;

class MatchingConfigResolver
{
    /**
     * @param array<string, mixed> $configuration
     * @return array<string, mixed>
     */
    public function resolve(array $configuration): array
    {
        $mode = (string) ($configuration['mode'] ?? 'default');
        $preset = (string) ($configuration['preset'] ?? ($mode === 'construction' ? 'Konstruksi' : 'Default'));
        if (strcasecmp($preset, 'construction') === 0 || strcasecmp($mode, 'construction') === 0) {
            $preset = 'Konstruksi';
        }

        $strategy = (string) ($configuration['strategy'] ?? $this->strategyForPreset($preset));
        $thresholds = $configuration['thresholds'] ?? $this->thresholdsForPreset($preset);
        $candidateGeneration = $configuration['candidateGeneration'] ?? ['topN' => 3];
        $fields = is_array($configuration['fields'] ?? null) ? $configuration['fields'] : [];

        return [
            'preset' => $preset,
            'mode' => $mode,
            'strategy' => $this->normalizeStrategy($strategy),
            'fields' => $fields,
            'thresholds' => [
                'autoMatch' => (float) ($thresholds['autoMatch'] ?? 90),
                'review' => (float) ($thresholds['review'] ?? 75),
                'noMatch' => (float) ($thresholds['noMatch'] ?? 75),
            ],
            'candidateGeneration' => [
                'topN' => max(1, min(25, (int) ($candidateGeneration['topN'] ?? 3))),
                'searchLimit' => isset($candidateGeneration['searchLimit'])
                    ? max(max(1, min(25, (int) ($candidateGeneration['topN'] ?? 3))), min(50, (int) $candidateGeneration['searchLimit']))
                    : max(max(1, min(25, (int) ($candidateGeneration['topN'] ?? 3))) * 2, 8),
            ],
            'searchOptimization' => array_merge([
                'enabled' => true,
                'mode' => 'auto',
                'fields' => [],
                'recommendedFields' => [],
                'candidatePruning' => true,
            ], is_array($configuration['searchOptimization'] ?? null) ? $configuration['searchOptimization'] : []),
            'normalization' => $configuration['normalization'] ?? [
                'mode' => 'auto',
                'preset' => 'Entity Name',
            ],
            'weighting' => $this->normalizeWeighting($configuration['weighting'] ?? [], $fields),
            'rules' => $configuration['rules'] ?? null,
            'output' => $configuration['output'] ?? [
                'mode' => 'standard',
                'items' => ['Matched', 'Possible Match', 'Unmatched', 'Summary Report'],
            ],
            'runOptions' => [
                'chunkSize' => max(10, min(1000, (int) data_get($configuration, 'runOptions.chunkSize', 250))),
                'workerCount' => max(1, min(2, (int) data_get($configuration, 'runOptions.workerCount', 1))),
            ],
        ];
    }

    private function normalizeStrategy(string $strategy): string
    {
        return match ($strategy) {
            'Exact', 'Fuzzy', 'Composite', 'Rule-Based', 'Hybrid' => $strategy,
            default => 'Hybrid',
        };
    }

    private function strategyForPreset(string $preset): string
    {
        return match ($preset) {
            'Strict' => 'Exact',
            'Exploratory' => 'Fuzzy',
            default => 'Hybrid',
        };
    }

    /**
     * @return array{autoMatch: int, review: int, noMatch: int}
     */
    private function thresholdsForPreset(string $preset): array
    {
        return match ($preset) {
            'Strict' => ['autoMatch' => 95, 'review' => 85, 'noMatch' => 70],
            'Exploratory' => ['autoMatch' => 85, 'review' => 65, 'noMatch' => 50],
            'Konstruksi' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            default => ['autoMatch' => 90, 'review' => 75, 'noMatch' => 75],
        };
    }

    /**
     * Strict fields are constraints, not contributors to the weighted similarity score.
     *
     * @param array<string, mixed> $weighting
     * @param array<int, mixed> $fields
     * @return array<string, mixed>
     */
    private function normalizeWeighting(array $weighting, array $fields): array
    {
        $strictMappingIds = [];
        foreach ($fields as $field) {
            if (is_array($field) && (bool) ($field['strict'] ?? false)) {
                $strictMappingIds[(string) ($field['mappingId'] ?? '')] = true;
            }
        }

        $weightFields = is_array($weighting['fields'] ?? null) ? array_values($weighting['fields']) : [];
        $activeIndexes = [];
        $rawTotal = 0.0;

        foreach ($weightFields as $index => &$field) {
            if (! is_array($field)) {
                $field = [];
            }
            $mappingId = (string) ($field['mappingId'] ?? '');
            if (isset($strictMappingIds[$mappingId])) {
                $field['weight'] = 0;
                continue;
            }

            $raw = max(0.0, (float) ($field['weight'] ?? 0));
            $field['weight'] = $raw;
            $activeIndexes[] = $index;
            $rawTotal += $raw;
        }
        unset($field);

        if ($activeIndexes === []) {
            return ['mode' => 'manual', 'fields' => $weightFields];
        }

        if ($rawTotal <= 0) {
            $rawTotal = count($activeIndexes);
            foreach ($activeIndexes as $index) {
                $weightFields[$index]['weight'] = 1;
            }
        }

        $allocated = 0;
        $remainders = [];
        foreach ($activeIndexes as $index) {
            $exact = ((float) $weightFields[$index]['weight'] / $rawTotal) * 100;
            $normalized = (int) floor($exact);
            $weightFields[$index]['weight'] = $normalized;
            $allocated += $normalized;
            $remainders[] = [
                'index' => $index,
                'fraction' => $exact - $normalized,
                'raw' => $exact,
            ];
        }

        usort($remainders, static fn (array $left, array $right): int =>
            ($right['fraction'] <=> $left['fraction'])
            ?: ($right['raw'] <=> $left['raw'])
            ?: ($left['index'] <=> $right['index'])
        );

        $remaining = 100 - $allocated;
        foreach ($remainders as $remainder) {
            if ($remaining <= 0) {
                break;
            }
            $weightFields[$remainder['index']]['weight']++;
            $remaining--;
        }

        return [
            'mode' => (string) ($weighting['mode'] ?? 'manual'),
            'fields' => $weightFields,
        ];
    }
}
