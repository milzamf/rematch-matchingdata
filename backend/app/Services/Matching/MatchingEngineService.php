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
use App\Services\Datasets\CsvDatasetParser;
use App\Services\Datasets\XlsxDatasetParser;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

class MatchingEngineService
{
    private readonly FieldValueExtractor $fieldExtractor;

    public function __construct(
        private readonly MatchingConfigResolver $configResolver,
        private readonly ValueNormalizer $normalizer,
        private readonly EntityNameParser $entityNameParser,
        private readonly SimilarityScorer $scorer,
        private readonly ResourceOwnership $ownership,
        ?FieldValueExtractor $fieldExtractor = null,
    ) {
        $this->fieldExtractor = $fieldExtractor ?? new FieldValueExtractor($this->entityNameParser, $this->normalizer);
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

        if (app()->environment('testing') || config('queue.default') === 'sync') {
            RunMatchingJob::dispatchSync($job->id);
        } else {
            RunMatchingJob::dispatch($job->id);
        }

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

        $refRowCount = $reference->row_count > 0 ? (int) $reference->row_count : count($this->loadDatasetRows($reference));
        $rawInputRows = $this->loadDatasetRows($input);
        $dedupAnalysis = $this->analyzeAndDeduplicateInputRows($rawInputRows);
        $inputRowsRaw = $dedupAnalysis['unique_rows'];
        $inpRowCount = count($inputRowsRaw);

        if ($refRowCount === 0 || $inpRowCount === 0) {
            throw new InvalidArgumentException('Reference and input datasets must contain data rows before matching.');
        }

        return DB::transaction(function () use ($payload, $reference, $input, $configuration, $mappings, $workspace, $inpRowCount, $dedupAnalysis) {
            $job = MatchingJob::create([
                'reference_dataset_id' => $reference->id,
                'input_dataset_id' => $input->id,
                'name' => $payload['name'] ?? 'Matching Job',
                'status' => 'processing',
                'processed_count' => 0,
                'total_count' => $inpRowCount,
                'record_counts' => [
                    'matched' => 0,
                    'possible_match' => 0,
                    'unmatched' => 0,
                    'candidates_scored' => 0,
                    'total_raw_input' => $dedupAnalysis['raw_count'],
                    'total_unique_input' => $dedupAnalysis['unique_count'],
                    'total_duplicates' => $dedupAnalysis['duplicate_count'],
                    'duplicate_details' => array_slice($dedupAnalysis['duplicate_details'], 0, 100),
                ],
                'started_at' => Carbon::now(),
            ]);

            foreach ($mappings as $mapping) {
                ColumnMapping::create([
                    'matching_job_id' => $job->id,
                    'reference_column_id' => Str::isUuid($mapping['reference_column_id'] ?? null) ? $mapping['reference_column_id'] : null,
                    'input_column_id' => Str::isUuid($mapping['input_column_id'] ?? null) ? $mapping['input_column_id'] : null,
                    'reference_column_name' => ($mapping['reference_column_name'] ?? null),
                    'input_column_name' => ($mapping['input_column_name'] ?? null),
                    'algorithm' => ($mapping['algorithm'] ?? null),
                    'weight' => ($mapping['weight'] ?? null),
                    'required_match' => ($mapping['required_match'] ?? null),
                    'metadata' => $mapping['metadata'] ?? [],
                ]);
            }

            MatchingConfiguration::create([
                'matching_job_id' => $job->id,
                'preset' => ($configuration['preset'] ?? null),
                'strategy' => ($configuration['strategy'] ?? null),
                'thresholds' => ($configuration['thresholds'] ?? null),
                'normalization' => ($configuration['normalization'] ?? null),
                'search_optimization' => ($configuration['searchOptimization'] ?? null),
                'candidate_generation' => ($configuration['candidateGeneration'] ?? null),
                'output_config' => ($configuration['output'] ?? null),
                'advanced_settings' => [
                    'mode' => ($configuration['mode'] ?? null),
                    'fields' => ($configuration['fields'] ?? null),
                    'weighting' => ($configuration['weighting'] ?? null),
                    'rules' => ($configuration['rules'] ?? null),
                    'runOptions' => ($configuration['runOptions'] ?? null),
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
        @ini_set('memory_limit', '1024M');

        $job->loadMissing(['referenceDataset.columns', 'inputDataset.columns', 'mappings', 'configuration', 'workspace']);

        $reference = $job->referenceDataset;
        $input = $job->inputDataset;

        if (! $reference || ! $input) {
            throw new InvalidArgumentException('Reference and input datasets must be attached to the job.');
        }

        $configModel = $job->configuration;
        $configuration = $this->configResolver->resolve([
            'preset' => $configModel?->preset ?? 'Default',
            'mode' => data_get($configModel?->advanced_settings, 'mode', 'default'),
            'strategy' => $configModel?->strategy ?? 'Hybrid',
            'fields' => data_get($configModel?->advanced_settings, 'fields', []),
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
            'parent_input_column' => data_get($m->metadata, 'parent_input_column'),
            'parent_reference_column' => data_get($m->metadata, 'parent_reference_column'),
            'transform' => data_get($m->metadata, 'transform'),
            'algorithm' => $m->algorithm,
            'weight' => $m->weight,
            'required_match' => $m->required_match,
            'metadata' => $m->metadata,
        ])->all();

        $mappings = $this->resolveMappings($rawMappings, $configuration);

        $referenceRowsRaw = $this->loadDatasetRows($reference);
        $rawInputRows = $this->loadDatasetRows($input);
        $dedupAnalysis = $this->analyzeAndDeduplicateInputRows($rawInputRows);
        $inputRowsRaw = $dedupAnalysis['unique_rows'];
        $totalInputCount = count($inputRowsRaw);

        MatchingResult::where('matching_job_id', $job->id)->delete();

        $job->update([
            'status' => 'processing',
            'processed_count' => 0,
            'total_count' => $totalInputCount,
            'started_at' => Carbon::now(),
        ]);

        try {
            $summary = $this->executePipeline($job, $reference, $input, $referenceRowsRaw, $inputRowsRaw, $mappings, $configuration, $dedupAnalysis);
            
            $job->refresh();
            $finalStatus = in_array($job->status, ['cancelled', 'stopped']) ? $job->status : 'completed';

            $job->update([
                'status' => $finalStatus,
                'processed_count' => $job->processed_count, // Use the actual processed count rather than forcing total count
                'record_counts' => $summary,
                'finished_at' => Carbon::now(),
            ]);

            if ($job->workspace !== null) {
                if ($finalStatus === 'completed') {
                    $job->workspace->update([
                        'matching_job_id' => $job->id,
                        'status' => 'reviewing',
                        'current_step' => 6,
                    ]);
                } elseif (in_array($finalStatus, ['cancelled', 'stopped'])) {
                    $job->workspace->update([
                        'status' => 'configuring',
                    ]);
                }
            }
        } catch (Throwable $exception) {
            $job->update([
                'status' => 'failed',
                'error_message' => substr($exception->getMessage(), 0, 1000),
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
        $configuredFields = collect($configuration['fields'] ?? []);
        $weightByField = collect(data_get($configuration, 'weighting.fields', []));
        $validMappings = [];

        foreach ($rawMappings as $index => $mapping) {
            $refCol = (string) ($mapping['referenceColumnName'] ?? $mapping['reference_column_name'] ?? '');
            $inpCol = (string) ($mapping['inputColumnName'] ?? $mapping['input_column_name'] ?? '');

            if ($refCol === '' || $inpCol === '') {
                continue;
            }

            $mappingId = (string) ($mapping['id'] ?? $mapping['mappingId'] ?? '');

            // Match configured field by mappingId or composite column names
            $configured = $configuredFields->first(function ($cf) use ($mappingId, $refCol, $inpCol) {
                if ($mappingId !== '' && (string) ($cf['mappingId'] ?? '') === $mappingId) {
                    return true;
                }
                $cRef = (string) ($cf['referenceColumnName'] ?? $cf['reference_column_name'] ?? '');
                $cInp = (string) ($cf['inputColumnName'] ?? $cf['input_column_name'] ?? '');
                return ($cRef === $refCol && $cInp === $inpCol);
            }) ?? [];

            $weight = $weightByField->first(function ($wf) use ($mappingId, $refCol, $inpCol) {
                if ($mappingId !== '' && (string) ($wf['mappingId'] ?? '') === $mappingId) {
                    return true;
                }
                $fieldLabel = (string) ($wf['field'] ?? '');
                return str_contains($fieldLabel, $refCol) && str_contains($fieldLabel, $inpCol);
            }) ?? [];

            $parentInput = (string) (
                $mapping['parent_input_column']
                ?? $mapping['parentInputColumn']
                ?? data_get($mapping, 'metadata.parent_input_column')
                ?? data_get($mapping, 'metadata.parentInputColumn')
                ?? ''
            );
            $parentRef = (string) (
                $mapping['parent_reference_column']
                ?? $mapping['parentReferenceColumn']
                ?? data_get($mapping, 'metadata.parent_reference_column')
                ?? data_get($mapping, 'metadata.parentReferenceColumn')
                ?? ''
            );
            $transform = (string) (
                $mapping['transform']
                ?? data_get($mapping, 'metadata.transform')
                ?? ''
            );

            \Illuminate\Support\Facades\Log::info("Resolving Mapping: ", [
                'ref' => $refCol,
                'inp' => $inpCol,
                'transform' => $transform,
                'parent_ref' => $parentRef,
                'parent_inp' => $parentInput
            ]);

            $validMappings[] = [
                'id' => $mappingId !== '' ? $mappingId : (string) Str::uuid(),
                'reference_column_id' => $mapping['referenceColumnId'] ?? $mapping['reference_column_id'] ?? null,
                'input_column_id' => $mapping['inputColumnId'] ?? $mapping['input_column_id'] ?? null,
                'reference_column_name' => $refCol,
                'input_column_name' => $inpCol,
                'parent_input_column' => $parentInput !== '' ? $parentInput : null,
                'parent_reference_column' => $parentRef !== '' ? $parentRef : null,
                'transform' => $transform !== '' ? $transform : null,
                'algorithm' => $this->resolveAlgorithm(($configuration['strategy'] ?? 'Hybrid'), $configured['algorithm'] ?? $mapping['algorithm'] ?? null),
                'weight' => (float) ($weight['weight'] ?? $mapping['weight'] ?? $this->defaultWeight($index, count($rawMappings))),
                'required_match' => (bool) ($mapping['required_match'] ?? $mapping['strict'] ?? $mapping['is_mandatory'] ?? false),
                'metadata' => [
                    'suggested' => $mapping['suggested'] ?? false,
                    'suggestion_source' => $mapping['suggestionSource'] ?? null,
                    'suggestion_score' => $mapping['suggestionScore'] ?? null,
                    'parent_input_column' => $parentInput !== '' ? $parentInput : null,
                    'parent_reference_column' => $parentRef !== '' ? $parentRef : null,
                    'transform' => $transform !== '' ? $transform : null,
                ],
            ];
        }

        $totalWeight = array_sum(array_column($validMappings, 'weight'));

        if ($totalWeight > 0) {
            foreach ($validMappings as &$mapping) {
                $mapping['weight'] = round((($mapping['weight'] ?? 1) / $totalWeight) * 100, 2);
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

    public function resolveFieldValue(array $row, string $columnName, ?array $parsedEntity = null): ?string
    {
        if ($columnName === '') {
            return null;
        }

        // 1. Direct array key match
        if (array_key_exists($columnName, $row) && $row[$columnName] !== null) {
            return (string) $row[$columnName];
        }

        // 2. Synthetic/Generated Nama Inti / Core Name
        if (
            str_contains($columnName, '[Generated] Nama Inti') ||
            str_contains($columnName, 'Nama Inti') ||
            $columnName === 'core_name' ||
            $columnName === 'virtual_core_name'
        ) {
            if ($parsedEntity !== null && ! empty($parsedEntity['core_name'])) {
                return (string) $parsedEntity['core_name'];
            }

            $nameVal = $this->findEntityNameValue($row);
            if ($nameVal !== null) {
                $parsed = $this->entityNameParser->parse($nameVal);
                return $parsed['core_name'] !== '' ? $parsed['core_name'] : $nameVal;
            }

            return null;
        }

        // 3. Synthetic/Generated Badan Usaha / Legal Structure
        if (
            str_contains($columnName, '[Generated] Badan Usaha') ||
            str_contains($columnName, 'Badan Usaha') ||
            $columnName === 'legal_structure' ||
            $columnName === 'legal_form' ||
            $columnName === 'virtual_legal_form'
        ) {
            if ($parsedEntity !== null && ! empty($parsedEntity['legal_form'])) {
                return (string) $parsedEntity['legal_form'];
            }

            $nameVal = $this->findEntityNameValue($row);
            if ($nameVal !== null) {
                $parsed = $this->entityNameParser->parse($nameVal);
                return $parsed['legal_form'] ?? '';
            }

            return null;
        }

        // 4. Case-insensitive lookup fallback
        $normalizedSearch = mb_strtolower(trim($columnName));
        foreach ($row as $col => $val) {
            if (mb_strtolower(trim((string) $col)) === $normalizedSearch && $val !== null) {
                return (string) $val;
            }
        }

        return $row[$columnName] ?? null;
    }

    private function resolveColumnValue(array $row, string $columnName, ?array $parsedEntity = null): ?string
    {
        return $this->resolveFieldValue($row, $columnName, $parsedEntity);
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

                // Pre-extract entity name parsed object from row once if possible
                $entityNameVal = $this->findEntityNameValue($row);
                $parsedEntity = $entityNameVal !== null ? $this->entityNameParser->parse($entityNameVal) : null;

                foreach ($mappings as $mapping) {
                    $columnName = (string) ($mapping[$columnKey] ?? '');
                    if ($columnName === '') {
                        continue;
                    }

                    $rawValue = $this->fieldExtractor->extract($row, $mapping, $columnKey, $parsedEntity);
                    $dataType = $columnDataTypes[$columnName] ?? null;

                    if (($mapping['transform'] ?? null) === 'EXTRACT_LEGAL_FORM') {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, 'text', $columnName);
                        $identity[$columnName] = ['legal_form' => $rawValue];
                        continue;
                    }

                    if (($mapping['transform'] ?? null) === 'EXTRACT_CORE_NAME') {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, 'text', $columnName);
                        $identity[$columnName] = ['core_name' => $rawValue];
                        continue;
                    }

                    $parsedCurrent = $this->entityNameParser->parse($rawValue);
                    $isEntityName = $this->entityNameParser->isEntityNameColumn($columnName)
                        || $this->entityNameParser->hasEntityMetadata($parsedCurrent);

                    if ($isEntityName) {
                        $normalized[$columnName] = $this->normalizer->normalizeByType($parsedCurrent['core_name'], $dataType, $columnName);
                        $identity[$columnName] = $parsedCurrent;

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
     * @param array<int, array<string, mixed>> $referenceRowsRaw
     * @param array<int, array<string, mixed>> $inputRowsRaw
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<string, int>
     */
    private function executePipeline(
        MatchingJob $job,
        Dataset $reference,
        Dataset $input,
        array $referenceRowsRaw,
        array $inputRowsRaw,
        array $mappings,
        array $configuration,
        array $dedupAnalysis = [],
    ): array {
        $totalWallClockStart = microtime(true);
        $metrics = [
            'INDEX_REUSED' => false,
            'index_initialization_ms' => 0.0,
            'multisearch_ms' => 0.0,
            'scoring_ms' => 0.0,
            'db_write_ms' => 0.0,
            'total_wall_clock_ms' => 0.0,
        ];

        $refColTypes = $reference->columns ? $reference->columns->pluck('data_type', 'name')->all() : [];
        $inpColTypes = $input->columns ? $input->columns->pluck('data_type', 'name')->all() : [];

        // ---------------------------------------------------------------------
        // Phase 1: Automatic Normalization
        // ---------------------------------------------------------------------
        $referenceRows = $this->normalizeRows($referenceRowsRaw, $mappings, 'reference_column_name', $refColTypes);
        $inputRows = $this->normalizeRows($inputRowsRaw, $mappings, 'input_column_name', $inpColTypes);

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

        // Candidate Generation Index for Phase 3 via Meilisearch
        $indexInitStart = microtime(true);
        $httpClient = new \GuzzleHttp\Client(['timeout' => 15, 'connect_timeout' => 10]);
        $client = new \Meilisearch\Client(env('MEILISEARCH_HOST', 'http://127.0.0.1:7700'), env('MEILISEARCH_KEY', ''), $httpClient);
        $indexUid = 'matching_reference_' . str_replace('-', '_', $reference->id);
        
        $indexReused = false;
        $isIndexValid = false;
        try {
            $stats = $client->getIndex($indexUid)->stats();
            if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                $isIndexValid = true;
            }
        } catch (\Throwable $e) {}
        
        if ($isIndexValid) {
            $indexReused = true;
        } else {
            $lockKey = 'build_index_' . $indexUid;
            $lock = \Illuminate\Support\Facades\Cache::lock($lockKey, 120);
            try {
                $lock->block(60); 
                try {
                    $stats = $client->getIndex($indexUid)->stats();
                    if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                        $indexReused = true;
                    }
                } catch (\Throwable $e) {}
                
                if (!$indexReused) {
                    try {
                        $client->deleteIndex($indexUid);
                    } catch (\Throwable $e) {}
                    
                    $searchableDocuments = [];
                    $searchableAttributes = [];
                    foreach ($mappings as $mapping) {
                        $colName = $mapping['reference_column_name'] ?? '';
                        if ($colName !== '') {
                            $searchableAttributes[] = 'col_' . md5($colName);
                        }
                    }
                    
                    foreach ($referenceRows as $refRecord) {
                        $doc = ['id' => $refRecord['key']];
                        foreach ($mappings as $mapping) {
                            $colName = $mapping['reference_column_name'] ?? '';
                            if ($colName !== '') {
                                $doc['col_' . md5($colName)] = $refRecord['normalized'][$colName] ?? '';
                            }
                        }
                        $searchableDocuments[] = $doc;
                    }

                    $index = $client->index($indexUid);
                    $task = $index->updateSearchableAttributes($searchableAttributes);
                    $client->waitForTask($task['taskUid']);
                    
                    if (count($searchableDocuments) > 0) {
                        foreach(array_chunk($searchableDocuments, 10000) as $chunkDocs) {
                            $task = $index->addDocuments($chunkDocs);
                            $client->waitForTask($task['taskUid']);
                        }
                    }
                }
            } finally {
                $lock?->release();
            }
        }
        $indexes = ['uid' => $indexUid, 'client' => $client];
        $metrics['INDEX_REUSED'] = $indexReused;
        $metrics['index_initialization_ms'] = (microtime(true) - $indexInitStart) * 1000;

        $chunkSize = max(500, (int) ($configuration['runOptions']['chunkSize'] ?? 500));
        $workerCount = ($configuration['runOptions']['workerCount'] ?? 1);
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);

        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
            'total_raw_input' => $dedupAnalysis['raw_count'] ?? count($inputRowsRaw),
            'total_unique_input' => $dedupAnalysis['unique_count'] ?? count($inputRowsRaw),
            'total_duplicates' => $dedupAnalysis['duplicate_count'] ?? 0,
            'duplicate_details' => array_slice($dedupAnalysis['duplicate_details'] ?? [], 0, 100),
        ];
        $processed = 0;
        $memoizationCache = [];

        foreach (array_chunk($inputRows, $chunkSize) as $chunkIndex => $chunk) {
            $scoringStart = microtime(true);
            $job->refresh();
            if ($job->status === 'cancelled' || $job->status === 'stopped') {
                \Log::info("Matching job {$job->id} cancellation detected. Halting execution loop.");
                break;
            }

            $workerSlot = $chunkIndex % $workerCount;
            $batchResults = [];

            // -------------------------------------------------------------
            // Phase 1.6: Batch Candidate Generation via Meilisearch
            // -------------------------------------------------------------
            $searchQueriesToExecute = [];
            $recordsToEvaluate = [];
            
            foreach ($chunk as $idx => $inputRecord) {
                // -------------------------------------------------------------
                // Phase 1.5: Memoization (Intra-Job Deduplication)
                // -------------------------------------------------------------
                $signatureString = '';
                foreach ($mappings as $mapping) {
                    $col = ($mapping['input_column_name'] ?? null);
                    // Use the RAW value from the row to ensure we only deduplicate exactly identical strings
                    // This prevents collisions where two different raw strings (e.g., 'CV Satu Data' and 'Satu Data')
                    // normalize to the same core name ('satu data') but have different identity metadata.
                    $signatureString .= ($inputRecord['row'][$col] ?? '') . '|';
                }
                $cacheKey = md5(strtolower(trim($signatureString)));

                if (isset($memoizationCache[$cacheKey])) {
                    $cachedData = $memoizationCache[$cacheKey];
                    $summary['candidates_scored'] += $cachedData['candidates_scored'];
                    $summary[$cachedData['status']]++;

                    foreach ($cachedData['results'] as $cachedRow) {
                        $cachedRow['id'] = (string) Str::uuid();
                        $cachedRow['input_record_key'] = $inputRecord['key'];

                        $meta = json_decode($cachedRow['candidate_metadata'], true);
                        $meta['input_record'] = $inputRecord['row'];
                        $cachedRow['candidate_metadata'] = json_encode($meta, JSON_THROW_ON_ERROR);

                        $batchResults[] = $cachedRow;
                    }
                    continue;
                }

                $candidatesScoredForThisRecord = 0;
                $exactMatchFound = false;
                $exactMatchResults = [];

                // -------------------------------------------------------------
                // Phase 2: Mandatory / Exact Phase
                // -------------------------------------------------------------
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
                            $candidatesScoredForThisRecord += count($exactRefs);
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

                                $resRow = $this->resultRow(
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
                                $batchResults[] = $resRow;
                                $exactMatchResults[] = $resRow;
                            }
                        }
                    }
                }

                if ($exactMatchFound) {
                    if (count($memoizationCache) >= 1000) {
                        $memoizationCache = array_slice($memoizationCache, -500, null, true);
                    }
                    $memoizationCache[$cacheKey] = [
                        'results' => $exactMatchResults,
                        'status' => 'matched',
                        'candidates_scored' => $candidatesScoredForThisRecord,
                    ];
                    continue; // Bypass Phase 3 and Phase 4
                }

                // Needs fuzzy matching via Meilisearch!
                $searchTerms = [];
                foreach ($mappings as $mapping) {
                    $colName = $mapping['input_column_name'] ?? '';
                    if ($colName !== '') {
                        $term = (string) ($inputRecord['normalized'][$colName] ?? '');
                        if ($term !== '') {
                            $searchTerms[] = $term;
                        }
                    }
                }
                usort($searchTerms, fn($a, $b) => strlen($b) <=> strlen($a));
                
                $searchQuery = implode(' ', $searchTerms);
                $searchQueriesToExecute[$idx] = [
                    'query' => $searchQuery,
                    'cacheKey' => $cacheKey,
                ];
                $recordsToEvaluate[$idx] = $inputRecord;
            }
            
            // Execute batch search
            $searchResultsByIndex = [];
            if (!empty($searchQueriesToExecute)) {
                $queries = [];
                $idxMap = [];
                foreach ($searchQueriesToExecute as $idx => $meta) {
                    $queries[] = (new \Meilisearch\Contracts\SearchQuery())
                        ->setIndexUid($indexes['uid'])
                        ->setQuery($meta['query'])
                        ->setLimit(max($topN, 3));
                    $idxMap[] = $idx;
                }
                
                try {
                    $msStart = microtime(true);
                    $multiResults = $indexes['client']->multiSearch($queries)['results'] ?? [];
                    $metrics['multisearch_ms'] += (microtime(true) - $msStart) * 1000;
                    foreach ($multiResults as $resultIndex => $searchResult) {
                        $originalIdx = $idxMap[$resultIndex];
                        $searchResultsByIndex[$originalIdx] = $searchResult['hits'] ?? [];
                    }
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::error('Meilisearch MultiSearch Error: ' . $e->getMessage());
                }
            }
            
            // Process evaluateCandidates for the fuzzy records
            foreach ($recordsToEvaluate as $idx => $inputRecord) {
                $meta = $searchQueriesToExecute[$idx];
                $cacheKey = $meta['cacheKey'];
                $candidatesScoredForThisRecord = 0;
                $recordFuzzyResults = [];
                
                $hits = $searchResultsByIndex[$idx] ?? [];
                $candidates = [];
                foreach ($hits as $hit) {
                    $refKey = $hit['id'];
                    if (isset($referenceByKey[$refKey])) {
                        $candidates[] = $referenceByKey[$refKey];
                    }
                }

                // -------------------------------------------------------------
                // Phase 3 & Phase 4: Similarity Scoring & Verification Guardrails
                // -------------------------------------------------------------
                $scoredCandidates = $this->evaluateCandidates(
                    $inputRecord,
                    $candidates,
                    $mappings,
                    $configuration
                );

                $candidatesScoredForThisRecord += count($scoredCandidates);
                $summary['candidates_scored'] += count($scoredCandidates);

                if ($scoredCandidates === []) {
                    $unmatchedRow = $this->resultRow(
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
                    $batchResults[] = $unmatchedRow;
                    $summary['unmatched']++;
                    if (count($memoizationCache) >= 1000) {
                        $memoizationCache = array_slice($memoizationCache, -500, null, true);
                    }
                    $memoizationCache[$cacheKey] = [
                        'results' => [$unmatchedRow],
                        'status' => 'unmatched',
                        'candidates_scored' => $candidatesScoredForThisRecord,
                    ];
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

                    $resRow = $this->resultRow(
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
                    $batchResults[] = $resRow;
                    $recordFuzzyResults[] = $resRow;
                }

                if (count($memoizationCache) >= 1000) {
                    $memoizationCache = array_slice($memoizationCache, -500, null, true);
                }
                $memoizationCache[$cacheKey] = [
                    'results' => $recordFuzzyResults,
                    'status' => $rowOutcome,
                    'candidates_scored' => $candidatesScoredForThisRecord,
                ];
            }

            $metrics['scoring_ms'] += (microtime(true) - $scoringStart) * 1000;
            $dbStart = microtime(true);
            DB::transaction(function () use ($batchResults, $job, $processed, $chunk, $summary) {
                if (! empty($batchResults)) {
                    foreach (array_chunk($batchResults, 50) as $insertBatch) {
                        MatchingResult::insert($insertBatch);
                    }
                }

                $job->update([
                    'processed_count' => $processed + count($chunk),
                    'record_counts' => $summary,
                ]);
            });
            $metrics['db_write_ms'] += (microtime(true) - $dbStart) * 1000;

            $processed += count($chunk);
            unset($batchResults, $searchQueriesToExecute, $recordsToEvaluate, $searchResultsByIndex, $chunk);
            gc_collect_cycles();
        }

        $metrics['total_wall_clock_ms'] = (microtime(true) - $totalWallClockStart) * 1000;
        \Illuminate\Support\Facades\Log::info('MATCHING_METRICS', $metrics);

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
        array $candidates,
        array $mappings,
        array $configuration
    ): array {
        $evaluated = [];

        $autoMatchThreshold = (float) (($configuration['thresholds'] ?? null)['autoMatch'] ?? 90);
        $reviewThreshold = (float) (($configuration['thresholds'] ?? null)['review'] ?? 75);

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
                $refCol = ($mapping['reference_column_name'] ?? null);
                $inpCol = ($mapping['input_column_name'] ?? null);

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

                $algorithm = ($mapping['algorithm'] ?? null);
                if ($left === '' && $right === '') {
                    $refLegal = $refIdentity['legal_form'] ?? null;
                    $inpLegal = $inpIdentity['legal_form'] ?? null;
                    if ($refLegal !== null && $inpLegal !== null && $refLegal === $inpLegal) {
                        $score = 100.0;
                    } else {
                        $rawLeft = trim((string) ($candidate['row'][$refCol] ?? ''));
                        $rawRight = trim((string) ($inputRecord['row'][$inpCol] ?? ''));
                        if ($rawLeft !== '' && $rawRight !== '') {
                            $score = $this->scorer->score($algorithm, $rawLeft, $rawRight);
                        } else {
                            $score = 0.0;
                        }
                    }
                } else {
                    $score = $this->scorer->score($algorithm, $left, $right);
                }

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
            // Phase 4: Verification & Decision Tree Evaluation
            // -----------------------------------------------------------------
            $presetName = (string) ($configuration['preset'] ?? '');
            $modeName = (string) ($configuration['mode'] ?? '');
            $isConstructionPreset = (strcasecmp($presetName, 'Konstruksi') === 0 || strcasecmp($presetName, 'Construction') === 0 || strcasecmp($modeName, 'construction') === 0);

            $rulesEvaluated = [];
            $allRulesPassed = true;
            $failedRuleReasons = [];
            $downgraded = false;
            $downgradeReason = null;
            $finalClassification = $initialClassification;

            // Map field scores by column names for rapid lookup
            $fieldScoreByMapping = collect($fieldScores)->keyBy(function ($fs) {
                return $fs['reference_column'].'|'.$fs['input_column'];
            });

            if ($isConstructionPreset) {
                // -------------------------------------------------------------
                // PRESET KONSTRUKSI DECISION TREE (ISO 5807 Flowchart Implementation)
                // -------------------------------------------------------------
                $cityScore = $this->extractFieldScore($fieldScores, ['kab', 'kota', 'city', 'location', 'wilayah', 'kdkab']);
                $nameScore = $this->extractFieldScore($fieldScores, ['nama inti', 'core name', 'nama_perusahaan', 'nama_penyedia', 'nama', 'name', 'company']);
                $addrScore = $this->extractFieldScore($fieldScores, ['alamat', 'address']);
                $isActive = $this->resolveRecordActiveStatus($candidate);

                $cityPassed = (round($cityScore, 2) >= 100.0);
                $nameAddrPassed = (round($nameScore, 2) >= 100.0 && round($addrScore, 2) >= 100.0);

                // Step 1: Evaluasi 1 (similarity_total >= 90%?)
                $rulesEvaluated[] = [
                    'order' => 1,
                    'field' => 'Skor Total WLS (Nama 55% + Alamat 30% + Badan Usaha 10% + Kode Kab 5%)',
                    'method' => 'WLS Formula',
                    'required_threshold' => 90.0,
                    'actual_score' => $ws,
                    'passed' => ($ws >= 90.0),
                    'is_mandatory' => false,
                ];

                if ($ws < 90.0) {
                    // Evaluasi 1.1 (Ambang Sedang: similarity_total antara 80% - 89%?)
                    $inReviewRange = ($ws >= 80.0);
                    $rulesEvaluated[] = [
                        'order' => 2,
                        'field' => 'Pemeriksaan Ambang Sedang (80% - 89%)',
                        'method' => 'Range Check (80% - 89%)',
                        'required_threshold' => 80.0,
                        'actual_score' => $ws,
                        'passed' => $inReviewRange,
                        'is_mandatory' => false,
                    ];

                    if ($inReviewRange) {
                        $allRulesPassed = false;
                        $finalClassification = 'possible_match';
                        $decisionReason = "Skor total kemiripan {$ws}% berada pada ambang sedang (80% - 89%) -> Reviu Manual (Keputusan di tangan User)";
                    } else {
                        $allRulesPassed = false;
                        $finalClassification = 'unmatched';
                        $decisionReason = "Skor total kemiripan {$ws}% < 80% -> Tidak Cocok (Masukkan record ke tabel Referensi)";
                    }
                } else {
                    // ws >= 90% -> Masuk ke pemeriksaan variabel pendukung
                    // Step 2: Evaluasi 2 (Apakah kemiripan_kota == 100%?)
                    $rulesEvaluated[] = [
                        'order' => 2,
                        'field' => 'Evaluasi 2: Kemiripan Kota / Kabupaten == 100%',
                        'method' => 'Exact Match',
                        'required_threshold' => 100.0,
                        'actual_score' => $cityScore,
                        'passed' => $cityPassed,
                        'is_mandatory' => true,
                    ];

                    if ($cityPassed) {
                        // EARLY EXIT / TERMINAL MATCH! Rule 1 & Rule 2 lolos -> STOP, AUTO-MATCH (DROP record duplikat)
                        $allRulesPassed = true;
                        $finalClassification = 'matched';
                        $decisionReason = "Skor total kemiripan {$ws}% >= 90% dan Kemiripan Kota 100% -> Cocok (Drop record duplikat)";
                    } else {
                        // Evaluasi 3: Apakah kemiripan_nama_perusahaan == 100% DAN kemiripan_alamat == 100%?
                        $rulesEvaluated[] = [
                            'order' => 3,
                            'field' => 'Evaluasi 3: Syarat Ganda (Nama Perusahaan 100% DAN Alamat 100%)',
                            'method' => 'Exact Dual Match',
                            'required_threshold' => 100.0,
                            'actual_score' => min($nameScore, $addrScore),
                            'passed' => $nameAddrPassed,
                            'is_mandatory' => true,
                        ];

                        if (! $nameAddrPassed) {
                            $allRulesPassed = false;
                            $finalClassification = 'unmatched';
                            $decisionReason = "Kemiripan kota {$cityScore}% < 100% dan syarat ganda (Nama {$nameScore}%, Alamat {$addrScore}%) tidak terpenuhi -> Tidak Cocok (Masukkan record ke tabel Referensi)";
                        } else {
                            // Evaluasi 4: Apakah Referensi.is_active == 1?
                            $rulesEvaluated[] = [
                                'order' => 4,
                                'field' => 'Evaluasi 4: Status Referensi Aktif (is_active == 1)',
                                'method' => 'Active Status Flag',
                                'required_threshold' => 100.0,
                                'actual_score' => $isActive ? 100.0 : 0.0,
                                'passed' => $isActive,
                                'is_mandatory' => true,
                            ];

                            if ($isActive) {
                                $allRulesPassed = true;
                                $finalClassification = 'matched';
                                $decisionReason = "Nama & Alamat 100% dan Status Referensi Aktif (is_active == 1) -> Cocok (Drop record duplikat)";
                            } else {
                                $allRulesPassed = false;
                                $finalClassification = 'unmatched';
                                $decisionReason = "Nama & Alamat 100% namun Status Referensi Tidak Aktif (is_active == 0) -> Tidak Cocok (Masukkan record ke tabel Referensi)";
                            }
                        }
                    }
                }
            } elseif ($initialClassification !== 'unmatched' && count($verificationRules) > 0) {
                // Standard Guardrails Loop
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

                // Downgrade logic for standard guardrails
                if ($numericConflict && ($initialClassification === 'matched' || ! $allRulesPassed)) {
                    $finalClassification = 'possible_match';
                    $downgraded = true;
                    $downgradeReason = 'Numeric sequence mismatch requires review';
                    $decisionReason = 'Numeric sequence mismatch requires review';
                } elseif ($initialClassification === 'matched' && ! $allRulesPassed) {
                    $finalClassification = 'possible_match';
                    $downgraded = true;
                    $downgradeReason = implode('; ', $failedRuleReasons);
                    $decisionReason = "Auto-match downgraded to needs_review: {$downgradeReason}";
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
            } else {
                if ($finalClassification === 'matched') {
                    $decisionReason = 'Auto-match verified';
                } elseif ($finalClassification === 'possible_match') {
                    $decisionReason = "Needs review (score: {$ws}%)";
                } else {
                    $decisionReason = "Unmatched (score: {$ws}% below review threshold)";
                }
            }

            $verificationEvidence = [
                'phase' => $isConstructionPreset ? 'Phase 4: Decision Tree Preset Konstruksi' : 'Phase 4: Ordered Partial Verification',
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

        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);
        return array_slice($evaluated, 0, $topN);
    }

    /**
     * @param array<string, mixed> $configuration
     * @param array<int, array<string, mixed>> $mappings
     * @return array<int, array<string, mixed>>
     */
    private function resolveVerificationRules(array $configuration, array $mappings, float $defaultThreshold): array
    {
        $rules = data_get($configuration, 'rules') ?? data_get($configuration, 'advanced_settings.rules');

        // Check if verification is explicitly disabled
        $verificationEnabled = data_get($rules, 'verificationEnabled');
        if ($verificationEnabled === false || $verificationEnabled === 0 || $verificationEnabled === '0') {
            return [];
        }

        $customRules = data_get($rules, 'verificationOrder')
            ?? data_get($configuration, 'rules.verificationOrder')
            ?? data_get($configuration, 'advanced_settings.rules.verificationOrder');

        if (is_array($customRules) && count($customRules) > 0) {
            return $customRules;
        }

        // If rules was explicitly provided with empty verificationOrder, do not run rules
        if ($rules !== null && is_array($rules) && isset($rules['verificationOrder']) && count($rules['verificationOrder']) === 0) {
            return [];
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

        $rulesList = [];
        foreach ($sorted as $index => $mapping) {
            $refCol = (string) ($mapping['reference_column_name'] ?? null);
            $isMandatory = (bool) ($mapping['required_match'] ?? false);
            $isName = $this->entityNameParser->isEntityNameColumn($refCol)
                || str_contains(mb_strtolower($refCol), 'nama')
                || str_contains(mb_strtolower($refCol), 'name');
            $isLoc = $this->isLocationColumn($refCol);

            $threshold = $isMandatory ? 100.0 : ($isName ? 90.0 : ($isLoc ? 100.0 : $defaultThreshold));

            $rulesList[] = [
                'order' => $index + 1,
                'mappingId' => $mapping['id'] ?? (string) $index,
                'field' => ($mapping['input_column_name'] ?? null) . " <-> " . ($mapping['reference_column_name'] ?? null),
                'method' => ($mapping['algorithm'] ?? 'Jaro-Winkler'),
                'threshold' => $threshold,
            ];
        }

        return $rulesList;
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
                $ref = mb_strtolower((string) ($mapping['reference_column_name'] ?? ''));
                $inp = mb_strtolower((string) ($mapping['input_column_name'] ?? ''));
                $label = mb_strtolower("{$inp} ↔ {$ref}");
                $labelAlt = mb_strtolower("{$inp} <-> {$ref}");

                if ($ruleField === $label || $ruleField === $labelAlt || $ruleField === $ref || $ruleField === $inp || str_contains($ruleField, $ref) || str_contains($ruleField, $inp)) {
                    return $mapping;
                }
            }
        }

        return null;
    }

    /**
     * Extract field score matching any of given keyword substrings.
     *
     * @param array<int, array<string, mixed>> $fieldScores
     * @param list<string> $keywords
     */
    private function extractFieldScore(array $fieldScores, array $keywords): float
    {
        foreach ($fieldScores as $fs) {
            $ref = mb_strtolower((string) ($fs['reference_column'] ?? ''));
            $inp = mb_strtolower((string) ($fs['input_column'] ?? ''));

            foreach ($keywords as $kw) {
                if (str_contains($ref, $kw) || str_contains($inp, $kw)) {
                    return (float) ($fs['score'] ?? 0.0);
                }
            }
        }

        return 0.0;
    }

    /**
     * Resolve active status flag for candidate/reference record (is_active == 1).
     *
     * @param array<string, mixed> $candidate
     */
    private function resolveRecordActiveStatus(array $candidate): bool
    {
        $raw = $candidate['row'] ?? $candidate['raw'] ?? [];
        $norm = $candidate['normalized'] ?? [];
        $merged = array_merge($norm, $raw);

        foreach ($merged as $key => $val) {
            $k = mb_strtolower((string) $key);
            if (
                in_array($k, ['is_active', 'status_perusahaan', 'status', 'active', 'is_aktif', 'status_aktif', 'status_penyedia', 'status_badan_usaha'], true)
                || str_contains($k, 'is_active')
                || str_contains($k, 'status_perusahaan')
            ) {
                $v = mb_strtolower(trim((string) $val));
                if (in_array($v, ['0', 'false', 'tidak aktif', 'inactive', 'tutup', 'nonaktif', 'non-aktif', 'non active', 't'], true)) {
                    return false;
                }
                if (in_array($v, ['1', 'true', 'aktif', 'active', 'ya', 'yes', 'a'], true)) {
                    return true;
                }
            }
        }

        // If no explicit inactive flag is found, default to active (1)
        return true;
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
            $refCol = ($mapping['reference_column_name'] ?? null);
            $inpCol = ($mapping['input_column_name'] ?? null);

            $isMandatory = (bool) ($mapping['required_match'] ?? false);
            $left = $referenceRecord['normalized'][$refCol] ?? '';
            $right = $inputRecord['normalized'][$inpCol] ?? '';

            $refIdentity = $referenceRecord['identity'][$refCol] ?? null;
            $inpIdentity = $inputRecord['identity'][$inpCol] ?? null;
            $fieldIdentityConflict = $this->entityNameParser->hasStrictLegalConflict($refIdentity, $inpIdentity);

            $score = $isMandatory ? 100.0 : $this->scorer->score(($mapping['algorithm'] ?? null), $left, $right);

            $fieldScores[] = [
                'reference_column' => $refCol,
                'input_column' => $inpCol,
                'algorithm' => ($mapping['algorithm'] ?? null),
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

        $rawInput = (int) ($counts['total_raw_input'] ?? $job->inputDataset?->row_count ?? $job->total_count);
        $uniqueInput = (int) ($counts['total_unique_input'] ?? $job->total_count);
        $duplicates = (int) ($counts['total_duplicates'] ?? max(0, $rawInput - $uniqueInput));
        $duplicateDetails = $counts['duplicate_details'] ?? [];

        if (empty($duplicateDetails) && $duplicates > 0 && $job->inputDataset) {
            try {
                $rawRows = $this->loadDatasetRows($job->inputDataset);
                $analysis = $this->analyzeAndDeduplicateInputRows($rawRows);
                $rawInput = $analysis['raw_count'];
                $uniqueInput = $analysis['unique_count'];
                $duplicates = $analysis['duplicate_count'];
                $duplicateDetails = array_slice($analysis['duplicate_details'], 0, 100);
            } catch (\Throwable $e) {
            }
        }

        return [
            'job' => [
                'id' => $job->id,
                'name' => $job->name,
                'status' => $job->status,
                'reference_dataset_id' => $job->reference_dataset_id,
                'input_dataset_id' => $job->input_dataset_id,
                'total_count' => $job->total_count,
                'processed_count' => $job->processed_count,
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
                'total_raw_input' => $rawInput,
                'total_unique_input' => $uniqueInput,
                'total_duplicates' => $duplicates,
                'duplicate_details' => $duplicateDetails,
            ],
            'top_results' => $job->results()
                ->orderByDesc('overall_score')
                ->limit(10)
                ->get(['id', 'input_record_key', 'reference_record_key', 'result_type', 'overall_score', 'candidate_rank'])
                ->all(),
        ];
    }

    /**
     * Public alias to dynamically load full dataset rows from disk storage.
     *
     * @return array<int, array<string, mixed>>
     */
    public function loadFullRows(Dataset $dataset): array
    {
        return $this->loadDatasetRows($dataset);
    }

    /**
     * Dynamically loads full dataset rows from disk storage,
     * with graceful fallback to preview_rows for unit test fixtures.
     *
     * @return array<int, array<string, mixed>>
     */
    public function loadDatasetRows(Dataset $dataset): array
    {
        $storagePath = $dataset->storage_path;
        if (empty($storagePath)) {
            return $dataset->preview_rows ?? [];
        }

        $candidates = [
            Storage::disk('local')->path($storagePath),
            storage_path('app/' . $storagePath),
            storage_path('app/private/' . $storagePath),
            $storagePath,
        ];

        $filePath = null;
        foreach ($candidates as $candidate) {
            if (is_string($candidate) && file_exists($candidate) && is_readable($candidate)) {
                $filePath = $candidate;
                break;
            }
        }

        if ($filePath === null) {
            return $dataset->preview_rows ?? [];
        }

        $format = strtolower((string) ($dataset->file_format ?: pathinfo($filePath, PATHINFO_EXTENSION)));

        try {
            if ($format === 'csv') {
                $delimiter = $dataset->delimiter;
                $headerRow = max(1, (int) ($dataset->header_row ?? 1));

                $parser = new CsvDatasetParser();
                $uploaded = new UploadedFile(
                    $filePath,
                    $dataset->original_filename ?: basename($filePath),
                    $dataset->mime_type ?: 'text/csv',
                    null,
                    true
                );

                $parsed = $parser->parse($uploaded, [
                    'delimiter' => $delimiter,
                    'header_row' => $headerRow,
                ]);

                return $parsed->rows;
            }

            if ($format === 'xlsx' || $format === 'xls') {
                $parser = new XlsxDatasetParser();
                $uploaded = new UploadedFile(
                    $filePath,
                    $dataset->original_filename ?: basename($filePath),
                    $dataset->mime_type ?: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    null,
                    true
                );

                $parsed = $parser->parse($uploaded, [
                    'sheet_name' => $dataset->selected_sheet,
                    'header_row' => (int) ($dataset->header_row ?? 1),
                ]);

                return $parsed->rows;
            }
        } catch (Throwable $e) {
            Log::warning("Failed to stream full dataset [{$filePath}]: " . $e->getMessage() . ". Falling back to preview_rows.");
        }

        return $dataset->preview_rows ?? [];
    }

    /**
     * Analyze and deduplicate input rows, returning unique rows and comprehensive duplicate metadata.
     *
     * @param array<int, array<string, mixed>> $rows
     * @return array{
     *     unique_rows: array<int, array<string, mixed>>,
     *     raw_count: int,
     *     unique_count: int,
     *     duplicate_count: int,
     *     duplicate_details: array<int, array<string, mixed>>
     * }
     */
    public function analyzeAndDeduplicateInputRows(array $rows): array
    {
        $seen = [];
        $unique = [];
        $duplicateCounts = [];
        $duplicateSamples = [];

        foreach ($rows as $index => $row) {
            $normalizedRow = array_map(function ($val) {
                if (is_string($val)) {
                    return strtolower(trim($val));
                }
                return $val;
            }, $row);
            ksort($normalizedRow);

            $sig = md5(json_encode($normalizedRow));

            if (! isset($seen[$sig])) {
                $seen[$sig] = true;
                $unique[] = $row;
                $duplicateCounts[$sig] = 1;
                $duplicateSamples[$sig] = [
                    'sample_row' => $row,
                    'first_row_index' => $index + 1,
                ];
            } else {
                $duplicateCounts[$sig]++;
            }
        }

        $duplicateDetails = [];
        foreach ($duplicateCounts as $sig => $count) {
            if ($count > 1) {
                $sample = $duplicateSamples[$sig];
                $duplicateDetails[] = [
                    'sample_row' => $sample['sample_row'],
                    'first_row_index' => $sample['first_row_index'],
                    'duplicate_count' => $count - 1,
                    'total_occurrences' => $count,
                ];
            }
        }

        usort($duplicateDetails, fn ($a, $b) => $b['total_occurrences'] <=> $a['total_occurrences']);

        return [
            'unique_rows' => $unique,
            'raw_count' => count($rows),
            'unique_count' => count($unique),
            'duplicate_count' => count($rows) - count($unique),
            'duplicate_details' => $duplicateDetails,
        ];
    }

    /**
     * Deduplicate input rows so identical company records appearing multiple times are only matched once.
     *
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    public function deduplicateInputRows(array $rows): array
    {
        return $this->analyzeAndDeduplicateInputRows($rows)['unique_rows'];
    }
}
