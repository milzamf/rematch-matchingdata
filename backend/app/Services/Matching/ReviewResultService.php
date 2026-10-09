<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use App\Models\User;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

class ReviewResultService
{
    private readonly WilayahDictionaryService $wilayahService;

    public function __construct(
        private readonly ResourceOwnership $ownership,
        ?WilayahDictionaryService $wilayahService = null,
    ) {
        $this->wilayahService = $wilayahService ?? app(WilayahDictionaryService::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function list(User $user, string $jobId, array $params = []): array
    {
        $job = $this->ownership->findMatchingJob($user, $jobId);

        // Guard: If job is still processing/queued, return early without heavy unindexed queries
        if (in_array($job->status, ['processing', 'queued', 'pending'], true)) {
            $recordCounts = $job->record_counts ?? [];
            $totalRawInput = (int) ($recordCounts['total_raw_input'] ?? $job->inputDataset?->row_count ?? $job->total_count ?? 0);
            $totalUniqueInput = (int) ($recordCounts['total_unique_input'] ?? $totalRawInput);
            $totalDuplicates = (int) ($recordCounts['total_duplicates'] ?? 0);

            return [
                'job' => [
                    'id' => $job->id,
                    'name' => $job->name,
                    'status' => $job->status,
                    'thresholds' => $job->configuration?->thresholds ?? null,
                    'configuration' => [
                        'thresholds' => $job->configuration?->thresholds ?? null,
                        'strategy' => $job->configuration?->strategy ?? null,
                    ],
                ],
                'summary' => [
                    'matched' => (int) ($recordCounts['matched'] ?? 0),
                    'possible_match' => (int) ($recordCounts['possible_match'] ?? 0),
                    'unmatched' => (int) ($recordCounts['unmatched'] ?? 0),
                    'auto_matched' => (int) ($recordCounts['matched'] ?? 0),
                    'manual_accepted' => 0,
                    'manual_rejected' => 0,
                    'reviewed' => 0,
                    'total_raw_input' => $totalRawInput,
                    'total_unique_input' => $totalUniqueInput,
                    'total_duplicates' => $totalDuplicates,
                    'duplicate_details' => $recordCounts['duplicate_details'] ?? [],
                    'processed_count' => (int) ($job->processed_count ?? 0),
                    'is_completed' => false,
                    'unprocessed_count' => max(0, $totalUniqueInput - (int) ($job->processed_count ?? 0)),
                ],
                'pagination' => [
                    'current_page' => 1,
                    'per_page' => 25,
                    'total_items' => 0,
                    'total_pages' => 1,
                    'from' => 0,
                    'to' => 0,
                ],
                'items' => [],
                'system_presets' => [],
                'custom_rules' => [],
                'dynamic_patterns' => [],
                'case_groups' => [],
                'is_processing' => true,
            ];
        }

        $allDecisions = $job->reviewDecisions()
            ->latest()
            ->get();
        $latestDecisions = $allDecisions
            ->whereNull('undone_at')
            ->unique('input_record_key')
            ->keyBy('input_record_key');
        $decisionHistory = $allDecisions
            ->groupBy('input_record_key');

        $customRules = data_get($job->configuration?->advanced_settings, 'custom_review_rules', []);
        if (empty($customRules) && $job->workspace) {
            $customRules = data_get($job->workspace->workflow_state, 'custom_review_rules', []);
        }

        $page = max(1, (int) ($params['page'] ?? 1));
        $perPage = min(100, max(10, (int) ($params['per_page'] ?? 25)));
        $status = (string) ($params['status'] ?? $params['filter'] ?? 'all');
        $search = trim((string) ($params['search'] ?? $params['query'] ?? ''));
        $caseGroupId = trim((string) ($params['case_group_id'] ?? $params['group_id'] ?? ''));

        $recordCounts = $job->record_counts ?? [];
        $totalRawInput = (int) ($recordCounts['total_raw_input'] ?? $job->total_count ?? count($items ?? []));
        $totalUniqueInput = (int) ($recordCounts['total_unique_input'] ?? $totalRawInput);
        $totalDuplicates = (int) ($recordCounts['total_duplicates'] ?? max(0, $totalRawInput - $totalUniqueInput));
        $duplicateDetails = $recordCounts['duplicate_details'] ?? [];

        if (empty($recordCounts) || (!isset($recordCounts['matched']) && !isset($recordCounts['possible_match']) && !isset($recordCounts['unmatched']))) {
            $matchedCount = (int) MatchingResult::where('matching_job_id', $job->id)->where('result_type', 'matched')->count();
            $possibleMatchCount = (int) MatchingResult::where('matching_job_id', $job->id)->where('result_type', 'possible_match')->count();
            $unmatchedCount = (int) MatchingResult::where('matching_job_id', $job->id)->where('result_type', 'unmatched')->count();
        } else {
            $matchedCount = (int) ($recordCounts['matched'] ?? 0);
            $possibleMatchCount = (int) ($recordCounts['possible_match'] ?? 0);
            $unmatchedCount = (int) ($recordCounts['unmatched'] ?? 0);
        }

        $reviewedCount = $job->reviewDecisions()->whereNull('undone_at')->distinct('input_record_key')->count('input_record_key');

        // Aggregate review groups across all reviewable database records (with caching)
        $reviewGroups = $this->aggregateJobReviewGroups($job, $latestDecisions, $decisionHistory, $customRules, $reviewedCount);

        if ($caseGroupId !== '') {
            $allGroups = array_merge(
                $reviewGroups['system_presets'] ?? [],
                $reviewGroups['custom_rules'] ?? [],
                $reviewGroups['dynamic_patterns'] ?? [],
                $reviewGroups['case_groups'] ?? []
            );
            $matchedGroup = collect($allGroups)->first(fn ($g) => ($g['id'] ?? '') === $caseGroupId);
            $groupKeys = $matchedGroup['item_keys'] ?? [];

            if ($search !== '') {
                $groupKeys = array_values(array_filter($groupKeys, fn ($k) => str_contains(strtolower($k), strtolower($search))));
            }

            $totalFiltered = count($groupKeys);
            $totalPages = max(1, (int) ceil($totalFiltered / $perPage));
            $pageKeys = array_slice($groupKeys, ($page - 1) * $perPage, $perPage);

            $results = MatchingResult::where('matching_job_id', $job->id)
                ->whereIn('input_record_key', $pageKeys)
                ->orderBy('input_record_key')
                ->orderBy('candidate_rank')
                ->get();

            $items = $this->transformResultsToItems($results, $latestDecisions, $decisionHistory, $customRules);
        } else {
            // Query input keys using the index on candidate_rank = 1
            $keysQuery = DB::table('matching_results')
                ->where('matching_job_id', $job->id)
                ->where('candidate_rank', 1);

            if ($status !== 'all' && in_array($status, ['possible_match', 'matched', 'unmatched'], true)) {
                $keysQuery->where('result_type', $status);
            }

            if ($search !== '') {
                $keysQuery->where(function ($q) use ($search) {
                    $q->where('input_record_key', 'LIKE', "%{$search}%")
                      ->orWhere('candidate_metadata', 'LIKE', "%{$search}%");
                });
            }

            if ($search !== '') {
                $totalFiltered = (clone $keysQuery)->count();
            } else {
                $totalFiltered = match ($status) {
                    'possible_match' => $possibleMatchCount,
                    'matched' => $matchedCount,
                    'unmatched' => $unmatchedCount,
                    default => (int) ($job->total_count ?? $totalRawInput),
                };
                if ($totalFiltered === 0) {
                    $totalFiltered = (clone $keysQuery)->count();
                }
            }
            $totalPages = max(1, (int) ceil($totalFiltered / $perPage));

            $pageKeys = $keysQuery
                ->orderBy('id', 'asc')
                ->forPage($page, $perPage)
                ->pluck('input_record_key');

            $results = MatchingResult::where('matching_job_id', $job->id)
                ->whereIn('input_record_key', $pageKeys)
                ->orderBy('input_record_key')
                ->orderBy('candidate_rank')
                ->get();

            $items = $this->transformResultsToItems($results, $latestDecisions, $decisionHistory, $customRules);
        }

        $manualAccepted = $latestDecisions->filter(fn ($d) => in_array($d->decision, ['accept_match', 'accepted', 'accept'], true))->count();
        $manualRejected = $latestDecisions->filter(fn ($d) => in_array($d->decision, ['reject_match', 'rejected', 'reject'], true))->count();

        $effectiveMatched = $matchedCount + $manualAccepted;
        $effectiveReview = max(0, $possibleMatchCount - $manualAccepted - $manualRejected);
        $effectiveUnmatched = $unmatchedCount + $manualRejected;
        $processedCount = (int) ($job->processed_count ?? ($matchedCount + $possibleMatchCount + $unmatchedCount));
        $isCompleted = ($job->status === 'completed');
        $unprocessedCount = max(0, $totalUniqueInput - $processedCount);

        return [
            'job' => [
                'id' => $job->id,
                'name' => $job->name,
                'status' => $job->status,
                'thresholds' => $job->configuration?->thresholds ?? null,
                'configuration' => [
                    'thresholds' => $job->configuration?->thresholds ?? null,
                    'strategy' => $job->configuration?->strategy ?? null,
                ],
            ],
            'summary' => [
                'matched' => $effectiveMatched,
                'possible_match' => $effectiveReview,
                'unmatched' => $effectiveUnmatched,
                'auto_matched' => $matchedCount,
                'manual_accepted' => $manualAccepted,
                'manual_rejected' => $manualRejected,
                'reviewed' => $reviewedCount,
                'total_raw_input' => $totalRawInput,
                'total_unique_input' => $totalUniqueInput,
                'total_duplicates' => $totalDuplicates,
                'duplicate_details' => $duplicateDetails,
                'processed_count' => $processedCount,
                'is_completed' => $isCompleted,
                'unprocessed_count' => $unprocessedCount,
            ],
            'pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total_items' => $totalFiltered,
                'total_pages' => $totalPages,
                'from' => $totalFiltered > 0 ? (($page - 1) * $perPage + 1) : 0,
                'to' => min($totalFiltered, $page * $perPage),
            ],
            'items' => $items->sortBy(fn (array $item) => match ($item['status']) {
                'possible_match' => 0,
                'matched' => 1,
                default => 2,
            })->values()->all(),
            'system_presets' => $reviewGroups['system_presets'],
            'custom_rules' => $reviewGroups['custom_rules'],
            'dynamic_patterns' => $reviewGroups['dynamic_patterns'],
            'case_groups' => $reviewGroups['case_groups'],
            'field_quality_summary' => $this->aggregateFieldQuality($job, $totalUniqueInput),
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function aggregateFieldQuality(MatchingJob $job, int $totalEvaluated): array
    {
        $cacheKey = "matching_job_field_quality_{$job->id}";
        return cache()->remember($cacheKey, 3600, function () use ($job, $totalEvaluated) {
            if (!empty($job->record_counts['field_quality_summary'])) {
                return $job->record_counts['field_quality_summary'];
            }

            $samples = MatchingResult::where('matching_job_id', $job->id)
                ->where('candidate_rank', 1)
                ->whereNotNull('field_scores')
                ->limit(2000)
                ->pluck('field_scores');

            if ($samples->isEmpty()) {
                return [];
            }

            $stats = [];
            foreach ($samples as $scores) {
                if (!is_array($scores)) {
                    continue;
                }
                foreach ($scores as $scoreItem) {
                    $refCol = (string) ($scoreItem['reference_column'] ?? '');
                    $inpCol = (string) ($scoreItem['input_column'] ?? '');
                    if ($refCol === '' && $inpCol === '') {
                        continue;
                    }
                    $key = "{$refCol}:::{$inpCol}";
                    if (!isset($stats[$key])) {
                        $stats[$key] = [
                            'fieldKey' => $key,
                            'referenceColumn' => $refCol,
                            'inputColumn' => $inpCol,
                            'totalSample' => 0,
                            'scoreSum' => 0.0,
                            'highCount' => 0,
                            'medCount' => 0,
                            'lowCount' => 0,
                        ];
                    }
                    $s = (float) ($scoreItem['score'] ?? 0);
                    $stats[$key]['totalSample']++;
                    $stats[$key]['scoreSum'] += $s;
                    if ($s >= 90) {
                        $stats[$key]['highCount']++;
                    } elseif ($s >= 80) {
                        $stats[$key]['medCount']++;
                    } else {
                        $stats[$key]['lowCount']++;
                    }
                }
            }

            $effectiveTotal = max(1, $totalEvaluated);
            $result = [];
            foreach ($stats as $key => $st) {
                if ($st['totalSample'] === 0) {
                    continue;
                }
                $highRatio = $st['highCount'] / $st['totalSample'];
                $medRatio = $st['medCount'] / $st['totalSample'];
                $lowRatio = $st['lowCount'] / $st['totalSample'];

                $scaledHigh = (int) round($highRatio * $effectiveTotal);
                $scaledMed = (int) round($medRatio * $effectiveTotal);
                $scaledLow = max(0, $effectiveTotal - $scaledHigh - $scaledMed);

                $result[$key] = [
                    'fieldKey' => $key,
                    'referenceColumn' => $st['referenceColumn'],
                    'inputColumn' => $st['inputColumn'],
                    'totalEvaluated' => $effectiveTotal,
                    'avgScore' => (int) round($st['scoreSum'] / $st['totalSample']),
                    'highCount' => $scaledHigh,
                    'medCount' => $scaledMed,
                    'lowCount' => $scaledLow,
                    'highPct' => (int) round($highRatio * 100),
                    'medPct' => (int) round($medRatio * 100),
                    'lowPct' => (int) round($lowRatio * 100),
                ];
            }

            return $result;
        });
    }

    /**
     * @param \Illuminate\Support\Collection<string, ReviewDecision> $latestDecisions
     * @param \Illuminate\Support\Collection<string, \Illuminate\Support\Collection<int, ReviewDecision>> $decisionHistory
     * @param array<int, array<string, mixed>> $customRules
     * @return array{system_presets: array<int, array<string, mixed>>, custom_rules: array<int, array<string, mixed>>, dynamic_patterns: array<int, array<string, mixed>>, case_groups: array<int, array<string, mixed>>}
     */
    private function aggregateJobReviewGroups(MatchingJob $job, $latestDecisions, $decisionHistory, array $customRules, int $reviewedCount): array
    {
        $rulesHash = md5(json_encode($customRules));
        $cacheKey = "matching_job_case_groups_{$job->id}_{$reviewedCount}_{$rulesHash}";

        if (cache()->has($cacheKey)) {
            $cached = cache()->get($cacheKey);
            if (is_array($cached) && (!empty($cached['case_groups']) || !empty($cached['system_presets']))) {
                return $cached;
            }
        }

        $results = MatchingResult::where('matching_job_id', $job->id)
            ->where(function ($q) {
                $q->where('result_type', 'possible_match')
                  ->orWhere('review_status', 'reviewed')
                  ->orWhereNotNull('review_decision');
            })
            ->whereIn('candidate_rank', [1, 2])
            ->orderBy('input_record_key')
            ->orderBy('candidate_rank')
            ->limit(1000)
            ->get();

        $items = $this->transformResultsToItems($results, $latestDecisions, $decisionHistory, $customRules);
        $groups = $this->buildReviewGroups($items, $customRules);

        cache()->put($cacheKey, $groups, 1800);

        return $groups;
    }

    /**
     * @param \Illuminate\Support\Collection<int, MatchingResult> $results
     * @param \Illuminate\Support\Collection<string, ReviewDecision> $latestDecisions
     * @param \Illuminate\Support\Collection<string, \Illuminate\Support\Collection<int, ReviewDecision>> $decisionHistory
     * @param array<int, array<string, mixed>> $customRules
     * @return \Illuminate\Support\Collection<int, array<string, mixed>>
     */
    private function transformResultsToItems($results, $latestDecisions, $decisionHistory, array $customRules = []): \Illuminate\Support\Collection
    {
        return $results->groupBy('input_record_key')->map(function ($group, string $inputKey) use ($latestDecisions, $decisionHistory, $customRules) {
            /** @var \Illuminate\Support\Collection<int, MatchingResult> $group */
            $group = $group->sortBy('candidate_rank')->values();
            $primary = $group->first();
            $decision = $latestDecisions->get($inputKey);
            $history = $decisionHistory->get($inputKey, collect());
            $candidates = $group->map(fn (MatchingResult $result) => $this->candidatePayload($result))->values()->all();
            $item = [
                'input_record_key' => $inputKey,
                'status' => $decision?->new_result_type ?? $this->statusForGroup($group),
                'display_status' => $this->displayStatus($decision, $this->statusForGroup($group)),
                'status_code' => $this->statusCode($decision, $this->statusForGroup($group)),
                'review_status' => $primary?->review_status ?? 'pending',
                'decision' => $decision ? $this->decisionPayload($decision) : null,
                'decision_history' => $history->map(fn (ReviewDecision $item) => $this->decisionPayload($item))->values()->all(),
                'input_record' => data_get($primary?->candidate_metadata, 'input_record', []),
                'candidates' => $candidates,
            ];

            return [
                ...$item,
                'case_features' => $this->caseFeatures($item, $customRules),
            ];
        })->values();
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function decide(User $user, string $jobId, array $payload): array
    {
        return DB::transaction(function () use ($user, $jobId, $payload) {
            $job = $this->ownership->findMatchingJob($user, $jobId);
            $decision = (string) $payload['decision'];
            $scope = (string) ($payload['scope'] ?? 'one');
            $reviewSnapshot = $this->list($user, $job->id);
            $itemsByKey = collect($reviewSnapshot['items'])->keyBy('input_record_key');
            $caseGroupsById = collect($reviewSnapshot['case_groups'])->keyBy('id');
            if (empty($caseGroupsById[$payload['case_group_id'] ?? ''])) {
                $allReviewGroups = collect(array_merge(
                    $reviewSnapshot['system_presets'] ?? [],
                    $reviewSnapshot['custom_rules'] ?? [],
                    $reviewSnapshot['dynamic_patterns'] ?? [],
                    $reviewSnapshot['case_groups'] ?? []
                ))->keyBy('id');
                $caseGroupsById = $allReviewGroups;
            }
            $inputKeys = $this->targetInputKeys($payload, $scope, $caseGroupsById);

            // Fetch any target records not present in current page snapshot
            $missingKeys = array_diff($inputKeys, $itemsByKey->keys()->all());
            if (! empty($missingKeys)) {
                $customRules = data_get($job->configuration?->advanced_settings, 'custom_review_rules', []);
                if (empty($customRules) && $job->workspace) {
                    $customRules = data_get($job->workspace->workflow_state, 'custom_review_rules', []);
                }
                $allDecisions = $job->reviewDecisions()->latest()->get();
                $latestDecisions = $allDecisions->whereNull('undone_at')->unique('input_record_key')->keyBy('input_record_key');
                $decisionHistory = $allDecisions->groupBy('input_record_key');

                $missingResults = MatchingResult::where('matching_job_id', $job->id)
                    ->whereIn('input_record_key', $missingKeys)
                    ->orderBy('input_record_key')
                    ->orderBy('candidate_rank')
                    ->get();
                $missingItems = $this->transformResultsToItems($missingResults, $latestDecisions, $decisionHistory, $customRules);
                $itemsByKey = $itemsByKey->union($missingItems->keyBy('input_record_key'));
            }

            $inputKeys = $this->openInputKeys($itemsByKey, $inputKeys, $scope);
            $safetyFailures = $this->bulkSafetyFailures($itemsByKey, $inputKeys, $decision, $scope, $payload);
            $inputKeys = array_values(array_filter(
                $inputKeys,
                fn (string $inputKey) => ! isset($safetyFailures[$inputKey]),
            ));

            if ($inputKeys === []) {
                throw new InvalidArgumentException('All selected records require individual review after safety validation.');
            }

            $newType = $this->newResultType($decision);
            $audits = [];
            $knowledge = null;
            $batchId = (string) Str::uuid();

            foreach ($inputKeys as $inputKey) {
                $item = $itemsByKey->get($inputKey);

                if (! is_array($item)) {
                    throw new InvalidArgumentException('One or more selected review records could not be found.');
                }

                $candidatePayload = $this->candidateForDecision($item, $payload, count($inputKeys) === 1);
                $result = $candidatePayload !== null
                    ? MatchingResult::where('matching_job_id', $job->id)->findOrFail($candidatePayload['id'])
                    : null;

                if ($decision !== 'mark_unmatched' && $result === null) {
                    throw new InvalidArgumentException('A candidate result is required for this review decision.');
                }

                $previousType = $result?->result_type;
                $knowledge = $knowledge ?? $this->reviewKnowledge($job, $item, $decision, $scope, $payload);

                if ($result !== null) {
                    $result->update([
                        'result_type' => $newType,
                        'review_status' => 'reviewed',
                        'review_decision' => $decision,
                        'reviewed_at' => Carbon::now(),
                    ]);
                } else {
                    MatchingResult::where('matching_job_id', $job->id)
                        ->where('input_record_key', $inputKey)
                        ->update([
                            'result_type' => 'unmatched',
                            'review_status' => 'reviewed',
                            'review_decision' => $decision,
                            'reviewed_at' => Carbon::now(),
                        ]);
                }

                $audits[] = ReviewDecision::create([
                    'matching_job_id' => $job->id,
                    'matching_result_id' => $result?->id,
                    'input_record_key' => $inputKey,
                    'selected_reference_record_key' => $result?->reference_record_key,
                    'decision' => $decision,
                    'previous_result_type' => $previousType,
                    'new_result_type' => $newType,
                    'metadata' => [
                        'note' => $payload['note'] ?? null,
                        'created_by' => 'local_frontend',
                        'reviewer' => 'local_frontend',
                        'scope' => $scope,
                        'decision_source' => $scope === 'group' ? 'group' : ($scope === 'selected' ? 'group' : 'individual'),
                        'case_group_id' => $payload['case_group_id'] ?? null,
                        'batch_id' => $batchId,
                        'affected_records' => count($inputKeys),
                        'safety_validation' => [
                            'applied' => in_array($scope, ['group', 'selected'], true),
                            'passed' => true,
                            'skipped_records' => array_values($safetyFailures),
                        ],
                        'review_knowledge' => $knowledge,
                    ],
                ]);
            }

            /** @var ReviewDecision $latestAudit */
            $latestAudit = end($audits);

            return [
                'decision' => [
                    'id' => $latestAudit->id,
                    'decision' => $latestAudit->decision,
                    'input_record_key' => $latestAudit->input_record_key,
                    'selected_reference_record_key' => $latestAudit->selected_reference_record_key,
                    'new_result_type' => $latestAudit->new_result_type,
                    'affected_records' => count($audits),
                    'skipped_records' => array_values($safetyFailures),
                    'skipped_count' => count($safetyFailures),
                ],
                'review' => $this->list($user, $job->id),
            ];
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function undo(User $user, string $jobId, string $decisionId): array
    {
        return DB::transaction(function () use ($user, $jobId, $decisionId) {
            $this->ownership->findMatchingJob($user, $jobId);
            $decision = ReviewDecision::where('matching_job_id', $jobId)
                ->whereNull('undone_at')
                ->findOrFail($decisionId);
            $batchId = data_get($decision->metadata, 'batch_id');
            $decisions = $batchId
                ? ReviewDecision::where('matching_job_id', $jobId)
                    ->whereNull('undone_at')
                    ->where('metadata->batch_id', $batchId)
                    ->get()
                : collect([$decision]);

            foreach ($decisions as $item) {
                if ($item->matching_result_id !== null) {
                    MatchingResult::where('matching_job_id', $jobId)
                        ->where('id', $item->matching_result_id)
                        ->update([
                            'result_type' => $item->previous_result_type ?? 'possible_match',
                            'review_status' => 'pending',
                            'review_decision' => null,
                            'reviewed_at' => null,
                        ]);
                } else {
                    MatchingResult::where('matching_job_id', $jobId)
                        ->where('input_record_key', $item->input_record_key)
                        ->update([
                            'review_status' => 'pending',
                            'review_decision' => null,
                            'reviewed_at' => null,
                        ]);
                }

                $item->update(['undone_at' => Carbon::now()]);
            }

            return [
                'undone_decision_id' => $decision->id,
                'affected_records' => $decisions->count(),
                'review' => $this->list($user, $jobId),
            ];
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function candidatePayload(MatchingResult $result): array
    {
        return [
            'id' => $result->id,
            'reference_record_key' => $result->reference_record_key,
            'reference_record' => data_get($result->candidate_metadata, 'reference_record', []),
            'result_type' => $result->result_type,
            'review_status' => $result->review_status,
            'score' => $result->overall_score,
            'rank' => $result->candidate_rank,
            'field_scores' => $this->decorateFieldScores($result->field_scores ?? []),
            'decision_reason' => $result->decision_reason,
            'verification_evidence' => $result->verification_evidence ?? null,
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, array<string, mixed>> $items
     * @return array<int, array<string, mixed>>
     */
    private function caseGroups($items): array
    {
        return $this->buildReviewGroups($items)['case_groups'];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function defaultSystemPresets(): array
    {
        return [
            [
                'id' => 'system_preset_1_nib_conflict',
                'preset_number' => 1,
                'name' => '1. NIB Beda / Konflik Identitas',
                'pattern' => 'IDENTIFIER_CONFLICT',
                'description' => 'Nomor NIB atau NPWP di kedua data terisi tetapi nilainya berbeda, atau terjadi konflik pada identifier legal unik.',
                'type' => 'system_preset',
                'recommendation' => 'Reject atau verifikasi keabsahan izin berusaha secara individual.',
            ],
            [
                'id' => 'system_preset_2_legal_form',
                'preset_number' => 2,
                'name' => '2. Beda Bentuk Usaha (PT/CV)',
                'pattern' => 'LEGAL_FORM_CONFLICT',
                'description' => 'Bentuk badan usaha berbeda (CV vs PT / perorangan) meskipun nama inti perusahaan memiliki kemiripan tinggi.',
                'type' => 'system_preset',
                'recommendation' => 'Reject group kecuali sampel perwakilan terbukti transformasi entitas yang sama.',
            ],
            [
                'id' => 'system_preset_3_multi_candidate',
                'preset_number' => 3,
                'name' => '3. Kandidat Ganda (Ambiguitas)',
                'pattern' => 'MULTI_CANDIDATE_AMBIGUITY',
                'description' => 'Terdapat 2 atau lebih data kandidat acuan dengan kemiripan tinggi dan selisih skor <= 5%.',
                'type' => 'system_preset',
                'recommendation' => 'Pilih manual salah satu kandidat acuan yang paling sesuai.',
            ],
            [
                'id' => 'system_preset_4_geo_location',
                'preset_number' => 4,
                'name' => '4. Beda Wilayah (Kabupaten)',
                'pattern' => 'GEO_LOCATION_CONFLICT',
                'description' => 'Kemiripan nama perusahaan tinggi (>= 80%), namun kolom Kabupaten/Kota berbeda antardata.',
                'type' => 'system_preset',
                'recommendation' => 'Periksa apakah entitas memiliki kantor cabang atau berpindah domisili wilayah.',
            ],
            [
                'id' => 'system_preset_5_address',
                'preset_number' => 5,
                'name' => '5. Beda Alamat',
                'pattern' => 'ADDRESS_CONFLICT',
                'description' => 'Nama perusahaan dan wilayah cocok, namun penulisan alamat jalan/detail memiliki kemiripan rendah (< 60%).',
                'type' => 'system_preset',
                'recommendation' => 'Verifikasi keabsahan relokasi kantor sebelum menyetujui.',
            ],
            [
                'id' => 'system_preset_6_same_name_addr_diff_city',
                'preset_number' => 6,
                'name' => '6. Nama & Alamat Sama, Beda Kabupaten/Kota',
                'pattern' => 'SAME_NAME_ADDRESS_DIFF_CITY',
                'description' => 'Nama perusahaan dan alamat sama persis atau kemiripan tinggi (>= 90%), namun Kabupaten/Kota atau kode wilayah berbeda.',
                'type' => 'system_preset',
                'recommendation' => 'Periksa apakah entitas memiliki kantor cabang, berpindah domisili wilayah, atau terdapat kesalahan kode kabupaten/kota pada data input.',
            ],
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, array<string, mixed>> $items
     * @param array<int, array<string, mixed>> $customRules
     * @return array{system_presets: array<int, array<string, mixed>>, custom_rules: array<int, array<string, mixed>>, dynamic_patterns: array<int, array<string, mixed>>, case_groups: array<int, array<string, mixed>>}
     */
    private function buildReviewGroups($items, array $customRules = []): array
    {
        $reviewItems = $items->filter(fn (array $item) => $this->isReviewCaseItem($item));
        $byGroupId = $reviewItems->groupBy(fn (array $item) => (string) data_get($item, 'case_features.group_id'));

        // 1. System Presets
        $defaultDefs = $this->defaultSystemPresets();
        $systemPresets = [];
        foreach ($defaultDefs as $def) {
            $group = $byGroupId->get($def['id'], collect());
            $systemPresets[] = $this->formatGroupPayload($def['id'], $group, $def);
        }

        // 2. Custom Rules
        $customRuleGroups = [];
        foreach ($customRules as $cr) {
            $gid = 'custom_rule_' . ($cr['id'] ?? Str::slug($cr['name']));
            $group = $byGroupId->get($gid, collect());
            $customRuleGroups[] = $this->formatGroupPayload($gid, $group, [
                'id' => $gid,
                'name' => $cr['name'],
                'description' => $cr['description'] ?? "Kustom: {$cr['name']}",
                'type' => 'custom_rule',
                'rule_id' => $cr['id'] ?? null,
                'pattern' => 'CUSTOM_RULE_' . ($cr['id'] ?? Str::slug($cr['name'])),
                'recommendation' => match ($cr['action_recommendation'] ?? 'manual') {
                    'accept' => 'Setujui pencocokan sesuai aturan kustom.',
                    'reject' => 'Tolak pencocokan sesuai aturan kustom.',
                    default => 'Tinjau sampel perwakilan sebelum mengambil keputusan kelompok.',
                },
            ]);
        }

        // 3. Dynamic Fallback Patterns
        $dynamicPatterns = [];
        foreach ($byGroupId as $gid => $group) {
            $first = $group->first();
            if (data_get($first, 'case_features.rule_type') === 'dynamic_fallback') {
                $dynamicPatterns[] = $this->formatGroupPayload($gid, $group, [
                    'id' => $gid,
                    'name' => data_get($first, 'case_features.label', 'Pola Dinamis'),
                    'description' => data_get($first, 'case_features.reason', 'Pola data sisa.'),
                    'type' => 'dynamic_fallback',
                    'pattern' => data_get($first, 'case_features.pattern', 'DYNAMIC_PATTERN'),
                    'recommendation' => 'Tinjau sampel perwakilan, atau promosikan ke aturan baru dengan tombol Jadikan Aturan Baru.',
                ]);
            }
        }

        // 4. Combined active case groups
        $activeGroups = collect(array_merge($systemPresets, $customRuleGroups, $dynamicPatterns))
            ->filter(fn (array $g) => $g['item_count'] > 0)
            ->values()
            ->all();

        return [
            'system_presets' => $systemPresets,
            'custom_rules' => $customRuleGroups,
            'dynamic_patterns' => $dynamicPatterns,
            'case_groups' => $activeGroups,
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, array<string, mixed>> $group
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function formatGroupPayload(string $groupId, $group, array $meta): array
    {
        $hasItems = $group->isNotEmpty();
        $representative = $hasItems
            ? $group->sortByDesc(fn (array $item) => data_get($item, 'candidates.0.score', 0))->first()
            : null;
        $scores = $group->map(fn (array $item) => (float) data_get($item, 'candidates.0.score', 0));
        $scoreRange = $hasItems ? (($scores->max() ?? 0) - ($scores->min() ?? 0)) : 0;
        $confidence = $hasItems ? $this->clusterConfidence($group->count(), $scoreRange) : 'Unique';
        $decisionSummary = $this->decisionSummary($group);
        $groupStatus = $hasItems ? $this->caseGroupStatus($group, $decisionSummary) : 'open';

        return [
            'id' => $groupId,
            'fingerprint' => $groupId,
            'status' => $groupStatus,
            'pattern' => $meta['pattern'] ?? data_get($representative, 'case_features.pattern', 'UNKNOWN'),
            'label' => $meta['name'] ?? data_get($representative, 'case_features.label', 'Grup'),
            'rule_name' => $meta['name'] ?? data_get($representative, 'case_features.label', 'Grup'),
            'rule_type' => $meta['type'] ?? data_get($representative, 'case_features.rule_type', 'system_preset'),
            'preset_number' => $meta['preset_number'] ?? data_get($representative, 'case_features.preset_number'),
            'description' => $meta['description'] ?? data_get($representative, 'case_features.reason', ''),
            'reason' => $meta['description'] ?? data_get($representative, 'case_features.reason', ''),
            'conditions' => data_get($representative, 'case_features.conditions', []),
            'confidence' => $confidence,
            'consistency' => $this->caseConsistency($confidence),
            'recommendation' => $meta['recommendation'] ?? $this->caseRecommendation((string) ($meta['pattern'] ?? ''), $confidence, $decisionSummary),
            'knowledge_level' => $this->knowledgeLevelFromHistory($group),
            'eligible_for_bulk' => $hasItems && $confidence === 'High' && $groupStatus === 'open',
            'eligible_for_rule_promotion' => ($meta['type'] ?? '') === 'dynamic_fallback',
            'item_count' => $group->count(),
            'reviewed_count' => $group->filter(fn (array $item) => $item['decision'] !== null)->count(),
            'decision_summary' => $decisionSummary,
            'decision_history' => $group
                ->flatMap(fn (array $item) => $item['decision_history'] ?? [])
                ->values()
                ->all(),
            'item_keys' => $group->pluck('input_record_key')->values()->all(),
            'representative_input_key' => $representative['input_record_key'] ?? null,
            'representative' => $representative,
            'representative_samples' => $group
                ->sortByDesc(fn (array $item) => data_get($item, 'candidates.0.score', 0))
                ->take(3)
                ->values()
                ->all(),
        ];
    }

    private function decisionPayload(ReviewDecision $decision): array
    {
        return [
            'id' => $decision->id,
            'decision' => $decision->decision,
            'previous_result_type' => $decision->previous_result_type,
            'new_result_type' => $decision->new_result_type,
            'selected_reference_record_key' => $decision->selected_reference_record_key,
            'created_at' => optional($decision->created_at)->toISOString(),
            'decided_at' => optional($decision->created_at)->toISOString(),
            'undone_at' => optional($decision->undone_at)->toISOString(),
            'source' => data_get($decision->metadata, 'decision_source', data_get($decision->metadata, 'scope', 'individual')),
            'reviewer' => data_get($decision->metadata, 'reviewer', data_get($decision->metadata, 'created_by')),
            'affected_records' => (int) data_get($decision->metadata, 'affected_records', 1),
            'case_group_id' => data_get($decision->metadata, 'case_group_id'),
            'batch_id' => data_get($decision->metadata, 'batch_id'),
            'review_knowledge' => data_get($decision->metadata, 'review_knowledge'),
            'safety_validation' => data_get($decision->metadata, 'safety_validation'),
        ];
    }

    private function displayStatus(?ReviewDecision $decision, string $baseStatus): string
    {
        if ($decision !== null) {
            return match ($decision->decision) {
                'accept_match', 'select_candidate' => 'manual_accepted',
                'reject_match' => 'manual_rejected',
                'mark_unmatched' => 'confirmed_unmatched',
                default => $baseStatus,
            };
        }

        return match ($baseStatus) {
            'matched' => 'auto_matched',
            'possible_match' => 'need_review',
            'unmatched' => 'unmatched',
            default => $baseStatus,
        };
    }

    private function statusCode(?ReviewDecision $decision, string $baseStatus): string
    {
        if ($decision !== null) {
            return match ($decision->decision) {
                'accept_match', 'select_candidate' => 'MANUAL_ACCEPTED',
                'reject_match' => 'MANUAL_REJECTED',
                'mark_unmatched' => 'CONFIRMED_UNMATCHED',
                default => 'NEED_REVIEW',
            };
        }

        return match ($baseStatus) {
            'matched' => 'AUTO_MATCHED',
            'possible_match' => 'NEED_REVIEW',
            default => 'NEED_REVIEW',
        };
    }

    private function decisionSummary($group): array
    {
        $accepted = $group->filter(fn (array $item) => in_array(data_get($item, 'decision.decision'), ['accept_match', 'select_candidate'], true))->count();
        $rejected = $group->filter(fn (array $item) => data_get($item, 'decision.decision') === 'reject_match')->count();
        $unmatched = $group->filter(fn (array $item) => data_get($item, 'decision.decision') === 'mark_unmatched')->count();

        return [
            'accepted' => $accepted,
            'rejected' => $rejected,
            'unmatched' => $unmatched,
            'pending' => $group->count() - $accepted - $rejected - $unmatched,
            'mixed' => collect([$accepted, $rejected, $unmatched])->filter(fn (int $count) => $count > 0)->count() > 1,
        ];
    }

    private function caseGroupStatus($group, array $decisionSummary): string
    {
        if (($decisionSummary['pending'] ?? 0) > 0) {
            return 'open';
        }

        return 'resolved';
    }

    /**
     * @param array<string, mixed> $item
     * @param array<int, array<string, mixed>> $customRules
     * @return array<string, mixed>
     */
    private function caseFeatures(array $item, array $customRules = []): array
    {
        $candidate = $item['candidates'][0] ?? null;

        if (! is_array($candidate) || empty($candidate['reference_record_key'])) {
            return [
                'pattern' => 'NO_CANDIDATE',
                'label' => 'No Candidate',
                'group_id' => 'dynamic_no_candidate',
                'fingerprint' => 'NO_CANDIDATE',
                'rule_type' => 'dynamic_fallback',
                'preset_number' => null,
                'reason' => 'No reference candidate was generated for this input record.',
                'conditions' => ['has_reference_candidate' => false],
            ];
        }

        $inp = $item['input_record'] ?? [];
        $ref = is_array($candidate) ? ($candidate['reference_record'] ?? []) : [];
        $candidates = $item['candidates'] ?? [];
        $fieldScores = collect($candidate['field_scores'] ?? []);
        $score = (float) ($candidate['score'] ?? 0);
        $scoreBand = $this->scoreBand($score);

        $identityConflict = $fieldScores->contains(fn (array $s) => (bool) ($s['identity_conflict'] ?? false));
        $differentFields = $fieldScores
            ->filter(fn (array $s) => ($s['comparison'] ?? null) === 'different')
            ->pluck('reference_column')
            ->values()
            ->all();
        $similarFields = $fieldScores
            ->filter(fn (array $s) => ($s['comparison'] ?? null) === 'similar')
            ->pluck('reference_column')
            ->values()
            ->all();

        // 1. NIB / NPWP / Identifier conflict check (Type-safe semantic comparison)
        $nibInp = null;
        foreach ($inp as $k => $v) {
            if (preg_match('/\b(nib|nomor_induk_berusaha)\b/i', (string) $k) || strtolower((string) $k) === 'nib') {
                $cleaned = preg_replace('/[^0-9A-Za-z]/', '', (string) $v);
                if ($cleaned !== '') { $nibInp = $cleaned; break; }
            }
        }
        $nibRef = null;
        foreach ($ref as $k => $v) {
            if (preg_match('/\b(nib|nomor_induk_berusaha)\b/i', (string) $k) || strtolower((string) $k) === 'nib') {
                $cleaned = preg_replace('/[^0-9A-Za-z]/', '', (string) $v);
                if ($cleaned !== '') { $nibRef = $cleaned; break; }
            }
        }
        $hasNibConflict = ($nibInp !== null && $nibRef !== null && $nibInp !== $nibRef);

        $npwpInp = null;
        foreach ($inp as $k => $v) {
            if (preg_match('/\b(npwp|nomor_pokok_wajib_pajak|tax_id)\b/i', (string) $k) || strtolower((string) $k) === 'npwp') {
                $cleaned = preg_replace('/[^0-9]/', '', (string) $v);
                if ($cleaned !== '') { $npwpInp = $cleaned; break; }
            }
        }
        $npwpRef = null;
        foreach ($ref as $k => $v) {
            if (preg_match('/\b(npwp|nomor_pokok_wajib_pajak|tax_id)\b/i', (string) $k) || strtolower((string) $k) === 'npwp') {
                $cleaned = preg_replace('/[^0-9]/', '', (string) $v);
                if ($cleaned !== '') { $npwpRef = $cleaned; break; }
            }
        }
        $hasNpwpConflict = ($npwpInp !== null && $npwpRef !== null && $npwpInp !== $npwpRef);

        $nikInp = null;
        foreach ($inp as $k => $v) {
            if (preg_match('/\b(nik|nomor_induk_kependudukan)\b/i', (string) $k) || strtolower((string) $k) === 'nik') {
                $cleaned = preg_replace('/[^0-9]/', '', (string) $v);
                if ($cleaned !== '') { $nikInp = $cleaned; break; }
            }
        }
        $nikRef = null;
        foreach ($ref as $k => $v) {
            if (preg_match('/\b(nik|nomor_induk_kependudukan)\b/i', (string) $k) || strtolower((string) $k) === 'nik') {
                $cleaned = preg_replace('/[^0-9]/', '', (string) $v);
                if ($cleaned !== '') { $nikRef = $cleaned; break; }
            }
        }
        $hasNikConflict = ($nikInp !== null && $nikRef !== null && $nikInp !== $nikRef);

        // Same-named identifier column match (e.g. custom identifier columns present in both)
        $sameColIdConflict = false;
        if (! $hasNibConflict && ! $hasNpwpConflict && ! $hasNikConflict) {
            foreach ($inp as $col => $val) {
                if ($this->isIdentifierField((string) $col) && isset($ref[$col])) {
                    $cleanInp = preg_replace('/[^0-9A-Za-z]/', '', (string) $val);
                    $cleanRef = preg_replace('/[^0-9A-Za-z]/', '', (string) $ref[$col]);
                    if ($cleanInp !== '' && $cleanRef !== '' && $cleanInp !== $cleanRef) {
                        $sameColIdConflict = true;
                        break;
                    }
                }
            }
        }

        $hasIdConflict = $hasNibConflict || $hasNpwpConflict || $hasNikConflict || $sameColIdConflict || $this->hasIdentifierConflict($candidate);

        // Name core score
        $coreNameScore = $score;
        foreach ($fieldScores as $fs) {
            $col = strtolower((string) ($fs['reference_column'] ?? '').' '.(string) ($fs['input_column'] ?? ''));
            if (str_contains($col, 'nama inti') || str_contains($col, 'core') || str_contains($col, 'nama') || str_contains($col, 'name')) {
                $coreNameScore = max($coreNameScore, (float) ($fs['score'] ?? 0));
            }
        }

        // 2. Legal form conflict check (PT vs CV)
        $legalField = $fieldScores->first(function (array $s) {
            $col = strtolower((string) ($s['reference_column'] ?? '').' '.(string) ($s['input_column'] ?? ''));
            return Str::contains($col, ['badan usaha', 'bentuk usaha', 'legal_form', 'legal form']);
        });

        $legalConflict = false;
        if ($legalField !== null) {
            $comparison = $legalField['comparison'] ?? null;
            $fieldScore = (float) ($legalField['score'] ?? 0);
            $hasFieldIdConflict = (bool) ($legalField['identity_conflict'] ?? false);

            if ($comparison === 'same' || $fieldScore >= 90) {
                $legalConflict = false;
            } else {
                $normInp = $this->normalizeLegalForm($inp['[Generated] Badan Usaha'] ?? $inp['bentuk_usaha'] ?? $inp['badan_usaha'] ?? $inp['legal_form'] ?? null);
                $normRef = $this->normalizeLegalForm($ref['[Generated] Badan Usaha'] ?? $ref['badan_usaha'] ?? $ref['bentuk_usaha'] ?? $ref['legal_form'] ?? null);

                if ($normInp !== null && $normRef !== null) {
                    $legalConflict = ($normInp !== $normRef);
                } else {
                    $legalConflict = $hasFieldIdConflict || ($comparison === 'different');
                }
            }
        } else {
            $legalConflict = $identityConflict;
            if (! $legalConflict) {
                $normInp = $this->normalizeLegalForm($inp['[Generated] Badan Usaha'] ?? $inp['bentuk_usaha'] ?? $inp['badan_usaha'] ?? $inp['legal_form'] ?? null);
                $normRef = $this->normalizeLegalForm($ref['[Generated] Badan Usaha'] ?? $ref['badan_usaha'] ?? $ref['bentuk_usaha'] ?? $ref['legal_form'] ?? null);

                if ($normInp === null) {
                    foreach ($inp as $k => $v) {
                        if (Str::contains(strtolower((string) $k), ['nama', 'name', 'perusahaan', 'penyedia']) && !empty($v)) {
                            $parsedInp = (new EntityNameParser())->parse((string) $v);
                            $normInp = $parsedInp['legal_form'] ?? null;
                            if ($normInp !== null) break;
                        }
                    }
                }
                if ($normRef === null) {
                    foreach ($ref as $k => $v) {
                        if (Str::contains(strtolower((string) $k), ['nama', 'name', 'perusahaan', 'penyedia']) && !empty($v)) {
                            $parsedRef = (new EntityNameParser())->parse((string) $v);
                            $normRef = $parsedRef['legal_form'] ?? null;
                            if ($normRef !== null) break;
                        }
                    }
                }

                if ($normInp !== null && $normRef !== null && $normInp !== $normRef && $coreNameScore >= 75) {
                    $legalConflict = true;
                }
            }
        }

        // 3. Multi-candidate check
        $hasMultiCandidate = false;
        if (count($candidates) >= 2) {
            $top1Score = (float) ($candidates[0]['score'] ?? 0);
            $top2Score = (float) ($candidates[1]['score'] ?? 0);
            if ($top1Score >= 65 && $top2Score >= 65 && abs($top1Score - $top2Score) <= 5.0) {
                $hasMultiCandidate = true;
            }
        }

        // 4. Location / Kabupaten conflict check with MFD dictionary resolution
        $kabInp = null;
        foreach ($inp as $k => $v) {
            if (Str::contains(strtolower((string) $k), ['kab', 'kota', 'city', 'wilayah', 'district', 'kd_kab', 'kode_kab', 'regency']) && !empty($v)) {
                $kabInp = (string) $v;
                break;
            }
        }
        $kabRef = null;
        foreach ($ref as $k => $v) {
            if (Str::contains(strtolower((string) $k), ['kab', 'kota', 'city', 'wilayah', 'district', 'kd_kab', 'kode_kab', 'regency']) && !empty($v)) {
                $kabRef = (string) $v;
                break;
            }
        }

        $locationConflict = false;
        if ($kabInp !== null && $kabRef !== null && trim($kabInp) !== '' && trim($kabRef) !== '') {
            $isSameRegency = $this->wilayahService->compareRegencies($kabInp, $kabRef, $inp, $ref);
            if ($isSameRegency === false) {
                // Different regencies confirmed via MFD resolution
                $locationConflict = true;
            } elseif ($isSameRegency === null) {
                // Fallback for custom location strings outside MFD
                $locationConflict = (mb_strtolower(trim($kabInp)) !== mb_strtolower(trim($kabRef)));
            }
            // If $isSameRegency === true, $locationConflict remains false (no false conflict!)
        } elseif ($coreNameScore >= 80) {
            $locationConflict = collect($differentFields)->contains(function (string $col) {
                $c = strtolower($col);
                return Str::contains($c, ['kab', 'kota', 'city', 'wilayah', 'district', 'lokasi', 'prov', 'kd_kab', 'kode_kab', 'regency']);
            });
        }

        // 5. Address evaluation
        $addrScore = null;
        foreach ($fieldScores as $fs) {
            $col = strtolower((string) ($fs['reference_column'] ?? '').' '.(string) ($fs['input_column'] ?? ''));
            if (str_contains($col, 'alamat') || str_contains($col, 'address') || str_contains($col, 'jalan') || str_contains($col, 'street')) {
                $addrScore = max($addrScore ?? 0.0, (float) ($fs['score'] ?? 0));
            }
        }
        if ($addrScore === null) {
            $addrInp = null;
            foreach ($inp as $k => $v) {
                if (Str::contains(strtolower((string) $k), ['alamat', 'address', 'jalan', 'street']) && !empty($v)) {
                    $addrInp = trim((string) $v);
                    break;
                }
            }
            $addrRef = null;
            foreach ($ref as $k => $v) {
                if (Str::contains(strtolower((string) $k), ['alamat', 'address', 'jalan', 'street']) && !empty($v)) {
                    $addrRef = trim((string) $v);
                    break;
                }
            }
            if ($addrInp !== null && $addrRef !== null && $addrInp !== '' && $addrRef !== '') {
                $addrScore = strcasecmp($addrInp, $addrRef) === 0 ? 100.0 : 0.0;
            }
        }

        // Address conflict check for Preset 5
        $addressConflict = false;
        if ($coreNameScore >= 80 && ! $locationConflict) {
            if ($addrScore !== null && $addrScore < 60) {
                $addressConflict = true;
            } elseif (collect($differentFields)->contains(fn ($c) => Str::contains(strtolower($c), ['alamat', 'address', 'jalan', 'street']))) {
                $addressConflict = true;
            }
        }

        // Special case: Nama & Alamat sama persis / tinggi (>= 90%) namun Kabupaten/Kota berbeda
        $nameHighSimilarity = ($coreNameScore >= 90.0);
        $addrHighSimilarity = ($addrScore !== null && $addrScore >= 90.0);
        $sameNameAndAddressDiffCity = ($locationConflict && $nameHighSimilarity && $addrHighSimilarity);

        // Sequential Priority
        if ($hasIdConflict) {
            $pattern = 'IDENTIFIER_CONFLICT';
            $reason = 'Nomor NIB atau NPWP di kedua data terisi tetapi nilainya berbeda, atau terjadi konflik pada identifier legal unik.';
            $ruleType = 'system_preset';
            $presetNumber = 1;
            $groupId = 'system_preset_1_nib_conflict';
            $label = '1. NIB Beda / Konflik Identitas';
        } elseif ($legalConflict) {
            $pattern = 'LEGAL_FORM_CONFLICT';
            $reason = 'Bentuk badan usaha berbeda (CV vs PT / perorangan) meskipun nama inti perusahaan memiliki kemiripan tinggi.';
            $ruleType = 'system_preset';
            $presetNumber = 2;
            $groupId = 'system_preset_2_legal_form';
            $label = '2. Beda Bentuk Usaha (PT/CV)';
        } elseif ($hasMultiCandidate) {
            $pattern = 'MULTI_CANDIDATE_AMBIGUITY';
            $reason = 'Terdapat 2 atau lebih data kandidat acuan dengan kemiripan tinggi dan selisih skor <= 5%.';
            $ruleType = 'system_preset';
            $presetNumber = 3;
            $groupId = 'system_preset_3_multi_candidate';
            $label = '3. Kandidat Ganda (Ambiguitas)';
        } elseif ($sameNameAndAddressDiffCity) {
            $pattern = 'SAME_NAME_ADDRESS_DIFF_CITY';
            $reason = "Nama perusahaan ({$coreNameScore}%) dan alamat ({$addrScore}%) sama persis atau kemiripan tinggi (>= 90%), namun Kabupaten/Kota berbeda.";
            $ruleType = 'system_preset';
            $presetNumber = 6;
            $groupId = 'system_preset_6_same_name_addr_diff_city';
            $label = '6. Nama & Alamat Sama, Beda Kabupaten/Kota';
        } elseif ($locationConflict) {
            $pattern = 'GEO_LOCATION_CONFLICT';
            $reason = 'Kemiripan nama perusahaan tinggi (>= 80%), namun kolom Kabupaten/Kota berbeda antardata.';
            $ruleType = 'system_preset';
            $presetNumber = 4;
            $groupId = 'system_preset_4_geo_location';
            $label = '4. Beda Wilayah (Kabupaten)';
        } elseif ($addressConflict) {
            $pattern = 'ADDRESS_CONFLICT';
            $reason = 'Nama perusahaan dan wilayah cocok, namun penulisan alamat jalan/detail memiliki kemiripan rendah (< 60%).';
            $ruleType = 'system_preset';
            $presetNumber = 5;
            $groupId = 'system_preset_5_address';
            $label = '5. Beda Alamat';
        } else {
            // Check Custom Rules
            $matchedCustom = null;
            foreach ($customRules as $cr) {
                if ($this->matchesCustomRule($cr, $inp, $ref, $candidate, $score)) {
                    $matchedCustom = $cr;
                    break;
                }
            }

            if ($matchedCustom !== null) {
                $pattern = 'CUSTOM_RULE_' . ($matchedCustom['id'] ?? Str::slug($matchedCustom['name']));
                $reason = $matchedCustom['description'] ?? "Memenuhi kriteria aturan kustom: {$matchedCustom['name']}.";
                $ruleType = 'custom_rule';
                $presetNumber = null;
                $groupId = 'custom_rule_' . ($matchedCustom['id'] ?? Str::slug($matchedCustom['name']));
                $label = $matchedCustom['name'];
            } else {
                // Fallback: Pola Dinamis
                $diffText = $differentFields !== [] ? 'Perbedaan Kolom ' . implode(', ', array_slice($differentFields, 0, 2)) : "Skor Rentang {$scoreBand}%";
                $pattern = 'DYNAMIC_PATTERN_' . $scoreBand . ($differentFields !== [] ? '_' . implode('-', array_slice($differentFields, 0, 2)) : '');
                $reason = 'Tidak memenuhi 6 aturan bawaan; ditampung ke pola dinamis berbasis kemiripan data sisa.';
                $ruleType = 'dynamic_fallback';
                $presetNumber = null;
                $groupId = 'dynamic_' . md5($pattern);
                $label = "Pola Dinamis: {$diffText}";
            }
        }

        return [
            'pattern' => $pattern,
            'label' => $label,
            'group_id' => $groupId,
            'fingerprint' => $groupId,
            'rule_type' => $ruleType,
            'preset_number' => $presetNumber,
            'reason' => $reason,
            'conditions' => [
                'score_band' => $scoreBand,
                'core_name_similarity_min' => round($score / 100, 2),
                'legal_form_conflict' => $legalConflict,
                'location_conflict' => $locationConflict,
                'address_conflict' => $addressConflict,
                'same_name_address_diff_city' => $sameNameAndAddressDiffCity,
                'multi_candidate' => $hasMultiCandidate,
                'has_identifier_conflict' => $hasIdConflict,
                'different_fields' => $differentFields,
                'similar_fields' => $similarFields,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $rule
     * @param array<string, mixed> $inp
     * @param array<string, mixed> $ref
     * @param array<string, mixed> $candidate
     */
    private function matchesCustomRule(array $rule, array $inp, array $ref, array $candidate, float $overallScore): bool
    {
        $conditions = $rule['conditions'] ?? [];
        if (empty($conditions)) {
            return false;
        }

        foreach ($conditions as $cond) {
            $source = $cond['source'] ?? 'input';
            $field = (string) ($cond['field'] ?? '');
            $op = (string) ($cond['operator'] ?? 'equals');
            $val = (string) ($cond['value'] ?? '');

            $targetVal = '';
            if ($source === 'comparison' || $field === 'score') {
                $targetVal = (string) $overallScore;
            } elseif ($source === 'reference') {
                $targetVal = (string) ($ref[$field] ?? '');
            } else {
                $targetVal = (string) ($inp[$field] ?? '');
            }

            $matched = match ($op) {
                'equals' => mb_strtolower(trim($targetVal)) === mb_strtolower(trim($val)),
                'not_equals' => mb_strtolower(trim($targetVal)) !== mb_strtolower(trim($val)),
                'contains' => str_contains(mb_strtolower($targetVal), mb_strtolower(trim($val))),
                'does_not_contain' => ! str_contains(mb_strtolower($targetVal), mb_strtolower(trim($val))),
                'greater_than' => (float) $targetVal > (float) $val,
                'less_than' => (float) $targetVal < (float) $val,
                'is_empty' => trim($targetVal) === '',
                'is_not_empty' => trim($targetVal) !== '',
                default => false,
            };

            if (! $matched) {
                return false;
            }
        }

        return true;
    }

    private function clusterConfidence(int $count, float $scoreRange): string
    {
        if ($count === 1) {
            return 'Unique';
        }

        return $scoreRange <= 5 ? 'High' : 'Mixed';
    }

    private function scoreBand(float $score): string
    {
        if ($score >= 95) {
            return '95-100';
        }

        if ($score >= 85) {
            return '85-94';
        }

        if ($score >= 75) {
            return '75-84';
        }

        return 'below-75';
    }

    private function caseLabel(string $pattern, ?string $fallbackLabel = null): string
    {
        if ($fallbackLabel) {
            return $fallbackLabel;
        }

        return match ($pattern) {
            'IDENTIFIER_CONFLICT' => '1. NIB Beda / Konflik Identitas',
            'LEGAL_FORM_CONFLICT' => '2. Beda Bentuk Usaha (PT/CV)',
            'MULTI_CANDIDATE_AMBIGUITY' => '3. Kandidat Ganda (Ambiguitas)',
            'GEO_LOCATION_CONFLICT' => '4. Beda Wilayah (Kabupaten)',
            'ADDRESS_CONFLICT' => '5. Beda Alamat',
            'SAME_NAME_ADDRESS_DIFF_CITY' => '6. Nama & Alamat Sama, Beda Kabupaten/Kota',
            'INACTIVE_BUSINESS_STATUS' => 'Status Usaha Nonaktif',
            'FIELD_CONFLICT' => 'Supporting field conflict',
            'SIMILAR_NAME_REVIEW' => 'Similar name review',
            'NO_CANDIDATE' => 'No candidate',
            default => 'Low confidence match',
        };
    }

    private function caseConsistency(string $confidence): string
    {
        return match ($confidence) {
            'High' => 'High',
            'Mixed' => 'Mixed',
            default => 'Unique',
        };
    }

    private function caseRecommendation(string $pattern, string $confidence, array $decisionSummary): string
    {
        if (($decisionSummary['pending'] ?? 0) === 0) {
            return 'Resolved. Keep the decision history for audit.';
        }

        return match ($pattern) {
            'IDENTIFIER_CONFLICT' => 'Reject atau verifikasi keabsahan izin berusaha secara individual.',
            'LEGAL_FORM_CONFLICT' => 'Reject group kecuali sampel perwakilan terbukti transformasi entitas yang sama.',
            'MULTI_CANDIDATE_AMBIGUITY' => 'Pilih manual salah satu kandidat acuan yang paling sesuai.',
            'GEO_LOCATION_CONFLICT' => 'Periksa apakah entitas memiliki kantor cabang atau berpindah domisili wilayah.',
            'ADDRESS_CONFLICT' => 'Verifikasi keabsahan relokasi kantor sebelum menyetujui.',
            'SAME_NAME_ADDRESS_DIFF_CITY' => 'Periksa apakah entitas memiliki kantor cabang, berpindah domisili wilayah, atau terdapat kesalahan kode kabupaten/kota pada data input.',
            'INACTIVE_BUSINESS_STATUS' => 'Konfirmasi apakah perusahaan kembali aktif atau merupakan entitas lama.',
            'NO_CANDIDATE' => 'Tandai sebagai tidak cocok (unmatched) atau periksa sumber data mentah.',
            default => 'Tinjau sampel perwakilan, kemudian terapkan keputusan kelompok.',
        };
    }

    private function knowledgeLevelFromHistory($group): string
    {
        $knowledge = $group
            ->flatMap(fn (array $item) => $item['decision_history'] ?? [])
            ->pluck('review_knowledge')
            ->filter();

        if ($knowledge->count() >= 2 && $knowledge->pluck('decision')->unique()->count() === 1) {
            return 'KNOWN_PATTERN';
        }

        return 'NEW_PATTERN';
    }

    private function isReviewCaseItem(array $item): bool
    {
        $status = (string) ($item['display_status'] ?? $item['status'] ?? '');

        return in_array($status, [
            'need_review',
            'manual_accepted',
            'manual_rejected',
            'confirmed_unmatched',
        ], true) || $item['decision'] !== null;
    }

    /**
     * @param array<string, mixed> $payload
     * @param \Illuminate\Support\Collection<string, array<string, mixed>> $caseGroupsById
     * @return array<int, string>
     */
    private function targetInputKeys(array $payload, string $scope, $caseGroupsById): array
    {
        if ($scope === 'group') {
            $group = $caseGroupsById->get((string) ($payload['case_group_id'] ?? ''));

            if (! is_array($group)) {
                throw new InvalidArgumentException('The selected case group could not be found.');
            }

            if (! (bool) ($group['eligible_for_bulk'] ?? false)) {
                throw new InvalidArgumentException('This case group is not consistent enough for bulk review.');
            }

            return array_values(array_map('strval', $group['item_keys'] ?? []));
        }

        if ($scope === 'selected') {
            $keys = array_values(array_map('strval', $payload['input_record_keys'] ?? []));

            if ($keys === []) {
                throw new InvalidArgumentException('Select at least one review record.');
            }

            if (! empty($payload['case_group_id'])) {
                $eligibleGroup = $caseGroupsById
                    ->filter(fn (array $group) => (bool) ($group['eligible_for_bulk'] ?? false))
                    ->first(fn (array $group) => count(array_diff($keys, $group['item_keys'] ?? [])) === 0);

                if (! is_array($eligibleGroup)) {
                    throw new InvalidArgumentException('Selected records must belong to one high-confidence case group.');
                }
            }

            return $keys;
        }

        return [(string) $payload['input_record_key']];
    }

    /**
     * @param \Illuminate\Support\Collection<string, array<string, mixed>> $itemsByKey
     * @param array<int, string> $inputKeys
     * @return array<int, string>
     */
    private function openInputKeys($itemsByKey, array $inputKeys, string $scope): array
    {
        if (! in_array($scope, ['group', 'selected'], true)) {
            return $inputKeys;
        }

        return array_values(array_filter($inputKeys, function (string $inputKey) use ($itemsByKey) {
            $item = $itemsByKey->get($inputKey);

            return is_array($item) && empty($item['decision']);
        }));
    }

    /**
     * @param \Illuminate\Support\Collection<string, array<string, mixed>> $itemsByKey
     * @param array<int, string> $inputKeys
     * @return array<string, array<string, mixed>>
     */
    private function bulkSafetyFailures($itemsByKey, array $inputKeys, string $decision, string $scope, array $payload): array
    {
        if (! in_array($scope, ['group', 'selected'], true) || ! in_array($decision, ['accept_match', 'select_candidate'], true)) {
            return [];
        }

        $referenceCounts = [];
        $candidatesByKey = [];

        foreach ($inputKeys as $inputKey) {
            $item = $itemsByKey->get($inputKey);
            $candidate = is_array($item) ? $this->candidateForDecision($item, $payload, false) : null;
            $referenceKey = (string) ($candidate['reference_record_key'] ?? '');
            $candidatesByKey[$inputKey] = $candidate;

            if ($referenceKey !== '') {
                $referenceCounts[$referenceKey] = ($referenceCounts[$referenceKey] ?? 0) + 1;
            }
        }

        $failures = [];
        $isDirectManualSelection = empty($payload['case_group_id']) && $scope === 'selected';

        foreach ($inputKeys as $inputKey) {
            $item = $itemsByKey->get($inputKey);
            $candidate = $candidatesByKey[$inputKey] ?? null;
            $referenceKey = (string) ($candidate['reference_record_key'] ?? '');
            $reason = null;

            if (! is_array($item) || ! is_array($candidate) || $referenceKey === '') {
                $reason = 'No reference candidate is available.';
            } elseif (($referenceCounts[$referenceKey] ?? 0) > 1) {
                $reason = 'Multiple input records point to the same reference record.';
            } elseif (! $isDirectManualSelection) {
                if ((bool) data_get($item, 'case_features.conditions.legal_form_conflict', false)) {
                    $reason = 'Legal form conflict must be reviewed individually.';
                } elseif ($this->hasIdentifierConflict($candidate)) {
                    $reason = 'Identifier conflict must be reviewed individually.';
                } elseif ($this->hasContradictoryStrongField($candidate)) {
                    $reason = 'A strong supporting field contradicts the candidate.';
                }
            }

            if ($reason !== null) {
                $failures[$inputKey] = [
                    'input_record_key' => $inputKey,
                    'reference_record_key' => $referenceKey ?: null,
                    'reason' => $reason,
                ];
            }
        }

        return $failures;
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, mixed> $payload
     * @return array<string, mixed>|null
     */
    private function candidateForDecision(array $item, array $payload, bool $allowExplicitCandidate): ?array
    {
        $candidates = collect($item['candidates'] ?? []);

        if ($allowExplicitCandidate && isset($payload['matching_result_id'])) {
            return $candidates->first(fn (array $candidate) => $candidate['id'] === $payload['matching_result_id']);
        }

        return $candidates->first(fn (array $candidate) => ! empty($candidate['reference_record_key']));
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function reviewKnowledge(MatchingJob $job, array $item, string $decision, string $scope, array $payload): array
    {
        $features = $item['case_features'] ?? $this->caseFeatures($item);
        $level = $this->knowledgeLevel($job, $features, $decision);

        return [
            'level' => $level,
            'pattern' => $features['pattern'] ?? 'UNKNOWN',
            'conditions' => $features['conditions'] ?? [],
            'decision' => $this->knowledgeDecision($decision),
            'scope' => $scope,
            'case_group_id' => $payload['case_group_id'] ?? null,
        ];
    }

    /**
     * @param array<string, mixed> $features
     */
    private function knowledgeLevel(MatchingJob $job, array $features, string $decision): string
    {
        $pattern = (string) ($features['pattern'] ?? 'UNKNOWN');
        $targetDecision = $this->knowledgeDecision($decision);
        $matchingDecisions = $job->reviewDecisions()
            ->whereNull('undone_at')
            ->get()
            ->filter(fn (ReviewDecision $item) => data_get($item->metadata, 'review_knowledge.pattern') === $pattern);

        if (
            $matchingDecisions->count() >= 2
            && $matchingDecisions
                ->filter(fn (ReviewDecision $item) => data_get($item->metadata, 'review_knowledge.decision') === $targetDecision)
                ->count() === $matchingDecisions->count()
            && ! (bool) ($features['conditions']['legal_form_conflict'] ?? false)
        ) {
            return 'KNOWN_PATTERN';
        }

        return 'NEW_PATTERN';
    }

    private function knowledgeDecision(string $decision): string
    {
        return match ($decision) {
            'accept_match', 'select_candidate' => 'MATCH',
            'mark_unmatched' => 'UNMATCHED',
            'reject_match' => 'NOT_MATCH',
            default => 'REVIEW',
        };
    }

    /**
     * @param iterable<int, array<string, mixed>> $scores
     * @return array<int, array<string, mixed>>
     */
    private function decorateFieldScores(iterable $scores): array
    {
        return collect($scores)
            ->map(fn (array $score) => [
                ...$score,
                'comparison' => $this->comparisonLabel((float) ($score['score'] ?? 0)),
            ])
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $candidate
     */
    private function hasIdentifierConflict(array $candidate): bool
    {
        return collect($candidate['field_scores'] ?? [])->contains(function (array $score) {
            $field = strtolower((string) ($score['reference_column'] ?? '').' '.(string) ($score['input_column'] ?? ''));

            return $this->isIdentifierField($field)
                && ($score['comparison'] ?? null) === 'different'
                && (float) ($score['score'] ?? 0) < 95;
        });
    }

    /**
     * @param array<string, mixed> $candidate
     */
    private function hasContradictoryStrongField(array $candidate): bool
    {
        return collect($candidate['field_scores'] ?? [])->contains(function (array $score) {
            $field = strtolower((string) ($score['reference_column'] ?? '').' '.(string) ($score['input_column'] ?? ''));

            return $this->isStrongField($field)
                && ($score['comparison'] ?? null) === 'different'
                && (float) ($score['score'] ?? 0) < 75;
        });
    }

    private function isIdentifierField(string $field): bool
    {
        return (bool) preg_match('/\b(nib|npwp|nik|nomor_induk|tax_id)\b/i', $field);
    }

    private function isStrongField(string $field): bool
    {
        return (bool) preg_match('/\b(nib|npwp|nik|nomor_induk|tax_id|email|phone|telepon|telp|tanggal|date)\b/i', $field);
    }

    /**
     * @param \Illuminate\Support\Collection<int, MatchingResult> $group
     */
    private function statusForGroup($group): string
    {
        $sorted = $group->sortBy('candidate_rank')->values();
        $primary = $sorted->first();

        if ($primary) {
            return $primary->result_type;
        }

        if ($group->contains('result_type', 'matched')) {
            return 'matched';
        }

        if ($group->contains('result_type', 'possible_match')) {
            return 'possible_match';
        }

        return 'unmatched';
    }

    private function newResultType(string $decision): string
    {
        return match ($decision) {
            'accept_match', 'select_candidate' => 'matched',
            'mark_unmatched' => 'unmatched',
            'reject_match' => 'possible_match',
            default => throw new InvalidArgumentException('Unsupported review decision.'),
        };
    }

    private function comparisonLabel(float $score): string
    {
        if ($score >= 95) {
            return 'same';
        }

        if ($score >= 75) {
            return 'similar';
        }

        return 'different';
    }

    public function normalizeLegalForm(mixed $value): ?string
    {
        return (new EntityNameParser())->normalizeLegalForm($value);
    }
}
