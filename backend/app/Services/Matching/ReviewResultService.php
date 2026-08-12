<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

class ReviewResultService
{
    /**
     * @return array<string, mixed>
     */
    public function list(string $jobId): array
    {
        $job = MatchingJob::findOrFail($jobId);
        $results = $job->results()
            ->orderByRaw("case result_type when 'possible_match' then 0 when 'matched' then 1 else 2 end")
            ->orderBy('input_record_key')
            ->orderBy('candidate_rank')
            ->get();
        $latestDecisions = $job->reviewDecisions()
            ->whereNull('undone_at')
            ->latest()
            ->get()
            ->unique('input_record_key')
            ->keyBy('input_record_key');
        $decisionHistory = $job->reviewDecisions()
            ->latest()
            ->get()
            ->groupBy('input_record_key');

        $items = $results->groupBy('input_record_key')->map(function ($group, string $inputKey) use ($latestDecisions, $decisionHistory) {
            /** @var \Illuminate\Support\Collection<int, MatchingResult> $group */
            $primary = $group->first();
            $decision = $latestDecisions->get($inputKey);
            $history = $decisionHistory->get($inputKey, collect());
            $candidates = $group->map(fn (MatchingResult $result) => $this->candidatePayload($result))->values()->all();
            $item = [
                'input_record_key' => $inputKey,
                'status' => $decision?->new_result_type ?? $this->statusForGroup($group),
                'display_status' => $this->displayStatus($decision, $this->statusForGroup($group)),
                'review_status' => $primary?->review_status ?? 'pending',
                'decision' => $decision ? $this->decisionPayload($decision) : null,
                'decision_history' => $history->map(fn (ReviewDecision $item) => $this->decisionPayload($item))->values()->all(),
                'input_record' => data_get($primary?->candidate_metadata, 'input_record', []),
                'candidates' => $candidates,
            ];

            return [
                ...$item,
                'case_features' => $this->caseFeatures($item),
            ];
        })->values();

        return [
            'job' => [
                'id' => $job->id,
                'name' => $job->name,
                'status' => $job->status,
            ],
            'summary' => [
                'matched' => $items->where('status', 'matched')->count(),
                'possible_match' => $items->where('status', 'possible_match')->count(),
                'unmatched' => $items->where('status', 'unmatched')->count(),
                'reviewed' => $items->filter(fn (array $item) => $item['decision'] !== null)->count(),
            ],
            'items' => $items->all(),
            'case_groups' => $this->caseGroups($items),
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function decide(string $jobId, array $payload): array
    {
        return DB::transaction(function () use ($jobId, $payload) {
            $job = MatchingJob::findOrFail($jobId);
            $decision = (string) $payload['decision'];
            $scope = (string) ($payload['scope'] ?? 'one');
            $reviewSnapshot = $this->list($job->id);
            $itemsByKey = collect($reviewSnapshot['items'])->keyBy('input_record_key');
            $caseGroupsById = collect($reviewSnapshot['case_groups'])->keyBy('id');
            $inputKeys = $this->targetInputKeys($payload, $scope, $caseGroupsById);
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
                $knowledge = $knowledge ?? $this->reviewKnowledge($item, $decision, $scope, $payload);

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
                ],
                'review' => $this->list($job->id),
            ];
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function undo(string $jobId, string $decisionId): array
    {
        return DB::transaction(function () use ($jobId, $decisionId) {
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
                'review' => $this->list($jobId),
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
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, array<string, mixed>> $items
     * @return array<int, array<string, mixed>>
     */
    private function caseGroups($items): array
    {
        return $items
            ->groupBy(fn (array $item) => data_get($item, 'case_features.fingerprint'))
            ->map(function ($group, string $fingerprint) {
                /** @var \Illuminate\Support\Collection<int, array<string, mixed>> $group */
                $representative = $group->sortByDesc(fn (array $item) => data_get($item, 'candidates.0.score', 0))->first();
                $scores = $group->map(fn (array $item) => (float) data_get($item, 'candidates.0.score', 0));
                $scoreRange = ($scores->max() ?? 0) - ($scores->min() ?? 0);
                $confidence = $this->clusterConfidence($group->count(), $scoreRange);

                $decisionSummary = $this->decisionSummary($group);
                $groupStatus = $this->caseGroupStatus($group, $decisionSummary);

                return [
                    'id' => $fingerprint,
                    'fingerprint' => $fingerprint,
                    'status' => $groupStatus,
                    'pattern' => data_get($representative, 'case_features.pattern'),
                    'label' => $this->caseLabel((string) data_get($representative, 'case_features.pattern')),
                    'reason' => data_get($representative, 'case_features.reason'),
                    'conditions' => data_get($representative, 'case_features.conditions', []),
                    'confidence' => $confidence,
                    'eligible_for_bulk' => $confidence === 'High' && $groupStatus === 'open',
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
                ];
            })
            ->sortBy(fn (array $group) => ['High' => 0, 'Mixed' => 1, 'Unique' => 2][$group['confidence']] ?? 3)
            ->values()
            ->all();
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
     * @return array<string, mixed>
     */
    private function caseFeatures(array $item): array
    {
        $candidate = $item['candidates'][0] ?? null;

        if (! is_array($candidate) || empty($candidate['reference_record_key'])) {
            return [
                'pattern' => 'NO_CANDIDATE',
                'fingerprint' => 'NO_CANDIDATE',
                'reason' => 'No reference candidate was generated for this input record.',
                'conditions' => ['has_reference_candidate' => false],
            ];
        }

        $fieldScores = collect($candidate['field_scores'] ?? []);
        $score = (float) ($candidate['score'] ?? 0);
        $scoreBand = $this->scoreBand($score);
        $identityConflict = $fieldScores->contains(fn (array $score) => (bool) ($score['identity_conflict'] ?? false));
        $differentFields = $fieldScores
            ->filter(fn (array $score) => ($score['comparison'] ?? null) === 'different')
            ->pluck('reference_column')
            ->values()
            ->all();
        $similarFields = $fieldScores
            ->filter(fn (array $score) => ($score['comparison'] ?? null) === 'similar')
            ->pluck('reference_column')
            ->values()
            ->all();

        if ($identityConflict) {
            $pattern = 'LEGAL_FORM_CONFLICT';
            $reason = 'Legal form differs even though the core entity name is highly similar.';
        } elseif ($differentFields !== []) {
            $pattern = 'FIELD_CONFLICT';
            $reason = 'Some supporting fields differ and need a reviewer decision.';
        } elseif ($similarFields !== []) {
            $pattern = 'SIMILAR_NAME_REVIEW';
            $reason = 'The candidate is similar but not strong enough for automatic approval.';
        } else {
            $pattern = 'LOW_CONFIDENCE_MATCH';
            $reason = 'The score is inside the review band and needs confirmation.';
        }

        return [
            'pattern' => $pattern,
            'fingerprint' => implode('|', [
                $pattern,
                $scoreBand,
                implode(',', $differentFields),
                implode(',', $similarFields),
            ]),
            'reason' => $reason,
            'conditions' => [
                'score_band' => $scoreBand,
                'core_name_similarity_min' => round($score / 100, 2),
                'legal_form_conflict' => $identityConflict,
                'different_fields' => $differentFields,
                'similar_fields' => $similarFields,
            ],
        ];
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

    private function caseLabel(string $pattern): string
    {
        return match ($pattern) {
            'LEGAL_FORM_CONFLICT' => 'Legal form conflict',
            'FIELD_CONFLICT' => 'Supporting field conflict',
            'SIMILAR_NAME_REVIEW' => 'Similar name review',
            'NO_CANDIDATE' => 'No candidate',
            default => 'Low confidence match',
        };
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

            $eligibleGroup = $caseGroupsById
                ->filter(fn (array $group) => (bool) ($group['eligible_for_bulk'] ?? false))
                ->first(fn (array $group) => count(array_diff($keys, $group['item_keys'] ?? [])) === 0);

            if (! is_array($eligibleGroup)) {
                throw new InvalidArgumentException('Selected records must belong to one high-confidence case group.');
            }

            return $keys;
        }

        return [(string) $payload['input_record_key']];
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
    private function reviewKnowledge(array $item, string $decision, string $scope, array $payload): array
    {
        $features = $item['case_features'] ?? $this->caseFeatures($item);

        return [
            'pattern' => $features['pattern'] ?? 'UNKNOWN',
            'conditions' => $features['conditions'] ?? [],
            'decision' => $this->knowledgeDecision($decision),
            'scope' => $scope,
            'case_group_id' => $payload['case_group_id'] ?? null,
        ];
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
     * @param \Illuminate\Support\Collection<int, MatchingResult> $group
     */
    private function statusForGroup($group): string
    {
        if ($group->contains('result_type', 'possible_match')) {
            return 'possible_match';
        }

        if ($group->contains('result_type', 'matched')) {
            return 'matched';
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
}
