<?php

namespace App\Services\AI;

use App\Models\MatchingResult;
use App\Models\User;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;

class ReviewRecommendationService
{
    public function __construct(
        private readonly AiProviderManager $providers,
        private readonly ResourceOwnership $ownership,
        private readonly ReviewCaseAnalyst $analyst,
        private readonly ReviewKnowledgeService $knowledge,
    ) {
    }

    public function recommend(User $user, string $matchingResultId, ?string $locale = null): AiResponse
    {
        $resolvedLocale = $this->resolveTargetLanguage($locale);
        $result = $this->ownership->scopeMatchingResults(
            MatchingResult::query()->with(['job.mappings']),
            $user,
        )->find($matchingResultId);

        if (! $result instanceof MatchingResult) {
            throw (new ModelNotFoundException())->setModel(MatchingResult::class, [$matchingResultId]);
        }

        $currentEvidence = $this->analyst->buildEvidence($result);
        $analysis = $this->analyst->analyze($user, $matchingResultId, $resolvedLocale);
        $knowledge = $this->knowledge->retrieve($user, $matchingResultId);

        $payload = [
            'current_case' => $this->compactCurrentCase($currentEvidence),
            'analysis' => $this->compactAnalysis($analysis),
            'historical_knowledge' => $this->compactKnowledge($knowledge),
            'risk_flags' => $this->riskFlags($currentEvidence),
            'target_language' => $resolvedLocale,
        ];

        return $this->providers->generateStructured([
            'instructions' => $this->instructions($resolvedLocale),
            'schema_name' => 'rematch_review_recommendation',
            'schema' => $this->schema(),
            'input' => [[
                'type' => 'input_text',
                'text' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]],
            'temperature' => 0.1,
        ]);
    }

    /**
     * @param  array<string, mixed>  $evidence
     * @return array<string, mixed>
     */
    private function compactCurrentCase(array $evidence): array
    {
        $fields = collect($evidence['fields'] ?? [])
            ->filter(fn ($field) => is_array($field) && is_string($field['f'] ?? null))
            ->map(fn (array $field) => [
                'f' => $field['f'],
                'score' => $field['score'] ?? null,
                'cmp' => $this->normalizeComparison($field['cmp'] ?? null, $field['score'] ?? null),
            ])
            ->values()
            ->all();

        return [
            'score' => $evidence['score'] ?? null,
            'fields' => $fields,
            'agreements' => array_values(array_filter($evidence['agreements'] ?? [], fn ($item) => is_string($item) && $item !== '')),
            'conflicts' => array_values(array_filter($evidence['conflicts'] ?? [], fn ($item) => is_string($item) && $item !== '')),
            'missing' => array_values(array_filter($evidence['missing'] ?? [], fn ($item) => is_string($item) && $item !== '')),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function compactAnalysis(AiResponse $analysis): array
    {
        if (! $analysis->success || ! is_array($analysis->data)) {
            return [
                'available' => false,
                'error' => $analysis->errorCode,
            ];
        }

        return [
            'available' => true,
            'assessment' => $analysis->data['assessment'] ?? null,
            'confidence' => $analysis->data['confidence'] ?? null,
            'summary' => $analysis->data['summary'] ?? null,
            'supporting_evidence' => array_slice($this->stringList($analysis->data['supporting_evidence'] ?? null), 0, 4),
            'conflicts' => array_slice($this->stringList($analysis->data['conflicts'] ?? null), 0, 4),
            'missing_information' => array_slice($this->stringList($analysis->data['missing_information'] ?? null), 0, 4),
            'attention_points' => array_slice($this->stringList($analysis->data['attention_points'] ?? null), 0, 4),
        ];
    }

    /**
     * @param  array<string, mixed>  $knowledge
     * @return array<string, mixed>
     */
    private function compactKnowledge(array $knowledge): array
    {
        $cases = collect($knowledge['similar_cases'] ?? [])
            ->filter(fn ($case) => is_array($case))
            ->take(3)
            ->map(fn (array $case) => [
                'relevance' => $case['relevance_score'] ?? null,
                'decision' => $case['previous_human_decision'] ?? null,
                'pattern' => $case['pattern'] ?? null,
                'agreements' => array_slice($this->stringList($case['important_agreements'] ?? null), 0, 3),
                'conflicts' => array_slice($this->stringList($case['important_conflicts'] ?? null), 0, 3),
            ])
            ->values()
            ->all();

        return [
            'total_found' => $knowledge['total_cases_found'] ?? 0,
            'cases' => $cases,
        ];
    }

    /**
     * @param  array<string, mixed>  $evidence
     * @return array<int, string>
     */
    private function riskFlags(array $evidence): array
    {
        $fields = collect($evidence['fields'] ?? [])->filter(fn ($field) => is_array($field));
        $flags = [];

        if ($fields->contains(fn (array $field) => ($field['cmp'] ?? null) === 'identity_conflict')) {
            $flags[] = 'strong_identifier_conflict';
        }

        if ($fields->contains(fn (array $field) => in_array(($field['f'] ?? null), ['entity_name', 'identifier', 'code', 'nib', 'npwp'], true) && $this->normalizeComparison($field['cmp'] ?? null, $field['score'] ?? null) === 'different')) {
            $flags[] = 'strong_field_mismatch';
        }

        if (($evidence['score'] ?? 0) < 75) {
            $flags[] = 'low_overall_similarity';
        }

        if ($this->stringList($evidence['missing'] ?? null) !== []) {
            $flags[] = 'missing_identity_fields';
        }

        return $flags;
    }

    private function instructions(string $targetLanguage = 'Indonesian (Bahasa Indonesia)'): string
    {
        return 'Generate one advisory review recommendation for RE-MATCH. '
            .'Never make or apply a final decision. '
            .'Use current compact evidence first, AI analysis second, historical human cases as supporting context only. '
            .'Strong identifier conflicts must be highlighted as risks. '
            ."Output all text fields (rationale, key_evidence, historical_context, risks, suggested_checks) strictly in {$targetLanguage}. "
            .'Return one JSON object only with no markdown fences and no extra text. '
            .'Use exactly these fields: recommendation (accept_match|reject_match|mark_unmatched|needs_review), confidence 0-100, rationale, key_evidence[], historical_context[], risks[], suggested_checks[].';
    }

    private function resolveTargetLanguage(?string $locale): string
    {
        $loc = mb_strtolower(trim((string) ($locale ?? request()?->header('X-Locale') ?? request()?->header('Accept-Language') ?? app()->getLocale())));
        if (str_starts_with($loc, 'id') || str_contains($loc, 'indonesia')) {
            return 'Indonesian (Bahasa Indonesia)';
        }
        return 'English';
    }

    /**
     * @return array<string, mixed>
     */
    private function schema(): array
    {
        return [
            'type' => 'object',
            'additionalProperties' => false,
            'required' => [
                'recommendation',
                'confidence',
                'rationale',
                'key_evidence',
                'historical_context',
                'risks',
                'suggested_checks',
            ],
            'properties' => [
                'recommendation' => [
                    'type' => 'string',
                    'enum' => ['accept_match', 'reject_match', 'mark_unmatched', 'needs_review'],
                ],
                'confidence' => [
                    'type' => 'integer',
                    'minimum' => 0,
                    'maximum' => 100,
                ],
                'rationale' => ['type' => 'string'],
                'key_evidence' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'historical_context' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'risks' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'suggested_checks' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
        ];
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

    /**
     * @return array<int, string>
     */
    private function stringList(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, fn ($item) => is_string($item) && $item !== ''));
    }
}
