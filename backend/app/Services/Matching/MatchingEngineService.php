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
    private readonly MatchingCheckpointManager $checkpointManager;

    public function __construct(
        private readonly MatchingConfigResolver $configResolver,
        private readonly ValueNormalizer $normalizer,
        private readonly EntityNameParser $entityNameParser,
        private readonly SimilarityScorer $scorer,
        private readonly ResourceOwnership $ownership,
        ?FieldValueExtractor $fieldExtractor = null,
        ?MatchingCheckpointManager $checkpointManager = null,
    ) {
        $this->fieldExtractor = $fieldExtractor ?? new FieldValueExtractor($this->entityNameParser, $this->normalizer);
        $this->checkpointManager = $checkpointManager ?? new MatchingCheckpointManager();
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
            $this->runJob($job);
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
        $forceRestart = (bool) ($payload['force_restart'] ?? data_get($payload, 'configuration.runOptions.forceRestart', false));
        if ($forceRestart) {
            $configuration['runOptions'] = array_merge($configuration['runOptions'] ?? [], ['forceRestart' => true]);
            $chkKey = $this->checkpointManager->generateCheckpointKey($reference->id, $input->id, $payload['mappings'] ?? [], $configuration);
            $this->checkpointManager->clearCheckpoint($chkKey);
        }
        $mappings = $this->resolveMappings($payload['mappings'] ?? [], $configuration);

        if ($mappings === []) {
            throw new InvalidArgumentException('At least one valid column mapping is required.');
        }

        $refRowCount = $reference->row_count > 0 ? (int) $reference->row_count : count($reference->preview_rows ?? []);
        $inpRowCount = $input->row_count > 0 ? (int) $input->row_count : count($input->preview_rows ?? []);

        if ($refRowCount === 0) {
            $refRowCount = count($this->loadDatasetRows($reference));
        }
        if ($inpRowCount === 0) {
            $inpRowCount = count($this->loadDatasetRows($input));
        }

        if ($refRowCount === 0 || $inpRowCount === 0) {
            throw new InvalidArgumentException('Reference and input datasets must contain data rows before matching.');
        }

        return DB::transaction(function () use ($payload, $reference, $input, $configuration, $mappings, $workspace, $inpRowCount) {
            $job = MatchingJob::create([
                'workspace_id' => $workspace?->id,
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
                    'total_raw_input' => $inpRowCount,
                    'total_unique_input' => $inpRowCount,
                    'total_duplicates' => 0,
                    'duplicate_details' => [],
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
                if ($workspace->matching_job_id) {
                    $prevJob = MatchingJob::find($workspace->matching_job_id);
                    if ($prevJob && in_array($prevJob->status, ['processing', 'queued', 'pending'])) {
                        $prevJob->update([
                            'status' => 'cancelled',
                            'error_message' => 'Dibatalkan karena matching dijalankan ulang.',
                            'finished_at' => Carbon::now(),
                        ]);
                        try {
                            DB::table('jobs')
                                ->where('payload', 'LIKE', '%' . $prevJob->id . '%')
                                ->delete();
                        } catch (\Throwable $e) {
                            Log::warning("Could not evict queued job for {$prevJob->id}: " . $e->getMessage());
                        }
                    }
                }

                $workspace->update([
                    'matching_job_id' => $job->id,
                    'status' => 'processing',
                    'current_step' => 2,
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
        if (ini_get('memory_limit') !== '-1') {
            @ini_set('memory_limit', '4096M');
        }

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
        unset($rawInputRows);
        $totalInputCount = count($inputRowsRaw);

        $job->refresh();
        if (in_array($job->status, ['cancelled', 'stopped']) || $job->error_message === 'Matching stopped by user.') {
            Log::info("Matching job {$job->id} was cancelled or stopped before execution. Halting.");
            return $this->responseFor($job);
        }

        $checkpointKey = $this->checkpointManager->generateCheckpointKey(
            $reference->id,
            $input->id,
            $rawMappings,
            $configuration
        );

        $forceRestart = (bool) (data_get($configuration, 'runOptions.forceRestart', false) ?: data_get($configuration, 'forceRestart', false));
        $hasCheckpoint = $this->checkpointManager->hasIncompleteCheckpoint($checkpointKey);
        $isResuming = false;

        if ($hasCheckpoint && ! $forceRestart) {
            $restored = $this->checkpointManager->restoreResultsForJob($checkpointKey, $job->id);
            if ($restored['restored'] && $restored['processed_count'] > 0) {
                $isResuming = true;
                $processedCount = (int) $restored['processed_count'];
                $restoredSummary = array_merge([
                    'matched' => 0,
                    'possible_match' => 0,
                    'unmatched' => 0,
                    'candidates_scored' => 0,
                    'total_raw_input' => $dedupAnalysis['raw_count'],
                    'total_unique_input' => $dedupAnalysis['unique_count'],
                    'total_duplicates' => $dedupAnalysis['duplicate_count'],
                    'duplicate_details' => array_slice($dedupAnalysis['duplicate_details'], 0, 100),
                ], $restored['summary'] ?? []);

                $job->update([
                    'status' => 'processing',
                    'processed_count' => $processedCount,
                    'total_count' => $totalInputCount,
                    'record_counts' => array_merge($restoredSummary, [
                        'current_stage' => sprintf('Melanjutkan matching dari checkpoint (%s / %s baris)...', number_format($processedCount), number_format($totalInputCount)),
                        'is_resumed' => true,
                        'resumed_at_record' => $processedCount,
                        'checkpoint_key' => $checkpointKey,
                    ]),
                    'started_at' => $job->started_at ?? Carbon::now(),
                ]);
            }
        }

        if (! $isResuming) {
            MatchingResult::where('matching_job_id', $job->id)->delete();
            $this->checkpointManager->clearCheckpoint($checkpointKey);

            $job->update([
                'status' => 'processing',
                'processed_count' => 0,
                'total_count' => $totalInputCount,
                'record_counts' => [
                    'current_stage' => 'Tahap 1/3: Memuat dan menormalkan data...',
                    'is_resumed' => false,
                    'matched' => 0,
                    'possible_match' => 0,
                    'unmatched' => 0,
                    'candidates_scored' => 0,
                    'total_raw_input' => $dedupAnalysis['raw_count'],
                    'total_unique_input' => $dedupAnalysis['unique_count'],
                    'total_duplicates' => $dedupAnalysis['duplicate_count'],
                    'duplicate_details' => array_slice($dedupAnalysis['duplicate_details'], 0, 100),
                    'checkpoint_key' => $checkpointKey,
                ],
                'started_at' => Carbon::now(),
            ]);
        }

        try {
            $summary = $this->executePipeline(
                $job,
                $reference,
                $input,
                $referenceRowsRaw,
                $inputRowsRaw,
                $mappings,
                $configuration,
                $dedupAnalysis,
                $checkpointKey,
                $isResuming
            );
            
            $job->refresh();
            $finalStatus = in_array($job->status, ['cancelled', 'stopped']) ? $job->status : 'completed';

            $finalRecordCounts = array_merge($summary, [
                'current_stage' => 'Matching selesai',
                'is_resumed' => (bool) ($job->record_counts['is_resumed'] ?? false),
                'resumed_at_record' => (int) ($job->record_counts['resumed_at_record'] ?? 0),
                'checkpoint_key' => $job->record_counts['checkpoint_key'] ?? null,
            ]);

            $job->update([
                'status' => $finalStatus,
                'processed_count' => $job->processed_count, // Use the actual processed count rather than forcing total count
                'record_counts' => $finalRecordCounts,
                'finished_at' => Carbon::now(),
            ]);

            $targetWorkspace = $job->workspace ?? ($job->workspace_id ? Workspace::find($job->workspace_id) : Workspace::where('matching_job_id', $job->id)->first());
            if ($targetWorkspace !== null) {
                if ($finalStatus === 'completed') {
                    $targetWorkspace->update([
                        'matching_job_id' => $job->id,
                        'status' => 'reviewing',
                        'current_step' => 3,
                    ]);
                } elseif (in_array($finalStatus, ['cancelled', 'stopped'])) {
                    $targetWorkspace->update([
                        'status' => 'configuring',
                        'current_step' => 2,
                    ]);
                }
            }
        } catch (Throwable $exception) {
            $job->update([
                'status' => 'failed',
                'error_message' => substr($exception->getMessage(), 0, 1000),
                'finished_at' => Carbon::now(),
            ]);

            $targetWorkspace = $job->workspace ?? ($job->workspace_id ? Workspace::find($job->workspace_id) : Workspace::where('matching_job_id', $job->id)->first());
            if ($targetWorkspace !== null) {
                $targetWorkspace->update([
                    'status' => 'failed',
                ]);
            }

            throw $exception;
        }

        return $this->responseFor($job->refresh());
    }

    /**
     * Check if a resumable incomplete checkpoint exists for the given dataset and mapping combination.
     *
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @return array<string, mixed>
     */
    public function getCheckpointStatus(
        string $referenceDatasetId,
        string $inputDatasetId,
        array $mappings,
        array $configuration
    ): array {
        $checkpointKey = $this->checkpointManager->generateCheckpointKey(
            $referenceDatasetId,
            $inputDatasetId,
            $mappings,
            $configuration
        );

        $hasCheckpoint = $this->checkpointManager->hasIncompleteCheckpoint($checkpointKey);
        if (! $hasCheckpoint) {
            return [
                'has_checkpoint' => false,
                'checkpoint_key' => $checkpointKey,
                'processed_count' => 0,
                'total_count' => 0,
            ];
        }

        $checkpoint = $this->checkpointManager->getCheckpoint($checkpointKey);

        return [
            'has_checkpoint' => true,
            'checkpoint_key' => $checkpointKey,
            'processed_count' => (int) ($checkpoint['processed_count'] ?? 0),
            'total_count' => (int) ($checkpoint['total_count'] ?? 0),
            'last_chunk_index' => (int) ($checkpoint['last_chunk_index'] ?? -1),
        ];
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
        string $checkpointKey = '',
        bool $isResuming = false,
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
        unset($referenceRowsRaw);
        $inputRows = $this->normalizeRows($inputRowsRaw, $mappings, 'input_column_name', $inpColTypes);
        unset($inputRowsRaw);
        $totalInputCount = $job->total_count > 0 ? (int) $job->total_count : count($inputRows);

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

        // ---------------------------------------------------------------------
        // Tier 2 Preparation: Composite Exact ("Gelondongan") Indexing
        // Mengindeks seluruh gabungan atribut non-mandatory untuk pencocokan O(1)
        // ---------------------------------------------------------------------
        $compositeMappings = array_values(array_filter($mappings, fn ($m) => ! (bool) ($m['required_match'] ?? false)));
        $hasCompositeFields = count($compositeMappings) > 0;
        $compositeRefIndex = [];

        if ($hasCompositeFields) {
            foreach ($referenceRows as $refRecord) {
                $compValues = [];
                $hasMeaningfulVal = false;
                foreach ($compositeMappings as $m) {
                    $val = trim((string) ($refRecord['normalized'][$m['reference_column_name']] ?? ''));
                    if ($val !== '') {
                        $hasMeaningfulVal = true;
                    }
                    $compValues[] = $val;
                }
                if ($hasMeaningfulVal) {
                    $compKey = md5(implode('|###|', $compValues));
                    $compositeRefIndex[$compKey][] = $refRecord;
                }
            }
        }

        // Candidate Generation Index for Phase 3 via Meilisearch
        $job->update([
            'record_counts' => array_merge($job->record_counts ?? [], [
                'current_stage' => 'Tahap 2/3: Menyiapkan indeks pencarian cepat...',
            ]),
        ]);

        $indexInitStart = microtime(true);
        $meiliHost = env('MEILISEARCH_HOST') ?: config('scout.meilisearch.host') ?: 'http://meilisearch:7700';
        $meiliKey = env('MEILISEARCH_KEY') ?: config('scout.meilisearch.key') ?: '';
        $httpClient = new \GuzzleHttp\Client(['timeout' => 60, 'connect_timeout' => 10]);
        $client = new \Meilisearch\Client($meiliHost, $meiliKey, $httpClient);
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
                    $client->waitForTask($task['taskUid'], 300000);
                    
                    if (count($searchableDocuments) > 0) {
                        $totalDocs = count($searchableDocuments);
                        $indexedDocs = 0;
                        foreach(array_chunk($searchableDocuments, 10000) as $chunkDocs) {
                            $task = $index->addDocuments($chunkDocs);
                            $client->waitForTask($task['taskUid'], 300000);
                            $indexedDocs += count($chunkDocs);
                            $job->update([
                                'record_counts' => array_merge($job->record_counts ?? [], [
                                    'current_stage' => sprintf('Tahap 2/3: Menyiapkan indeks pencarian (%s / %s dokumen)...', number_format($indexedDocs), number_format($totalDocs)),
                                ]),
                            ]);
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

        // Transition stage immediately to Phase 3 so the UI reflects active matching without delay
        $job->update([
            'record_counts' => array_merge($job->record_counts ?? [], [
                'current_stage' => sprintf('Tahap 3/3: Memulai pencocokan data (%s baris)...', number_format($totalInputCount)),
            ]),
        ]);

        $userChunk = (int) ($configuration['runOptions']['chunkSize'] ?? 0);
        if ($userChunk > 0) {
            $chunkSize = $userChunk;
        } else {
            // Adaptive chunk sizing: for small datasets (e.g. 200-2,000 rows), use smaller chunks (25-100)
            // so progress updates incrementally (e.g. every 5%) instead of jumping suddenly from 0% to 100%.
            // For large datasets, scale up to 2,500 to minimize DB commit overhead and transaction pressure.
            $chunkSize = max(25, min(2500, (int) ceil(count($inputRows) / 25)));
        }
        $workerCount = ($configuration['runOptions']['workerCount'] ?? 1);
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);
        $candidatePoolLimit = max($topN, (int) data_get($configuration, 'candidateGeneration.searchLimit', min(5, max($topN, 3))));

        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
            'total_raw_input' => $dedupAnalysis['raw_count'] ?? $totalInputCount,
            'total_unique_input' => $dedupAnalysis['unique_count'] ?? $totalInputCount,
            'total_duplicates' => $dedupAnalysis['duplicate_count'] ?? 0,
            'duplicate_details' => array_slice($dedupAnalysis['duplicate_details'] ?? [], 0, 100),
        ];

        $processed = 0;
        $lastChunkIndex = -1;
        if ($isResuming && ! empty($checkpointKey)) {
            $checkpoint = $this->checkpointManager->getCheckpoint($checkpointKey);
            if ($checkpoint) {
                $lastChunkIndex = (int) ($checkpoint['last_chunk_index'] ?? -1);
                $processed = (int) ($checkpoint['processed_count'] ?? 0);
                if (! empty($checkpoint['summary'])) {
                    foreach (['matched', 'possible_match', 'unmatched', 'candidates_scored'] as $k) {
                        if (isset($checkpoint['summary'][$k])) {
                            $summary[$k] = (int) $checkpoint['summary'][$k];
                        }
                    }
                }
            }
        }
        $chunks = array_chunk($inputRows, $chunkSize);
        $totalChunks = count($chunks);

        $completedChunkIndices = ! empty($checkpointKey)
            ? array_flip($this->checkpointManager->getCompletedChunkIndices($checkpointKey))
            : [];

        // Use sequential execution for datasets <= 10,000 rows for rock-solid stability and zero fork IPC overhead.
        $canFork = function_exists('pcntl_fork') && $workerCount > 1 && count($inputRows) > 10000 && ! app()->runningUnitTests();

        if ($canFork) {
            $pendingChunkIndices = [];
            foreach ($chunks as $chunkIndex => $chunk) {
                if ($isResuming && isset($completedChunkIndices[$chunkIndex])) {
                    continue;
                }
                $pendingChunkIndices[] = $chunkIndex;
            }

            $activeWorkers = [];
            $shmDir = is_dir('/dev/shm') && is_writable('/dev/shm') ? '/dev/shm' : sys_get_temp_dir();
            $lastJobStatusCheck = microtime(true);

            while (! empty($pendingChunkIndices) || ! empty($activeWorkers)) {
                // Throttle status check to at most once per second instead of every 5ms
                if (microtime(true) - $lastJobStatusCheck >= 1.0) {
                    $job->refresh();
                    $lastJobStatusCheck = microtime(true);
                    if (in_array($job->status, ['cancelled', 'stopped']) || $job->error_message === 'Matching stopped by user.') {
                        \Illuminate\Support\Facades\Log::info("Matching job {$job->id} cancelled/stopped. Terminating active child workers.");
                        foreach ($activeWorkers as $pid => $meta) {
                            @posix_kill($pid, SIGTERM);
                            if (file_exists($meta['tmpFile'])) {
                                @unlink($meta['tmpFile']);
                            }
                        }
                        break;
                    }
                }

                while (count($activeWorkers) < $workerCount && ! empty($pendingChunkIndices)) {
                    $chunkIndex = array_shift($pendingChunkIndices);
                    $chunk = $chunks[$chunkIndex];
                    $workerSlot = $chunkIndex % $workerCount;
                    $tmpFile = $shmDir . '/rematch_' . $job->id . '_' . $chunkIndex . '_' . Str::random(6) . '.tmp';

                    // Disconnect DB before fork so child processes do not share PDO socket descriptors
                    \Illuminate\Support\Facades\DB::disconnect();

                    $pid = pcntl_fork();
                    if ($pid === -1) {
                        \Illuminate\Support\Facades\DB::reconnect();
                        \Illuminate\Support\Facades\Log::warning("pcntl_fork failed for chunk {$chunkIndex}, running synchronously.");
                        $chunkOutput = $this->processChunk(
                            $chunk,
                            $chunkIndex,
                            $workerSlot,
                            $job,
                            $mappings,
                            $configuration,
                            $mandatoryMappings,
                            $hasMandatoryFields,
                            $mandatoryRefIndex,
                            $compositeMappings,
                            $hasCompositeFields,
                            $compositeRefIndex,
                            $referenceByKey,
                            $indexes,
                            $candidatePoolLimit,
                            $topN
                        );
                        $this->commitChunkResults(
                            $job,
                            $chunkIndex,
                            $chunkOutput,
                            count($chunk),
                            $processed,
                            $totalInputCount,
                            $summary,
                            $checkpointKey,
                            $metrics,
                            1
                        );
                        $processed += count($chunk);
                        continue;
                    } elseif ($pid === 0) {
                        // Child worker process
                        try {
                            $childIndexes = [
                                'uid' => $indexes['uid'],
                                'client' => new \Meilisearch\Client($meiliHost, $meiliKey, new \GuzzleHttp\Client(['timeout' => 60, 'connect_timeout' => 10])),
                            ];

                            $chunkOutput = $this->processChunk(
                                $chunk,
                                $chunkIndex,
                                $workerSlot,
                                $job,
                                $mappings,
                                $configuration,
                                $mandatoryMappings,
                                $hasMandatoryFields,
                                $mandatoryRefIndex,
                                $compositeMappings,
                                $hasCompositeFields,
                                $compositeRefIndex,
                                $referenceByKey,
                                $childIndexes,
                                $candidatePoolLimit,
                                $topN
                            );

                            file_put_contents($tmpFile, serialize($chunkOutput));
                            \Illuminate\Support\Facades\DB::disconnect();
                            exit(0);
                        } catch (Throwable $e) {
                            \Illuminate\Support\Facades\Log::error("Child worker error on chunk {$chunkIndex}: " . $e->getMessage());
                            file_put_contents($tmpFile, serialize(['error' => $e->getMessage()]));
                            \Illuminate\Support\Facades\DB::disconnect();
                            exit(1);
                        }
                    } else {
                        // Parent process
                        \Illuminate\Support\Facades\DB::reconnect();
                        $activeWorkers[$pid] = [
                            'chunkIndex' => $chunkIndex,
                            'count' => count($chunk),
                            'tmpFile' => $tmpFile,
                            'workerSlot' => $workerSlot,
                        ];
                    }
                }

                // Check for completed child workers
                $pid = pcntl_waitpid(-1, $status, WNOHANG);
                if ($pid > 0 && isset($activeWorkers[$pid])) {
                    $meta = $activeWorkers[$pid];
                    unset($activeWorkers[$pid]);

                    $tmpFile = $meta['tmpFile'];
                    if (file_exists($tmpFile)) {
                        $rawPayload = file_get_contents($tmpFile);
                        @unlink($tmpFile);
                        $chunkOutput = @unserialize($rawPayload);

                        if (is_array($chunkOutput) && ! isset($chunkOutput['error'])) {
                            $this->commitChunkResults(
                                $job,
                                $meta['chunkIndex'],
                                $chunkOutput,
                                $meta['count'],
                                $processed,
                                $totalInputCount,
                                $summary,
                                $checkpointKey,
                                $metrics,
                                $workerCount
                            );
                            $processed += $meta['count'];
                        } else {
                            \Illuminate\Support\Facades\Log::error("Chunk {$meta['chunkIndex']} child worker failed: " . ($chunkOutput['error'] ?? 'Unknown error'));
                        }
                    } else {
                        \Illuminate\Support\Facades\Log::error("Chunk {$meta['chunkIndex']} child worker exited without producing output file.");
                    }
                } else {
                    usleep(30000); // 30ms yield to keep CPU usage low
                }
            }
        } else {
            // Sequential execution (fallback for testing / single worker)
            foreach ($chunks as $chunkIndex => $chunk) {
                if ($isResuming && isset($completedChunkIndices[$chunkIndex])) {
                    continue;
                }
                $isResuming = false;
                $job->refresh();
                if (in_array($job->status, ['cancelled', 'stopped']) || $job->error_message === 'Matching stopped by user.') {
                    \Illuminate\Support\Facades\Log::info("Matching job {$job->id} cancellation detected. Halting execution loop.");
                    break;
                }

                $workerSlot = $chunkIndex % $workerCount;
                $chunkOutput = $this->processChunk(
                    $chunk,
                    $chunkIndex,
                    $workerSlot,
                    $job,
                    $mappings,
                    $configuration,
                    $mandatoryMappings,
                    $hasMandatoryFields,
                    $mandatoryRefIndex,
                    $compositeMappings,
                    $hasCompositeFields,
                    $compositeRefIndex,
                    $referenceByKey,
                    $indexes,
                    $candidatePoolLimit,
                    $topN
                );

                $this->commitChunkResults(
                    $job,
                    $chunkIndex,
                    $chunkOutput,
                    count($chunk),
                    $processed,
                    $totalInputCount,
                    $summary,
                    $checkpointKey,
                    $metrics,
                    1
                );
                $processed += count($chunk);
            }
        }

        if (! empty($checkpointKey)) {
            $this->checkpointManager->markCompleted($checkpointKey);
        }

        $metrics['total_wall_clock_ms'] = (microtime(true) - $totalWallClockStart) * 1000;
        \Illuminate\Support\Facades\Log::info('MATCHING_METRICS', $metrics);

        return $summary;
    }

    /**
     * Process a single chunk of input records.
     *
     * @param array<int, array<string, mixed>> $chunk
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     * @param array<int, array<string, mixed>> $mandatoryMappings
     * @param array<int, array<string, mixed>> $compositeMappings
     * @param array<string, array<int, array<string, mixed>>> $mandatoryRefIndex
     * @param array<string, array<int, array<string, mixed>>> $compositeRefIndex
     * @param array<string, array<string, mixed>> $referenceByKey
     * @param array{uid: string, client: \Meilisearch\Client} $indexes
     * @return array{batchResults: array, summaryDelta: array, scoring_ms: float, multisearch_ms: float}
     */
    private function processChunk(
        array $chunk,
        int $chunkIndex,
        int $workerSlot,
        MatchingJob $job,
        array $mappings,
        array $configuration,
        array $mandatoryMappings,
        bool $hasMandatoryFields,
        array $mandatoryRefIndex,
        array $compositeMappings,
        bool $hasCompositeFields,
        array $compositeRefIndex,
        array $referenceByKey,
        array $indexes,
        int $candidatePoolLimit,
        int $topN
    ): array {
        $scoringStart = microtime(true);
        $multisearchMs = 0.0;
        $batchResults = [];
        $summaryDelta = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
        ];

        $memoizationCache = [];
        $searchQueriesToExecute = [];
        $recordsToEvaluate = [];

        foreach ($chunk as $idx => $inputRecord) {
            $signatureString = '';
            foreach ($mappings as $mapping) {
                $col = ($mapping['input_column_name'] ?? null);
                $signatureString .= ($inputRecord['row'][$col] ?? '') . '|';
            }
            $cacheKey = md5(strtolower(trim($signatureString)));

            if (isset($memoizationCache[$cacheKey])) {
                $cachedData = $memoizationCache[$cacheKey];
                $summaryDelta['candidates_scored'] += $cachedData['candidates_scored'];
                $summaryDelta[$cachedData['status']]++;

                foreach ($cachedData['results'] as $cachedRow) {
                    $cachedRow['id'] = (string) Str::uuid();
                    $cachedRow['input_record_key'] = $inputRecord['key'];

                    $meta = json_decode($cachedRow['candidate_metadata'], true);
                    $meta['input_record'] = $this->leanRecordRow($inputRecord['row'], $mappings, 'input');
                    if (! empty($inputRecord['normalized'])) {
                        foreach ($inputRecord['normalized'] as $normK => $normV) {
                            if (str_starts_with($normK, '[Generated]') && ! isset($meta['input_record'][$normK]) && $normV !== null && $normV !== '') {
                                $meta['input_record'][$normK] = $normV;
                            }
                        }
                    }
                    $cachedRow['candidate_metadata'] = json_encode($meta, JSON_THROW_ON_ERROR);

                    $batchResults[] = $cachedRow;
                }
                continue;
            }

            $candidatesScoredForThisRecord = 0;
            $exactMatchFound = false;
            $exactMatchResults = [];

            // Phase 2: Mandatory / Exact Phase
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
                        $summaryDelta['candidates_scored'] += count($exactRefs);
                        $summaryDelta['matched']++;

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
                                $mappings,
                            );
                            $batchResults[] = $resRow;
                            $exactMatchResults[] = $resRow;
                        }
                    }
                }
            }

            // Phase 2.5: Tier 2 Composite Exact ("Gelondongan") Matching
            if (! $exactMatchFound && $hasCompositeFields) {
                $inpCompValues = [];
                $hasMeaningfulVal = false;
                foreach ($compositeMappings as $m) {
                    $val = trim((string) ($inputRecord['normalized'][$m['input_column_name']] ?? ''));
                    if ($val !== '') {
                        $hasMeaningfulVal = true;
                    }
                    $inpCompValues[] = $val;
                }

                if ($hasMeaningfulVal) {
                    $inpCompKey = md5(implode('|###|', $inpCompValues));
                    if (! empty($compositeRefIndex[$inpCompKey])) {
                        $potentialExactRefs = $compositeRefIndex[$inpCompKey];
                        $validExactRefs = [];

                        foreach ($potentialExactRefs as $exactRef) {
                            $hasLegalConflict = false;
                            foreach ($compositeMappings as $m) {
                                $refId = $exactRef['identity'][$m['reference_column_name']] ?? null;
                                $inpId = $inputRecord['identity'][$m['input_column_name']] ?? null;
                                if ($this->entityNameParser->hasStrictLegalConflict($refId, $inpId)) {
                                    $hasLegalConflict = true;
                                    break;
                                }
                            }
                            if ($hasLegalConflict) {
                                continue;
                            }

                            if (count($compositeMappings) === 1) {
                                $singleMap = $compositeMappings[0];
                                $rawRef = strtolower(trim((string) ($exactRef['row'][$singleMap['reference_column_name']] ?? '')));
                                $rawInp = strtolower(trim((string) ($inputRecord['row'][$singleMap['input_column_name']] ?? '')));
                                if ($rawRef !== $rawInp) {
                                    continue;
                                }
                            }

                            $validExactRefs[] = $exactRef;
                        }

                        if (! empty($validExactRefs)) {
                            $exactMatchFound = true;
                            $exactRefs = array_slice($validExactRefs, 0, $topN);
                            $candidatesScoredForThisRecord += count($exactRefs);
                            $summaryDelta['candidates_scored'] += count($exactRefs);
                            $summaryDelta['matched']++;

                            foreach ($exactRefs as $rank => $exactRef) {
                                $exactFieldScores = $this->calculateFieldScores($inputRecord, $exactRef, $mappings);

                                $evidence = [
                                    'phase' => 'Phase 2.5: Composite Exact (Gelondongan) Phase',
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
                                        'message' => 'Exact match pada seluruh atribut entitas (Gelondongan) lolos tanpa fuzzy scoring.',
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
                                    'Exact match pada seluruh atribut entitas (Gelondongan / Composite Exact)',
                                    $workerSlot,
                                    $evidence,
                                    $mappings,
                                );
                                $batchResults[] = $resRow;
                                $exactMatchResults[] = $resRow;
                            }
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
                continue;
            }

            // Needs fuzzy matching via Meilisearch!
            $searchQuery = $this->buildCandidateBlockingQuery($inputRecord, $mappings);

            if ($searchQuery === '') {
                $resRow = $this->resultRow(
                    $job,
                    $inputRecord,
                    null,
                    0.0,
                    1,
                    [],
                    'unmatched',
                    'Tidak ada atribut entitas yang dapat dicari',
                    $workerSlot,
                    [],
                    $mappings,
                );
                $batchResults[] = $resRow;
                $summaryDelta['unmatched']++;
                if (count($memoizationCache) >= 1000) {
                    $memoizationCache = array_slice($memoizationCache, -500, null, true);
                }
                $memoizationCache[$cacheKey] = [
                    'results' => [$resRow],
                    'status' => 'unmatched',
                    'candidates_scored' => 0,
                ];
                continue;
            }

            $searchQueriesToExecute[$idx] = [
                'query' => $searchQuery,
                'cacheKey' => $cacheKey,
            ];
            $recordsToEvaluate[$idx] = $inputRecord;
        }

        // Execute batch search
        $searchResultsByIndex = [];
        if (! empty($searchQueriesToExecute)) {
            $queries = [];
            $idxMap = [];
            foreach ($searchQueriesToExecute as $idx => $meta) {
                $queries[] = (new \Meilisearch\Contracts\SearchQuery())
                    ->setIndexUid($indexes['uid'])
                    ->setQuery($meta['query'])
                    ->setLimit($candidatePoolLimit);
                $idxMap[] = $idx;
            }

            try {
                $msStart = microtime(true);
                $multiResults = $indexes['client']->multiSearch($queries)['results'] ?? [];
                $multisearchMs += (microtime(true) - $msStart) * 1000;
                foreach ($multiResults as $resultIndex => $searchResult) {
                    $originalIdx = $idxMap[$resultIndex];
                    $searchResultsByIndex[$originalIdx] = $searchResult['hits'] ?? [];
                }
            } catch (Throwable $e) {
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

            $scoredCandidates = $this->evaluateCandidates(
                $inputRecord,
                $candidates,
                $mappings,
                $configuration
            );

            if ($scoredCandidates === []) {
                $presetName = (string) ($configuration['preset'] ?? '');
                $modeName = (string) ($configuration['mode'] ?? '');
                $isConstruction = (strcasecmp($presetName, 'Konstruksi') === 0 || strcasecmp($presetName, 'Construction') === 0 || strcasecmp($modeName, 'construction') === 0);
                $unmatchedReason = $isConstruction
                    ? 'No candidate generated (Total WLS 0.0% < 80% ambang batas)'
                    : 'No candidate generated';

                $unmatchedRow = $this->resultRow(
                    $job,
                    $inputRecord,
                    null,
                    0.0,
                    1,
                    [],
                    'unmatched',
                    $unmatchedReason,
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
                    $mappings,
                );
                $batchResults[] = $unmatchedRow;
                $summaryDelta['unmatched']++;
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

            $candidatesScoredForThisRecord += count($scoredCandidates);
            $summaryDelta['candidates_scored'] += count($scoredCandidates);

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
            $summaryDelta[$rowOutcome]++;

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
                    $mappings,
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

        $scoringMs = (microtime(true) - $scoringStart) * 1000;

        return [
            'batchResults' => $batchResults,
            'summaryDelta' => $summaryDelta,
            'scoring_ms' => $scoringMs,
            'multisearch_ms' => $multisearchMs,
        ];
    }

    /**
     * Commit a completed chunk's results into MySQL, SQLite checkpoint, and update Job progress.
     *
     * @param array<string, mixed> $chunkOutput
     * @param array<string, mixed> $summary
     * @param array<string, float|bool> $metrics
     */
    private function commitChunkResults(
        MatchingJob $job,
        int $chunkIndex,
        array $chunkOutput,
        int $chunkCount,
        int $processedSoFar,
        int $totalInputCount,
        array &$summary,
        string $checkpointKey,
        array &$metrics,
        int $workerCount = 1
    ): void {
        $dbStart = microtime(true);
        $batchResults = $chunkOutput['batchResults'] ?? [];
        $delta = $chunkOutput['summaryDelta'] ?? [];

        foreach (['matched', 'possible_match', 'unmatched', 'candidates_scored'] as $k) {
            $summary[$k] += (int) ($delta[$k] ?? 0);
        }

        $metrics['scoring_ms'] += (float) ($chunkOutput['scoring_ms'] ?? 0.0);
        $metrics['multisearch_ms'] += (float) ($chunkOutput['multisearch_ms'] ?? 0.0);

        $currentProcessed = $processedSoFar + $chunkCount;
        $workerBadge = $workerCount > 1 ? " [{$workerCount} Worker Paralel]" : '';
        $summaryWithStage = array_merge($summary, [
            'current_stage' => sprintf(
                'Tahap 3/3: Mencocokkan data batch #%d (%s / %s baris)%s...',
                $chunkIndex + 1,
                number_format($currentProcessed),
                number_format($totalInputCount),
                $workerBadge
            ),
            'is_resumed' => ! empty($checkpointKey),
            'checkpoint_key' => $checkpointKey,
        ]);

        DB::transaction(function () use ($batchResults, $job, $currentProcessed, $summaryWithStage) {
            if (! empty($batchResults)) {
                foreach (array_chunk($batchResults, 2000) as $insertBatch) {
                    MatchingResult::insert($insertBatch);
                }
            }

            $job->update([
                'processed_count' => $currentProcessed,
                'record_counts' => $summaryWithStage,
            ]);
        });

        if (! empty($checkpointKey)) {
            $this->checkpointManager->saveChunk(
                $checkpointKey,
                $job->id,
                $job->workspace_id,
                $chunkIndex,
                $currentProcessed,
                $totalInputCount,
                $summaryWithStage,
                $batchResults
            );
        }

        $metrics['db_write_ms'] += (microtime(true) - $dbStart) * 1000;
        gc_collect_cycles();
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
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);
        $pruningEnabled = (bool) data_get($configuration, 'searchOptimization.candidatePruning', true);

        // Verification rules list (ordered)
        $verificationRules = $this->resolveVerificationRules($configuration, $mappings, $reviewThreshold);

        $bestCandidateScore = 0.0;
        $autoMatchCount = 0;
        $evaluatedCount = 0;

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

                $cityPassed = (round($cityScore, 2) >= 100.0);
                $nameHighSimilarity = (round($nameScore, 2) >= 90.0);
                $addrHighSimilarity = (round($addrScore, 2) >= 90.0);
                $nameAddrPassed = ($nameHighSimilarity && $addrHighSimilarity);

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
                    if ($nameHighSimilarity && $addrHighSimilarity && ! $cityPassed) {
                        $rulesEvaluated[] = [
                            'order' => 2,
                            'field' => 'Evaluasi: Nama Perusahaan & Alamat Sama / Tinggi (>= 90%) dengan Kota Berbeda',
                            'method' => 'Dual High Similarity (>= 90%)',
                            'required_threshold' => 90.0,
                            'actual_score' => min($nameScore, $addrScore),
                            'passed' => true,
                            'is_mandatory' => true,
                        ];
                        $allRulesPassed = false;
                        $finalClassification = 'possible_match';
                        $downgraded = true;
                        $downgradeReason = "Nama perusahaan ({$nameScore}%) dan alamat ({$addrScore}%) sama/kemiripan tinggi (>= 90%), namun Kabupaten/Kota berbeda ({$cityScore}%) -> Perlu Reviu Manual";
                        $decisionReason = "Nama perusahaan ({$nameScore}%) dan alamat ({$addrScore}%) sama/kemiripan tinggi (>= 90%), namun Kabupaten/Kota berbeda ({$cityScore}%) -> Perlu Reviu Manual";
                    } else {
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
                        // Evaluasi 3: Apakah Nama Perusahaan >= 90% DAN Alamat Perusahaan >= 90%?
                        $rulesEvaluated[] = [
                            'order' => 3,
                            'field' => 'Evaluasi 3: Nama Perusahaan & Alamat Sama / Tinggi (>= 90%) dengan Kota Berbeda',
                            'method' => 'Dual High Similarity (>= 90%)',
                            'required_threshold' => 90.0,
                            'actual_score' => min($nameScore, $addrScore),
                            'passed' => $nameAddrPassed,
                            'is_mandatory' => true,
                        ];

                        if ($nameAddrPassed) {
                            $allRulesPassed = false;
                            $finalClassification = 'possible_match';
                            $downgraded = true;
                            $downgradeReason = "Nama perusahaan ({$nameScore}%) dan alamat ({$addrScore}%) sama/kemiripan tinggi (>= 90%), namun Kabupaten/Kota berbeda ({$cityScore}%) -> Perlu Reviu Manual";
                            $decisionReason = "Nama perusahaan ({$nameScore}%) dan alamat ({$addrScore}%) sama/kemiripan tinggi (>= 90%), namun Kabupaten/Kota berbeda ({$cityScore}%) -> Perlu Reviu Manual";
                        } else {
                            $allRulesPassed = false;
                            $finalClassification = 'unmatched';
                            $decisionReason = "Kemiripan kota {$cityScore}% < 100% dan syarat kemiripan nama & alamat (Nama: {$nameScore}%, Alamat: {$addrScore}%) tidak memenuhi batas >= 90% -> Tidak Cocok (Masukkan record ke tabel Referensi)";
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

            // -----------------------------------------------------------------
            // Adaptive Candidate Pruning
            // -----------------------------------------------------------------
            if ($ws > $bestCandidateScore) {
                $bestCandidateScore = $ws;
            }
            if ($finalClassification === 'matched') {
                $autoMatchCount++;
            }
            $evaluatedCount++;

            if ($pruningEnabled) {
                // Condition 1: High confidence auto-match saturation (Rank 1/2 is >= 95% or verified auto-match)
                if ($autoMatchCount >= 1 && $bestCandidateScore >= 95.0 && $evaluatedCount >= $topN) {
                    if ($ws < ($bestCandidateScore - 20.0) || $ws < $reviewThreshold) {
                        break;
                    }
                }

                // Condition 2: Deep fall-off from best candidate score
                if ($evaluatedCount >= $topN && $bestCandidateScore >= $reviewThreshold && $ws < ($bestCandidateScore - 30.0)) {
                    break;
                }

                // Condition 3: Very low initial relevance (top 2 hits in Meilisearch are below 40%)
                if ($evaluatedCount >= 2 && $bestCandidateScore < 40.0) {
                    break;
                }

                // Condition 4: Below review threshold once topN candidates are collected
                if ($evaluatedCount >= $topN && $ws < $reviewThreshold) {
                    break;
                }
            }
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

        // Exclude mandatory mappings from default verification order
        $nonMandatory = array_values(array_filter($mappings, fn ($m) => ! (bool) ($m['required_match'] ?? false)));
        $sorted = $nonMandatory;
        usort($sorted, function ($a, $b) {
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
            $isName = $this->entityNameParser->isEntityNameColumn($refCol)
                || str_contains(mb_strtolower($refCol), 'nama')
                || str_contains(mb_strtolower($refCol), 'name');
            $isLoc = $this->isLocationColumn($refCol);

            $threshold = ($isName ? 90.0 : ($isLoc ? 100.0 : $defaultThreshold));

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
     * Store only essential mapped columns, generated entity columns, and key identifiers
     * to avoid multi-gigabyte raw row duplication in candidate_metadata.
     *
     * @param array<string, mixed>|null $row
     * @param array<int, array<string, mixed>> $mappings
     * @param string $side 'input' or 'reference'
     * @return array<string, mixed>|null
     */
    private function leanRecordRow(?array $row, array $mappings = [], string $side = 'input'): ?array
    {
        if ($row === null) {
            return null;
        }

        // If dataset row is already small (e.g. <= 8 columns), keep it as is
        if (count($row) <= 8) {
            return $row;
        }

        $colKey = $side === 'input' ? 'input_column_name' : 'reference_column_name';
        $parentColKey = $side === 'input' ? 'parent_input_column' : 'parent_reference_column';
        $allowedCols = [];
        foreach ($mappings as $m) {
            if (! empty($m[$colKey])) {
                $allowedCols[(string) $m[$colKey]] = true;
            }
            if (! empty($m[$parentColKey])) {
                $allowedCols[(string) $m[$parentColKey]] = true;
            }
            if (! empty($m['metadata'][$parentColKey])) {
                $allowedCols[(string) $m['metadata'][$parentColKey]] = true;
            }
        }

        $lean = [];
        foreach ($row as $k => $v) {
            $keyStr = (string) $k;
            $lowerKey = strtolower($keyStr);

            // Always keep mapped columns and parent columns
            if (isset($allowedCols[$keyStr])) {
                $lean[$keyStr] = $v;
                continue;
            }

            // Always keep generated columns (e.g. [Generated] Badan Usaha, [Generated] Nama Inti)
            if (str_starts_with($keyStr, '[Generated]') || str_starts_with($keyStr, '_')) {
                $lean[$keyStr] = $v;
                continue;
            }

            // Keep entity name, company, business, identifier, address, and location columns without restrictive word boundaries that break on underscores
            if (preg_match('/(nama|name|perusahaan|penyedia|usaha|rekanan|kontraktor|badan|entitas|company|vendor|mitra|instansi|nib|npwp|nik|id|kode|kab|kota|regency|city|prov|alamat|address|street|status|legal_form|bentuk_usaha|badan_usaha|izin)/i', $lowerKey)) {
                if ($v !== null && $v !== '') {
                    $lean[$keyStr] = $v;
                }
            }
        }

        return $lean ?: $row;
    }

    /**
     * @param array<string, mixed>|null $referenceRecord
     * @param array<int, array<string, mixed>> $fieldScores
     * @param array<string, mixed>|null $verificationEvidence
     * @param array<int, array<string, mixed>> $mappings
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
        array $mappings = [],
    ): array {
        $leanInput = $this->leanRecordRow($inputRecord['row'] ?? [], $mappings, 'input');
        if (! empty($inputRecord['normalized'])) {
            foreach ($inputRecord['normalized'] as $normK => $normV) {
                if (str_starts_with($normK, '[Generated]') && ! isset($leanInput[$normK]) && $normV !== null && $normV !== '') {
                    $leanInput[$normK] = $normV;
                }
            }
        }
        $leanReference = $this->leanRecordRow($referenceRecord['row'] ?? null, $mappings, 'reference');
        if (! empty($referenceRecord['normalized'])) {
            foreach ($referenceRecord['normalized'] as $normK => $normV) {
                if (str_starts_with($normK, '[Generated]') && ! isset($leanReference[$normK]) && $normV !== null && $normV !== '') {
                    $leanReference[$normK] = $normV;
                }
            }
        }

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
                'input_record' => $leanInput,
                'reference_record' => $leanReference,
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
                'stage' => data_get($job->record_counts, 'current_stage'),
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
            'checkpoint' => [
                'is_resumed' => (bool) data_get($job->record_counts, 'is_resumed', false),
                'resumed_at_record' => (int) data_get($job->record_counts, 'resumed_at_record', 0),
                'checkpoint_key' => data_get($job->record_counts, 'checkpoint_key'),
            ],
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
                    'inspect_mode' => false,
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
                    'inspect_mode' => false,
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
                $seen[$sig] = $index;
                $unique[] = $row;
            } else {
                if (! isset($duplicateCounts[$sig])) {
                    $duplicateCounts[$sig] = 2;
                    $duplicateSamples[$sig] = [
                        'sample_row' => $row,
                        'first_row_index' => $seen[$sig] + 1,
                    ];
                } else {
                    $duplicateCounts[$sig]++;
                }
            }
        }

        $duplicateDetails = [];
        foreach ($duplicateCounts as $sig => $count) {
            $sample = $duplicateSamples[$sig];
            $duplicateDetails[] = [
                'sample_row' => $sample['sample_row'],
                'first_row_index' => $sample['first_row_index'],
                'duplicate_count' => $count - 1,
                'total_occurrences' => $count,
            ];
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

    /**
     * Extract a fast, targeted candidate blocking search query for Meilisearch.
     * Candidate blocking should ONLY query the primary entity name (core name or company name)
     * capped at 5 tokens to prevent combinatorial explosion in typo tolerance.
     * Address, geographic location, and IDs are evaluated in in-memory scoring (Phase 3 & 4).
     *
     * @param array<string, mixed> $inputRecord
     * @param array<int, array<string, mixed>> $mappings
     */
    public function buildCandidateBlockingQuery(array $inputRecord, array $mappings): string
    {
        $primaryCandidate = '';
        $secondaryCandidate = '';
        $fallbackCandidate = '';

        foreach ($mappings as $mapping) {
            $colName = $mapping['input_column_name'] ?? '';
            if ($colName === '') {
                continue;
            }
            $val = trim((string) ($inputRecord['normalized'][$colName] ?? ''));
            if ($val === '') {
                continue;
            }

            $colLower = strtolower($colName);
            $transform = (string) ($mapping['transform'] ?? data_get($mapping, 'metadata.transform') ?? '');

            // Priority 1: Extracted core name
            if ($transform === 'EXTRACT_CORE_NAME' || str_contains($colLower, 'nama_inti') || str_contains($colLower, 'core_name')) {
                $primaryCandidate = $val;
                break;
            }

            // Priority 2: Primary entity name (nama, nama_perusahaan, etc.)
            if (str_contains($colLower, 'nama') || str_contains($colLower, 'name') || str_contains($colLower, 'perusahaan') || str_contains($colLower, 'usaha')) {
                if (empty($secondaryCandidate)) {
                    $secondaryCandidate = $val;
                }
            }

            // Priority 3: Non-address, non-id, non-legal-form column
            $isAddress = str_contains($colLower, 'alamat') || str_contains($colLower, 'address') || str_contains($colLower, 'jalan') || str_contains($colLower, 'rt') || str_contains($colLower, 'rw') || str_contains($colLower, 'kelurahan') || str_contains($colLower, 'kecamatan') || str_contains($colLower, 'kota') || str_contains($colLower, 'kabupaten') || str_contains($colLower, 'provinsi') || str_contains($colLower, 'kodepos');
            $isId = str_contains($colLower, 'id') || str_contains($colLower, 'nib') || str_contains($colLower, 'npwp') || str_contains($colLower, 'kode');
            $isLegal = str_contains($colLower, 'badan_usaha') || str_contains($colLower, 'legal_form');

            if (!$isAddress && !$isId && !$isLegal && empty($fallbackCandidate)) {
                $fallbackCandidate = $val;
            }
        }

        $chosen = $primaryCandidate ?: ($secondaryCandidate ?: $fallbackCandidate);

        // Fallback: if no candidate selected, take the first non-empty value
        if ($chosen === '') {
            foreach ($mappings as $mapping) {
                $colName = $mapping['input_column_name'] ?? '';
                if ($colName !== '') {
                    $val = trim((string) ($inputRecord['normalized'][$colName] ?? ''));
                    if ($val !== '') {
                        $chosen = $val;
                        break;
                    }
                }
            }
        }

        // Clean punctuation and cap to 5 tokens max for instant Meilisearch execution (< 5ms)
        $clean = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $chosen) ?? $chosen;
        $tokens = array_filter(preg_split('/\s+/', trim($clean)) ?: []);
        $capped = array_slice($tokens, 0, 5);

        return implode(' ', $capped);
    }
}
