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
        $preset = (string) ($configuration['preset'] ?? 'Balanced');
        $strategy = (string) ($configuration['strategy'] ?? $this->strategyForPreset($preset));
        $thresholds = $configuration['thresholds'] ?? $this->thresholdsForPreset($preset);
        $candidateGeneration = $configuration['candidateGeneration'] ?? ['topN' => 3];

        return [
            'preset' => $preset,
            'strategy' => $this->normalizeStrategy($strategy),
            'thresholds' => [
                'autoMatch' => (float) ($thresholds['autoMatch'] ?? 90),
                'review' => (float) ($thresholds['review'] ?? 75),
                'noMatch' => (float) ($thresholds['noMatch'] ?? 60),
            ],
            'candidateGeneration' => [
                'topN' => max(1, min(25, (int) ($candidateGeneration['topN'] ?? 3))),
            ],
            'searchOptimization' => $configuration['searchOptimization'] ?? [
                'enabled' => true,
                'mode' => 'auto',
                'fields' => [],
                'recommendedFields' => [],
            ],
            'normalization' => $configuration['normalization'] ?? [
                'mode' => 'auto',
                'preset' => 'Entity Name',
            ],
            'weighting' => $configuration['weighting'] ?? [
                'mode' => 'auto',
                'fields' => [],
            ],
            'rules' => $configuration['rules'] ?? null,
            'output' => $configuration['output'] ?? [
                'mode' => 'standard',
                'items' => ['Matched', 'Possible Match', 'Unmatched', 'Summary Report'],
            ],
            'runOptions' => [
                'chunkSize' => max(10, min(1000, (int) data_get($configuration, 'runOptions.chunkSize', 250))),
                'workerCount' => max(1, min(8, (int) data_get($configuration, 'runOptions.workerCount', 4))),
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
            default => ['autoMatch' => 90, 'review' => 75, 'noMatch' => 60],
        };
    }
}
