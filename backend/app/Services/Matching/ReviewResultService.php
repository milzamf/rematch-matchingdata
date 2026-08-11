<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
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

        $groups = $results->groupBy('input_record_key')->map(function ($group, string $inputKey) use ($latestDecisions) {
            /** @var \Illuminate\Support\Collection<int, MatchingResult> $group */
            $primary = $group->first();
            $decision = $latestDecisions->get($inputKey);
            $candidates = $group->map(fn (MatchingResult $result) => $this->candidatePayload($result))->values()->all();

            return [
                'input_record_key' => $inputKey,
                'status' => $decision?->new_result_type ?? $this->statusForGroup($group),
                'review_status' => $primary?->review_status ?? 'pending',
                'decision' => $decision ? [
                    'id' => $decision->id,
                    'decision' => $decision->decision,
                    'selected_reference_record_key' => $decision->selected_reference_record_key,
                    'created_at' => optional($decision->created_at)->toISOString(),
                ] : null,
                'input_record' => data_get($primary?->candidate_metadata, 'input_record', []),
                'candidates' => $candidates,
            ];
        })->values();

        return [
            'job' => [
                'id' => $job->id,
                'name' => $job->name,
                'status' => $job->status,
            ],
            'summary' => [
                'matched' => $groups->where('status', 'matched')->count(),
                'possible_match' => $groups->where('status', 'possible_match')->count(),
                'unmatched' => $groups->where('status', 'unmatched')->count(),
                'reviewed' => $groups->filter(fn (array $item) => $item['decision'] !== null)->count(),
            ],
            'items' => $groups->all(),
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
            $inputKey = (string) $payload['input_record_key'];
            $result = isset($payload['matching_result_id'])
                ? MatchingResult::where('matching_job_id', $job->id)->findOrFail($payload['matching_result_id'])
                : null;
            $newType = $this->newResultType($decision);

            if ($decision !== 'mark_unmatched' && $result === null) {
                throw new InvalidArgumentException('A candidate result is required for this review decision.');
            }

            $previousType = $result?->result_type;

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

            $audit = ReviewDecision::create([
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
                ],
            ]);

            return [
                'decision' => [
                    'id' => $audit->id,
                    'decision' => $audit->decision,
                    'input_record_key' => $audit->input_record_key,
                    'selected_reference_record_key' => $audit->selected_reference_record_key,
                    'new_result_type' => $audit->new_result_type,
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

            if ($decision->matching_result_id !== null) {
                MatchingResult::where('matching_job_id', $jobId)
                    ->where('id', $decision->matching_result_id)
                    ->update([
                        'result_type' => $decision->previous_result_type ?? 'possible_match',
                        'review_status' => 'pending',
                        'review_decision' => null,
                        'reviewed_at' => null,
                    ]);
            } else {
                MatchingResult::where('matching_job_id', $jobId)
                    ->where('input_record_key', $decision->input_record_key)
                    ->update([
                        'review_status' => 'pending',
                        'review_decision' => null,
                        'reviewed_at' => null,
                    ]);
            }

            $decision->update(['undone_at' => Carbon::now()]);

            return [
                'undone_decision_id' => $decision->id,
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
