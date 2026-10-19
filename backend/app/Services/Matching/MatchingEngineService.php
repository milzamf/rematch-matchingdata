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
    private readonly WilayahDictionaryService $wilayah;
    private readonly AddressComparator $addresses;
    private ?bool $snapshotStorageAvailable = null;

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
        $this->wilayah = new WilayahDictionaryService();
        $this->addresses = new AddressComparator($this->normalizer);
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
        return \App\Services\Matching\Transactions\ReviewDeploymentFence::withAdmission(function () use ($user, $payload) {
            \App\Services\Matching\Transactions\ReviewDeploymentFence::assertWritable();
            if (SharedMatchingLifecycle::enabled()) return app(SharedMatchingLifecycle::class)->admit($user, $payload, fn ($admitted) => $this->prepareAdmittedJob($user, $admitted));
            return $this->prepareAdmittedJob($user, $payload);
        });
    }

    private function prepareAdmittedJob(User $user, array $payload): MatchingJob
    {
        $reference = $this->ownership->scopeDatasets(Dataset::with('columns'), $user)
            ->findOrFail($payload['reference_dataset_id']);
        $input = $this->ownership->scopeDatasets(Dataset::with('columns'), $user)
            ->findOrFail($payload['input_dataset_id']);
        $workspace = ! empty($payload['workspace_id'])
            ? $this->ownership->findWorkspace($user, (string) $payload['workspace_id'])
            : null;

        $configuration = $this->configResolver->resolve($payload['configuration'] ?? []);
        app(MatchingInputScope::class)->predicate($configuration['inputScope'], $input->columns->pluck('name')->all());
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
                    'inputScope' => $configuration['inputScope'],
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
        return \App\Services\Matching\Transactions\ReviewDeploymentFence::withAdmission(function () use ($job) {
            if (SharedMatchingLifecycle::enabled()) {
                $lifecycle = app(SharedMatchingLifecycle::class);
                return $lifecycle->withRunner($job, function () use ($job, $lifecycle) {
                    $job->refresh()->load(['configuration', 'workspace', 'inputDataset', 'referenceDataset']);
                    if (SharedMatchingLifecycle::owns($job) && $job->review_state_readiness === 'ready') return $this->responseFor($job);
                    $lifecycle->assertJob($job);
                    $lifecycle->verifySources($job);
                    return $this->runAdmittedJob($job);
                });
            }
            \App\Services\Matching\Transactions\ReviewDeploymentFence::assertWritable(true);
            return $this->runAdmittedJob($job);
        });
    }

    private function runAdmittedJob(MatchingJob $job): array
    {
        // Queue workers may reuse this service after a deployment adds snapshot storage.
        $this->snapshotStorageAvailable = MatchingRecordSnapshots::available();
        if (ini_get('memory_limit') !== '-1') {
            @ini_set('memory_limit', '1024M');
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
            'inputScope' => data_get($configModel?->advanced_settings, 'inputScope', []),
            'runOptions' => data_get($configModel?->advanced_settings, 'runOptions', []),
        ]);

        if (SharedMatchingLifecycle::owns($job)) $configuration['sharedJobKey'] = $job->id;

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

        $referenceRowsRaw = $this->streamDatasetRows($reference);
        $inputRowsRaw = new MatchingRowStore();
        $rawCount = 0;
        $sourceCount = 0;
        $eligible = app(MatchingInputScope::class)->predicate($configuration['inputScope'], $input->columns->pluck('name')->all());
        foreach ($this->streamDatasetRows($input) as $row) {
            $sourceCount++;
            if (!$eligible($row)) continue;
            $rawCount++;
            $signatureRow = array_map(static fn ($value) => is_string($value) ? strtolower(trim($value)) : $value, $row);
            ksort($signatureRow);
            $inputRowsRaw->append($row, hash('sha256', json_encode($signatureRow, JSON_THROW_ON_ERROR)), $sourceCount);
        }
        if ($rawCount === 0 && $sourceCount > 0) {
            throw new InvalidArgumentException('Tidak ada baris input yang sesuai filter wilayah. Periksa pilihan wilayah dan kolom sumber.');
        }
        $dedupAnalysis = [
            'source_count' => $sourceCount, 'excluded_count' => $sourceCount - $rawCount,
            'input_scope' => $configuration['inputScope'],
            'raw_count' => $rawCount, 'unique_count' => count($inputRowsRaw),
            'duplicate_count' => $rawCount - count($inputRowsRaw),
            'duplicate_details' => $inputRowsRaw->duplicateDetails(),
        ];
        $totalInputCount = count($inputRowsRaw);
        if (SharedMatchingLifecycle::owns($job)) {
            if ($sourceCount !== (int) $input->row_count) throw new \RuntimeException('Input source row count changed after inspection.');
            if (data_get($job->record_counts, 'shared_scoring_complete')) {
                app(NewMatchingReviewInitializer::class)->initialize($job, $inputRowsRaw);
                return $this->responseFor($job->refresh());
            }
        }


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
                    'total_source_input' => $dedupAnalysis['source_count'] ?? $totalInputCount,
                    'excluded_input' => $dedupAnalysis['excluded_count'] ?? 0,
                    'input_scope' => $dedupAnalysis['input_scope'] ?? [],
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
                    'total_source_input' => $dedupAnalysis['source_count'] ?? $totalInputCount,
                    'excluded_input' => $dedupAnalysis['excluded_count'] ?? 0,
                    'input_scope' => $dedupAnalysis['input_scope'] ?? [],
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
                'current_stage' => SharedMatchingLifecycle::owns($job) ? 'Menyiapkan review dan memeriksa integritas hasil...' : 'Matching selesai',
                'shared_scoring_complete' => SharedMatchingLifecycle::owns($job),
                'is_resumed' => (bool) ($job->record_counts['is_resumed'] ?? false),
                'resumed_at_record' => (int) ($job->record_counts['resumed_at_record'] ?? 0),
                'checkpoint_key' => $job->record_counts['checkpoint_key'] ?? null,
            ]);

            $job->update([
                'status' => $finalStatus === 'completed' && SharedMatchingLifecycle::owns($job) ? 'processing' : $finalStatus,
                'processed_count' => $job->processed_count, // Use the actual processed count rather than forcing total count
                'record_counts' => $finalRecordCounts,
                'finished_at' => Carbon::now(),
            ]);

            if ($finalStatus === 'completed' && SharedMatchingLifecycle::owns($job)) {
                app(NewMatchingReviewInitializer::class)->initialize($job, $inputRowsRaw);
                $job->refresh();
            }

            $targetWorkspace = $job->workspace ?? ($job->workspace_id ? Workspace::find($job->workspace_id) : Workspace::where('matching_job_id', $job->id)->first());
            if ($targetWorkspace !== null) {
                if ($finalStatus === 'completed') {
                    $workflowState = $targetWorkspace->workflow_state ?? [];
                    $workflowState['runResult'] = [
                        'job' => [
                            'id' => $job->id,
                            'name' => $job->name,
                            'status' => 'completed',
                            'reference_dataset_id' => $job->reference_dataset_id,
                            'input_dataset_id' => $job->input_dataset_id,
                            'started_at' => optional($job->started_at)->toISOString(),
                            'finished_at' => optional($job->finished_at)->toISOString(),
                            'error_message' => null,
                        ],
                        'progress' => [
                            'status' => 'completed',
                            'processed' => $job->processed_count,
                            'total' => $job->total_count,
                            'percentage' => 100,
                            'stage' => 'Matching selesai',
                        ],
                        'checkpoint' => [
                            'is_resumed' => (bool) ($finalRecordCounts['is_resumed'] ?? false),
                            'resumed_at_record' => (int) ($finalRecordCounts['resumed_at_record'] ?? 0),
                        ],
                        'summary' => [
                            'matched' => (int) ($finalRecordCounts['matched'] ?? 0),
                            'possible_match' => (int) ($finalRecordCounts['possible_match'] ?? 0),
                            'unmatched' => (int) ($finalRecordCounts['unmatched'] ?? 0),
                            'candidates_scored' => (int) ($finalRecordCounts['candidates_scored'] ?? 0),
                            'total_source_input' => (int) ($finalRecordCounts['total_source_input'] ?? $job->total_count),
                            'excluded_input' => (int) ($finalRecordCounts['excluded_input'] ?? 0),
                            'input_scope' => $finalRecordCounts['input_scope'] ?? [],
                            'total_raw_input' => (int) ($finalRecordCounts['total_raw_input'] ?? $job->total_count),
                            'total_unique_input' => (int) ($finalRecordCounts['total_unique_input'] ?? $job->total_count),
                            'total_duplicates' => (int) ($finalRecordCounts['total_duplicates'] ?? 0),
                            'duplicate_details' => $finalRecordCounts['duplicate_details'] ?? [],
                        ],
                        'top_results' => $workflowState['runResult']['top_results'] ?? [],
                    ];
                    $workflowState['runState'] = 'success';
                    $workflowState['progress'] = 100;

                    $targetWorkspace->update([
                        'matching_job_id' => $job->id,
                        'status' => 'reviewing',
                        'current_step' => 3,
                        'workflow_state' => $workflowState,
                    ]);
                } elseif (in_array($finalStatus, ['cancelled', 'stopped'])) {
                    $targetWorkspace->update([
                        'status' => 'configuring',
                        'current_step' => 2,
                    ]);
                }
            }
        } catch (Throwable $exception) {
            $job->refresh();
            if (SharedMatchingLifecycle::owns($job) && $job->review_state_readiness === 'ready') {
                Log::warning('Matching review was published; post-publication metadata update failed.', ['job' => $job->id]);
                return $this->responseFor($job);
            }
            if (in_array($job->status, ['cancelled', 'stopped'], true)) {
                Log::info("Matching job {$job->id} stopped during dataset normalization.");

                return $this->responseFor($job);
            }

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
        iterable $rows,
        array $mappings,
        string $columnKey,
        array $columnDataTypes = [],
        ?callable $onProgress = null,
        ?MatchingRowStore $store = null,
    ): MatchingRowStore {
        $store ??= new MatchingRowStore();
        $index = 0;
        foreach ($rows as $row) {
            $store->append($this->normalizeRecord($row, $index + 1, $mappings, $columnKey, $columnDataTypes));
            $index++;
            if ($onProgress !== null) $onProgress($index);
        }
        if ($onProgress !== null) $onProgress($index, true);
        return $store;
    }

    /** Load a persistent normalized reference snapshot, or build and publish it once. */
    private function loadOrBuildReferenceRows(
        Dataset $dataset,
        iterable $rawRows,
        array $mappings,
        array $columnTypes,
        callable $onProgress,
    ): array {
        $sourcePath = $this->datasetFilePath($dataset);
        if ($sourcePath === null) {
            $store = $this->normalizeRows($rawRows, $mappings, 'reference_column_name', $columnTypes, $onProgress);
            $this->buildExactLookups($store, $mappings, $onProgress);
            return ['rows' => $store, 'cache_hit' => false, 'cache_key' => null];
        }

        $regionsDir = storage_path('app/wilayah');
        $signaturePayload = [
            'engine' => 'streaming-full-row-address-v6',
            'source_sha256' => hash_file('sha256', $sourcePath),
            'reference_mappings' => array_map(static fn ($mapping) => [
                'reference_column_name' => $mapping['reference_column_name'] ?? '',
                'parent_reference_column' => $mapping['parent_reference_column'] ?? null,
                'transform' => $mapping['transform'] ?? null,
                'required_match' => (bool) ($mapping['required_match'] ?? false),
            ], $mappings),
            'column_types' => $columnTypes,
            'regions' => [
                'provinces' => is_file($regionsDir.'/provinces.json') ? hash_file('sha256', $regionsDir.'/provinces.json') : null,
                'regencies' => is_file($regionsDir.'/regencies.json') ? hash_file('sha256', $regionsDir.'/regencies.json') : null,
            ],
        ];
        $signature = hash('sha256', json_encode($signaturePayload, JSON_THROW_ON_ERROR));
        $cacheDir = rtrim((string) (env('MATCHING_CACHE_PATH') ?: storage_path('app/matching-cache')), DIRECTORY_SEPARATOR);
        if (!is_dir($cacheDir) && !mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
            throw new \RuntimeException('Could not create the matching reference cache directory.');
        }
        $cachePath = $cacheDir.DIRECTORY_SEPARATOR.'reference_'.$signature.'.sqlite';
        // Use a renewable lease so a killed worker cannot leave this cache
        // unavailable for the full duration of a large matching job.
        $lockLeaseSeconds = 300;
        $lock = \Illuminate\Support\Facades\Cache::lock('matching_reference_cache_'.$signature, $lockLeaseSeconds);
        $lock->block(30);
        $lastLockRefresh = microtime(true);
        $progressWithLockLease = function (int $processed, bool $force = false, ?string $phase = null) use ($onProgress, $lock, $lockLeaseSeconds, &$lastLockRefresh): void {
            if (microtime(true) - $lastLockRefresh >= 30) {
                if (! $lock->refresh($lockLeaseSeconds)) {
                    throw new \RuntimeException('Matching reference cache lease was lost while building the cache.');
                }
                $lastLockRefresh = microtime(true);
            }

            $onProgress($processed, $force, $phase);
        };
        try {
            if (MatchingRowStore::isValidCache($cachePath, $signature)) {
                return ['rows' => new MatchingRowStore($cachePath, false), 'cache_hit' => true, 'cache_key' => $signature];
            }
            if (is_file($cachePath)) @unlink($cachePath);

            $buildingPath = $cachePath.'.building_'.Str::uuid();
            $store = new MatchingRowStore($buildingPath);
            try {
                $store = $this->normalizeRows($rawRows, $mappings, 'reference_column_name', $columnTypes, $progressWithLockLease, $store);
                $this->buildExactLookups($store, $mappings, $progressWithLockLease);
                $store->markCacheReady($signature);
                $store->promoteCache($cachePath);
            } catch (\Throwable $e) {
                unset($store);
                if (is_file($buildingPath)) @unlink($buildingPath);
                throw $e;
            }

            return ['rows' => new MatchingRowStore($cachePath, false), 'cache_hit' => false, 'cache_key' => $signature];
        } finally {
            $lock->release();
        }
    }

    private function buildExactLookups(MatchingRowStore $store, array $mappings, callable $onProgress): void
    {
        $mandatoryMappings = array_values(array_filter($mappings, fn ($m) => (bool) ($m['required_match'] ?? false)));
        $compositeMappings = array_values(array_filter($mappings, fn ($m) => ! (bool) ($m['required_match'] ?? false)));
        $count = count($store);
        for ($offset = 0; $offset < $count; $offset += 5000) {
            $chunk = $store->chunk(intdiv($offset, 5000), 5000);
            foreach ($chunk as $record) {
                $mandatoryValues = array_map(fn ($m) => (string) ($record['normalized'][$m['reference_column_name']] ?? ''), $mandatoryMappings);
                $compositeValues = array_map(fn ($m) => trim((string) ($record['normalized'][$m['reference_column_name']] ?? '')), $compositeMappings);
                $store->setExactKeys((int) $record['key'],
                    $mandatoryMappings !== [] && !in_array('', $mandatoryValues, true) ? implode('|###|', $mandatoryValues) : null,
                    $compositeMappings !== [] && count(array_filter($compositeValues, fn ($v) => $v !== '')) > 0 ? md5(implode('|###|', $compositeValues)) : null);
            }
            $onProgress(min($count, $offset + count($chunk)), true, 'exact_lookup');
        }
        $store->buildLookupIndexes();
    }

    private function datasetFilePath(Dataset $dataset): ?string
    {
        if (!$dataset->storage_path) return null;
        $paths = [Storage::disk('local')->path($dataset->storage_path), storage_path('app/'.$dataset->storage_path), storage_path('app/private/'.$dataset->storage_path), $dataset->storage_path];
        foreach ($paths as $path) if (is_file($path) && is_readable($path)) return $path;
        return null;
    }

    /** Normalize an existing row store in place, avoiding a second full SQLite copy. */
    private function normalizeStoreInPlace(
        MatchingRowStore $store,
        array $mappings,
        string $columnKey,
        array $columnDataTypes = [],
        ?callable $onProgress = null,
    ): MatchingRowStore {
        $total = count($store);
        $processed = 0;
        $store->mapPayloads(function (array $raw, int $id) use ($mappings, $columnKey, $columnDataTypes, $onProgress, $total, &$processed): array {
            $normalized = $this->normalizeRecord($raw, $id, $mappings, $columnKey, $columnDataTypes);
            $processed++;
            if ($onProgress !== null) $onProgress($processed, $processed === $total);
            return $normalized;
        });
        return $store;
    }

    /** @return array<string, mixed> */
    private function normalizeRecord(array $row, int $index, array $mappings, string $columnKey, array $columnDataTypes): array
    {
        $normalized = [];
        $identity = [];
        $entityNameVal = $this->findEntityNameValue($row);
        $parsedEntity = $entityNameVal !== null ? $this->entityNameParser->parse($entityNameVal) : null;

        foreach ($mappings as $mapping) {
            $columnName = (string) ($mapping[$columnKey] ?? '');
            if ($columnName === '') continue;
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
            $role = $this->wilayah->detectWilayahColumnRole($columnName);
            if ($role !== null && (str_starts_with($role, 'KAB_') || str_starts_with($role, 'PROV_'))) {
                $region = str_starts_with($role, 'PROV_') ? $this->wilayah->resolveProvince($rawValue) : $this->wilayah->resolve($rawValue, $row);
                $normalized[$columnName] = $region !== null ? (string) ($region['id_kab'] ?? $region['kd_prov']) : $this->normalizer->normalizeByType($rawValue, 'text', $columnName);
                continue;
            }
            if ($this->addresses->isAddress($columnName)) {
                $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, 'text', 'alamat');
                continue;
            }
            $parsedCurrent = $this->entityNameParser->parse($rawValue);
            if ($this->entityNameParser->isEntityNameColumn($columnName) || $this->entityNameParser->hasEntityMetadata($parsedCurrent)) {
                $normalized[$columnName] = $this->normalizer->normalizeByType($parsedCurrent['core_name'], $dataType, $columnName);
                $identity[$columnName] = $parsedCurrent;
                continue;
            }
            $normalized[$columnName] = $this->normalizer->normalizeByType($rawValue, $dataType, $columnName);
        }

        return [
            'key' => (string) $index,
            'row' => $row,
            'normalized' => $normalized,
            'identity' => $identity,
        ];
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
        iterable $referenceRowsRaw,
        iterable $inputRowsRaw,
        array $mappings,
        array $configuration,
        array $dedupAnalysis = [],
        string $checkpointKey = '',
        bool $isResuming = false,
    ): array {
        $totalWallClockStart = microtime(true);
        $metrics = [
            'INDEX_REUSED' => false,
            'REFERENCE_CACHE_REUSED' => false,
            'index_initialization_ms' => 0.0,
            'reference_cache_ms' => 0.0,
            'multisearch_ms' => 0.0,
            'scoring_ms' => 0.0,
            'db_write_ms' => 0.0,
            'total_wall_clock_ms' => 0.0,
            'reference_rows' => (int) $reference->row_count,
            'input_rows' => (int) $input->row_count,
        ];

        $refColTypes = $reference->columns ? $reference->columns->pluck('data_type', 'name')->all() : [];
        $inpColTypes = $input->columns ? $input->columns->pluck('data_type', 'name')->all() : [];

        // ---------------------------------------------------------------------
        // Phase 1: Automatic Normalization
        // ---------------------------------------------------------------------
        $lastNormalizationUpdate = 0.0;
        $publishNormalizationProgress = function (string $label, int $processed, int $total, bool $force = false, ?string $phase = null) use ($job, &$lastNormalizationUpdate): void {
            $now = microtime(true);
            if (! $force && ($processed % 5000 !== 0) && ($now - $lastNormalizationUpdate < 3.0)) {
                return;
            }

            $job->refresh();
            if (in_array($job->status, ['cancelled', 'stopped'], true) || $job->error_message === 'Matching stopped by user.') {
                throw new \RuntimeException('Matching stopped by user.');
            }

            $counts = array_merge($job->record_counts ?? [], [
                'current_stage' => sprintf(
                    'Tahap 1/3: Menormalkan %s (%s%s)...',
                    $label,
                    number_format($processed),
                    $total > 0 ? ' / '.number_format($total).' baris' : ' baris'
                ),
                'stage_progress' => [
                    'phase' => $phase ?? ($label === 'dataset acuan' ? 'reference_normalization' : 'input_normalization'),
                    'label' => $label,
                    'processed' => $processed,
                    'total' => $total,
                    'percentage' => $total > 0 ? round(($processed / $total) * 100, 1) : 0,
                    'heartbeat_at' => now()->toIso8601String(),
                ],
            ]);
            $job->record_counts = $counts;
            $job->save();
            $lastNormalizationUpdate = $now;
        };

        $referenceTotal = max(0, (int) $reference->row_count);
        $publishNormalizationProgress('dataset acuan', 0, $referenceTotal, true);
        $normalizationStart = microtime(true);
        $referenceCacheStart = microtime(true);
        $referenceCache = $this->loadOrBuildReferenceRows(
            $reference,
            $referenceRowsRaw,
            $mappings,
            $refColTypes,
            fn (int $processed, bool $force = false, ?string $phase = null) => $publishNormalizationProgress('dataset acuan', $processed, $referenceTotal, $force, $phase)
        );
        /** @var MatchingRowStore $referenceRows */
        $referenceRows = $referenceCache['rows'];
        if (SharedMatchingLifecycle::owns($job) && count($referenceRows) !== (int) $reference->row_count) throw new \RuntimeException('Reference source row count changed after inspection.');
        $metrics['reference_cache_hit'] = $referenceCache['cache_hit'];
        $metrics['reference_cache_ms'] = round((microtime(true) - $referenceCacheStart) * 1000, 2);
        $metrics['reference_cache_key'] = $referenceCache['cache_key'];
        $metrics['REFERENCE_CACHE_REUSED'] = $referenceCache['cache_hit'];
        \Illuminate\Support\Facades\Log::info('MATCHING_NORMALIZATION_COMPLETE', [
            'job_id' => $job->id,
            'dataset' => 'reference',
            'processed_rows' => count($referenceRows),
            'elapsed_ms' => round((microtime(true) - $normalizationStart) * 1000, 2),
        ]);
        unset($referenceRowsRaw);
        $inputTotal = count($inputRowsRaw);
        $publishNormalizationProgress('dataset input', 0, $inputTotal, true);
        $normalizationStart = microtime(true);
        $inputRows = $this->normalizeStoreInPlace(
            $inputRowsRaw,
            $mappings,
            'input_column_name',
            $inpColTypes,
            fn (int $processed, bool $force = false) => $publishNormalizationProgress('dataset input', $processed, $inputTotal, $force)
        );
        \Illuminate\Support\Facades\Log::info('MATCHING_NORMALIZATION_COMPLETE', [
            'job_id' => $job->id,
            'dataset' => 'input',
            'processed_rows' => count($inputRows),
            'elapsed_ms' => round((microtime(true) - $normalizationStart) * 1000, 2),
        ]);
        unset($inputRowsRaw);
        $totalInputCount = $job->total_count > 0 ? (int) $job->total_count : count($inputRows);

        $referenceByKey = $referenceRows;

        // ---------------------------------------------------------------------
        // Phase 2 Preparation: Mandatory Indexing
        // ---------------------------------------------------------------------
        $mandatoryMappings = array_values(array_filter($mappings, fn ($m) => (bool) ($m['required_match'] ?? false)));
        $hasMandatoryFields = count($mandatoryMappings) > 0;

        $compositeMappings = array_values(array_filter($mappings, fn ($m) => ! (bool) ($m['required_match'] ?? false)));
        $hasCompositeFields = count($compositeMappings) > 0;
        $referenceRowCount = count($referenceRows);
        $job->update(['record_counts' => array_merge($job->record_counts ?? [], [
            'current_stage' => sprintf('Tahap 2/3: Lookup exact acuan siap (%s baris; cache %s)...', number_format($referenceRowCount), $referenceCache['cache_hit'] ? 'dipakai ulang' : 'dibangun'),
            'stage_progress' => ['phase' => 'reference_lookup_ready', 'label' => 'Lookup exact acuan', 'processed' => $referenceRowCount, 'total' => $referenceRowCount, 'percentage' => 100],
        ])]);

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
        $indexSignature = substr(hash('sha256', json_encode([$referenceCache['cache_key'], 'mfd-address-v3'], JSON_THROW_ON_ERROR)), 0, 16);
        $indexUid = 'matching_reference_' . str_replace('-', '_', $reference->id) . '_' . $indexSignature;
        
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
            $lockLeaseSeconds = 300;
            $lock = \Illuminate\Support\Facades\Cache::lock($lockKey, $lockLeaseSeconds);
            try {
                $lock->block(30);
                try {
                    $stats = $client->getIndex($indexUid)->stats();
                    if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                        $indexReused = true;
                    }
                } catch (\Throwable $e) {}
                
                if (!$indexReused) {
                    // Existing documents are immutable for this dataset/mapping signature.
                    // Retry indexing with upserts instead of deleting an index another reader uses.
                    
                    $searchableAttributes = array_values(array_unique(array_map(
                        fn ($m) => 'col_' . md5($m['reference_column_name']), $mappings)));
                    $index = $client->index($indexUid);
                    \Illuminate\Support\Facades\Log::info('MATCHING_INDEX_BUILD_STARTED', [
                        'job_id' => $job->id,
                        'index_uid' => $indexUid,
                        'reference_rows' => count($referenceRows),
                        'batch_size' => max(500, min(10000, (int) (env('MATCHING_MEILI_INDEX_BATCH_SIZE') ?: 5000))),
                    ]);
                    $totalDocs = count($referenceRows);
                    $indexBatchSize = max(500, min(10000, (int) (env('MATCHING_MEILI_INDEX_BATCH_SIZE') ?: 5000)));
                    $lastIndexLockRefresh = microtime(true);
                    $progressWhileIndexing = function (int $completedDocs, int $batchNumber) use ($job, $totalDocs, $lock, $lockLeaseSeconds, &$lastIndexLockRefresh): \Closure {
                        return function () use ($job, $totalDocs, $completedDocs, $batchNumber, $lock, $lockLeaseSeconds, &$lastIndexLockRefresh): void {
                            if (microtime(true) - $lastIndexLockRefresh >= 30) {
                                if (! $lock->refresh($lockLeaseSeconds)) {
                                    throw new \RuntimeException('Matching search index lease was lost while building the index.');
                                }
                                $lastIndexLockRefresh = microtime(true);
                            }

                            $job->refresh();
                            if (in_array($job->status, ['cancelled', 'stopped'], true)) {
                                throw new \RuntimeException('Matching stopped by user.');
                            }
                            $counts = $job->record_counts ?? [];
                            $counts['current_stage'] = sprintf('Tahap 2/3: Meilisearch memproses batch %d (%s / %s dokumen)...', $batchNumber, number_format($completedDocs), number_format($totalDocs));
                            $counts['stage_progress'] = [
                                'phase' => 'meilisearch_indexing',
                                'label' => 'Menunggu task indeks Meilisearch',
                                'processed' => $completedDocs,
                                'total' => $totalDocs,
                                'percentage' => $totalDocs > 0 ? round(($completedDocs / $totalDocs) * 100, 1) : 0,
                                'heartbeat_at' => Carbon::now()->toISOString(),
                            ];
                            $job->update(['record_counts' => $counts]);
                        };
                    };
                    $task = $index->updateSearchableAttributes($searchableAttributes);
                    $this->waitForSearchTask($client, $task['taskUid'], $progressWhileIndexing(0, 0));
                    $indexedDocs = 0;
                    $documents = [];
                    foreach ($referenceRows as $refRecord) {
                        $doc = ['id' => $refRecord['key']];
                        foreach ($mappings as $mapping) {
                            $colName = $mapping['reference_column_name'];
                            $doc['col_' . md5($colName)] = $refRecord['normalized'][$colName] ?? '';
                        }
                        $documents[] = $doc;
                        if (count($documents) < $indexBatchSize && $indexedDocs + count($documents) < $totalDocs) continue;
                        $task = $index->addDocuments($documents);
                        $this->waitForSearchTask($client, $task['taskUid'], $progressWhileIndexing($indexedDocs, (int) floor($indexedDocs / $indexBatchSize) + 1));
                        $indexedDocs += count($documents);
                        $documents = [];
                        $job->update(['record_counts' => array_merge($job->record_counts ?? [], [
                            'current_stage' => sprintf('Tahap 2/3: Menyiapkan indeks pencarian (%s / %s dokumen)...', number_format($indexedDocs), number_format($totalDocs)),
                            'stage_progress' => ['phase' => 'meilisearch_indexing', 'label' => 'Indeks Meilisearch', 'processed' => $indexedDocs, 'total' => $totalDocs, 'percentage' => $totalDocs > 0 ? round(($indexedDocs / $totalDocs) * 100, 1) : 100],
                        ])]);
                    }
                }
            } finally {
                $lock?->release();
            }
        }
        $indexes = ['uid' => $indexUid, 'client' => $client];
        $metrics['INDEX_REUSED'] = $indexReused;
        $metrics['index_initialization_ms'] = (microtime(true) - $indexInitStart) * 1000;
        \Illuminate\Support\Facades\Log::info('MATCHING_INDEX_READY', [
            'job_id' => $job->id,
            'index_uid' => $indexUid,
            'reused' => $indexReused,
            'documents' => count($referenceRows),
            'batch_size' => max(500, min(10000, (int) (env('MATCHING_MEILI_INDEX_BATCH_SIZE') ?: 5000))),
            'elapsed_ms' => round($metrics['index_initialization_ms'], 2),
        ]);

        $job->update(['record_counts' => array_merge($job->record_counts ?? [], [
            'current_stage' => $indexReused ? 'Tahap 2/3: Indeks Meilisearch siap (dipakai ulang).' : 'Tahap 2/3: Indeks Meilisearch siap.',
            'stage_progress' => ['phase' => 'meilisearch_indexing', 'label' => $indexReused ? 'Indeks Meilisearch dipakai ulang' : 'Indeks Meilisearch siap', 'processed' => count($referenceRows), 'total' => count($referenceRows), 'percentage' => 100],
        ])]);

        // Transition stage immediately to Phase 3 so the UI reflects active matching without delay
        $job->update([
            'record_counts' => array_merge($job->record_counts ?? [], [
                'current_stage' => sprintf('Tahap 3/3: Memulai pencocokan data (%s baris)...', number_format($totalInputCount)),
                'stage_progress' => ['phase' => 'matching_input', 'label' => 'Pemadanan input', 'processed' => 0, 'total' => $totalInputCount, 'percentage' => 0],
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
        $workerCount = max(1, min(2, (int) ($configuration['runOptions']['workerCount'] ?? 1)));
        $chunkSize = max(10, min(250, $chunkSize));
        $topN = (int) data_get($configuration, 'candidateGeneration.topN', 3);
        // Retrieval breadth is independent of the number of candidates retained.
        $candidatePoolLimit = min(100, max($topN, (int) data_get($configuration, 'candidateGeneration.searchLimit', 12)));

        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
            'total_source_input' => $dedupAnalysis['source_count'] ?? $totalInputCount,
            'excluded_input' => $dedupAnalysis['excluded_count'] ?? 0,
            'input_scope' => $dedupAnalysis['input_scope'] ?? [],
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
        $totalChunks = (int) ceil(count($inputRows) / $chunkSize);

        $completedChunkIndices = ! empty($checkpointKey)
            ? array_flip($this->checkpointManager->getCompletedChunkIndices($checkpointKey))
            : [];

        // Use sequential execution for datasets <= 10,000 rows for rock-solid stability and zero fork IPC overhead.
        $canFork = function_exists('pcntl_fork') && $workerCount > 1 && count($inputRows) > 10000 && ! app()->runningUnitTests();

        if ($canFork) {
            $pendingChunkIndices = [];
            for ($chunkIndex = 0; $chunkIndex < $totalChunks; $chunkIndex++) {
                if ($isResuming && isset($completedChunkIndices[$chunkIndex])) {
                    continue;
                }
                $pendingChunkIndices[] = $chunkIndex;
            }

            $activeWorkers = [];
            $shmDir = is_dir('/dev/shm') && is_writable('/dev/shm') ? '/dev/shm' : sys_get_temp_dir();
            $lastJobStatusCheck = microtime(true);

            try {
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
                    $chunk = $inputRows->chunk($chunkIndex, $chunkSize);
                    $workerSlot = $chunkIndex % $workerCount;
                    $tmpFile = $shmDir . '/rematch_' . $job->id . '_' . $chunkIndex . '_' . Str::random(6) . '.tmp';

                    // Disconnect DB before fork so child processes do not share PDO socket descriptors
                    \Illuminate\Support\Facades\DB::disconnect();

                    $referenceRows->disconnect();
                    $inputRows->disconnect();
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

                            $compositeMappings,
                            $hasCompositeFields,

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

                                $compositeMappings,
                                $hasCompositeFields,

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
                            throw new \RuntimeException("Chunk {$meta['chunkIndex']} failed: " . ($chunkOutput['error'] ?? 'Worker terminated'));
                        }
                    } else {
                        throw new \RuntimeException("Chunk {$meta['chunkIndex']} worker exited without output (exit status {$status}). Resume from the last committed checkpoint.");
                    }
                } else {
                    usleep(30000); // 30ms yield to keep CPU usage low
                }
            }
            } finally {
                foreach ($activeWorkers as $pid => $meta) {
                    @posix_kill($pid, SIGTERM);
                    pcntl_waitpid($pid, $waitStatus);
                    if (is_file($meta['tmpFile'])) @unlink($meta['tmpFile']);
                }
            }
        } else {
            // Sequential execution (fallback for testing / single worker)
            for ($chunkIndex = 0; $chunkIndex < $totalChunks; $chunkIndex++) {
                if ($isResuming && isset($completedChunkIndices[$chunkIndex])) {
                    continue;
                }
                $chunk = $inputRows->chunk($chunkIndex, $chunkSize);
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

                    $compositeMappings,
                    $hasCompositeFields,

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
                // Release the preceding output before allocating the next chunk.
                unset($chunkOutput, $chunk);
            }
        }

        $job->refresh();
        $stopped = in_array($job->status, ['cancelled', 'stopped'], true);
        if (!$stopped && $processed !== $totalInputCount) {
            throw new \RuntimeException('Matching incomplete: committed record count does not match input count.');
        }
        if (!$stopped && ! empty($checkpointKey)) {
            $this->checkpointManager->markCompleted($checkpointKey);
        }

        $metrics['peak_php_memory_bytes'] = memory_get_peak_usage(true);
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
    private function waitForSearchTask(\Meilisearch\Client $client, int $taskUid, ?callable $heartbeat = null): void
    {
        $deadline = microtime(true) + 300;
        $nextHeartbeat = microtime(true) + 5;
        do {
            $result = $client->getTask($taskUid);
            $status = $result['status'] ?? null;
            if ($status === 'succeeded') return;
            if (in_array($status, ['failed', 'canceled'], true)) {
                throw new \RuntimeException('Meilisearch indexing failed: '.($result['error']['message'] ?? 'unknown task error'));
            }
            if ($heartbeat !== null && microtime(true) >= $nextHeartbeat) {
                $heartbeat();
                $nextHeartbeat = microtime(true) + 5;
            }
            usleep(500000);
        } while (microtime(true) < $deadline);

        throw new \RuntimeException("Meilisearch indexing task {$taskUid} did not finish within 300 seconds.");
    }

    private function processChunk(
        array $chunk,
        int $chunkIndex,
        int $workerSlot,
        MatchingJob $job,
        array $mappings,
        array $configuration,
        array $mandatoryMappings,
        bool $hasMandatoryFields,
        array $compositeMappings,
        bool $hasCompositeFields,
        MatchingRowStore $referenceByKey,
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
        $candidateSearchQueryCount = 0;
        $candidateSearchHitCount = 0;

        foreach ($chunk as $idx => $inputRecord) {
            $cacheKey = $this->memoizationKey($inputRecord, $mappings);

            if (isset($memoizationCache[$cacheKey])) {
                $cachedData = $memoizationCache[$cacheKey];
                $summaryDelta['candidates_scored'] += $cachedData['candidates_scored'];
                $summaryDelta[$cachedData['status']]++;

                foreach ($cachedData['results'] as $cachedRow) {
                    $cachedRow['id'] = (string) Str::uuid7();
                    $cachedRow['input_record_key'] = $inputRecord['key'];
                    $cachedRow = [...$cachedRow, ...((int) $cachedRow['candidate_rank'] === 1
                        ? (new ReviewRegionIndexService($this->wilayah))->codes($inputRecord['row'])
                        : ['input_province_code' => null, 'input_regency_code' => null, 'input_region_indexed' => false])];

                    $meta = json_decode($cachedRow['candidate_metadata'], true);
                    if (isset($meta['_input_primary'])) $meta['_input_primary'] = (string) $inputRecord['key'];
                    else $meta['input_record'] = $this->snapshotStorageAvailable ? $inputRecord['row'] : $this->leanRecordRow($inputRecord['row'], $mappings, 'input');
                    if (! empty($inputRecord['normalized'])) {
                        foreach ($inputRecord['normalized'] as $normK => $normV) {
                            if (!isset($meta['_input_primary']) && str_starts_with($normK, '[Generated]') && ! isset($meta['input_record'][$normK]) && $normV !== null && $normV !== '') {
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
                    $exactRefs = [];
                    foreach ($referenceByKey->exactMatches('mandatory', $compKey) as $exactRef) {
                        $exactRefs[] = $exactRef;
                        if (count($exactRefs) >= max(2, $topN)) break;
                    }
                    if ($exactRefs !== []) {
                        $exactMatchFound = true;
                        $exactStatus = count($exactRefs) > 1 ? 'possible_match' : 'matched';
                        $exactRefs = array_slice($exactRefs, 0, $topN);
                        $candidatesScoredForThisRecord += count($exactRefs);
                        $summaryDelta['candidates_scored'] += count($exactRefs);
                        $summaryDelta[$exactStatus]++;

                        foreach ($exactRefs as $rank => $exactRef) {
                            $exactFieldScores = $this->calculateFieldScores($inputRecord, $exactRef, $mappings);

                            $evidence = [
                                'phase' => 'Phase 2: Mandatory / Exact Phase',
                                'is_exact_match' => true,
                                'bypassed_fuzzy' => true,
                                'initial_classification' => 'matched',
                                'final_classification' => $exactStatus,
                                'weighted_similarity' => 100.0,
                                'downgraded' => $exactStatus !== 'matched',
                                'downgrade_reason' => $exactStatus !== 'matched' ? 'multiple_exact_references' : null,
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
                                $exactStatus,
                                $exactStatus === 'matched' ? 'Exact match on mandatory fields (bypassed fuzzy scoring)' : 'Multiple exact references require review',
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
                    {
                        $potentialExactRefs = $referenceByKey->exactMatches('composite', $inpCompKey);
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
                            if (count($validExactRefs) >= max(2, $topN)) break;
                        }

                        if (! empty($validExactRefs)) {
                            $exactMatchFound = true;
                            $exactStatus = count($validExactRefs) > 1 ? 'possible_match' : 'matched';
                            $exactRefs = array_slice($validExactRefs, 0, $topN);
                            $candidatesScoredForThisRecord += count($exactRefs);
                            $summaryDelta['candidates_scored'] += count($exactRefs);
                            $summaryDelta[$exactStatus]++;

                            foreach ($exactRefs as $rank => $exactRef) {
                                $exactFieldScores = $this->calculateFieldScores($inputRecord, $exactRef, $mappings);

                                $evidence = [
                                    'phase' => 'Phase 2.5: Composite Exact (Gelondongan) Phase',
                                    'is_exact_match' => true,
                                    'bypassed_fuzzy' => true,
                                    'initial_classification' => 'matched',
                                    'final_classification' => $exactStatus,
                                    'weighted_similarity' => 100.0,
                                    'downgraded' => $exactStatus !== 'matched',
                                    'downgrade_reason' => $exactStatus !== 'matched' ? 'multiple_exact_references' : null,
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
                                    $exactStatus,
                                    $exactStatus === 'matched' ? 'Exact match pada seluruh atribut entitas (Gelondongan / Composite Exact)' : 'Multiple exact references require review',
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
                    'status' => $exactStatus,
                    'candidates_scored' => $candidatesScoredForThisRecord,
                ];
                continue;
            }

            // Needs fuzzy matching via Meilisearch!
            $searchQueries = $this->buildCandidateBlockingQueries($inputRecord, $mappings);

            if ($searchQueries === []) {
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
                'queries' => $searchQueries,
                'cacheKey' => $cacheKey,
            ];
            $candidateSearchQueryCount += count($searchQueries);
            $recordsToEvaluate[$idx] = $inputRecord;
        }

        // Execute batch search
        $searchResultsByIndex = [];
        if (! empty($searchQueriesToExecute)) {
            $queries = [];
            $idxMap = [];
            foreach ($searchQueriesToExecute as $idx => $meta) {
                foreach ($meta['queries'] as $queryText) {
                    $queries[] = (new \Meilisearch\Contracts\SearchQuery())
                        ->setIndexUid($indexes['uid'])
                        ->setQuery($queryText)
                        ->setLimit($candidatePoolLimit)
                        ->setAttributesToRetrieve(['id']);
                    $idxMap[] = $idx;
                }
            }

            try {
                $msStart = microtime(true);
                $resultOffset = 0;
                foreach (array_chunk($queries, 50) as $queryBatch) {
                    $batch = $indexes['client']->multiSearch($queryBatch)['results'] ?? [];
                    if (count($batch) !== count($queryBatch)) throw new \RuntimeException('Incomplete Meilisearch response.');
                    foreach ($batch as $resultIndex => $searchResult) {
                        $originalIdx = $idxMap[$resultOffset + $resultIndex];
                        $candidateSearchHitCount += count($searchResult['hits'] ?? []);
                        $searchResultsByIndex[$originalIdx] ??= [];
                        $known = array_fill_keys(array_column($searchResultsByIndex[$originalIdx], 'id'), true);
                        foreach (($searchResult['hits'] ?? []) as $hit) {
                            if (!isset($known[$hit['id']])) {
                                $searchResultsByIndex[$originalIdx][] = ['id' => $hit['id']];
                                $known[$hit['id']] = true;
                            }
                        }
                    }
                    $resultOffset += count($batch);
                    unset($batch);
                }
                $multisearchMs += (microtime(true) - $msStart) * 1000;
                unset($queries, $idxMap);
            } catch (Throwable $e) {
                throw new \RuntimeException('Candidate search failed; no unmatched decisions were committed for this batch. ' . $e->getMessage(), 0, $e);
            }
        }

        // Process evaluateCandidates for the fuzzy records
        foreach ($recordsToEvaluate as $idx => $inputRecord) {
            $meta = $searchQueriesToExecute[$idx];
            $cacheKey = $meta['cacheKey'];
            $candidatesScoredForThisRecord = 0;
            $recordFuzzyResults = [];

            $hits = $searchResultsByIndex[$idx] ?? [];
            unset($searchResultsByIndex[$idx]);
            $candidateKeys = [];
            foreach ($hits as $hit) {
                $candidateKeys[] = (string) ($hit['id'] ?? '');
            }
            $candidateRecords = $referenceByKey->getMany($candidateKeys);
            $candidates = [];
            foreach ($candidateKeys as $refKey) {
                if (isset($candidateRecords[$refKey])) $candidates[] = $candidateRecords[$refKey];
            }

            $scoredCandidates = $this->evaluateCandidates(
                $inputRecord,
                $candidates,
                $mappings,
                $configuration
            );

            // Expand only a saturated, inconclusive search. Never rerun already scored hits.
            $best = $scoredCandidates[0] ?? null;
            $runner = $scoredCandidates[1] ?? null;
            $uncertain = ! $best || $best['classification'] !== 'matched'
                || ($runner && abs($best['score'] - $runner['score']) < 3.0);
            $expandedLimit = min(100, max($candidatePoolLimit, (int) data_get($configuration, 'candidateGeneration.expandedLimit', 48)));
            if ($uncertain && count($hits) >= $candidatePoolLimit && $expandedLimit > $candidatePoolLimit) {
                $extraQueries = array_map(fn ($text) => (new \Meilisearch\Contracts\SearchQuery())
                    ->setIndexUid($indexes['uid'])->setQuery($text)->setLimit($expandedLimit)->setAttributesToRetrieve(['id']), $meta['queries']);
                $response = $indexes['client']->multiSearch($extraQueries)['results'] ?? [];
                if (count($response) !== count($extraQueries)) throw new \RuntimeException('Incomplete expanded candidate response.');
                $known = array_fill_keys(array_map(fn ($key) => 'key:'.$key, $candidateKeys), true);
                $extraKeys = [];
                foreach ($response as $search) foreach ($search['hits'] ?? [] as $hit) {
                    $key = (string) $hit['id'];
                    if (! isset($known['key:'.$key])) { $extraKeys[] = $key; $known['key:'.$key] = true; }
                }
                $extraRows = $referenceByKey->getMany($extraKeys);
                $extra = [];
                foreach ($extraKeys as $key) if (isset($extraRows[$key])) $extra[] = $extraRows[$key];
                // Each pool's top N contains every candidate eligible for the combined top N.
                $scoredCandidates = $this->retainCandidates([...$scoredCandidates, ...$this->evaluateCandidates($inputRecord, $extra, $mappings, $configuration)], $configuration);
            }

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
        // Persist immutable evidence before publishing a worker result/checkpoint.
        MatchingRecordSnapshots::flush();

        return [
            'batchResults' => $batchResults,
            'summaryDelta' => $summaryDelta,
            'scoring_ms' => $scoringMs,
            'multisearch_ms' => $multisearchMs,
            'candidate_search_queries' => $candidateSearchQueryCount,
            'candidate_search_hits' => $candidateSearchHitCount,
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
        $metrics['candidate_search_queries'] = ($metrics['candidate_search_queries'] ?? 0) + (int) ($chunkOutput['candidate_search_queries'] ?? 0);
        $metrics['candidate_search_hits'] = ($metrics['candidate_search_hits'] ?? 0) + (int) ($chunkOutput['candidate_search_hits'] ?? 0);

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
            'stage_progress' => [
                'phase' => 'matching_input',
                'label' => 'Pemadanan input',
                'processed' => $currentProcessed,
                'total' => $totalInputCount,
                'percentage' => $totalInputCount > 0 ? round(($currentProcessed / $totalInputCount) * 100, 1) : 100,
            ],
            'is_resumed' => ! empty($checkpointKey),
            'checkpoint_key' => $checkpointKey,
        ]);

        DB::transaction(function () use ($batchResults, $job, $currentProcessed, $summaryWithStage) {
            MatchingResult::where('matching_job_id', $job->id)->whereIn('input_record_key', array_values(array_unique(array_column($batchResults, 'input_record_key'))))->delete();
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
        \Illuminate\Support\Facades\Log::info('MATCHING_CHUNK_METRICS', [
            'job_id' => $job->id,
            'chunk' => $chunkIndex + 1,
            'processed' => $currentProcessed,
            'chunk_rows' => $chunkCount,
            'candidate_search_queries' => (int) ($chunkOutput['candidate_search_queries'] ?? 0),
            'candidate_search_hits' => (int) ($chunkOutput['candidate_search_hits'] ?? 0),
            'candidates_scored' => (int) ($delta['candidates_scored'] ?? 0),
            'multisearch_ms' => round((float) ($chunkOutput['multisearch_ms'] ?? 0), 2),
            'scoring_ms' => round((float) ($chunkOutput['scoring_ms'] ?? 0), 2),
            'db_write_ms' => round((microtime(true) - $dbStart) * 1000, 2),
            'memory_bytes' => memory_get_usage(true),
            'result_payload_bytes' => array_sum(array_map(static fn ($row) =>
                strlen($row['field_scores'] ?? '') + strlen($row['candidate_metadata'] ?? '') + strlen($row['verification_evidence'] ?? ''), $batchResults)),
        ]);
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
        $totalPossibleWeight = array_sum(array_map(fn ($m) => max(0.0, (float) ($m['weight'] ?? 0)), $mappings));
        $keptScores = [];

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

                $addressEvidence = $this->addresses->isAddress((string) $refCol) || $this->addresses->isAddress((string) $inpCol)
                    ? $this->addresses->compare($left, $right) : null;
                $fieldNumericMismatch = $addressEvidence !== null
                    ? $addressEvidence['conflict'] : $this->scorer->hasNumericMismatch($left, $right);
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

                if ($addressEvidence !== null) {
                    if ($addressEvidence['conflict']) $score = min($score, 60.0);
                    elseif ($addressEvidence['compatible'] && $addressEvidence['richer_side'] !== null) $score = max($score, 92.0);
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
                    'address_evidence' => $addressEvidence,
                ];
                // A proven upper bound may discard this candidate, never the rest
                // of the search results. Equality is retained for stable key ties.
                if ((bool) data_get($configuration, 'searchOptimization.candidatePruning', true)
                    && $totalPossibleWeight > 0 && count($keptScores) >= max(2, $topN)) {
                    $upper = round(($weightedScoreSum + max(0, $totalPossibleWeight - $weightTotal) * 100) / $totalPossibleWeight, 2);
                    if ($upper + 0.000001 < min($keptScores)) continue 2;
                }
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

            // Completeness is an enrichment proposal, not a failed guardrail.
            // Preserve the classification produced by thresholds and verification;
            // incompatible addresses still carry conflict evidence and lower scores.
            $hasAddressEnrichmentEvidence = collect($fieldScores)->contains(function ($score) {
                $evidence = $score['address_evidence'] ?? null;
                return ($evidence['compatible'] ?? false)
                    && !($evidence['conflict'] ?? true)
                    && ($evidence['richer_side'] ?? null) !== null;
            });
            $hasAddressConflict = collect($fieldScores)->contains(fn ($score) => (bool) data_get($score, 'address_evidence.conflict', false));
            if ($finalClassification === 'matched' && $hasAddressConflict) {
                $finalClassification = 'possible_match';
                $allRulesPassed = false;
                $downgraded = true;
                $downgradeReason = 'Address component conflict requires review';
                $decisionReason = $downgradeReason;
                $rulesEvaluated[] = [
                    'order' => count($rulesEvaluated) + 1,
                    'field_name' => 'Conflicting address components',
                    'method' => 'Conflict check',
                    'required_threshold' => 100.0,
                    'actual_score' => 0.0,
                    'passed' => false,
                    'is_mandatory' => true,
                ];
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
                'address_enrichment_available' => $hasAddressEnrichmentEvidence,
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
            $keptScores[] = $ws;
            rsort($keptScores);
            $keptScores = array_slice($keptScores, 0, max(2, $topN));

            // -----------------------------------------------------------------
            // Search relevance supplies no upper bound on the WLS of later hits.
            // Score the bounded retrieval pool completely before retaining top N.
        }

        return $this->retainCandidates($evaluated, $configuration);
    }

    private function retainCandidates(array $evaluated, array $configuration): array
    {
        usort($evaluated, fn ($a, $b) => ($b['score'] <=> $a['score']) ?: strcmp((string) $a['record']['key'], (string) $b['record']['key']));
        if (count($evaluated) > 1
            && $evaluated[0]['score'] === $evaluated[1]['score']
            && (string) $evaluated[0]['record']['key'] !== (string) $evaluated[1]['record']['key']) {
            foreach ($evaluated as &$candidate) {
                if ($candidate['score'] !== $evaluated[0]['score']) break;
                if ($candidate['classification'] !== 'matched') continue;
                $candidate['classification'] = 'possible_match';
                $candidate['reason'] = 'Ambiguous candidates with identical weighted similarity require review';
                $candidate['verification_evidence']['final_classification'] = 'possible_match';
                $candidate['verification_evidence']['downgraded'] = true;
                $candidate['verification_evidence']['downgrade_reason'] = $candidate['reason'];
            }
            unset($candidate);
        }
        return array_slice($evaluated, 0, max(1, (int) data_get($configuration, 'candidateGeneration.topN', 3)));
    }

    private function memoizationKey(array $input, array $mappings): string
    {
        $raw = [];
        foreach ($mappings as $mapping) {
            foreach ([$mapping['input_column_name'] ?? '', $mapping['parent_input_column'] ?? data_get($mapping, 'metadata.parent_input_column', '')] as $column) {
                if ($column !== '') $raw[$column] = $input['row'][$column] ?? null;
            }
        }
        // Generated values live in normalized[], not row[]. A raw-only cache key
        // collapses different company names when mappings use generated columns.
        return hash('sha256', json_encode([$raw, $input['normalized'] ?? [], $input['identity'] ?? []], JSON_THROW_ON_ERROR));
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
                'address_evidence' => $this->addresses->isAddress((string) $refCol) || $this->addresses->isAddress((string) $inpCol)
                    ? $this->addresses->compare($left, $right) : null,
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
        $useSnapshots = $this->snapshotStorageAvailable ??= MatchingRecordSnapshots::available();
        $leanInput = $useSnapshots ? ($inputRecord['row'] ?? []) : $this->leanRecordRow($inputRecord['row'] ?? [], $mappings, 'input');
        if (! empty($inputRecord['normalized'])) {
            foreach ($inputRecord['normalized'] as $normK => $normV) {
                if (str_starts_with($normK, '[Generated]') && ! isset($leanInput[$normK]) && $normV !== null && $normV !== '') {
                    $leanInput[$normK] = $normV;
                }
            }
        }
        $leanReference = $useSnapshots ? ($referenceRecord['row'] ?? null) : $this->leanRecordRow($referenceRecord['row'] ?? null, $mappings, 'reference');
        $metadata = ['worker_slot' => $workerSlot];
        if ($useSnapshots && $rank > 1) $metadata['_input_primary'] = (string) $inputRecord['key'];
        else $metadata['input_record'] = $leanInput;
        if ($useSnapshots && $leanReference !== null) $metadata['_reference_snapshot'] = MatchingRecordSnapshots::store($leanReference);
        if (! empty($referenceRecord['normalized'])) {
            foreach ($referenceRecord['normalized'] as $normK => $normV) {
                if (str_starts_with($normK, '[Generated]') && ! isset($leanReference[$normK]) && $normV !== null && $normV !== '') {
                    $leanReference[$normK] = $normV;
                    if ($useSnapshots) $metadata['_reference_generated'][$normK] = $normV;
                }
            }
        }

        if (! $useSnapshots || $leanReference === null) $metadata['reference_record'] = $leanReference;

        return [
            // Time-ordered UUIDs keep new InnoDB writes local instead of scattering
            // millions of inserts across random clustered-index pages.
            'id' => (string) Str::uuid7(),
            'matching_job_id' => $job->id,
            'input_record_key' => $inputRecord['key'],
            'reference_record_key' => $referenceRecord['key'] ?? null,
            'result_type' => $classification,
            'overall_score' => $score,
            ...($rank === 1 ? (new ReviewRegionIndexService($this->wilayah))->codes($inputRecord['row'] ?? []) : [
                'input_province_code' => null, 'input_regency_code' => null, 'input_region_indexed' => false,
            ]),
            'candidate_rank' => $rank,
            ...MatchingResultStorage::pack($metadata, $fieldScores, $verificationEvidence),
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
        $counts = $job->record_counts;
        if (! is_array($counts) || ! isset($counts['matched'])) {
            $counts = $job->calculateDistinctRecordCounts();
        }

        $progress = $job->total_count > 0 ? round(($job->processed_count / $job->total_count) * 100, 2) : 0;

        $rawInput = (int) ($counts['total_raw_input'] ?? $job->inputDataset?->row_count ?? $job->total_count);
        $uniqueInput = (int) ($counts['total_unique_input'] ?? $job->total_count);
        $duplicates = (int) ($counts['total_duplicates'] ?? max(0, $rawInput - $uniqueInput));
        $duplicateDetails = $counts['duplicate_details'] ?? [];

        if (empty($duplicateDetails) && $duplicates > 0 && $job->inputDataset
            && empty(data_get($counts, 'input_scope.provinceCodes')) && empty(data_get($counts, 'input_scope.regencyCodes'))) {
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
            'workspace' => $job->workspace ? ['id' => $job->workspace->id, 'configuration_version' => (int) $job->workspace->configuration_version] : null,
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
                'stage_progress' => data_get($job->record_counts, 'stage_progress'),
            ],
            'summary' => [
                'matched' => (int) ($counts['matched'] ?? 0),
                'possible_match' => (int) ($counts['possible_match'] ?? 0),
                'unmatched' => (int) ($counts['unmatched'] ?? 0),
                'candidates_scored' => (int) ($counts['candidates_scored'] ?? 0),
                'total_source_input' => (int) ($counts['total_source_input'] ?? $rawInput),
                'excluded_input' => (int) ($counts['excluded_input'] ?? 0),
                'input_scope' => $counts['input_scope'] ?? [],
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
    public function streamDatasetRows(Dataset $dataset): \Generator
    {
        $storagePath = $dataset->storage_path;
        if (!$storagePath) {
            if (!app()->runningUnitTests()) throw new InvalidArgumentException('Dataset source file is missing. Please upload it again.');
            yield from $dataset->preview_rows ?? [];
            return;
        }
        $paths = [Storage::disk('local')->path($storagePath), storage_path('app/'.$storagePath), storage_path('app/private/'.$storagePath), $storagePath];
        $filePath = null;
        foreach ($paths as $path) {
            if (is_file($path) && is_readable($path)) { $filePath = $path; break; }
        }
        if ($filePath === null) {
            if (!app()->runningUnitTests()) throw new InvalidArgumentException('Dataset source file is unreadable. Please upload it again.');
            yield from $dataset->preview_rows ?? [];
            return;
        }
        $format = strtolower((string) ($dataset->file_format ?: pathinfo($filePath, PATHINFO_EXTENSION)));
        $parser = match ($format) {
            'csv', 'tsv' => new CsvDatasetParser(),
            'xlsx', 'xls' => new XlsxDatasetParser(),
            default => throw new InvalidArgumentException('Unsupported dataset format.'),
        };
        yield from $parser->streamRows($filePath, [
            'delimiter' => $dataset->delimiter, 'header_row' => max(1, (int) $dataset->header_row),
            'sheet_name' => $dataset->selected_sheet,
        ]);
    }

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

    /** Compatibility helper returning the highest-priority candidate query. */
    public function buildCandidateBlockingQuery(array $inputRecord, array $mappings): string
    {
        return $this->buildCandidateBlockingQueries($inputRecord, $mappings)[0] ?? '';
    }

    /** Build a bounded union of independent name-field queries for better candidate recall. */
    public function buildCandidateBlockingQueries(array $inputRecord, array $mappings): array
    {
        $identifierCandidates = [];
        $coreCandidates = [];
        $nameCandidates = [];
        $fallbackCandidates = [];

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
            if (preg_match('/(?:^|_)(?:nib|npwp|identifier|registration)(?:_|$)/', $colLower)) {
                $identifier = preg_replace('/[^\pL\pN]/u', '', $val);
                if (mb_strlen($identifier) >= 8 && ! preg_match('/^(.)\1+$/u', $identifier)) $identifierCandidates[] = $identifier;
                continue;
            }
            $transform = (string) ($mapping['transform'] ?? data_get($mapping, 'metadata.transform') ?? '');

            if ($transform === 'EXTRACT_LEGAL_FORM' || str_contains($colLower, 'badan_usaha') || str_contains($colLower, 'legal_form')) continue;

            // Prefer generated core name, then other mapped name fields.
            if ($transform === 'EXTRACT_CORE_NAME' || str_contains($colLower, 'nama_inti') || str_contains($colLower, 'core_name')) {
                $coreCandidates[] = $val;
                continue;
            }
            if (str_contains($colLower, 'nama') || str_contains($colLower, 'name') || str_contains($colLower, 'perusahaan') || str_contains($colLower, 'usaha')) {
                $nameCandidates[] = $val;
                continue;
            }

            // Priority 3: Non-address, non-id, non-legal-form column
            $isAddress = str_contains($colLower, 'alamat') || str_contains($colLower, 'address') || str_contains($colLower, 'jalan') || str_contains($colLower, 'rt') || str_contains($colLower, 'rw') || str_contains($colLower, 'kelurahan') || str_contains($colLower, 'kecamatan') || str_contains($colLower, 'kota') || str_contains($colLower, 'kabupaten') || str_contains($colLower, 'provinsi') || str_contains($colLower, 'kodepos');
            $isId = str_contains($colLower, 'id') || str_contains($colLower, 'nib') || str_contains($colLower, 'npwp') || str_contains($colLower, 'kode');
            $isLegal = str_contains($colLower, 'badan_usaha') || str_contains($colLower, 'legal_form');

            if (!$isAddress && !$isId && !$isLegal) $fallbackCandidates[] = $val;
        }

        $queries = [];
        foreach ([$identifierCandidates, $coreCandidates, $nameCandidates, $fallbackCandidates] as $group) {
            foreach ($group as $candidate) {
                $query = $this->prepareCandidateQuery($candidate);
                if ($query !== '' && !in_array($query, $queries, true)) $queries[] = $query;
                if (count($queries) >= 3) return $queries;
            }
        }
        return $queries;
    }

    private function prepareCandidateQuery(string $candidate): string
    {
        $clean = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $candidate) ?? $candidate;
        $tokens = array_values(array_filter(preg_split('/\s+/u', trim($clean)) ?: [], static fn ($token) => $token !== ''));
        if (count($tokens) > 5) {
            $ranked = $tokens;
            usort($ranked, static fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
            $selected = array_fill_keys(array_slice($ranked, 0, 5), true);
            $tokens = array_values(array_filter($tokens, static fn ($token) => isset($selected[$token])));
        }
        return implode(' ', $tokens);
    }
}
