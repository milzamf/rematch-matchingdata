<?php

namespace App\Services\Matching;

use App\Models\ColumnMapping;
use App\Models\Dataset;
use App\Models\MatchingConfiguration;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

class MatchingEngineService
{
    public function __construct(
        private readonly MatchingConfigResolver $configResolver,
        private readonly ValueNormalizer $normalizer,
        private readonly EntityNameParser $entityNameParser,
        private readonly CandidateGenerator $candidateGenerator,
        private readonly SimilarityScorer $scorer,
        private readonly ResourceOwnership $ownership,
    ) {
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function run(User $user, array $payload): array
    {
        $reference = $this->ownership->scopeDatasets(Dataset::with('columns'), $user)
            ->findOrFail($payload['reference_dataset_id']);
        $input = $this->ownership->scopeDatasets(Dataset::with('columns'), $user)
            ->findOrFail($payload['input_dataset_id']);
        $workspace = ! empty($payload['workspace_id'])
            ? $this->ownership->findWorkspace($user, (string) $payload['workspace_id'])
            : null;
        $configuration = $this->configResolver->resolve($payload['configuration'] ?? []);
        $mappings = $this->resolveMappings($payload['mappings'] ?? [], $configuration);
        $inputRows = $this->normalizeRows($input->preview_rows ?? [], $mappings, 'input_column_name', $configuration);
        $referenceRows = $this->normalizeRows($reference->preview_rows ?? [], $mappings, 'reference_column_name', $configuration);

        if ($mappings === []) {
            throw new InvalidArgumentException('At least one valid column mapping is required.');
        }

        if ($inputRows === [] || $referenceRows === []) {
            throw new InvalidArgumentException('Reference and input datasets must contain preview rows before matching.');
        }

        return DB::transaction(function () use ($payload, $reference, $input, $configuration, $mappings, $inputRows, $referenceRows, $workspace) {
            $job = MatchingJob::create([
                'reference_dataset_id' => $reference->id,
                'input_dataset_id' => $input->id,
                'name' => $payload['name'] ?? 'Matching Job',
                'status' => 'processing',
                'processed_count' => 0,
                'total_count' => count($inputRows),
                'record_counts' => [
                    'matched' => 0,
                    'possible_match' => 0,
                    'unmatched' => 0,
                    'candidates_scored' => 0,
                ],
                'started_at' => Carbon::now(),
            ]);

            foreach ($mappings as $mapping) {
                ColumnMapping::create([
                    'matching_job_id' => $job->id,
                    'reference_column_id' => $mapping['reference_column_id'] ?? null,
                    'input_column_id' => $mapping['input_column_id'] ?? null,
                    'reference_column_name' => $mapping['reference_column_name'],
                    'input_column_name' => $mapping['input_column_name'],
                    'algorithm' => $mapping['algorithm'],
                    'weight' => $mapping['weight'],
                    'required_match' => $mapping['required_match'],
                    'metadata' => $mapping['metadata'] ?? [],
                ]);
            }

            MatchingConfiguration::create([
                'matching_job_id' => $job->id,
                'preset' => $configuration['preset'],
                'strategy' => $configuration['strategy'],
                'thresholds' => $configuration['thresholds'],
                'normalization' => $configuration['normalization'],
                'search_optimization' => $configuration['searchOptimization'],
                'candidate_generation' => $configuration['candidateGeneration'],
                'output_config' => $configuration['output'],
                'advanced_settings' => [
                    'weighting' => $configuration['weighting'],
                    'rules' => $configuration['rules'],
                    'runOptions' => $configuration['runOptions'],
                ],
                'config_hash' => hash('sha256', json_encode($configuration, JSON_THROW_ON_ERROR)),
            ]);

            try {
                $summary = $this->executePipeline($job, $inputRows, $referenceRows, $mappings, $configuration);
                $job->update([
                    'status' => 'completed',
                    'processed_count' => count($inputRows),
                    'record_counts' => $summary,
                    'finished_at' => Carbon::now(),
                ]);
            } catch (Throwable $exception) {
                $job->update([
                    'status' => 'failed',
                    'error_message' => $exception->getMessage(),
                    'finished_at' => Carbon::now(),
                ]);

                throw $exception;
            }

            if ($workspace !== null) {
                $workspace->update([
                    'matching_job_id' => $job->id,
                    'status' => $job->status === 'completed' ? 'reviewing' : 'failed',
                    'current_step' => $job->status === 'completed' ? 6 : 5,
                ]);
            }

            return $this->responseFor($job->refresh());
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function status(User $user, string $jobId): array
    {
        return $this->responseFor($this->ownership->findMatchingJob($user, $jobId));
    }

    /**
     * @param array<int, mixed> $rawMappings
     * @param array<string, mixed> $configuration
     * @return array<int, array<string, mixed>>
     */
    private function resolveMappings(array $rawMappings, array $configuration): array
    {
        $configuredFields = collect($configuration['fields'] ?? [])->keyBy('mappingId');
        $weightByField = collect(data_get($configuration, 'weighting.fields', []))->keyBy('mappingId');
        $validMappings = [];

        foreach ($rawMappings as $index => $mapping) {
            if (($mapping['referenceColumnName'] ?? '') === '' || ($mapping['inputColumnName'] ?? '') === '') {
                continue;
            }

            $mappingId = (string) ($mapping['id'] ?? $mapping['mappingId'] ?? Str::uuid());
            $configured = $configuredFields->get($mappingId, []);
            $weight = $weightByField->get($mappingId, []);

            $validMappings[] = [
                'id' => $mappingId,
                'reference_column_id' => $mapping['referenceColumnId'] ?? $mapping['reference_column_id'] ?? null,
                'input_column_id' => $mapping['inputColumnId'] ?? $mapping['input_column_id'] ?? null,
                'reference_column_name' => (string) ($mapping['referenceColumnName'] ?? $mapping['reference_column_name']),
                'input_column_name' => (string) ($mapping['inputColumnName'] ?? $mapping['input_column_name']),
                'algorithm' => $this->resolveAlgorithm($configuration['strategy'], $configured['algorithm'] ?? $mapping['algorithm'] ?? null),
                'weight' => (float) ($weight['weight'] ?? $this->defaultWeight($index, count($rawMappings))),
                'required_match' => (bool) ($mapping['required_match'] ?? false),
                'metadata' => [
                    'suggested' => $mapping['suggested'] ?? false,
                    'suggestion_source' => $mapping['suggestionSource'] ?? null,
                    'suggestion_score' => $mapping['suggestionScore'] ?? null,
                ],
            ];
        }

        $totalWeight = array_sum(array_column($validMappings, 'weight'));

        if ($totalWeight > 0) {
            foreach ($validMappings as &$mapping) {
                $mapping['weight'] = round(($mapping['weight'] / $totalWeight) * 100, 2);
            }
        }

        return $validMappings;
    }

    private function resolveAlgorithm(string $strategy, ?string $algorithm): string
    {
        if (is_string($algorithm) && $algorithm !== '') {
            return $algorithm;
        }

        return match ($strategy) {
            'Exact' => 'Normalized Exact',
            'Fuzzy' => 'Jaro-Winkler',
            'Rule-Based' => 'Exact',
            default => 'Token Set Ratio',
        };
    }

    private function defaultWeight(int $index, int $total): float
    {
        if ($total <= 0) {
            return 0;
        }

        $base = floor(100 / $total);

        return $base + ($index === 0 ? 100 - ($base * $total) : 0);
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @param array<int, array<string, mixed>> $mappings
     * @return array<int, array<string, mixed>>
     */
    private function normalizeRows(array $rows, array $mappings, string $columnKey, array $configuration): array
    {
        $preset = (string) data_get($configuration, 'normalization.preset', 'Basic');

        return collect($rows)
            ->values()
            ->map(function (array $row, int $index) use ($mappings, $columnKey, $preset) {
                $normalized = [];
                $identity = [];

                foreach ($mappings as $mapping) {
                    $columnName = $mapping[$columnKey];
                    $rawValue = $row[$columnName] ?? null;
                    $parsedEntity = $this->entityNameParser->parse($rawValue);
                    $isEntityName = $this->entityNameParser->isEntityNameColumn($columnName)
                        || $this->entityNameParser->hasEntityMetadata($parsedEntity);

                    if ($isEntityName) {
                        $normalized[$columnName] = $parsedEntity['core_name'];
                        $identity[$columnName] = $parsedEntity;

                        continue;
                    }

                    $normalized[$columnName] = $this->normalizer->normalize($rawValue, $preset);
                }

                return [
                    'key' => (string) ($index + 1),
                    'row' => $row,
                    'normalized' => $normalized,
                    'identity' => $identity,
                ];
            })
            ->all();
    }

    /**
     * @param array<int, array<string, mixed>> $inputRows
     * @param array<int, array<string, mixed>> $referenceRows
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<string, int>
     */
    private function executePipeline(
        MatchingJob $job,
        array $inputRows,
        array $referenceRows,
        array $mappings,
        array $configuration,
    ): array {
        $chunkSize = $configuration['runOptions']['chunkSize'];
        $workerCount = $configuration['runOptions']['workerCount'];
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);
        $referenceByKey = collect($referenceRows)->keyBy('key')->all();
        $indexes = $this->candidateGenerator->buildIndexes($referenceRows, $mappings, $configuration['strategy']);
        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
        ];
        $processed = 0;

        foreach (array_chunk($inputRows, $chunkSize) as $chunkIndex => $chunk) {
            $workerSlot = $chunkIndex % $workerCount;
            $batchResults = [];

            foreach ($chunk as $inputRecord) {
                $ranked = $this->rankCandidates($inputRecord, $referenceByKey, $indexes, $mappings, $configuration, $topN);
                $summary['candidates_scored'] += count($ranked);

                if ($ranked === []) {
                    $batchResults[] = $this->resultRow($job, $inputRecord, null, 0, 1, [], 'unmatched', 'No candidate generated', $workerSlot);
                    $summary['unmatched']++;
                    continue;
                }

                foreach ($ranked as $rank => $candidate) {
                    $classification = $this->classify($candidate['score'], $configuration['thresholds']);
                    $summary[$classification]++;
                    $batchResults[] = $this->resultRow(
                        $job,
                        $inputRecord,
                        $candidate['record'],
                        $candidate['score'],
                        $rank + 1,
                        $candidate['field_scores'],
                        $classification,
                        $candidate['reason'],
                        $workerSlot,
                    );
                }
            }

            MatchingResult::insert($batchResults);
            $processed += count($chunk);
            $job->update([
                'processed_count' => $processed,
                'record_counts' => $summary,
            ]);
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $inputRecord
     * @param array<int|string, array<string, mixed>> $referenceByKey
     * @param array<string, mixed> $indexes
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<int, array<string, mixed>>
     */
    private function rankCandidates(
        array $inputRecord,
        array $referenceByKey,
        array $indexes,
        array $mappings,
        array $configuration,
        int $topN,
    ): array {
        $candidates = $this->candidateGenerator->candidatesFor($indexes, $inputRecord, $mappings, $referenceByKey, max($topN, 3));
        $ranked = [];

        foreach ($candidates as $candidate) {
            $score = $this->scoreRecord($inputRecord, $candidate, $mappings, $configuration);

            if ($score === null) {
                continue;
            }

            $ranked[] = $score;
        }

        usort($ranked, fn (array $a, array $b) => $b['score'] <=> $a['score']);

        return array_slice($ranked, 0, $topN);
    }

    /**
     * @param array<string, mixed> $inputRecord
     * @param array<string, mixed> $referenceRecord
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<string, mixed>|null
     */
    private function scoreRecord(array $inputRecord, array $referenceRecord, array $mappings, array $configuration): ?array
    {
        $strategy = $configuration['strategy'];
        $fieldScores = [];
        $weightedScore = 0.0;
        $weightTotal = 0.0;
        $exactMiss = false;
        $identityConflict = false;

        foreach ($mappings as $mapping) {
            $left = $referenceRecord['normalized'][$mapping['reference_column_name']] ?? '';
            $right = $inputRecord['normalized'][$mapping['input_column_name']] ?? '';
            $referenceIdentity = $referenceRecord['identity'][$mapping['reference_column_name']] ?? null;
            $inputIdentity = $inputRecord['identity'][$mapping['input_column_name']] ?? null;
            $fieldIdentityConflict = $this->entityNameParser->hasStrictLegalConflict($referenceIdentity, $inputIdentity);
            $algorithm = $this->algorithmForStrategy($strategy, $mapping['algorithm']);
            $score = $this->scorer->score($algorithm, $left, $right);

            if ($fieldIdentityConflict) {
                $identityConflict = true;
            }

            if ($strategy === 'Rule-Based' && $mapping['required_match'] && $score < 100) {
                return null;
            }

            if ($strategy === 'Exact' && $score < 100) {
                $exactMiss = true;
            }

            $fieldScores[] = [
                'reference_column' => $mapping['reference_column_name'],
                'input_column' => $mapping['input_column_name'],
                'algorithm' => $algorithm,
                'score' => $score,
            ];

            if (is_array($referenceIdentity) || is_array($inputIdentity)) {
                $fieldScores[array_key_last($fieldScores)]['identity_metadata'] = [
                    'reference' => $referenceIdentity,
                    'input' => $inputIdentity,
                ];
                $fieldScores[array_key_last($fieldScores)]['identity_conflict'] = $fieldIdentityConflict;
            }

            $weight = max(0.0, (float) $mapping['weight']);
            $weightedScore += $score * $weight;
            $weightTotal += $weight;
        }

        if ($strategy === 'Exact' && $exactMiss) {
            return null;
        }

        $finalScore = $weightTotal > 0 ? $weightedScore / $weightTotal : 0.0;
        $reason = $strategy === 'Hybrid' ? 'Exact index with fuzzy fallback' : "{$strategy} candidate scored";

        if ($identityConflict) {
            $autoMatchThreshold = (float) ($configuration['thresholds']['autoMatch'] ?? 90);

            if ($finalScore >= $autoMatchThreshold) {
                $finalScore = max((float) ($configuration['thresholds']['review'] ?? 75), $autoMatchThreshold - 1);
            }

            $reason = 'Identity metadata conflict requires review';
        }

        return [
            'record' => $referenceRecord,
            'score' => round($finalScore, 2),
            'field_scores' => $fieldScores,
            'reason' => $reason,
        ];
    }

    private function algorithmForStrategy(string $strategy, string $algorithm): string
    {
        if ($strategy === 'Exact') {
            return in_array($algorithm, ['Exact', 'Normalized Exact', 'Case-Insensitive Exact', 'Numeric Exact', 'Date Exact'], true)
                ? $algorithm
                : 'Normalized Exact';
        }

        return $algorithm;
    }

    /**
     * @param array<string, float> $thresholds
     */
    private function classify(float $score, array $thresholds): string
    {
        if ($score >= ($thresholds['autoMatch'] ?? 90)) {
            return 'matched';
        }

        if ($score >= ($thresholds['review'] ?? 75)) {
            return 'possible_match';
        }

        return 'unmatched';
    }

    /**
     * @param array<string, mixed>|null $referenceRecord
     * @param array<int, array<string, mixed>> $fieldScores
     * @return array<string, mixed>
     */
    private function resultRow(
        MatchingJob $job,
        array $inputRecord,
        ?array $referenceRecord,
        float $score,
        int $rank,
        array $fieldScores,
        string $classification,
        string $reason,
        int $workerSlot,
    ): array {
        return [
            'id' => (string) Str::uuid(),
            'matching_job_id' => $job->id,
            'input_record_key' => $inputRecord['key'],
            'reference_record_key' => $referenceRecord['key'] ?? null,
            'result_type' => $classification,
            'overall_score' => $score,
            'candidate_rank' => $rank,
            'field_scores' => json_encode($fieldScores, JSON_THROW_ON_ERROR),
            'candidate_metadata' => json_encode([
                'worker_slot' => $workerSlot,
                'input_record' => $inputRecord['row'],
                'reference_record' => $referenceRecord['row'] ?? null,
            ], JSON_THROW_ON_ERROR),
            'decision_reason' => $reason,
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function responseFor(MatchingJob $job): array
    {
        $counts = $job->record_counts ?? [];
        $progress = $job->total_count > 0 ? round(($job->processed_count / $job->total_count) * 100, 2) : 0;

        return [
            'job' => [
                'id' => $job->id,
                'name' => $job->name,
                'status' => $job->status,
                'reference_dataset_id' => $job->reference_dataset_id,
                'input_dataset_id' => $job->input_dataset_id,
                'started_at' => optional($job->started_at)->toISOString(),
                'finished_at' => optional($job->finished_at)->toISOString(),
                'error_message' => $job->error_message,
            ],
            'progress' => [
                'status' => $job->status,
                'processed' => $job->processed_count,
                'total' => $job->total_count,
                'percentage' => $progress,
            ],
            'summary' => [
                'matched' => (int) ($counts['matched'] ?? 0),
                'possible_match' => (int) ($counts['possible_match'] ?? 0),
                'unmatched' => (int) ($counts['unmatched'] ?? 0),
                'candidates_scored' => (int) ($counts['candidates_scored'] ?? 0),
            ],
            'top_results' => $job->results()
                ->orderByDesc('overall_score')
                ->limit(10)
                ->get(['id', 'input_record_key', 'reference_record_key', 'result_type', 'overall_score', 'candidate_rank'])
                ->all(),
        ];
    }
}
