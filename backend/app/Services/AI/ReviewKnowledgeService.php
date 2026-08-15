<?php

namespace App\Services\AI;

use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use App\Models\User;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ReviewKnowledgeService
{
    private const MAX_CASES = 5;
    private const MIN_RELEVANCE = 20;
    private const FIELD_WEIGHTS = [
        'entity_name' => 5.0,
        'identifier' => 4.5,
        'code' => 4.0,
        'nib' => 4.0,
        'npwp' => 4.0,
        'address' => 2.0,
        'province' => 1.0,
        'city' => 1.0,
        'email' => 2.0,
        'phone' => 2.0,
    ];

    public function __construct(
        private readonly ResourceOwnership $ownership,
        private readonly ReviewCaseAnalyst $analyst,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function retrieve(User $user, string $matchingResultId): array
    {
        $currentResult = $this->ownership->scopeMatchingResults(
            MatchingResult::query()->with(['job.mappings']),
            $user,
        )->find($matchingResultId);

        if (! $currentResult instanceof MatchingResult) {
            throw (new ModelNotFoundException())->setModel(MatchingResult::class, [$matchingResultId]);
        }

        $currentCase = $this->buildCaseContext($currentResult);

        $similarCases = $this->latestResolvedCases($user)
            ->reject(function (ReviewDecision $decision) use ($currentResult) {
                return $decision->matching_job_id === $currentResult->matching_job_id
                    && $decision->input_record_key === $currentResult->input_record_key;
            })
            ->map(function (ReviewDecision $decision) use ($currentCase) {
                $result = $this->resolveDecisionResult($decision);

                if (! $result instanceof MatchingResult) {
                    return null;
                }

                $case = $this->buildCaseContext($result, $decision);
                $relevance = $this->relevanceScore($currentCase, $case);

                if ($relevance < self::MIN_RELEVANCE) {
                    return null;
                }

                $agreementSummary = $this->importantFieldSummary($case['fields'], ['same', 'similar']);
                $conflictSummary = $this->importantFieldSummary($case['fields'], ['different', 'identity_conflict']);

                return [
                    'matching_result_id' => $result->id,
                    'matching_job_id' => $result->matching_job_id,
                    'input_record_key' => $decision->input_record_key,
                    'relevance_score' => $relevance,
                    'previous_human_decision' => $this->decisionLabel($decision->decision),
                    'decision_recorded_at' => optional($decision->created_at)->toISOString(),
                    'pattern' => $case['pattern'],
                    'important_agreements' => $agreementSummary !== [] ? $agreementSummary : array_slice($case['evidence']['agreements'], 0, 4),
                    'important_conflicts' => $conflictSummary !== [] ? $conflictSummary : array_slice($case['evidence']['conflicts'], 0, 4),
                    'field_scores' => collect($case['evidence']['fields'])
                        ->map(fn (array $field) => [
                            'field' => $field['f'] ?? null,
                            'score' => $field['score'] ?? null,
                            'comparison' => $field['cmp'] ?? null,
                        ])
                        ->filter(fn (array $field) => is_string($field['field']) && $field['field'] !== '')
                        ->values()
                        ->all(),
                ];
            })
            ->filter()
            ->sortBy([
                ['relevance_score', 'desc'],
                ['decision_recorded_at', 'desc'],
                ['matching_result_id', 'asc'],
            ])
            ->values();

        return [
            'similar_cases' => $similarCases->take(self::MAX_CASES)->all(),
            'total_cases_found' => $similarCases->count(),
        ];
    }

    /**
     * @return Collection<int, ReviewDecision>
     */
    private function latestResolvedCases(User $user): Collection
    {
        return $this->ownership->scopeReviewDecisions(
            ReviewDecision::query()->with(['result.job.mappings']),
            $user,
        )
            ->whereNull('undone_at')
            ->latest('created_at')
            ->get()
            ->filter(fn (ReviewDecision $decision) => $this->isValidHumanDecision($decision))
            ->unique(fn (ReviewDecision $decision) => $decision->matching_job_id.'|'.$decision->input_record_key)
            ->values();
    }

    private function isValidHumanDecision(ReviewDecision $decision): bool
    {
        return in_array($decision->decision, [
            'accept_match',
            'select_candidate',
            'reject_match',
            'mark_unmatched',
        ], true);
    }

    private function resolveDecisionResult(ReviewDecision $decision): ?MatchingResult
    {
        if ($decision->relationLoaded('result') && $decision->result instanceof MatchingResult) {
            return $decision->result;
        }

        return MatchingResult::query()
            ->with(['job.mappings'])
            ->where('matching_job_id', $decision->matching_job_id)
            ->where('input_record_key', $decision->input_record_key)
            ->orderBy('candidate_rank')
            ->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function buildCaseContext(MatchingResult $result, ?ReviewDecision $decision = null): array
    {
        $evidence = $this->analyst->buildEvidence($result);
        $fieldSet = collect($evidence['fields'] ?? [])
            ->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))
            ->values();
        $pattern = (string) data_get($decision?->metadata, 'review_knowledge.pattern', $this->inferPattern($result, $fieldSet));
        $conditions = data_get($decision?->metadata, 'review_knowledge.conditions', $this->inferConditions($result, $fieldSet));

        return [
            'result_id' => $result->id,
            'matching_job_id' => $result->matching_job_id,
            'input_record_key' => $result->input_record_key,
            'score' => (float) ($evidence['score'] ?? 0),
            'score_band' => $this->scoreBand((float) ($evidence['score'] ?? 0)),
            'pattern' => $pattern,
            'conditions' => is_array($conditions) ? $conditions : [],
            'agreements' => collect($evidence['agreements'] ?? [])->filter(fn ($item) => is_string($item))->values()->all(),
            'conflicts' => collect($evidence['conflicts'] ?? [])->filter(fn ($item) => is_string($item))->values()->all(),
            'fields' => $fieldSet->all(),
            'evidence' => $evidence,
        ];
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $fields
     */
    private function inferPattern(MatchingResult $result, Collection $fields): string
    {
        if ($this->hasIdentityConflict($result, $fields)) {
            return 'LEGAL_FORM_CONFLICT';
        }

        if ($fields->contains(fn (array $field) => ($field['cmp'] ?? null) === 'different')) {
            return 'FIELD_CONFLICT';
        }

        if ($fields->contains(fn (array $field) => ($field['cmp'] ?? null) === 'similar')) {
            return 'SIMILAR_NAME_REVIEW';
        }

        if ($result->reference_record_key === null || $result->reference_record_key === '') {
            return 'NO_CANDIDATE';
        }

        return 'LOW_CONFIDENCE_MATCH';
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $fields
     * @return array<string, mixed>
     */
    private function inferConditions(MatchingResult $result, Collection $fields): array
    {
        return [
            'score_band' => $this->scoreBand((float) $result->overall_score),
            'legal_form_conflict' => $this->hasIdentityConflict($result, $fields),
            'agreement_fields' => $fields
                ->filter(fn (array $field) => ($field['cmp'] ?? null) === 'same')
                ->pluck('f')
                ->filter(fn ($field) => is_string($field) && $field !== '')
                ->values()
                ->all(),
            'conflict_fields' => $fields
                ->filter(fn (array $field) => in_array(($field['cmp'] ?? null), ['different', 'identity_conflict'], true))
                ->pluck('f')
                ->filter(fn ($field) => is_string($field) && $field !== '')
                ->values()
                ->all(),
        ];
    }

    private function hasIdentityConflict(MatchingResult $result, Collection $fields): bool
    {
        $rawScores = collect(is_array($result->field_scores) ? $result->field_scores : []);

        return $fields->contains(fn (array $field) => ($field['cmp'] ?? null) === 'identity_conflict')
            || $rawScores->contains(fn ($score) => is_array($score) && (bool) ($score['identity_conflict'] ?? false));
    }

    /**
     * @param  array<string, mixed>  $current
     * @param  array<string, mixed>  $candidate
     */
    private function relevanceScore(array $current, array $candidate): int
    {
        $fieldPattern = $this->fieldPatternSimilarity($current['fields'], $candidate['fields']);
        $agreementSimilarity = $this->stringSetSimilarity($current['agreements'], $candidate['agreements']);
        $conflictSimilarity = $this->stringSetSimilarity($current['conflicts'], $candidate['conflicts']);
        $scoreCloseness = $this->scoreCloseness((float) $current['score'], (float) $candidate['score']);
        $strongConflictPenalty = $this->strongPatternPenalty($current['fields'], $candidate['fields']);
        $patternBonus = ((string) $current['pattern'] === (string) $candidate['pattern']) ? 8 : 0;
        $bandBonus = ((string) $current['score_band'] === (string) $candidate['score_band']) ? 4 : 0;

        $score = 0.0;
        $score += $fieldPattern * 58;
        $score += $agreementSimilarity * 12;
        $score += $conflictSimilarity * 14;
        $score += $scoreCloseness * 8;
        $score += $patternBonus;
        $score += $bandBonus;
        $score -= $strongConflictPenalty;

        if ($this->hasOppositeStrongPattern($current['fields'], $candidate['fields'])) {
            $score = min($score, 18.0);
        }

        return (int) round(min(100, max(0, $score)));
    }

    private function scoreCloseness(float $left, float $right): float
    {
        return max(0.0, 1 - (abs($left - $right) / 100));
    }

    /**
     * @param  array<int, string>  $left
     * @param  array<int, string>  $right
     */
    private function stringSetSimilarity(array $left, array $right): float
    {
        $left = array_values(array_unique(array_filter($left, fn ($item) => is_string($item) && $item !== '')));
        $right = array_values(array_unique(array_filter($right, fn ($item) => is_string($item) && $item !== '')));

        if ($left === [] && $right === []) {
            return 1.0;
        }

        if ($left === [] || $right === []) {
            return 0.0;
        }

        $intersection = count(array_intersect($left, $right));
        $union = count(array_unique([...$left, ...$right]));

        return $union > 0 ? ($intersection / $union) : 0.0;
    }

    /**
     * @param  array<int, array<string, mixed>>  $left
     * @param  array<int, array<string, mixed>>  $right
     */
    private function fieldPatternSimilarity(array $left, array $right): float
    {
        $leftByField = collect($left)
            ->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))
            ->keyBy('f');
        $rightByField = collect($right)
            ->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))
            ->keyBy('f');
        $allFields = $leftByField->keys()->merge($rightByField->keys())->unique()->values();

        if ($allFields->isEmpty()) {
            return 0.0;
        }

        $weightedTotal = 0.0;
        $weightSum = 0.0;

        foreach ($allFields as $field) {
            $leftField = $leftByField->get($field);
            $rightField = $rightByField->get($field);
            $weight = $this->fieldWeight($field);
            $weightSum += $weight;

            if (! is_array($leftField) || ! is_array($rightField)) {
                continue;
            }

            $leftComparison = $this->normalizeComparison($leftField['cmp'] ?? null, $leftField['score'] ?? null);
            $rightComparison = $this->normalizeComparison($rightField['cmp'] ?? null, $rightField['score'] ?? null);
            $comparisonScore = $this->comparisonMatchScore($leftComparison, $rightComparison, $field);
            $scoreScore = 1 - min(1, abs(((float) ($leftField['score'] ?? 0)) - ((float) ($rightField['score'] ?? 0))) / 100);
            $weightedTotal += $weight * (($comparisonScore * 0.75) + ($scoreScore * 0.25));
        }

        return $weightSum > 0 ? ($weightedTotal / $weightSum) : 0.0;
    }

    /**
     * @param  array<int, array<string, mixed>>  $left
     * @param  array<int, array<string, mixed>>  $right
     */
    private function hasOppositeStrongPattern(array $left, array $right): bool
    {
        $leftByField = collect($left)->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))->keyBy('f');
        $rightByField = collect($right)->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))->keyBy('f');

        foreach (array_keys(self::FIELD_WEIGHTS) as $field) {
            if (! $this->isStrongField($field)) {
                continue;
            }

            $leftField = $leftByField->get($field);
            $rightField = $rightByField->get($field);

            if (! is_array($leftField) || ! is_array($rightField)) {
                continue;
            }

            $leftComparison = $this->normalizeComparison($leftField['cmp'] ?? null, $leftField['score'] ?? null);
            $rightComparison = $this->normalizeComparison($rightField['cmp'] ?? null, $rightField['score'] ?? null);

            if ($this->isAgreementLike($leftComparison) !== $this->isAgreementLike($rightComparison)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<int, array<string, mixed>>  $left
     * @param  array<int, array<string, mixed>>  $right
     */
    private function strongPatternPenalty(array $left, array $right): float
    {
        $leftByField = collect($left)->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))->keyBy('f');
        $rightByField = collect($right)->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))->keyBy('f');
        $penalty = 0.0;

        foreach (array_keys(self::FIELD_WEIGHTS) as $field) {
            if (! $this->isStrongField($field)) {
                continue;
            }

            $leftField = $leftByField->get($field);
            $rightField = $rightByField->get($field);

            if (! is_array($leftField) || ! is_array($rightField)) {
                continue;
            }

            $leftComparison = $this->normalizeComparison($leftField['cmp'] ?? null, $leftField['score'] ?? null);
            $rightComparison = $this->normalizeComparison($rightField['cmp'] ?? null, $rightField['score'] ?? null);

            if ($leftComparison === $rightComparison) {
                continue;
            }

            if ($this->isAgreementLike($leftComparison) !== $this->isAgreementLike($rightComparison)) {
                $penalty += $this->fieldWeight($field) * 4.5;
                continue;
            }

            if (in_array('different', [$leftComparison, $rightComparison], true) || in_array('identity_conflict', [$leftComparison, $rightComparison], true)) {
                $penalty += $this->fieldWeight($field) * 2.0;
            }
        }

        return $penalty;
    }

    /**
     * @param  array<int, array<string, mixed>>  $fields
     * @param  array<int, string>  $comparisons
     * @return array<int, string>
     */
    private function importantFieldSummary(array $fields, array $comparisons): array
    {
        return collect($fields)
            ->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))
            ->map(function (array $field) {
                $field['cmp_normalized'] = $this->normalizeComparison($field['cmp'] ?? null, $field['score'] ?? null);

                return $field;
            })
            ->filter(fn (array $field) => in_array($field['cmp_normalized'], $comparisons, true))
            ->sortBy(fn (array $field) => -1 * $this->fieldWeight((string) ($field['f'] ?? '')))
            ->take(4)
            ->map(fn (array $field) => (string) ($field['f'] ?? ''))
            ->filter(fn (string $field) => $field !== '')
            ->values()
            ->all();
    }

    private function fieldWeight(string $field): float
    {
        return self::FIELD_WEIGHTS[$field] ?? 1.0;
    }

    private function isStrongField(string $field): bool
    {
        return in_array($field, ['entity_name', 'identifier', 'code', 'nib', 'npwp'], true);
    }

    private function normalizeComparison(mixed $comparison, mixed $score): string
    {
        if (is_string($comparison) && $comparison !== '') {
            return $comparison;
        }

        $numericScore = is_numeric($score) ? (float) $score : null;

        if ($numericScore === null) {
            return 'unknown';
        }

        return match (true) {
            $numericScore >= 95 => 'same',
            $numericScore >= 75 => 'similar',
            default => 'different',
        };
    }

    private function comparisonMatchScore(string $left, string $right, string $field): float
    {
        if ($left === $right) {
            return 1.0;
        }

        if ($left === 'unknown' || $right === 'unknown') {
            return 0.15;
        }

        if ($this->isAgreementLike($left) && $this->isAgreementLike($right)) {
            return 0.65;
        }

        if ($this->isStrongField($field)) {
            return 0.0;
        }

        if (
            in_array($left, ['different', 'identity_conflict'], true)
            && in_array($right, ['different', 'identity_conflict'], true)
        ) {
            return 0.6;
        }

        return 0.1;
    }

    private function isAgreementLike(string $comparison): bool
    {
        return in_array($comparison, ['same', 'similar'], true);
    }

    private function scoreBand(float $score): string
    {
        return match (true) {
            $score >= 95 => '95-100',
            $score >= 85 => '85-94',
            $score >= 75 => '75-84',
            default => 'below-75',
        };
    }

    private function decisionLabel(string $decision): string
    {
        return match ($decision) {
            'accept_match', 'select_candidate' => 'MATCH',
            'reject_match' => 'NOT_MATCH',
            'mark_unmatched' => 'UNMATCHED',
            default => Str::upper($decision),
        };
    }
}
