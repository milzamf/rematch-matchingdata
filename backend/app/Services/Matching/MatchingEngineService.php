<?php

namespace App\Services\Matching;

use App\Jobs\RunMatchingJob;
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
     * Prepare a new MatchingJob, save mappings/config, and dispatch RunMatchingJob.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function run(User $user, array $payload): array
    {
        $job = $this->prepareJob($user, $payload);

        RunMatchingJob::dispatch($job->id);

        return $this->responseFor($job->refresh());
    }

    /**
     * Persist MatchingJob, mappings, configuration, and link to workspace.
     *
     * @param array<string, mixed> $payload
     */
    public function prepareJob(User $user, array $payload): MatchingJob
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

        if ($mappings === []) {
            throw new InvalidArgumentException('At least one valid column mapping is required.');
        }

        if (empty($input->preview_rows) || empty($reference->preview_rows)) {
            throw new InvalidArgumentException('Reference and input datasets must contain preview rows before matching.');
        }

        return DB::transaction(function () use ($payload, $reference, $input, $configuration, $mappings, $workspace) {
            $job = MatchingJob::create([
                'reference_dataset_id' => $reference->id,
                'input_dataset_id' => $input->id,
                'name' => $payload['name'] ?? 'Matching Job',
                'status' => 'processing',
                'processed_count' => 0,
                'total_count' => count($input->preview_rows),
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
                    'reference_column_id' => Str::isUuid($mapping['reference_column_id'] ?? null) ? $mapping['reference_column_id'] : null,
                    'input_column_id' => Str::isUuid($mapping['input_column_id'] ?? null) ? $mapping['input_column_id'] : null,
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

            if ($workspace !== null) {
                $workspace->update([
                    'matching_job_id' => $job->id,
                    'status' => 'processing',
                    'current_step' => 5,
                ]);
            }

            return $job;
        });
    }

    /**
     * Run matching for an existing MatchingJob model.
     *
     * @return array<string, mixed>
     */
    public function runJob(MatchingJob $job): array
    {
        $job->loadMissing(['referenceDataset.columns', 'inputDataset.columns', 'mappings', 'configuration', 'workspace']);

        $reference = $job->referenceDataset;
        $input = $job->inputDataset;

        if (! $reference || ! $input) {
            throw new InvalidArgumentException('Reference and input datasets must be attached to the job.');
        }

        $configModel = $job->configuration;
        $configuration = $this->configResolver->resolve([
            'preset' => $configModel?->preset ?? 'Default',
            'strategy' => $configModel?->strategy ?? 'Hybrid',
            'thresholds' => $configModel?->thresholds ?? [],
            'candidateGeneration' => $configModel?->candidate_generation ?? [],
            'searchOptimization' => $configModel?->search_optimization ?? [],
            'normalization' => $configModel?->normalization ?? [],
            'weighting' => data_get($configModel?->advanced_settings, 'weighting', []),
            'rules' => data_get($configModel?->advanced_settings, 'rules'),
            'output' => $configModel?->output_config ?? [],
            'runOptions' => data_get($configModel?->advanced_settings, 'runOptions', []),
        ]);

        $rawMappings = $job->mappings->map(fn (ColumnMapping $m) => [
            'id' => $m->id,
            'reference_column_id' => $m->reference_column_id,
            'input_column_id' => $m->input_column_id,
            'reference_column_name' => $m->reference_column_name,
            'input_column_name' => $m->input_column_name,
            'algorithm' => $m->algorithm,
            'weight' => $m->weight,
            'required_match' => $m->required_match,
            'metadata' => $m->metadata,
        ])->all();

        $mappings = $this->resolveMappings($rawMappings, $configuration);

        $job->update([
            'status' => 'processing',
            'processed_count' => 0,
            'total_count' => count($input->preview_rows ?? []),
            'started_at' => Carbon::now(),
        ]);

        try {
            $summary = $this->executePipeline($job, $reference, $input, $mappings, $configuration);
            $job->update([
                'status' => 'completed',
                'processed_count' => count($input->preview_rows ?? []),
                'record_counts' => $summary,
                'finished_at' => Carbon::now(),
            ]);

            if ($job->workspace !== null) {
                $job->workspace->update([
                    'matching_job_id' => $job->id,
                    'status' => 'reviewing',
                    'current_step' => 6,
                ]);
            }
        } catch (Throwable $exception) {
            $job->update([
                'status' => 'failed',
                'error_message' => $exception->getMessage(),
                'finished_at' => Carbon::now(),
            ]);

            if ($job->workspace !== null) {
                $job->workspace->update([
                    'status' => 'failed',
                ]);
            }

            throw $exception;
        }

        return $this->responseFor($job->refresh());
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
            $refCol = (string) ($mapping['referenceColumnName'] ?? $mapping['reference_column_name'] ?? '');
            $inpCol = (string) ($mapping['inputColumnName'] ?? $mapping['input_column_name'] ?? '');

            if ($refCol === '' || $inpCol === '') {
                continue;
            }

            $mappingId = (string) ($mapping['id'] ?? $mapping['mappingId'] ?? Str::uuid());
            $configured = $configuredFields->get($mappingId, []);
            $weight = $weightByField->get($mappingId, []);

            $validMappings[] = [
                'id' => $mappingId,
                'reference_column_id' => $mapping['referenceColumnId'] ?? $mapping['reference_column_id'] ?? null,
                'input_column_id' => $mapping['inputColumnId'] ?? $mapping['input_column_id'] ?? null,
                'reference_column_name' => $refCol,
                'input_column_name' => $inpCol,
                'algorithm' => $this->resolveAlgorithm($configuration['strategy'], $configured['algorithm'] ?? $mapping['algorithm'] ?? null),
                'weight' => (float) ($weight['weight'] ?? $mapping['weight'] ?? $this->defaultWeight($index, count($rawMappings))),
                'required_match' => (bool) ($mapping['required_match'] ?? $mapping['strict'] ?? $mapping['is_mandatory'] ?? false),
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

    private function resolveColumnValue(array $row, string $columnName): ?string
    {
        if (isset($row[$columnName])) {
            return (string) $row[$columnName];
        }

        if (str_contains($columnName, '[Generated] Nama Inti')) {
            $nameVal = $this->findEntityNameValue($row);
            if ($nameVal !== null) {
                $parsed = $this->entityNameParser->parse($nameVal);
                return $parsed['core_name'] !== '' ? $parsed['core_name'] : $nameVal;
            }
        }

        if (str_contains($columnName, '[Generated] Badan Usaha')) {
            $nameVal = $this->findEntityNameValue($row);
            if ($nameVal !== null) {
                $parsed = $this->entityNameParser->parse($nameVal);
                return $parsed['legal_form'] ?? '';
            }
        }

        return null;
    }

    private function findEntityNameValue(array $row): ?string
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

    /**
     * Phase 1: Automatic Normalization
     *
     * @param array<int, array<string, mixed>> $rows
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, string> $columnDataTypes
     * @return array<int, array<string, mixed>>
     */
    private function normalizeRows(
        array $rows,
        array $mappings,
        string $columnKey,
        array $columnDataTypes = [],
    ): array {
        return collect($rows)
            ->values()
            ->map(function (array $row, int $index) use ($mappings, $columnKey, $columnDataTypes) {
                $normalized = [];
                $identity = [];

                foreach ($mappings as $mapping) {
                    $columnName = $mapping[$columnKey];
                    $rawValue = $this->resolveColumnValue($row, $columnName);
                    $dataType = $columnDataTypes[$columnName] ?? null;

                    if ($columnName === '[Generated] Badan Usaha') {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, 'text', $columnName);
                        $identity[$columnName] = ['legal_form' => $rawValue];
                        continue;
                    }

                    if ($columnName === '[Generated] Nama Inti') {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, 'text', $columnName);
                        $identity[$columnName] = ['core_name' => $rawValue];
                        continue;
                    }

                    $parsedEntity = $this->entityNameParser->parse($rawValue);
                    $isEntityName = $this->entityNameParser->isEntityNameColumn($columnName)
                        || $this->entityNameParser->hasEntityMetadata($parsedEntity);

                    if ($isEntityName) {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($parsedEntity['core_name'], $dataType, $columnName);
                        $identity[$columnName] = $parsedEntity;

                        continue;
                    }

                    $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, $dataType, $columnName);
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
     * Executes the 4-phase matching pipeline.
     *
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<string, int>
     */
    private function executePipeline(
        MatchingJob $job,
        Dataset $reference,
        Dataset $input,
        array $mappings,
        array $configuration,
    ): array {
        $refColTypes = $reference->columns ? $reference->columns->pluck('data_type', 'name')->all() : [];
        $inpColTypes = $input->columns ? $input->columns->pluck('data_type', 'name')->all() : [];

        // ---------------------------------------------------------------------
        // Phase 1: Automatic Normalization
        // ---------------------------------------------------------------------
        $referenceRows = $this->normalizeRows($reference->preview_rows ?? [], $mappings, 'reference_column_name', $refColTypes);
        $inputRows = $this->normalizeRows($input->preview_rows ?? [], $mappings, 'input_column_name', $inpColTypes);

        $referenceByKey = collect($referenceRows)->keyBy('key')->all();

        // ---------------------------------------------------------------------
        // Phase 2 Preparation: Mandatory Indexing
        // ---------------------------------------------------------------------
        $mandatoryMappings = array_values(array_filter($mappings, fn ($m) => (bool) ($m['required_match'] ?? false)));
        $hasMandatoryFields = count($mandatoryMappings) > 0;

        $mandatoryRefIndex = [];
        if ($hasMandatoryFields) {
            foreach ($referenceRows as $refRecord) {
                $refValues = [];
                $allPresent = true;
                foreach ($mandatoryMappings as $m) {
                    $val = (string) ($refRecord['normalized'][$m['reference_column_name']] ?? '');
                    if ($val === '') {
                        $allPresent = false;
                        break;
                    }
                    $refValues[] = $val;
                }
                if ($allPresent) {
                    $compKey = implode('|###|', $refValues);
                    $mandatoryRefIndex[$compKey][] = $refRecord;
                }
            }
        }

        // Candidate Generation Index for Phase 3
        $indexes = $this->candidateGenerator->buildIndexes($referenceRows, $mappings, $configuration['strategy']);

        $chunkSize = $configuration['runOptions']['chunkSize'];
        $workerCount = $configuration['runOptions']['workerCount'];
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);

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
                // -------------------------------------------------------------
                // Phase 2: Mandatory / Exact Phase
                // -------------------------------------------------------------
                $exactMatchFound = false;
                if ($hasMandatoryFields) {
                    $inpValues = [];
                    $allPresent = true;
                    foreach ($mandatoryMappings as $m) {
                        $val = (string) ($inputRecord['normalized'][$m['input_column_name']] ?? '');
                        if ($val === '') {
                            $allPresent = false;
                            break;
                        }
                        $inpValues[] = $val;
                    }

                    if ($allPresent) {
                        $compKey = implode('|###|', $inpValues);
                        if (! empty($mandatoryRefIndex[$compKey])) {
                            $exactMatchFound = true;
                            $exactRefs = array_slice($mandatoryRefIndex[$compKey], 0, $topN);
                            $summary['candidates_scored'] += count($exactRefs);
                            // 1 input row = 1 matched status
                            $summary['matched']++;

                            foreach ($exactRefs as $rank => $exactRef) {
                                $exactFieldScores = $this->calculateFieldScores($inputRecord, $exactRef, $mappings);

                                $evidence = [
                                    'phase' => 'Phase 2: Mandatory / Exact Phase',
                                    'is_exact_match' => true,
                                    'bypassed_fuzzy' => true,
                                    'initial_classification' => 'matched',
                                    'final_classification' => 'matched',
                                    'weighted_similarity' => 100.0,
                                    'downgraded' => false,
                                    'downgrade_reason' => null,
                                    'rules_evaluated' => [],
                                    'summary' => [
                                        'total_rules' => 0,
                                        'passed_rules' => 0,
                                        'failed_rules' => 0,
                                        'all_passed' => true,
                                        'message' => 'Exact match on all mandatory fields bypassed Phase 3 and Phase 4.',
                                    ],
                                ];

                                $batchResults[] = $this->resultRow(
                                    $job,
                                    $inputRecord,
                                    $exactRef,
                                    100.0,
                                    $rank + 1,
                                    $exactFieldScores,
                                    'matched',
                                    'Exact match on mandatory fields (bypassed fuzzy scoring)',
                                    $workerSlot,
                                    $evidence,
                                );
                            }
                        }
                    }
                }

                if ($exactMatchFound) {
                    continue; // Bypass Phase 3 and Phase 4
                }

                // -------------------------------------------------------------
                // Phase 3 & Phase 4: Similarity Scoring & Verification Guardrails
                // -------------------------------------------------------------
                $scoredCandidates = $this->evaluateCandidates(
                    $inputRecord,
                    $referenceByKey,
                    $indexes,
                    $mappings,
                    $configuration,
                    $topN,
                );

                $summary['candidates_scored'] += count($scoredCandidates);

                if ($scoredCandidates === []) {
                    $batchResults[] = $this->resultRow(
                        $job,
                        $inputRecord,
                        null,
                        0.0,
                        1,
                        [],
                        'unmatched',
                        'No candidate generated',
                        $workerSlot,
                        [
                            'phase' => 'Phase 3: Similarity Scoring',
                            'is_exact_match' => false,
                            'bypassed_fuzzy' => false,
                            'initial_classification' => 'unmatched',
                            'final_classification' => 'unmatched',
                            'weighted_similarity' => 0.0,
                            'downgraded' => false,
                            'downgrade_reason' => null,
                            'rules_evaluated' => [],
                            'summary' => [
                                'total_rules' => 0,
                                'passed_rules' => 0,
                                'failed_rules' => 0,
                                'all_passed' => false,
                                'message' => 'No candidate generated.',
                            ],
                        ],
                    );
                    $summary['unmatched']++;
                    continue;
                }

                // Determine single distinct outcome for this unique input row
                $rowOutcome = 'unmatched';
                foreach ($scoredCandidates as $sc) {
                    if ($sc['classification'] === 'matched') {
                        $rowOutcome = 'matched';
                        break;
                    }
                    if ($sc['classification'] === 'possible_match' && $rowOutcome !== 'matched') {
                        $rowOutcome = 'possible_match';
                    }
                }
                $summary[$rowOutcome]++;

                foreach ($scoredCandidates as $rank => $candidate) {
                    $classification = $candidate['classification'];

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
                        $candidate['verification_evidence'],
                    );
                }
            }

            DB::transaction(function () use ($batchResults, $job, $processed, $chunk, $summary) {
                if (! empty($batchResults)) {
                    MatchingResult::insert($batchResults);
                }

                $job->update([
                    'processed_count' => $processed + count($chunk),
                    'record_counts' => $summary,
                ]);
            });

            $processed += count($chunk);
        }

        return $summary;
    }

    /**
     * Phase 3 & Phase 4 Evaluation.
     *
     * @param array<string, mixed> $inputRecord
     * @param array<int|string, array<string, mixed>> $referenceByKey
     * @param array<string, mixed> $indexes
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<int, array<string, mixed>>
     */
    private function evaluateCandidates(
        array $inputRecord,
        array $referenceByKey,
        array $indexes,
        array $mappings,
        array $configuration,
        int $topN,
    ): array {
        $candidates = $this->candidateGenerator->candidatesFor($indexes, $inputRecord, $mappings, $referenceByKey, max($topN, 3));
        $evaluated = [];

        $autoMatchThreshold = (float) ($configuration['thresholds']['autoMatch'] ?? 90);
        $reviewThreshold = (float) ($configuration['thresholds']['review'] ?? 75);

        // Verification rules list (ordered)
        $verificationRules = $this->resolveVerificationRules($configuration, $mappings, $reviewThreshold);

        foreach ($candidates as $candidate) {
            // -----------------------------------------------------------------
            // Phase 3: Similarity Scoring & Initial Thresholding
            // -----------------------------------------------------------------
            $fieldScores = [];
            $weightedScoreSum = 0.0;
            $weightTotal = 0.0;
            $identityConflict = false;
            $numericConflict = false;

            foreach ($mappings as $mapping) {
                $refCol = $mapping['reference_column_name'];
                $inpCol = $mapping['input_column_name'];

                $left = $candidate['normalized'][$refCol] ?? '';
                $right = $inputRecord['normalized'][$inpCol] ?? '';

                $refIdentity = $candidate['identity'][$refCol] ?? null;
                $inpIdentity = $inputRecord['identity'][$inpCol] ?? null;
                $fieldIdentityConflict = $this->entityNameParser->hasStrictLegalConflict($refIdentity, $inpIdentity);

                if ($fieldIdentityConflict) {
                    $identityConflict = true;
                }

                $fieldNumericMismatch = $this->scorer->hasNumericMismatch($left, $right);
                if ($fieldNumericMismatch) {
                    $numericConflict = true;
                }

                $algorithm = $mapping['algorithm'];
                $score = $this->scorer->score($algorithm, $left, $right);

                $weight = max(0.0, (float) ($mapping['weight'] ?? 0));
                $weightedScoreSum += $score * $weight;
                $weightTotal += $weight;

                $fieldScores[] = [
                    'reference_column' => $refCol,
                    'input_column' => $inpCol,
                    'algorithm' => $algorithm,
                    'score' => $score,
                    'weight' => $weight,
                    'is_mandatory' => (bool) ($mapping['required_match'] ?? false),
                    'identity_metadata' => (is_array($refIdentity) || is_array($inpIdentity)) ? [
                        'reference' => $refIdentity,
                        'input' => $inpIdentity,
                    ] : null,
                    'identity_conflict' => $fieldIdentityConflict,
                    'numeric_mismatch' => $fieldNumericMismatch,
                ];
            }

            $ws = $weightTotal > 0
                ? round($weightedScoreSum / $weightTotal, 2)
                : (count($fieldScores) > 0 ? round(array_sum(array_column($fieldScores, 'score')) / count($fieldScores), 2) : 0.0);

            // Initial classification based on Weighted Similarity
            if ($ws >= $autoMatchThreshold) {
                $initialClassification = 'matched';
            } elseif ($ws >= $reviewThreshold) {
                $initialClassification = 'possible_match';
            } else {
                $initialClassification = 'unmatched';
            }

            // -----------------------------------------------------------------
            // Phase 4: Ordered Partial Verification (The Guardrails)
            // -----------------------------------------------------------------
            $rulesEvaluated = [];
            $allRulesPassed = true;
            $failedRuleReasons = [];

            // Map field scores by column names for rapid lookup
            $fieldScoreByMapping = collect($fieldScores)->keyBy(function ($fs) {
                return $fs['reference_column'].'|'.$fs['input_column'];
            });

            if ($initialClassification !== 'unmatched' && count($verificationRules) > 0) {
                // NO SHORT-CIRCUIT: evaluate ALL rules in sequence!
                foreach ($verificationRules as $vRule) {
                    $ruleOrder = (int) ($vRule['order'] ?? (count($rulesEvaluated) + 1));
                    $targetMapping = $this->findMappingForRule($vRule, $mappings);

                    if (! $targetMapping) {
                        continue;
                    }

                    $refCol = $targetMapping['reference_column_name'];
                    $inpCol = $targetMapping['input_column_name'];
                    $lookupKey = $refCol.'|'.$inpCol;

                    $method = (string) ($vRule['method'] ?? $targetMapping['algorithm']);
                    $ruleThreshold = is_numeric($vRule['threshold'] ?? null)
                        ? (float) $vRule['threshold']
                        : ($targetMapping['required_match'] ? 100.0 : $reviewThreshold);

                    // Compute actual score using specified method (or use computed score if method matches)
                    $cached = $fieldScoreByMapping->get($lookupKey);
                    if ($cached && $cached['algorithm'] === $method) {
                        $actualScore = (float) $cached['score'];
                    } else {
                        $left = $candidate['normalized'][$refCol] ?? '';
                        $right = $inputRecord['normalized'][$inpCol] ?? '';
                        $actualScore = $this->scorer->score($method, $left, $right);
                    }

                    $passed = ($actualScore >= $ruleThreshold);

                    if (! $passed) {
                        $allRulesPassed = false;
                        $fieldLabel = $vRule['field'] ?? "{$inpCol} ↔ {$refCol}";
                        $failedRuleReasons[] = "Rule #{$ruleOrder} on '{$fieldLabel}' failed (score: {$actualScore}% < threshold: {$ruleThreshold}%)";
                    }

                    $rulesEvaluated[] = [
                        'order' => $ruleOrder,
                        'mapping_id' => $targetMapping['id'] ?? ($vRule['mappingId'] ?? null),
                        'field_name' => $vRule['field'] ?? "{$inpCol} ↔ {$refCol}",
                        'reference_column' => $refCol,
                        'input_column' => $inpCol,
                        'method' => $method,
                        'required_threshold' => $ruleThreshold,
                        'actual_score' => $actualScore,
                        'passed' => $passed,
                        'is_mandatory' => (bool) ($targetMapping['required_match'] ?? false),
                    ];
                }
            }

            // Downgrade logic: If Auto-Match fails ANY rule, downgrade to Need Review (possible_match)
            $downgraded = false;
            $downgradeReason = null;
            $finalClassification = $initialClassification;

            if ($initialClassification === 'matched' && ! $allRulesPassed) {
                $finalClassification = 'possible_match';
                $downgraded = true;
                $downgradeReason = implode('; ', $failedRuleReasons);
                $decisionReason = "Auto-match downgraded to needs_review: {$downgradeReason}";
            } elseif ($numericConflict && $finalClassification === 'matched') {
                $finalClassification = 'possible_match';
                $downgraded = true;
                $downgradeReason = 'Numeric sequence mismatch requires review';
                $decisionReason = 'Numeric sequence mismatch requires review';
            } elseif ($identityConflict && $finalClassification === 'matched') {
                $finalClassification = 'possible_match';
                $downgraded = true;
                $downgradeReason = 'Identity metadata conflict requires review';
                $decisionReason = 'Identity metadata conflict requires review';
            } elseif ($finalClassification === 'matched') {
                $decisionReason = 'Auto-match verified by guardrails';
            } elseif ($finalClassification === 'possible_match') {
                $decisionReason = "Needs review (score: {$ws}%)";
            } else {
                $decisionReason = "Unmatched (score: {$ws}% below review threshold)";
            }

            $verificationEvidence = [
                'phase' => 'Phase 4: Ordered Partial Verification',
                'is_exact_match' => false,
                'bypassed_fuzzy' => false,
                'initial_classification' => $initialClassification,
                'final_classification' => $finalClassification,
                'weighted_similarity' => $ws,
                'downgraded' => $downgraded,
                'downgrade_reason' => $downgradeReason,
                'rules_evaluated' => $rulesEvaluated,
                'summary' => [
                    'total_rules' => count($rulesEvaluated),
                    'passed_rules' => count(array_filter($rulesEvaluated, fn ($r) => $r['passed'])),
                    'failed_rules' => count(array_filter($rulesEvaluated, fn ($r) => ! $r['passed'])),
                    'all_passed' => $allRulesPassed,
                ],
            ];

            $evaluated[] = [
                'record' => $candidate,
                'score' => $ws,
                'field_scores' => $fieldScores,
                'classification' => $finalClassification,
                'reason' => $decisionReason,
                'verification_evidence' => $verificationEvidence,
            ];
        }

        // Sort candidates by score descending
        usort($evaluated, fn (array $a, array $b) => $b['score'] <=> $a['score']);

        return array_slice($evaluated, 0, $topN);
    }

    /**
     * @param array<string, mixed> $configuration
     * @param array<int, array<string, mixed>> $mappings
     * @return array<int, array<string, mixed>>
     */
    private function resolveVerificationRules(array $configuration, array $mappings, float $defaultThreshold): array
    {
        $customRules = data_get($configuration, 'rules.verificationOrder')
            ?? data_get($configuration, 'advanced_settings.rules.verificationOrder');

        if (is_array($customRules) && count($customRules) > 0) {
            return $customRules;
        }

        // Sort mappings for default verification order:
        // 1. Mandatory / Exact
        // 2. Name / Entity (threshold 90)
        // 3. Location (threshold 100)
        // 4. Address & others (threshold defaultThreshold)
        $sorted = $mappings;
        usort($sorted, function ($a, $b) {
            $aMandatory = (bool) ($a['required_match'] ?? false);
            $bMandatory = (bool) ($b['required_match'] ?? false);
            if ($aMandatory !== $bMandatory) return $bMandatory <=> $aMandatory;

            $aName = $this->entityNameParser->isEntityNameColumn((string) $a['reference_column_name']);
            $bName = $this->entityNameParser->isEntityNameColumn((string) $b['reference_column_name']);
            if ($aName !== $bName) return $bName <=> $aName;

            $aLoc = $this->isLocationColumn((string) $a['reference_column_name']);
            $bLoc = $this->isLocationColumn((string) $b['reference_column_name']);
            if ($aLoc !== $bLoc) return $bLoc <=> $aLoc;

            return 0;
        });

        $rules = [];
        foreach ($sorted as $index => $mapping) {
            $refCol = (string) $mapping['reference_column_name'];
            $isMandatory = (bool) ($mapping['required_match'] ?? false);
            $isName = $this->entityNameParser->isEntityNameColumn($refCol)
                || str_contains(mb_strtolower($refCol), 'nama')
                || str_contains(mb_strtolower($refCol), 'name');
            $isLoc = $this->isLocationColumn($refCol);

            $threshold = $isMandatory ? 100.0 : ($isName ? 90.0 : ($isLoc ? 100.0 : $defaultThreshold));

            $rules[] = [
                'order' => $index + 1,
                'mappingId' => $mapping['id'] ?? (string) $index,
                'field' => "{$mapping['input_column_name']} ↔ {$mapping['reference_column_name']}",
                'method' => $mapping['algorithm'],
                'threshold' => $threshold,
            ];
        }

        return $rules;
    }

    private function isLocationColumn(string $columnName): bool
    {
        $normalized = mb_strtolower($columnName);
        foreach (['kabupaten', 'kota', 'kab', 'provinsi', 'prov', 'wilayah', 'kecamatan', 'kelurahan', 'city', 'province', 'region'] as $kw) {
            if (str_contains($normalized, $kw)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array<string, mixed> $rule
     * @param array<int, array<string, mixed>> $mappings
     * @return array<string, mixed>|null
     */
    private function findMappingForRule(array $rule, array $mappings): ?array
    {
        $ruleMappingId = (string) ($rule['mappingId'] ?? $rule['mapping_id'] ?? '');
        if ($ruleMappingId !== '') {
            foreach ($mappings as $mapping) {
                if ((string) ($mapping['id'] ?? '') === $ruleMappingId) {
                    return $mapping;
                }
            }
        }

        $ruleField = mb_strtolower(trim((string) ($rule['field'] ?? '')));
        if ($ruleField !== '') {
            foreach ($mappings as $mapping) {
                $ref = mb_strtolower((string) $mapping['reference_column_name']);
                $inp = mb_strtolower((string) $mapping['input_column_name']);
                $label = mb_strtolower("{$inp} ↔ {$ref}");

                if ($ruleField === $label || $ruleField === $ref || $ruleField === $inp || str_contains($ruleField, $ref)) {
                    return $mapping;
                }
            }
        }

        return $mappings[0] ?? null;
    }

    /**
     * @param array<string, mixed> $inputRecord
     * @param array<string, mixed> $referenceRecord
     * @param array<int, array<string, mixed>> $mappings
     * @return array<int, array<string, mixed>>
     */
    private function calculateFieldScores(array $inputRecord, array $referenceRecord, array $mappings): array
    {
        $fieldScores = [];

        foreach ($mappings as $mapping) {
            $refCol = $mapping['reference_column_name'];
            $inpCol = $mapping['input_column_name'];

            $isMandatory = (bool) ($mapping['required_match'] ?? false);
            $left = $referenceRecord['normalized'][$refCol] ?? '';
            $right = $inputRecord['normalized'][$inpCol] ?? '';

            $refIdentity = $referenceRecord['identity'][$refCol] ?? null;
            $inpIdentity = $inputRecord['identity'][$inpCol] ?? null;
            $fieldIdentityConflict = $this->entityNameParser->hasStrictLegalConflict($refIdentity, $inpIdentity);

            $score = $isMandatory ? 100.0 : $this->scorer->score($mapping['algorithm'], $left, $right);

            $fieldScores[] = [
                'reference_column' => $refCol,
                'input_column' => $inpCol,
                'algorithm' => $mapping['algorithm'],
                'score' => $score,
                'weight' => max(0.0, (float) ($mapping['weight'] ?? 0)),
                'is_mandatory' => $isMandatory,
                'identity_metadata' => (is_array($refIdentity) || is_array($inpIdentity)) ? [
                    'reference' => $refIdentity,
                    'input' => $inpIdentity,
                ] : null,
                'identity_conflict' => $fieldIdentityConflict,
                'numeric_mismatch' => $this->scorer->hasNumericMismatch($left, $right),
            ];
        }

        return $fieldScores;
    }

    /**
     * @param array<string, mixed>|null $referenceRecord
     * @param array<int, array<string, mixed>> $fieldScores
     * @param array<string, mixed>|null $verificationEvidence
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
        ?array $verificationEvidence = null,
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
            'verification_evidence' => $verificationEvidence !== null ? json_encode($verificationEvidence, JSON_THROW_ON_ERROR) : null,
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function responseFor(MatchingJob $job): array
    {
        $counts = $job->record_counts;
        if (! is_array($counts) || ! isset($counts['matched'])) {
            $counts = $job->calculateDistinctRecordCounts();
        }

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
