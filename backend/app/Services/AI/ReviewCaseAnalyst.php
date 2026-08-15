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
    private const IDENTITY_ORDER = [
        'entity_name',
        'identifier',
        'nib',
        'npwp',
        'address',
        'province',
        'city',
        'email',
        'phone',
    ];

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
        $normalizedScores = collect(is_array($result->field_scores) ? $result->field_scores : [])
            ->filter(fn ($score) => is_array($score))
            ->map(fn (array $score) => $this->normalizeFieldScore($score, $inputRecord, $referenceRecord))
            ->values();
        $inputIdentity = $this->compactIdentity($this->extractIdentity($inputRecord));
        $referenceIdentity = $this->compactIdentity($this->extractIdentity($referenceRecord));
        $mappedFields = collect($this->mappedFields($mappings, $inputRecord, $referenceRecord, $normalizedScores));
        $importantFields = $this->selectImportantFields($mappedFields);

        return [
            'score' => round((float) $result->overall_score, 2),
            'rank' => $result->candidate_rank,
            'input' => $inputIdentity,
            'reference' => $referenceIdentity,
            'fields' => $importantFields->values()->all(),
            'agreements' => $importantFields
                ->filter(fn (array $field) => ($field['cmp'] ?? null) === 'same')
                ->take(4)
                ->map(fn (array $field) => (string) ($field['label'] ?? ''))
                ->filter(fn (string $label) => $label !== '')
                ->values()
                ->all(),
            'conflicts' => $importantFields
                ->filter(function (array $field) {
                    $comparison = $field['cmp'] ?? null;

                    return is_string($comparison)
                        && in_array($comparison, ['different', 'identity_conflict'], true);
                })
                ->take(4)
                ->map(fn (array $field) => [
                    'field' => $field['label'] ?? null,
                    'in' => $field['in'] ?? null,
                    'ref' => $field['ref'] ?? null,
                    'cmp' => $field['cmp'] ?? null,
                ])
                ->filter(fn (array $field) => is_string($field['field']) && $field['field'] !== '')
                ->values()
                ->all(),
            'missing_important_fields' => $this->missingImportantFields($inputIdentity, $referenceIdentity),
        ];
    }

    private function instructions(): string
    {
        return <<<'TEXT'
Analyze one RE-MATCH case using only the supplied compact evidence.
Advisory only.
Do not accept, reject, or mark unmatched.
Do not change similarity.
Return concise factual JSON only.
Assessment:
- likely_match
- uncertain
- likely_not_match
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
                    'input_value' => $this->safeScalar($inputRecord[$mapping->input_column_name] ?? null),
                    'reference_value' => $this->safeScalar($referenceRecord[$mapping->reference_column_name] ?? null),
                    'score' => is_array($fieldScore) ? $fieldScore['score'] : null,
                    'comparison' => is_array($fieldScore) ? $fieldScore['comparison'] : null,
                    'importance' => $this->fieldImportance(
                        $mapping->input_column_name ?: $mapping->reference_column_name ?: 'field'
                    ),
                ];
            })
            ->filter(fn (array $field) => ! $this->isEmptyFieldPair($field))
            ->values()
            ->all();
    }

    /**
     * @param  array<string, string|null>  $identity
     * @return array<string, string>
     */
    private function compactIdentity(array $identity): array
    {
        $compact = [];

        foreach (self::IDENTITY_ORDER as $field) {
            $value = $identity[$field] ?? null;

            if (is_string($value) && trim($value) !== '') {
                $compact[$field] = $value;
            }
        }

        return $compact;
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $mappedFields
     * @return Collection<int, array<string, mixed>>
     */
    private function selectImportantFields(Collection $mappedFields): Collection
    {
        $prioritized = $mappedFields
            ->sort(function (array $left, array $right) {
                $importanceDiff = ($left['importance'] ?? 99) <=> ($right['importance'] ?? 99);
                if ($importanceDiff !== 0) {
                    return $importanceDiff;
                }

                $comparisonDiff = $this->comparisonPriority((string) ($left['comparison'] ?? ''))
                    <=> $this->comparisonPriority((string) ($right['comparison'] ?? ''));

                if ($comparisonDiff !== 0) {
                    return $comparisonDiff;
                }

                return ((float) ($right['score'] ?? 0)) <=> ((float) ($left['score'] ?? 0));
            })
            ->values();

        $selected = $prioritized
            ->filter(fn (array $field) => ($field['importance'] ?? 99) <= 9)
            ->take(8);

        if ($selected->isEmpty()) {
            $selected = $prioritized->take(6);
        }

        return $selected->map(function (array $field) {
            return [
                'label' => $field['label'],
                'in' => $field['input_value'],
                'ref' => $field['reference_value'],
                'score' => $field['score'],
                'cmp' => $field['comparison'],
            ];
        });
    }

    /**
     * @param  array<string, string>  $inputIdentity
     * @param  array<string, string>  $referenceIdentity
     * @return array<int, string>
     */
    private function missingImportantFields(array $inputIdentity, array $referenceIdentity): array
    {
        $missing = [];

        foreach (self::IDENTITY_ORDER as $field) {
            $inputMissing = ! array_key_exists($field, $inputIdentity);
            $referenceMissing = ! array_key_exists($field, $referenceIdentity);

            if (! $inputMissing && ! $referenceMissing) {
                continue;
            }

            $missing[] = match (true) {
                $inputMissing && $referenceMissing => $field.' missing on both sides',
                $inputMissing => $field.' missing on input side',
                default => $field.' missing on reference side',
            };
        }

        return array_slice($missing, 0, 5);
    }

    /**
     * @param  array<string, mixed>  $field
     */
    private function isEmptyFieldPair(array $field): bool
    {
        return ($field['input_value'] === null || $field['input_value'] === '')
            && ($field['reference_value'] === null || $field['reference_value'] === '');
    }

    private function fieldImportance(string $column): int
    {
        $normalized = Str::lower($column);

        return match (true) {
            Str::contains($normalized, ['name', 'nama', 'company', 'entity', 'business']) => 1,
            Str::contains($normalized, ['identifier', 'id', 'kode', 'code']) => 2,
            Str::contains($normalized, ['nib']) => 3,
            Str::contains($normalized, ['npwp', 'tax']) => 4,
            Str::contains($normalized, ['address', 'alamat', 'jalan', 'street']) => 5,
            Str::contains($normalized, ['province', 'provinsi', 'prov']) => 6,
            Str::contains($normalized, ['city', 'kota', 'kabupaten', 'kab']) => 7,
            Str::contains($normalized, ['email']) => 8,
            Str::contains($normalized, ['phone', 'telepon', 'telp', 'mobile', 'hp']) => 9,
            default => 99,
        };
    }

    private function comparisonPriority(string $comparison): int
    {
        return match ($comparison) {
            'identity_conflict' => 1,
            'different' => 2,
            'similar' => 3,
            'same' => 4,
            default => 5,
        };
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
