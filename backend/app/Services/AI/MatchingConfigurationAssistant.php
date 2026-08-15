<?php

namespace App\Services\AI;

use App\Models\ColumnMapping;
use App\Models\DatasetColumn;
use App\Models\MatchingConfiguration;
use App\Models\MatchingJob;
use App\Models\User;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class MatchingConfigurationAssistant
{
    private const SUPPORTED_ALGORITHMS = [
        'Exact',
        'Normalized Exact',
        'Case-Insensitive Exact',
        'Numeric Exact',
        'Date Exact',
        'Jaro-Winkler',
        'Levenshtein',
        'Damerau-Levenshtein',
        'Jaccard Similarity',
        'Cosine Similarity',
        'Sørensen-Dice',
        'Monge-Elkan',
        'Smith-Waterman',
        'Token Sort Ratio',
        'Token Set Ratio',
        'Partial Ratio',
        'Partial Token Sort',
        'Partial Token Set',
    ];

    public function __construct(
        private readonly AiProviderManager $providers,
        private readonly ResourceOwnership $ownership,
    ) {
    }

    public function suggest(User $user, string $jobId): AiResponse
    {
        $job = $this->ownership->scopeMatchingJobs(
            MatchingJob::query()->with([
                'referenceDataset.columns',
                'inputDataset.columns',
                'mappings',
                'configuration',
            ]),
            $user,
        )->find($jobId);

        if (! $job instanceof MatchingJob) {
            throw (new ModelNotFoundException())->setModel(MatchingJob::class, [$jobId]);
        }

        $payload = [
            'job' => [
                'strategy' => $job->configuration?->strategy,
                'preset' => $job->configuration?->preset,
            ],
            'mappings' => $this->compactMappings($job),
            'existing_configuration' => $this->compactConfiguration($job->configuration),
            'supported_algorithms' => self::SUPPORTED_ALGORITHMS,
        ];

        $response = $this->providers->generateStructured([
            'instructions' => $this->instructions(),
            'schema_name' => 'rematch_matching_configuration_assistant',
            'schema' => $this->schema(),
            'input' => [[
                'type' => 'input_text',
                'text' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]],
            'temperature' => 0.1,
        ]);

        if (! $response->success || ! is_array($response->data)) {
            return $response;
        }

        $data = $response->data;
        $data['recommended_fields'] = $this->normalizeRecommendedFields($data['recommended_fields'] ?? null);

        return AiResponse::success(
            provider: $response->provider,
            model: $response->model,
            data: $data,
            usage: $response->usage,
            latencyMs: $response->latencyMs,
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function compactMappings(MatchingJob $job): array
    {
        $referenceColumns = $job->referenceDataset?->columns
            ? $job->referenceDataset->columns->keyBy(fn (DatasetColumn $column) => Str::lower($column->name))
            : collect();
        $inputColumns = $job->inputDataset?->columns
            ? $job->inputDataset->columns->keyBy(fn (DatasetColumn $column) => Str::lower($column->name))
            : collect();

        return $job->mappings
            ->map(function (ColumnMapping $mapping) use ($job, $referenceColumns, $inputColumns) {
                $reference = $referenceColumns->get(Str::lower($mapping->reference_column_name));
                $input = $inputColumns->get(Str::lower($mapping->input_column_name));
                $semanticType = $this->semanticFieldType(
                    $mapping->reference_column_name,
                    $mapping->input_column_name,
                    $reference,
                    $input,
                );

                return [
                    'mapping_id' => $mapping->id,
                    'reference_column' => $mapping->reference_column_name,
                    'input_column' => $mapping->input_column_name,
                    'semantic_type' => $semanticType,
                    'reference_profile' => $this->columnProfile($reference, $semanticType, $job->referenceDataset?->row_count),
                    'input_profile' => $this->columnProfile($input, $semanticType, $job->inputDataset?->row_count),
                    'existing' => [
                        'algorithm' => $mapping->algorithm,
                        'weight' => $mapping->weight,
                        'required_match' => $mapping->required_match,
                    ],
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function compactConfiguration(?MatchingConfiguration $configuration): ?array
    {
        if (! $configuration instanceof MatchingConfiguration) {
            return null;
        }

        return [
            'preset' => $configuration->preset,
            'strategy' => $configuration->strategy,
            'thresholds' => [
                'auto_match' => data_get($configuration->thresholds, 'autoMatch'),
                'needs_review' => data_get($configuration->thresholds, 'review'),
            ],
            'normalization' => [
                'mode' => data_get($configuration->normalization, 'mode'),
                'preset' => data_get($configuration->normalization, 'preset'),
            ],
            'search_optimization' => [
                'mode' => data_get($configuration->search_optimization, 'mode'),
                'fields' => data_get($configuration->search_optimization, 'fields', []),
            ],
            'candidate_generation' => [
                'top_n' => data_get($configuration->candidate_generation, 'topN'),
            ],
        ];
    }

    private function instructions(): string
    {
        return 'Generate one advisory matching configuration suggestion for RE-MATCH. '
            .'Use compact metadata only. Do not invent unsupported algorithms or unsupported configuration options. '
            .'Prioritize strong identifiers: entity/company name, company ID, NIB, NPWP. '
            .'Province, city, and address are supporting fields with lower identity importance. '
            .'Never apply changes. Return one JSON object only with fields: '
            .'recommended_fields[], suggested_thresholds, hard_conflict_rules[], warnings[], rationale. '
            .'For each recommended field include field, use_for_matching, priority, suggested_weight, suggested_algorithm, reason.';
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
                'recommended_fields',
                'suggested_thresholds',
                'hard_conflict_rules',
                'warnings',
                'rationale',
            ],
            'properties' => [
                'recommended_fields' => [
                    'type' => 'array',
                ],
                'suggested_thresholds' => [
                    'type' => 'object',
                ],
                'hard_conflict_rules' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'warnings' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'rationale' => [
                    'type' => 'string',
                ],
            ],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function columnProfile(?DatasetColumn $column, string $semanticType, ?int $rowCount): ?array
    {
        if (! $column instanceof DatasetColumn) {
            return null;
        }

        return [
            'data_type' => $column->data_type,
            'null_rate' => round((float) $column->null_percentage, 2),
            'unique_rate' => $this->rate($column->unique_count, $rowCount),
            'duplicate_rate' => round((float) $column->duplicate_percentage, 2),
            'characteristics' => $this->safeCharacteristics($column, $semanticType),
        ];
    }

    private function semanticFieldType(
        string $referenceName,
        string $inputName,
        ?DatasetColumn $reference,
        ?DatasetColumn $input,
    ): string {
        $names = Str::lower($referenceName.' '.$inputName);

        return match (true) {
            Str::contains($names, ['npwp']) => 'npwp',
            Str::contains($names, ['nib']) => 'nib',
            Str::contains($names, ['company_id', 'identifier', 'kode', 'code', 'id']) => 'identifier',
            Str::contains($names, ['entity', 'company', 'business', 'nama', 'name']) => 'entity_name',
            Str::contains($names, ['address', 'alamat', 'street', 'jalan']) => 'address',
            Str::contains($names, ['province', 'provinsi', 'prov']) => 'province',
            Str::contains($names, ['city', 'kota', 'kabupaten', 'kab']) => 'city',
            Str::contains($names, ['email']) => 'email',
            Str::contains($names, ['phone', 'telepon', 'telp', 'mobile', 'hp']) => 'phone',
            ($reference?->data_type === 'date' || $input?->data_type === 'date') => 'date',
            ($reference?->data_type === 'number' || $input?->data_type === 'number') => 'number',
            default => 'text',
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function safeCharacteristics(DatasetColumn $column, string $semanticType): array
    {
        $samples = collect(is_array($column->sample_values) ? $column->sample_values : [])
            ->filter(fn ($value) => is_scalar($value) && trim((string) $value) !== '')
            ->map(fn ($value) => trim((string) $value))
            ->values();
        $avgLength = $samples->isNotEmpty()
            ? round($samples->avg(fn (string $value) => mb_strlen($value)), 1)
            : null;

        return [
            'avg_length' => $avgLength,
            'looks_identifier' => in_array($semanticType, ['identifier', 'nib', 'npwp'], true),
            'multi_word_ratio' => $samples->isNotEmpty()
                ? round($samples->filter(fn (string $value) => str_contains($value, ' '))->count() / $samples->count(), 2)
                : null,
            'contains_punctuation' => $samples->contains(fn (string $value) => preg_match('/[^\pL\pN\s]/u', $value) === 1),
        ];
    }

    private function rate(?int $numerator, ?int $denominator): ?float
    {
        if ($numerator === null || $denominator === null || $denominator <= 0) {
            return null;
        }

        return round(($numerator / $denominator) * 100, 2);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function normalizeRecommendedFields(mixed $fields): array
    {
        if (! is_array($fields)) {
            return [];
        }

        $normalized = collect($fields)
            ->filter(fn ($field) => is_array($field))
            ->map(function (array $field, int $index) {
                $useForMatching = (bool) ($field['use_for_matching'] ?? false);
                $priority = $this->priorityRank($field['priority'] ?? null);
                $rawWeight = is_numeric($field['suggested_weight'] ?? null)
                    ? max(0.0, (float) $field['suggested_weight'])
                    : 0.0;
                $fieldName = (string) ($field['field'] ?? $field['mapping'] ?? '');
                $fallbackWeight = $this->fallbackRelativeWeight($fieldName, $priority);

                return [
                    ...$field,
                    '_index' => $index,
                    '_priority_rank' => $priority,
                    '_relative_weight' => $useForMatching ? ($rawWeight > 0 ? $rawWeight : $fallbackWeight) : 0.0,
                    'use_for_matching' => $useForMatching,
                    'suggested_weight' => 0,
                ];
            })
            ->values();

        $active = $normalized
            ->filter(fn (array $field) => $field['use_for_matching'] === true)
            ->sortBy([
                ['_priority_rank', 'asc'],
                ['_relative_weight', 'desc'],
                ['_index', 'asc'],
            ])
            ->values();

        $relativeTotal = (float) $active->sum('_relative_weight');

        if ($active->isNotEmpty()) {
            $allocated = 0;
            $distribution = $active->map(function (array $field) use ($relativeTotal, &$allocated) {
                $exactWeight = $relativeTotal > 0
                    ? (($field['_relative_weight'] / $relativeTotal) * 100)
                    : 0.0;
                $baseWeight = (int) floor($exactWeight);
                $allocated += $baseWeight;

                return [
                    'index' => $field['_index'],
                    'base_weight' => $baseWeight,
                    'remainder' => $exactWeight - $baseWeight,
                    'priority_rank' => $field['_priority_rank'],
                    'relative_weight' => $field['_relative_weight'],
                ];
            })->sortBy([
                ['remainder', 'desc'],
                ['priority_rank', 'asc'],
                ['relative_weight', 'desc'],
                ['index', 'asc'],
            ])->values()->all();

            $remainderUnits = 100 - $allocated;

            for ($i = 0; $i < $remainderUnits; $i++) {
                if (! array_key_exists($i, $distribution)) {
                    break;
                }

                $distribution[$i]['base_weight']++;
            }

            $weightsByIndex = collect($distribution)
                ->keyBy('index')
                ->map(fn (array $item) => $item['base_weight']);

            $normalized = $normalized->map(function (array $field) use ($weightsByIndex) {
                $field['suggested_weight'] = (int) ($weightsByIndex[$field['_index']] ?? 0);

                unset(
                    $field['_index'],
                    $field['_priority_rank'],
                    $field['_relative_weight'],
                );

                return $field;
            });
        } else {
            $normalized = $normalized->map(function (array $field) {
                unset(
                    $field['_index'],
                    $field['_priority_rank'],
                    $field['_relative_weight'],
                );

                $field['suggested_weight'] = 0;

                return $field;
            });
        }

        return $normalized->values()->all();
    }

    private function priorityRank(mixed $priority): int
    {
        $normalized = Str::lower(trim((string) $priority));

        return match ($normalized) {
            'critical' => 0,
            'high' => 1,
            'medium' => 2,
            'low' => 3,
            default => 4,
        };
    }

    private function fallbackRelativeWeight(string $fieldName, int $priorityRank): float
    {
        $normalized = Str::lower($fieldName);
        $base = match (true) {
            Str::contains($normalized, ['npwp']) => 10.0,
            Str::contains($normalized, ['nib']) => 10.0,
            Str::contains($normalized, ['company id', 'company_id', 'identifier', 'kode', 'code', 'id']) => 9.5,
            Str::contains($normalized, ['entity', 'company', 'business', 'nama', 'name']) => 8.5,
            Str::contains($normalized, ['email', 'phone', 'telepon', 'telp', 'mobile', 'hp']) => 5.0,
            Str::contains($normalized, ['address', 'alamat', 'street', 'jalan']) => 4.0,
            Str::contains($normalized, ['province', 'provinsi', 'prov']) => 2.0,
            Str::contains($normalized, ['city', 'kota', 'kabupaten', 'kab']) => 2.0,
            default => 3.0,
        };

        return match ($priorityRank) {
            0 => $base * 1.15,
            1 => $base,
            2 => $base * 0.85,
            3 => $base * 0.7,
            default => $base * 0.6,
        };
    }
}
