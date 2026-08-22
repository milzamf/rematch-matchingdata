<?php

namespace Tests\Feature;

use App\Models\Dataset;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MatchingEngineTest extends TestCase
{
    use RefreshDatabase;

    public function test_matching_engine_runs_with_configured_mapping(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'reference',
            'original_filename' => 'reference.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/reference.csv',
            'row_count' => 2,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['customer_id' => 'C001', 'name' => 'PT Satu Data'],
                ['customer_id' => 'C002', 'name' => 'Dua Digital'],
            ],
        ]);
        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'input',
            'original_filename' => 'input.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/input.csv',
            'row_count' => 2,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['customer_id' => 'C001', 'name' => 'Satu Data'],
                ['customer_id' => 'C099', 'name' => 'Tidak Cocok'],
            ],
        ]);

        $referenceId = $reference->columns()->create([
            'name' => 'customer_id',
            'normalized_name' => 'customer_id',
            'data_type' => 'text',
            'position' => 1,
        ]);
        $inputId = $input->columns()->create([
            'name' => 'customer_id',
            'normalized_name' => 'customer_id',
            'data_type' => 'text',
            'position' => 1,
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Smoke Match',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [[
                'id' => 'map-customer-id',
                'referenceColumnId' => $referenceId->id,
                'inputColumnId' => $inputId->id,
                'referenceColumnName' => 'customer_id',
                'inputColumnName' => 'customer_id',
                'algorithm' => 'Normalized Exact',
            ]],
            'configuration' => [
                'preset' => 'Balanced',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 75, 'noMatch' => 60],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Identifier Strict'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 2],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed')
            ->assertJsonPath('data.progress.processed', 2)
            ->assertJsonPath('data.summary.matched', 1);

        $this->assertDatabaseHas('matching_jobs', [
            'name' => 'Smoke Match',
            'status' => 'completed',
            'processed_count' => 2,
        ]);
        $this->assertDatabaseHas('matching_results', [
            'input_record_key' => '1',
            'reference_record_key' => '1',
            'result_type' => 'matched',
        ]);
    }

    public function test_mandatory_exact_match_bypasses_fuzzy_and_verification(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 2,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['nib' => '1234567890', 'name' => 'PT Maju Bersama'],
                ['nib' => '9876543210', 'name' => 'CV Sukses Mandiri'],
            ],
        ]);
        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 2,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['nib' => '1234-5678-90', 'name' => 'Maju Bersama'], // Exact on NIB (normalized)
                ['nib' => '1111-2222-33', 'name' => 'Sukses Mandiri'], // Non-matching NIB, drops to fuzzy
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Mandatory Match Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-nib',
                    'referenceColumnName' => 'nib',
                    'inputColumnName' => 'nib',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 50,
                ],
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Token Set Ratio',
                    'required_match' => false,
                    'weight' => 50,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 75, 'noMatch' => 60],
                'candidateGeneration' => ['topN' => 1],
                'rules' => [
                    'verificationOrder' => [
                        [
                            'order' => 1,
                            'mappingId' => 'map-nib',
                            'field' => 'nib ↔ nib',
                            'method' => 'Normalized Exact',
                            'threshold' => 100,
                        ],
                    ],
                ],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1);

        $exactResult = \App\Models\MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $exactResult->result_type);
        $this->assertSame(100.0, (float) $exactResult->overall_score);
        $this->assertTrue($exactResult->verification_evidence['is_exact_match']);
        $this->assertTrue($exactResult->verification_evidence['bypassed_fuzzy']);
        $this->assertSame('Phase 2: Mandatory / Exact Phase', $exactResult->verification_evidence['phase']);
    }

    public function test_ordered_verification_guardrails_evaluates_all_rules_and_downgrades_on_failure(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 1,
            'column_count' => 3,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Sumber Makmur Sentosa', 'city' => 'Jakarta Selatan', 'phone' => '08123456789'],
            ],
        ]);
        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 1,
            'column_count' => 3,
            'parse_status' => 'inspected',
            'preview_rows' => [
                // Name matches strongly (~100% token set), city differs (Surabaya vs Jakarta Selatan)
                ['name' => 'Sumber Makmur Sentosa PT', 'city' => 'Surabaya', 'phone' => '08123456789'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Guardrails Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Token Set Ratio',
                    'weight' => 80,
                ],
                [
                    'id' => 'map-city',
                    'referenceColumnName' => 'city',
                    'inputColumnName' => 'city',
                    'algorithm' => 'Jaro-Winkler',
                    'weight' => 20,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Fuzzy',
                'thresholds' => ['autoMatch' => 80, 'review' => 60, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'rules' => [
                    'verificationOrder' => [
                        [
                            'order' => 1,
                            'mappingId' => 'map-name',
                            'field' => 'name ↔ name',
                            'method' => 'Token Set Ratio',
                            'threshold' => 90, // Passed
                        ],
                        [
                            'order' => 2,
                            'mappingId' => 'map-city',
                            'field' => 'city ↔ city',
                            'method' => 'Normalized Exact',
                            'threshold' => 100, // Failed: Surabaya !== Jakarta Selatan
                        ],
                    ],
                ],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.possible_match', 1);

        $result = \App\Models\MatchingResult::where('input_record_key', '1')->firstOrFail();
        // Initial score was > 80 (Auto-match), but downgraded to possible_match due to Rule 2 failure
        $this->assertSame('possible_match', $result->result_type);
        $this->assertTrue($result->verification_evidence['downgraded']);
        $this->assertSame('matched', $result->verification_evidence['initial_classification']);
        $this->assertSame('possible_match', $result->verification_evidence['final_classification']);

        // Check that ALL rules were evaluated (No short-circuit)
        $rulesEvaluated = $result->verification_evidence['rules_evaluated'];
        $this->assertCount(2, $rulesEvaluated);
        $this->assertTrue($rulesEvaluated[0]['passed']);
        $this->assertFalse($rulesEvaluated[1]['passed']);
        $this->assertStringContainsString('downgraded to needs_review', $result->decision_reason);
    }
}
