<?php

namespace App\Services\AI;

use App\Models\MatchingResult;
use App\Models\User;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ReviewCaseAnalyst
{
    public function __construct(
        private readonly AiProviderManager $providers,
        private readonly ResourceOwnership $ownership,
    ) {
    }

    public function analyze(User $user, string $matchingResultId): AiResponse
    {
        $result = $this->ownership->scopeMatchingResults(
            MatchingResult::query()->with(['job.mappings']),
            $user,
        )->find($matchingResultId);

        if (! $result instanceof MatchingResult) {
            throw (new ModelNotFoundException())->setModel(MatchingResult::class, [$matchingResultId]);
        }

        $evidence = $this->buildEvidence($result);

        return $this->providers->generateStructured([
            'instructions' => $this->instructions(),
            'schema_name' => 'rematch_review_case_analysis',
            'schema' => $this->schema(),
            'input' => [[
                'type' => 'input_text',
                'text' => json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]],
            'temperature' => 0.1,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public function buildEvidence(MatchingResult $result): array
    {
        $candidateMetadata = is_array($result->candidate_metadata) ? $result->candidate_metadata : [];
        $inputRecord = is_array($candidateMetadata['input_record'] ?? null) ? $candidateMetadata['input_record'] : [];
        $referenceRecord = is_array($candidateMetadata['reference_record'] ?? null) ? $candidateMetadata['reference_record'] : [];
        $mappings = $result->job?->mappings ?? collect();
        $fieldScores = collect(is_array($result->field_scores) ? $result->field_scores : []);
        $normalizedScores = $fieldScores
            ->filter(fn ($score) => is_array($score))
            ->map(fn (array $score) => $this->normalizeFieldScore($score, $inputRecord, $referenceRecord))
            ->values();

        return [
            'matching_result_id' => $result->id,
            'matching_job_id' => $result->matching_job_id,
            'candidate_rank' => $result->candidate_rank,
            'overall_score' => $result->overall_score,
            'result_type' => $result->result_type,
            'review_status' => $result->review_status,
            'input_identity' => $this->extractIdentity($inputRecord),
            'reference_identity' => $this->extractIdentity($referenceRecord),
            'mapped_fields' => $this->mappedFields($mappings, $inputRecord, $referenceRecord, $normalizedScores),
            'field_scores' => $normalizedScores->all(),
            'agreements' => $normalizedScores
                ->where('comparison', 'same')
                ->pluck('label')
                ->values()
                ->all(),
            'conflicts' => $normalizedScores
                ->filter(fn (array $score) => in_array($score['comparison'], ['different', 'identity_conflict'], true))
                ->map(fn (array $score) => [
                    'field' => $score['label'],
                    'input_value' => $score['input_value'],
                    'reference_value' => $score['reference_value'],
                    'comparison' => $score['comparison'],
                ])
                ->values()
                ->all(),
        ];
    }

    private function instructions(): string
    {
        return <<<'TEXT'
You analyze one RE-MATCH review case. You are advisory only.

Rules:
- Explain the matching evidence for one candidate case
- Do not accept, reject, or mark unmatched
- Do not change similarity score
- Do not invent database facts
- Use only the provided evidence
- Keep summary concise and factual
- Output valid JSON matching the schema

Assessment meaning:
- likely_match: evidence strongly supports the same entity
- uncertain: evidence is mixed or incomplete
- likely_not_match: evidence strongly suggests different entities
TEXT;
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
                'assessment',
                'confidence',
                'summary',
                'supporting_evidence',
                'conflicts',
                'missing_information',
                'attention_points',
            ],
            'properties' => [
                'assessment' => [
                    'type' => 'string',
                    'enum' => ['likely_match', 'uncertain', 'likely_not_match'],
                ],
                'confidence' => [
                    'type' => 'integer',
                    'minimum' => 0,
                    'maximum' => 100,
                ],
                'summary' => [
                    'type' => 'string',
                ],
                'supporting_evidence' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'conflicts' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'missing_information' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'attention_points' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, string|null>
     */
    private function extractIdentity(array $record): array
    {
        $fields = collect($record)
            ->filter(fn ($value) => is_scalar($value) && trim((string) $value) !== '');

        return [
            'entity_name' => $this->findIdentityValue($fields, ['name', 'nama', 'company', 'entity', 'business']),
            'identifier' => $this->findIdentityValue($fields, ['id', 'identifier', 'kode', 'code']),
            'nib' => $this->findIdentityValue($fields, ['nib']),
            'npwp' => $this->findIdentityValue($fields, ['npwp', 'tax']),
            'address' => $this->findIdentityValue($fields, ['alamat', 'address', 'street', 'jalan']),
            'province' => $this->findIdentityValue($fields, ['province', 'provinsi', 'prov']),
            'city' => $this->findIdentityValue($fields, ['city', 'kota', 'kabupaten', 'kab']),
            'email' => $this->findIdentityValue($fields, ['email']),
            'phone' => $this->findIdentityValue($fields, ['phone', 'telepon', 'telp', 'mobile', 'hp']),
        ];
    }

    /**
     * @param  Collection<int|string, mixed>  $fields
     */
    private function findIdentityValue(Collection $fields, array $hints): ?string
    {
        $match = $fields->first(function ($value, $key) use ($hints) {
            $normalized = Str::lower((string) $key);

            foreach ($hints as $hint) {
                if (Str::contains($normalized, $hint)) {
                    return true;
                }
            }

            return false;
        });

        return is_scalar($match) ? (string) $match : null;
    }

    /**
     * @param  array<string, mixed>  $score
     * @param  array<string, mixed>  $inputRecord
     * @param  array<string, mixed>  $referenceRecord
     * @return array<string, mixed>
     */
    private function normalizeFieldScore(array $score, array $inputRecord, array $referenceRecord): array
    {
        $inputColumn = (string) ($score['input_column'] ?? '');
        $referenceColumn = (string) ($score['reference_column'] ?? '');
        $numericScore = (float) ($score['score'] ?? 0);
        $comparison = (string) ($score['comparison'] ?? '');
        $identityConflict = (bool) ($score['identity_conflict'] ?? false);

        return [
            'label' => $this->humanize($inputColumn !== '' ? $inputColumn : $referenceColumn),
            'input_column' => $inputColumn,
            'reference_column' => $referenceColumn,
            'input_value' => $this->safeScalar($inputRecord[$inputColumn] ?? null),
            'reference_value' => $this->safeScalar($referenceRecord[$referenceColumn] ?? null),
            'score' => round($numericScore, 2),
            'comparison' => $identityConflict ? 'identity_conflict' : $comparison,
        ];
    }

    /**
     * @param  Collection<int, \App\Models\ColumnMapping>  $mappings
     * @param  Collection<int, array<string, mixed>>  $normalizedScores
     * @return array<int, array<string, mixed>>
     */
    private function mappedFields(
        Collection $mappings,
        array $inputRecord,
        array $referenceRecord,
        Collection $normalizedScores,
    ): array {
        return $mappings
            ->map(function ($mapping) use ($inputRecord, $referenceRecord, $normalizedScores) {
                $fieldScore = $normalizedScores->first(function (array $score) use ($mapping) {
                    return $score['input_column'] === $mapping->input_column_name
                        && $score['reference_column'] === $mapping->reference_column_name;
                });

                return [
                    'label' => $this->humanize($mapping->input_column_name ?: $mapping->reference_column_name ?: 'field'),
                    'input_column' => $mapping->input_column_name,
                    'reference_column' => $mapping->reference_column_name,
                    'input_value' => $this->safeScalar($inputRecord[$mapping->input_column_name] ?? null),
                    'reference_value' => $this->safeScalar($referenceRecord[$mapping->reference_column_name] ?? null),
                    'algorithm' => $mapping->algorithm,
                    'required_match' => (bool) $mapping->required_match,
                    'weight' => $mapping->weight,
                    'score' => is_array($fieldScore) ? $fieldScore['score'] : null,
                    'comparison' => is_array($fieldScore) ? $fieldScore['comparison'] : null,
                ];
            })
            ->values()
            ->all();
    }

    private function safeScalar(mixed $value): string|int|float|bool|null
    {
        if (is_string($value)) {
            $trimmed = trim($value);

            return $trimmed !== '' ? $trimmed : null;
        }

        return is_scalar($value) ? $value : null;
    }

    private function humanize(string $value): string
    {
        return Str::of($value)
            ->replace(['_', '-'], ' ')
            ->squish()
            ->title()
            ->toString();
    }
}
