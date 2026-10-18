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
    use VersionedReviewPresentation;
    private readonly WilayahDictionaryService $wilayahService;

    public function __construct(
        private readonly ResourceOwnership $ownership,
        ?WilayahDictionaryService $wilayahService = null,
    ) {
        $this->wilayahService = $wilayahService ?? app(WilayahDictionaryService::class);
    }

    private function assertLegacyWriterEnabled(): void
    {
        // Even a partially enabled cutover must not mix legacy and versioned writes.
        if (config('workspace_access.enabled', false) || config('review_transactions.enabled', false)) {
            throw new Transactions\ReviewWriteConflict('legacy_review_write_disabled');
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function list(User $user, string $jobId, array $params = []): array
    {
        if (config('workspace_access.enabled') || config('review_transactions.enabled')) {
            return $this->versionedList($user, $jobId, $params);
        }
        $job = $this->ownership->findMatchingJob($user, $jobId);

        // A matching chunk commits its results and progress atomically. Expose those
        // committed rows while the worker is finalizing later chunks; only short
        // circuit while there is genuinely nothing reviewable to read yet.
        $isProcessing = in_array($job->status, ['processing', 'queued', 'pending'], true);
        $hasPersistedResults = ! $isProcessing
            || MatchingResult::where('matching_job_id', $job->id)->exists();
        if ($isProcessing && ! $hasPersistedResults) {
            $recordCounts = $job->record_counts ?? [];
            $totalRawInput = (int) ($recordCounts['total_raw_input'] ?? $job->inputDataset?->row_count ?? $job->total_count ?? 0);
            $totalUniqueInput = (int) ($recordCounts['total_unique_input'] ?? $totalRawInput);
            $totalDuplicates = (int) ($recordCounts['total_duplicates'] ?? 0);

            return [
                'contract_version' => ReviewContract::VERSION,
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
                    'accounting' => ReviewContract::accounting($recordCounts, (int) ($recordCounts['matched'] ?? 0)),
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

        // Count one outcome per input. Active review decisions override the
        // primary candidate even when the reviewer chose candidate rank 2/3.
        // PHP turns numeric string array keys into integers. Binding those as
        // numbers against VARCHAR input keys makes MySQL coerce every row and
        // defeats the job/input index (and can conflate "001" with "1").
        $decidedKeys = $latestDecisions->keys()->map(fn ($key) => (string) $key)->all();
        $baseCounts = MatchingResult::where('matching_job_id', $job->id)
            ->where('candidate_rank', 1)
            ->selectRaw('result_type, COUNT(*) AS total')->groupBy('result_type')->pluck('total', 'result_type');
        // Keep the full-job count covered by the job/rank/type index. Excluding
        // keys here forces MySQL to fetch every large JSON result row just to
        // inspect input_record_key. Subtract only the targeted primary outcomes.
        if ($decidedKeys !== []) {
            $decidedPrimaryCounts = MatchingResult::where('matching_job_id', $job->id)
                ->where('candidate_rank', 1)->whereIn('input_record_key', $decidedKeys)
                ->pluck('result_type')->countBy();
            foreach ($decidedPrimaryCounts as $type => $count) {
                $baseCounts[$type] = (int) ($baseCounts[$type] ?? 0) - (int) $count;
            }
        }
        $matchedCount = (int) ($baseCounts['matched'] ?? 0) + $latestDecisions->where('new_result_type', 'matched')->count();
        $possibleMatchCount = (int) ($baseCounts['possible_match'] ?? 0) + $latestDecisions->where('new_result_type', 'possible_match')->count();
        $unmatchedCount = (int) ($baseCounts['unmatched'] ?? 0) + $latestDecisions->where('new_result_type', 'unmatched')->count();

        $reviewedCount = $job->reviewDecisions()->whereNull('undone_at')->distinct('input_record_key')->count('input_record_key');

        // Aggregate review groups across all reviewable database records (with caching)
        $includeGroups = filter_var($params['include_groups'] ?? true, FILTER_VALIDATE_BOOLEAN);
        $reviewGroups = ($includeGroups || $caseGroupId !== '')
            ? $this->aggregateJobReviewGroups($job, $latestDecisions, $decisionHistory, $customRules, $reviewedCount, ! $includeGroups)
            : ['system_presets' => [], 'custom_rules' => [], 'dynamic_patterns' => [], 'case_groups' => []];

        if (isset($params['input_keys'])) {
            // Internal mutation snapshots contain only affected records, not a full
            // paginated review or expensive case-group diagnostic rebuild.
            $targetKeys = array_values(array_unique(array_map('strval', $params['input_keys'])));
            $results = MatchingResult::where('matching_job_id', $job->id)
                ->whereIn('input_record_key', $targetKeys)
                ->orderBy('candidate_rank')->get();
            $items = $this->transformResultsToItems($results, $latestDecisions, $decisionHistory, $customRules);
            $totalFiltered = count($targetKeys);
            $totalPages = 1;
        } else {
            $keysQuery = DB::table('matching_results')->where('matching_job_id', $job->id)->where('candidate_rank', 1);
            if ($caseGroupId !== '') {
                $matchedGroup = collect($reviewGroups['case_groups'])->first(fn ($group) => $group['id'] === $caseGroupId);
                if (!$matchedGroup) throw (new \Illuminate\Database\Eloquent\ModelNotFoundException())->setModel('ReviewCaseGroup', [$caseGroupId]);
                $keysQuery->whereIn('input_record_key', array_map('strval', $matchedGroup['item_keys']));
            }
            if ($status !== 'all' && in_array($status, ['possible_match', 'matched', 'unmatched'], true)) {
                $statusKeys = $latestDecisions->where('new_result_type', $status)->keys()->map(fn ($key) => (string) $key)->all();
                $keysQuery->where(function ($query) use ($status, $decidedKeys, $statusKeys) {
                    $query->where(fn ($q) => $q->where('result_type', $status)->whereNotIn('input_record_key', $decidedKeys));
                    if ($statusKeys !== []) $query->orWhereIn('input_record_key', $statusKeys);
                });
            }
            if ($search !== '') {
                $pattern = '%'.mb_strtolower($search).'%';
                $keysQuery->where(fn ($q) => $q->where('input_record_key', 'LIKE', "%{$search}%")
                    ->orWhereRaw("LOWER(JSON_EXTRACT(candidate_metadata, '$.input_record')) LIKE ?", [$pattern])
                    ->orWhereRaw("LOWER(JSON_EXTRACT(candidate_metadata, '$.reference_record')) LIKE ?", [$pattern]));
            }
            $hasRegions = !empty($params['input_province_code']) || !empty($params['input_regency_code']);
            if ($hasRegions) {
                if (app(ReviewRegionIndexService::class)->remaining($job->id) > 0) abort(409, 'Input region filters are still being prepared.');
                foreach (['input_province_code', 'input_regency_code'] as $column) {
                    if (!empty($params[$column])) $keysQuery->where($column, (string) $params[$column]);
                }
            }
            $sort = $params['sort'] ?? 'record_order';
            $hasRange = isset($params['similarity_min']) || isset($params['similarity_max']);
            $needsScores = $sort !== 'record_order' || $hasRange;
            $scoresQuery = (clone $keysQuery)->select('id', 'input_record_key', 'overall_score');
            if ($needsScores) {
                $chosen = $latestDecisions->where('new_result_type', 'matched')->filter(fn ($d) => $d->matching_result_id);
                $chosenScores = MatchingResult::where('matching_job_id', $job->id)->whereIn('id', $chosen->pluck('matching_result_id'))->pluck('overall_score', 'id');
                $overrides = [];
                foreach ($chosen as $decision) {
                    if ($chosenScores->has($decision->matching_result_id)) $overrides[(string) $decision->input_record_key] = $chosenScores[$decision->matching_result_id];
                }
                if ($overrides !== []) {
                    $overrideKeys = array_map('strval', array_keys($overrides));
                    $bindings = [];
                    $cases = [];
                    foreach ($overrides as $key => $score) { $cases[] = 'WHEN ? THEN ?'; array_push($bindings, (string) $key, $score); }
                    $overrideQuery = (clone $keysQuery)->whereIn('input_record_key', $overrideKeys)->select('id', 'input_record_key')
                        ->selectRaw('CASE input_record_key '.implode(' ', $cases).' ELSE overall_score END AS overall_score', $bindings);
                    $scoresQuery->whereNotIn('input_record_key', $overrideKeys)->unionAll($overrideQuery);
                }
            }
            $pageQuery = DB::query()->fromSub($scoresQuery, 'review_records');
            if (isset($params['similarity_min'])) $pageQuery->where('overall_score', '>=', (float) $params['similarity_min']);
            if (isset($params['similarity_max'])) $pageQuery->where('overall_score', '<=', (float) $params['similarity_max']);
            if ($caseGroupId !== '' || $search !== '' || $hasRegions || $hasRange) {
                $totalFiltered = (clone $pageQuery)->count();
            } else {
                $totalFiltered = match ($status) {
                    'possible_match' => $possibleMatchCount, 'matched' => $matchedCount, 'unmatched' => $unmatchedCount,
                    default => $matchedCount + $possibleMatchCount + $unmatchedCount,
                };
            }
            $totalPages = max(1, (int) ceil($totalFiltered / $perPage));
            if ($sort !== 'record_order') {
                if ($sort === 'similarity_asc') $pageQuery->orderByRaw('overall_score IS NULL');
                $pageQuery->orderBy('overall_score', $sort === 'similarity_desc' ? 'desc' : 'asc')->orderBy('input_record_key');
            } else {
                $pageQuery->orderBy('id');
            }
            $pageKeys = $pageQuery->forPage($page, $perPage)->pluck('input_record_key')->map(fn ($key) => (string) $key);
            $results = MatchingResult::where('matching_job_id', $job->id)->whereIn('input_record_key', $pageKeys)->orderBy('candidate_rank')->get();
            $byKey = $this->transformResultsToItems($results, $latestDecisions, $decisionHistory, $customRules)->keyBy('input_record_key');
            $items = $pageKeys->map(fn ($key) => $byKey->get($key))->filter()->values();
        }

        $manualAccepted = $latestDecisions->filter(fn ($d) => in_array($d->decision, ['accept_match', 'select_candidate', 'accepted', 'accept'], true))->count();
        $manualRejected = $latestDecisions->filter(fn ($d) => in_array($d->decision, ['reject_match', 'rejected', 'reject'], true))->count();

        $effectiveMatched = $matchedCount;
        $effectiveReview = $possibleMatchCount;
        $effectiveUnmatched = $unmatchedCount;
        $processedCount = (int) ($job->processed_count ?? ($matchedCount + $possibleMatchCount + $unmatchedCount));
        $isCompleted = ($job->status === 'completed');
        $unprocessedCount = max(0, $totalUniqueInput - $processedCount);

        return [
            'contract_version' => ReviewContract::VERSION,
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
                'auto_matched' => (int) ($baseCounts['matched'] ?? 0),
                'manual_accepted' => $manualAccepted,
                'manual_rejected' => $manualRejected,
                'reviewed' => $reviewedCount,
                'accounting' => ReviewContract::accounting($recordCounts, $effectiveMatched),
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
            'items' => $items->values()->all(),
            'system_presets' => $includeGroups ? $reviewGroups['system_presets'] : [],
            'custom_rules' => $includeGroups ? $reviewGroups['custom_rules'] : [],
            'dynamic_patterns' => $includeGroups ? $reviewGroups['dynamic_patterns'] : [],
            'case_groups' => $includeGroups ? $reviewGroups['case_groups'] : [],
            'field_quality_summary' => filter_var($params['include_quality'] ?? $includeGroups, FILTER_VALIDATE_BOOLEAN)
                ? $this->aggregateFieldQuality($job, $totalUniqueInput) : [],
            'is_processing' => $isProcessing,
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function aggregateFieldQuality(MatchingJob $job, int $totalEvaluated): array
    {
        // Scores are immutable matching evidence. Include progress in the key so
        // incremental results cannot leave a partial aggregate cached as final.
        $cacheKey = "matching_job_field_quality_v3_{$job->id}_{$job->processed_count}_{$job->status}";
        return cache()->remember($cacheKey, 3600, function () use ($job, $totalEvaluated) {
            if (DB::connection()->getDriverName() === 'mysql') {
                // Expand JSON in MySQL, returning only one aggregate per column.
                // No PHP hydration of hundreds of thousands of result payloads.
                $rows = DB::select(<<<'SQL'
                    SELECT f.reference_column, f.input_column,
                           COUNT(*) AS evaluated, SUM(f.score) AS score_sum,
                           SUM(f.score >= 90) AS high_count,
                           SUM(f.score >= 80 AND f.score < 90) AS med_count,
                           SUM(f.score < 80) AS low_count
                    FROM matching_results AS r
                    JOIN JSON_TABLE(COALESCE(r.field_scores, JSON_ARRAY()), '$[*]'
                        COLUMNS (
                            reference_column VARCHAR(255) PATH '$.reference_column',
                            input_column VARCHAR(255) PATH '$.input_column',
                            score DOUBLE PATH '$.score' NULL ON EMPTY NULL ON ERROR
                        )
                    ) AS f ON TRUE
                    WHERE r.matching_job_id = ? AND r.candidate_rank = 1
                        AND f.score IS NOT NULL
                    GROUP BY f.reference_column, f.input_column
                    SQL, [$job->id]);
            } else {
                // SQLite test/local fallback streams all evidence, never a sample.
                $stats = [];
                foreach (MatchingResult::where('matching_job_id', $job->id)
                    ->where('candidate_rank', 1)->select('id', 'field_scores')->lazyById(500) as $record) {
                    foreach ($record->field_scores ?? [] as $field) {
                        if (!isset($field['score']) || !is_numeric($field['score'])) continue;
                        $ref = (string) ($field['reference_column'] ?? '');
                        $inp = (string) ($field['input_column'] ?? '');
                        $key = $ref.':::'.$inp;
                        $stats[$key] ??= ['reference_column' => $ref, 'input_column' => $inp,
                            'evaluated' => 0, 'score_sum' => 0, 'high_count' => 0, 'med_count' => 0, 'low_count' => 0];
                        $score = (float) $field['score'];
                        $stats[$key]['evaluated']++;
                        $stats[$key]['score_sum'] += $score;
                        $stats[$key][$score >= 90 ? 'high_count' : ($score >= 80 ? 'med_count' : 'low_count')]++;
                    }
                }
                $rows = array_map(fn ($row) => (object) $row, array_values($stats));
            }

            $result = [];
            foreach ($rows as $row) {
                $key = $row->reference_column.':::'.$row->input_column;
                $count = (int) $row->evaluated;
                if ($count === 0) continue;
                $result[$key] = [
                    'fieldKey' => $key,
                    'referenceColumn' => $row->reference_column,
                    'inputColumn' => $row->input_column,
                    'totalEvaluated' => $count,
                    'totalRecords' => $totalEvaluated,
                    'unscoredCount' => max(0, $totalEvaluated - $count),
                    'avgScore' => (int) round($row->score_sum / $count),
                    'highCount' => (int) $row->high_count,
                    'medCount' => (int) $row->med_count,
                    'lowCount' => (int) $row->low_count,
                    'highPct' => round($row->high_count / $count * 100, 1),
                    'medPct' => round($row->med_count / $count * 100, 1),
                    'lowPct' => round($row->low_count / $count * 100, 1),
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
    private function aggregateJobReviewGroups(MatchingJob $job, $latestDecisions, $decisionHistory, array $customRules, int $reviewedCount, bool $membershipOnly = false): array
    {
        $rulesHash = md5(json_encode($customRules));
        $mode = config('workspace_access.enabled') ? 'states' : 'legacy';
        $cacheKey = "matching_job_case_membership_v4_{$mode}_{$job->id}_{$rulesHash}_{$job->processed_count}_{$job->status}";
        $groups = cache()->get($cacheKey);
        $knownKeys = is_array($groups)
            ? collect($groups['case_groups'])->flatMap(fn ($group) => $group['item_keys'])->all() : [];
        // A decision on a previously unreviewable record can introduce a new case.
        if (!is_array($groups) || array_diff($latestDecisions->keys()->all(), $knownKeys) !== []) {
            $groups = cache()->lock("{$cacheKey}_build", 300)->block(10, function () use ($cacheKey, $job, $latestDecisions, $customRules) {
                $cached = cache()->get($cacheKey);
                $cachedKeys = is_array($cached) ? collect($cached['case_groups'])->flatMap(fn ($group) => $group['item_keys'])->all() : [];
                if (is_array($cached) && array_diff($latestDecisions->keys()->all(), $cachedKeys) === []) return $cached;
                // Discover keys with narrow indexed predicates before loading JSON payloads.
                $keys = MatchingResult::where('matching_job_id', $job->id)->where('candidate_rank', 1)
                    ->where('result_type', 'possible_match')->pluck('input_record_key');
                $reviewedKeys = MatchingResult::where('matching_job_id', $job->id)->where('candidate_rank', 1)
                    ->where('review_status', 'reviewed')->pluck('input_record_key');
                $keys = $keys->merge($reviewedKeys)->merge($latestDecisions->keys())
                    ->map(fn ($key) => (string) $key)->unique()->values();
                if (config('workspace_access.enabled')) $keys = $keys->merge(DB::table('review_states')->where('matching_job_id', $job->id)->where('status', 'reference_conflict')->pluck('input_record_key'))->map(fn ($key) => (string) $key)->unique()->values();
                // Cache immutable classification and membership; decisions/undo are
                // overlaid below without re-reading thousands of result payloads.
                $stats = [];
                foreach ($keys->chunk(100) as $chunk) {
                    $results = MatchingResult::where('matching_job_id', $job->id)->whereIn('input_record_key', $chunk)->whereIn('candidate_rank', [1, 2])->orderBy('candidate_rank')->get();
                    foreach ($this->transformResultsToItems($results, collect(), collect(), $customRules) as $item) {
                        $item = [...$item, 'status' => 'possible_match', 'display_status' => 'need_review'];
                        $id = $item['case_features']['group_id'];
                        $score = (float) data_get($item, 'candidates.0.score', 0);
                        $stats[$id] ??= ['keys' => [], 'min' => $score, 'max' => $score, 'samples' => []];
                        $stats[$id]['keys'][] = (string) $item['input_record_key'];
                        $stats[$id]['min'] = min($stats[$id]['min'], $score); $stats[$id]['max'] = max($stats[$id]['max'], $score);
                        $stats[$id]['samples'][] = $item;
                        usort($stats[$id]['samples'], fn ($a, $b) => data_get($b, 'candidates.0.score', 0) <=> data_get($a, 'candidates.0.score', 0));
                        $stats[$id]['samples'] = array_slice($stats[$id]['samples'], 0, 3);
                    }
                }
                $groups = $this->buildReviewGroups(collect($stats)->flatMap(fn ($s) => $s['samples']), $customRules);
                foreach (['system_presets', 'custom_rules', 'dynamic_patterns', 'case_groups'] as $section) {
                    foreach ($groups[$section] as &$group) {
                        if (!isset($stats[$group['id']])) continue;
                        $s = $stats[$group['id']]; $count = count($s['keys']);
                        $group['item_count'] = $count; $group['item_keys'] = $s['keys'];
                        $group['confidence'] = $this->clusterConfidence($count, $s['max'] - $s['min']);
                        $group['consistency'] = $this->caseConsistency($group['confidence']);
                        $group['eligible_for_bulk'] = $group['confidence'] === 'High';
                        $group['decision_summary']['pending'] = $count;
                    }
                    unset($group);
                }
                cache()->put($cacheKey, $groups, 3600);
                return $groups;
            });
        }
        if ($membershipOnly) return $groups;

        $decorateItem = function (?array $item) use ($latestDecisions, $decisionHistory): ?array {
            if ($item === null) return null;
            $key = $item['input_record_key'];
            $decision = $latestDecisions->get($key);
            $item['decision'] = $decision ? $this->decisionPayload($decision) : null;
            $item['decision_history'] = $decisionHistory->get($key, collect())
                ->map(fn ($audit) => $this->decisionPayload($audit))->values()->all();
            $item['status'] = $decision?->new_result_type ?? 'possible_match';
            $item['display_status'] = $this->displayStatus($decision, 'possible_match');
            $item['status_code'] = $this->statusCode($decision, 'possible_match');
            $item['review_status'] = $decision ? 'reviewed' : 'pending';
            return $item;
        };
        foreach (['system_presets', 'custom_rules', 'dynamic_patterns'] as $section) {
            foreach ($groups[$section] as &$group) {
                $groupDecisions = $latestDecisions->toBase()->only($group['item_keys']);
                $accepted = $groupDecisions->whereIn('decision', ['accept_match', 'select_candidate'])->count();
                $rejected = $groupDecisions->where('decision', 'reject_match')->count();
                $unmatched = $groupDecisions->where('decision', 'mark_unmatched')->count();
                $pending = $group['item_count'] - $groupDecisions->count();
                $group['decision_summary'] = ['accepted' => $accepted, 'rejected' => $rejected,
                    'unmatched' => $unmatched, 'pending' => $pending,
                    'mixed' => collect([$accepted, $rejected, $unmatched])->filter(fn ($n) => $n > 0)->count() > 1];
                $group['reviewed_count'] = $groupDecisions->count();
                $group['status'] = $pending > 0 || $group['item_count'] === 0 ? 'open' : 'resolved';
                $group['eligible_for_bulk'] = $group['item_count'] > 0 && $group['confidence'] === 'High' && $pending > 0;
                $group['decision_history'] = $decisionHistory->toBase()->only($group['item_keys'])
                    ->flatten(1)->map(fn ($audit) => $this->decisionPayload($audit))->values()->all();
                $group['knowledge_level'] = $this->knowledgeLevelFromHistory(collect([
                    ['decision_history' => $group['decision_history']],
                ]));
                $group['representative'] = $decorateItem($group['representative']);
                $group['representative_samples'] = array_map($decorateItem, $group['representative_samples']);
            }
            unset($group);
        }
        $groups['case_groups'] = collect(array_merge($groups['system_presets'], $groups['custom_rules'], $groups['dynamic_patterns']))
            ->filter(fn ($group) => $group['item_count'] > 0)->values()->all();
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
            if ($decision?->new_result_type === 'matched' && $decision->matching_result_id) {
                $group = $group->sortBy(fn ($result) => [$result->id === $decision->matching_result_id ? 0 : 1, $result->candidate_rank])->values();
            }
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
        $this->assertLegacyWriterEnabled();
        $response = DB::transaction(function () use ($user, $jobId, $payload) {
            $job = $this->ownership->findMatchingJob($user, $jobId);
            $decision = (string) $payload['decision'];
            $scope = (string) ($payload['scope'] ?? 'one');
            $customRules = data_get($job->configuration?->advanced_settings, 'custom_review_rules', []);
            if (empty($customRules) && $job->workspace) {
                $customRules = data_get($job->workspace->workflow_state, 'custom_review_rules', []);
            }

            $caseGroupsById = collect();
            if ($scope === 'group' || ($scope === 'selected' && !empty($payload['case_group_id']))) {
                $allDecisions = $job->reviewDecisions()->latest()->get();
                $latestDecisions = $allDecisions->whereNull('undone_at')->unique('input_record_key')->keyBy('input_record_key');
                $groups = $this->aggregateJobReviewGroups($job, $latestDecisions,
                    $allDecisions->groupBy('input_record_key'), $customRules, $latestDecisions->count());
                $caseGroupsById = collect(array_merge($groups['system_presets'], $groups['custom_rules'],
                    $groups['dynamic_patterns'], $groups['case_groups']))->keyBy('id');
            }

            $inputKeys = array_values(array_unique($this->targetInputKeys($payload, $scope, $caseGroupsById)));
            // Only read/lock targeted rows. Preserve bulk guardrails and auditing.
            $targetResults = MatchingResult::where('matching_job_id', $job->id)
                ->whereIn('input_record_key', $inputKeys)
                ->orderBy('input_record_key')->orderBy('candidate_rank')->lockForUpdate()->get();
            $targetDecisions = $job->reviewDecisions()->whereIn('input_record_key', $inputKeys)->latest()->get();
            $itemsByKey = $this->transformResultsToItems($targetResults,
                $targetDecisions->whereNull('undone_at')->unique('input_record_key')->keyBy('input_record_key'),
                $targetDecisions->groupBy('input_record_key'), $customRules)->keyBy('input_record_key');

            $inputKeys = $this->openInputKeys($itemsByKey, $inputKeys, $scope);
            $snapshotKeys = $inputKeys;
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
                    'reviewer_user_id' => $user->id,
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
                'affected_keys' => $snapshotKeys,
            ];
        });
        $response['review'] = $this->list($user, $jobId, [
            'include_groups' => !empty($payload['case_group_id']), 'include_quality' => false,
            'input_keys' => $response['affected_keys'],
        ]);
        unset($response['affected_keys']);
        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    public function undo(User $user, string $jobId, string $decisionId): array
    {
        $this->assertLegacyWriterEnabled();
        $response = DB::transaction(function () use ($user, $jobId, $decisionId) {
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

                $item->update([
                    'undone_at' => Carbon::now(),
                    'metadata' => array_merge($item->metadata ?? [], ['undone_by_user_id' => $user->id]),
                ]);
            }

            return [
                'undone_decision_id' => $decision->id,
                'affected_records' => $decisions->count(),
                'affected_keys' => $decisions->pluck('input_record_key')->all(),
                'include_groups' => (bool) data_get($decision->metadata, 'case_group_id'),
            ];
        });
        $response['review'] = $this->list($user, $jobId, [
            'include_groups' => $response['include_groups'], 'include_quality' => false,
            'input_keys' => $response['affected_keys'],
        ]);
        unset($response['affected_keys'], $response['include_groups']);
        return $response;
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
            'operation_id' => $decision->review_operation_id,
            'decision' => $decision->decision,
            'previous_result_type' => $decision->previous_result_type,
            'new_result_type' => $decision->new_result_type,
            'selected_reference_record_key' => $decision->selected_reference_record_key,
            'created_at' => optional($decision->created_at)->toISOString(),
            'decided_at' => optional($decision->created_at)->toISOString(),
            'undone_at' => optional($decision->undone_at)->toISOString(),
            'source' => data_get($decision->metadata, 'decision_source', data_get($decision->metadata, 'scope', 'individual')),
            'reviewer' => data_get($decision->metadata, 'reviewer', data_get($decision->metadata, 'created_by')),
            'actors' => $decision->review_state_id ? [
                'reviewer_user_id' => $decision->reviewer_user_id,
                'proposed_by_user_id' => $decision->proposed_by_user_id,
                'approved_by_user_id' => $decision->approved_by_user_id,
                'last_modified_by_user_id' => $decision->last_modified_by_user_id,
                'attribution' => $decision->reviewer_user_id === null ? 'unknown_legacy' : 'authenticated',
            ] : ReviewContract::actors($decision),
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
            'unmatched' => 'CONFIRMED_UNMATCHED',
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
        return ReviewContract::resultType($decision);
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
