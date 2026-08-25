<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingResult;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MatchingEnginePipelineTest extends TestCase
{
    use RefreshDatabase;

    public function test_phase1_automatic_normalization_normalizes_identifiers_and_text(): void
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['nik' => '3171.0123.4567.8901', 'full_name' => '  BUDI   SANTOSO  '],
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['nik' => '3171012345678901', 'full_name' => 'budi santoso'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Normalization Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-nik',
                    'referenceColumnName' => 'nik',
                    'inputColumnName' => 'nik',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 50,
                ],
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'full_name',
                    'inputColumnName' => 'full_name',
                    'algorithm' => 'Exact',
                    'required_match' => false,
                    'weight' => 50,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $result->result_type);
        $this->assertSame(100.0, (float) $result->overall_score);
    }

    public function test_phase2_mandatory_exact_match_bypasses_fuzzy_and_verification(): void
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['id_number' => 'ID-9999', 'name' => 'Alpha Bravo'],
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['id_number' => 'ID-9999', 'name' => 'Alpha Bravo Charlie'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Mandatory Phase Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-id',
                    'referenceColumnName' => 'id_number',
                    'inputColumnName' => 'id_number',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 50,
                ],
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Levenshtein',
                    'required_match' => false,
                    'weight' => 50,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $result->result_type);
        $this->assertSame(100.0, (float) $result->overall_score);
        $this->assertTrue($result->verification_evidence['is_exact_match']);
        $this->assertTrue($result->verification_evidence['bypassed_fuzzy']);
        $this->assertSame('Phase 2: Mandatory / Exact Phase', $result->verification_evidence['phase']);
        $this->assertStringContainsString('bypassed fuzzy scoring', $result->decision_reason);
    }

    public function test_phase2_mandatory_non_matching_falls_back_to_fuzzy_pool(): void
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['id_number' => 'ID-1111', 'name' => 'PT Makmur Jaya'],
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
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['id_number' => 'ID-2222', 'name' => 'Makmur Jaya PT'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Fuzzy Fallback Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-id',
                    'referenceColumnName' => 'id_number',
                    'inputColumnName' => 'id_number',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 20,
                ],
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Token Set Ratio',
                    'required_match' => false,
                    'weight' => 80,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 80, 'review' => 60, 'noMatch' => 50],
                'rules' => [
                    'verificationOrder' => [
                        [
                            'order' => 1,
                            'mappingId' => 'map-id',
                            'field' => 'id_number - id_number',
                            'method' => 'Normalized Exact',
                            'threshold' => 100, // Fails because ID-2222 !== ID-1111
                        ],
                    ],
                ],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.possible_match', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertFalse($result->verification_evidence['is_exact_match']);
        $this->assertFalse($result->verification_evidence['bypassed_fuzzy']);
        $this->assertSame('Phase 4: Ordered Partial Verification', $result->verification_evidence['phase']);
        $this->assertSame('possible_match', $result->result_type);
        $this->assertTrue($result->verification_evidence['downgraded']);
    }

    public function test_phase4_evaluates_all_guardrails_and_logs_full_diagnostic_evidence(): void
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
                ['name' => 'PT Gemilang Abadi', 'city' => 'Bandung', 'phone' => '0811223344'],
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
                ['name' => 'Gemilang Abadi PT', 'city' => 'Bandung', 'phone' => '0899999999'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Full Diagnostic Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-name',
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Token Set Ratio',
                    'weight' => 50,
                ],
                [
                    'id' => 'map-city',
                    'referenceColumnName' => 'city',
                    'inputColumnName' => 'city',
                    'algorithm' => 'Normalized Exact',
                    'weight' => 30,
                ],
                [
                    'id' => 'map-phone',
                    'referenceColumnName' => 'phone',
                    'inputColumnName' => 'phone',
                    'algorithm' => 'Exact',
                    'weight' => 20,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Fuzzy',
                'thresholds' => ['autoMatch' => 75, 'review' => 50, 'noMatch' => 40],
                'rules' => [
                    'verificationOrder' => [
                        [
                            'order' => 1,
                            'mappingId' => 'map-name',
                            'field' => 'name - name',
                            'method' => 'Token Set Ratio',
                            'threshold' => 90,
                        ],
                        [
                            'order' => 2,
                            'mappingId' => 'map-city',
                            'field' => 'city - city',
                            'method' => 'Normalized Exact',
                            'threshold' => 100,
                        ],
                        [
                            'order' => 3,
                            'mappingId' => 'map-phone',
                            'field' => 'phone - phone',
                            'method' => 'Exact',
                            'threshold' => 100,
                        ],
                    ],
                ],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.possible_match', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $evidence = $result->verification_evidence;

        $this->assertIsArray($evidence);
        $this->assertSame('Phase 4: Ordered Partial Verification', $evidence['phase']);
        $this->assertSame('matched', $evidence['initial_classification']);
        $this->assertSame('possible_match', $evidence['final_classification']);
        $this->assertTrue($evidence['downgraded']);
        $this->assertCount(3, $evidence['rules_evaluated']);

        // Check each rule in sequence
        $this->assertSame(1, $evidence['rules_evaluated'][0]['order']);
        $this->assertTrue($evidence['rules_evaluated'][0]['passed']); // Name passed

        $this->assertSame(2, $evidence['rules_evaluated'][1]['order']);
        $this->assertTrue($evidence['rules_evaluated'][1]['passed']); // City passed

        $this->assertSame(3, $evidence['rules_evaluated'][2]['order']);
        $this->assertFalse($evidence['rules_evaluated'][2]['passed']); // Phone failed

        $this->assertSame(3, $evidence['summary']['total_rules']);
        $this->assertSame(2, $evidence['summary']['passed_rules']);
        $this->assertSame(1, $evidence['summary']['failed_rules']);
        $this->assertFalse($evidence['summary']['all_passed']);
    }

    public function test_virtual_columns_are_extracted_and_evaluated(): void
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
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['company_name' => 'PT Sumber Makmur Jaya Tbk'],
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
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['company' => 'Sumber Makmur Jaya, PT'],
            ],
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Virtual Columns Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-core-name',
                    'referenceColumnId' => 'virtual-ref-core-name',
                    'inputColumnId' => 'virtual-inp-core-name',
                    'referenceColumnName' => '[Generated] Nama Inti',
                    'inputColumnName' => '[Generated] Nama Inti',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 50,
                    'metadata' => [
                        'transform' => 'EXTRACT_CORE_NAME',
                        'parent_reference_column' => 'company_name',
                        'parent_input_column' => 'company',
                    ],
                ],
                [
                    'id' => 'map-legal-form',
                    'referenceColumnId' => 'virtual-ref-legal-form',
                    'inputColumnId' => 'virtual-inp-legal-form',
                    'referenceColumnName' => '[Generated] Badan Usaha',
                    'inputColumnName' => '[Generated] Badan Usaha',
                    'algorithm' => 'Exact',
                    'required_match' => true,
                    'weight' => 50,
                    'metadata' => [
                        'transform' => 'EXTRACT_LEGAL_FORM',
                        'parent_reference_column' => 'company_name',
                        'parent_input_column' => 'company',
                    ],
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $result->result_type);
        $this->assertSame(100.0, (float) $result->overall_score);
    }
}
