<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
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

        $response = $this->postJson('/api/matching-jobs/run', [
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
        $this->assertSame('Numeric sequence mismatch requires review', $result->decision_reason);
    }

    public function test_multi_candidate_generation_counts_distinct_input_rows_in_summary(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'column_count' => 1,
            'row_count' => 5,
            'preview_rows' => [
                ['name' => 'PT Maju Bersama Jaya'],
                ['name' => 'PT Maju Bersama Sejahtera'],
                ['name' => 'PT Maju Bersama Makmur'],
                ['name' => 'PT Indah Permai'],
                ['name' => 'PT Sumber Rezeki'],
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
            'column_count' => 1,
            'row_count' => 2,
            'preview_rows' => [
                ['name' => 'PT Maju Bersama'], // Generates 3 candidates (topN=3), all possible_match (~80-85%)
                ['name' => 'PT Sumber Rezeki'], // Generates 1 candidate, matched (100%)
            ],
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Distinct Count Test Job',
            'mappings' => [[
                'referenceColumnName' => 'name',
                'inputColumnName' => 'name',
                'algorithm' => 'Jaro-Winkler',
                'weight' => 100,
            ]],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Fuzzy',
                'thresholds' => ['autoMatch' => 95, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 3],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 1],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1)
            ->assertJsonPath('data.summary.possible_match', 1)
            ->assertJsonPath('data.summary.unmatched', 0)
            ->assertJsonPath('data.progress.total', 2);

        // Verify total candidates in database is 4 (3 for input 1 + 1 for input 2)
        $jobId = $response->json('data.job.id');
        $job = MatchingJob::findOrFail($jobId);
        $this->assertSame(4, $job->results()->count());

        // Verify distinct counts method
        $distinctCounts = $job->calculateDistinctRecordCounts();
        $this->assertSame(1, $distinctCounts['matched']);
        $this->assertSame(1, $distinctCounts['possible_match']);
        $this->assertSame(0, $distinctCounts['unmatched']);
        $this->assertSame(4, $distinctCounts['candidates_scored']);
        $this->assertSame(2, $distinctCounts['matched'] + $distinctCounts['possible_match'] + $distinctCounts['unmatched']);
    }

    public function test_matching_engine_resolves_synthetic_generated_columns_without_crash(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'column_count' => 1,
            'row_count' => 1,
            'preview_rows' => [
                ['nama_perusahaan' => 'PT Sumber Makmur Sejahtera'],
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
            'column_count' => 1,
            'row_count' => 1,
            'preview_rows' => [
                ['company_name' => 'PT Sumber Makmur Sejahtera'],
            ],
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Synthetic Columns Test',
            'mappings' => [
                [
                    'referenceColumnName' => '[Generated] Nama Inti',
                    'inputColumnName' => '[Generated] Nama Inti',
                    'algorithm' => 'Jaro-Winkler',
                    'weight' => 70,
                    'metadata' => [
                        'transform' => 'EXTRACT_CORE_NAME',
                        'parent_reference_column' => 'nama_perusahaan',
                        'parent_input_column' => 'company_name',
                    ],
                ],
                [
                    'referenceColumnName' => '[Generated] Badan Usaha',
                    'inputColumnName' => '[Generated] Badan Usaha',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 30,
                    'metadata' => [
                        'transform' => 'EXTRACT_LEGAL_FORM',
                        'parent_reference_column' => 'nama_perusahaan',
                        'parent_input_column' => 'company_name',
                    ],
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 1],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed')
            ->assertJsonPath('data.summary.matched', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $result->result_type);
    }

    public function test_mandatory_composite_key_with_empty_value_gracefully_drops_to_fuzzy(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'column_count' => 2,
            'row_count' => 1,
            'preview_rows' => [
                ['npwp' => '1234567890', 'name' => 'PT Makmur Sentosa'],
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
            'column_count' => 2,
            'row_count' => 1,
            'preview_rows' => [
                ['npwp' => '', 'name' => 'Makmur Sentosa'], // Empty NPWP drops out of Phase 2 into Phase 3
            ],
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Null-Safe Mandatory Test',
            'mappings' => [
                [
                    'referenceColumnName' => 'npwp',
                    'inputColumnName' => 'npwp',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 50,
                ],
                [
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Jaro-Winkler',
                    'weight' => 50,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 1],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed');
    }

    public function test_matching_engine_resolves_synthetic_columns_with_custom_parent_columns(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref_custom',
            'original_filename' => 'ref_custom.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref_custom.csv',
            'column_count' => 1,
            'row_count' => 1,
            'preview_rows' => [
                ['nm_perusahaan_raw' => 'PT Nusantara Sejahtera Abadi'],
            ],
        ]);

        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp_custom',
            'original_filename' => 'inp_custom.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp_custom.csv',
            'column_count' => 1,
            'row_count' => 1,
            'preview_rows' => [
                ['nama_bu_custom' => 'PT Nusantara Sejahtera Abadi'],
            ],
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Parent Column Binding Test',
            'mappings' => [
                [
                    'referenceColumnName' => '[Generated] Nama Inti',
                    'inputColumnName' => '[Generated] Nama Inti',
                    'parent_reference_column' => 'nm_perusahaan_raw',
                    'parent_input_column' => 'nama_bu_custom',
                    'transform' => 'EXTRACT_CORE_NAME',
                    'algorithm' => 'Jaro-Winkler',
                    'weight' => 60,
                ],
                [
                    'referenceColumnName' => '[Generated] Badan Usaha',
                    'inputColumnName' => '[Generated] Badan Usaha',
                    'parent_reference_column' => 'nm_perusahaan_raw',
                    'parent_input_column' => 'nama_bu_custom',
                    'transform' => 'EXTRACT_LEGAL_FORM',
                    'algorithm' => 'Normalized Exact',
                    'required_match' => true,
                    'weight' => 40,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 1],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed')
            ->assertJsonPath('data.summary.matched', 1);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $this->assertSame('matched', $result->result_type);
    }

    public function test_matching_engine_dynamically_streams_full_physical_files_exceeding_preview_rows(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');

        // Create reference CSV with 150 rows in storage
        $refCsv = "id,name,city\n";
        for ($i = 1; $i <= 150; $i++) {
            $refCsv .= "{$i},PT Perusahaan {$i},Jakarta\n";
        }
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/test_ref_full.csv', $refCsv);

        // Create input CSV with 150 rows in storage
        $inpCsv = "id,company,region\n";
        for ($i = 1; $i <= 150; $i++) {
            $inpCsv .= "{$i},PT Perusahaan {$i},Jakarta\n";
        }
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/test_inp_full.csv', $inpCsv);

        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref_full',
            'original_filename' => 'ref_full.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => strlen($refCsv),
            'storage_path' => 'datasets/test_ref_full.csv',
            'column_count' => 3,
            'row_count' => 150,
            'preview_rows' => [
                ['id' => '1', 'name' => 'PT Perusahaan 1', 'city' => 'Jakarta'],
            ], // Only 1 sample row in preview
        ]);

        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp_full',
            'original_filename' => 'inp_full.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => strlen($inpCsv),
            'storage_path' => 'datasets/test_inp_full.csv',
            'column_count' => 3,
            'row_count' => 150,
            'preview_rows' => [
                ['id' => '1', 'company' => 'PT Perusahaan 1', 'region' => 'Jakarta'],
            ], // Only 1 sample row in preview
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Full Streaming Test',
            'mappings' => [
                [
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'company',
                    'algorithm' => 'Normalized Exact',
                    'weight' => 70,
                ],
                [
                    'referenceColumnName' => 'city',
                    'inputColumnName' => 'region',
                    'algorithm' => 'Normalized Exact',
                    'weight' => 30,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 50, 'workerCount' => 2],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed')
            ->assertJsonPath('data.job.total_count', 150)
            ->assertJsonPath('data.job.processed_count', 150)
            ->assertJsonPath('data.summary.matched', 150);

        $this->assertSame(150, MatchingResult::where('matching_job_id', $response->json('data.job.id'))->count());
    }

    public function test_matching_engine_executes_entire_large_dataset_without_row_capping(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');

        $rowCount = 500;
        $refCsv = "id,nama_perusahaan\n";
        for ($i = 1; $i <= $rowCount; $i++) {
            $refCsv .= "{$i},PT Maju Bersama {$i}\n";
        }
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/ref_large.csv', $refCsv);

        $inpCsv = "id,nama_vendor\n";
        for ($i = 1; $i <= $rowCount; $i++) {
            $inpCsv .= "{$i},PT Maju Bersama {$i}\n";
        }
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/inp_large.csv', $inpCsv);

        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref_large',
            'original_filename' => 'ref_large.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => strlen($refCsv),
            'storage_path' => 'datasets/ref_large.csv',
            'column_count' => 2,
            'row_count' => $rowCount,
            'preview_rows' => [
                ['id' => '1', 'nama_perusahaan' => 'PT Maju Bersama 1'],
            ],
        ]);

        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp_large',
            'original_filename' => 'inp_large.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => strlen($inpCsv),
            'storage_path' => 'datasets/inp_large.csv',
            'column_count' => 2,
            'row_count' => $rowCount,
            'preview_rows' => [
                ['id' => '1', 'nama_vendor' => 'PT Maju Bersama 1'],
            ],
        ]);

        $response = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => '500 Rows Matching Job',
            'mappings' => [
                [
                    'referenceColumnName' => 'nama_perusahaan',
                    'inputColumnName' => 'nama_vendor',
                    'algorithm' => 'Normalized Exact',
                    'weight' => 100,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Default'],
                'runOptions' => ['chunkSize' => 100, 'workerCount' => 2],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.job.status', 'completed')
            ->assertJsonPath('data.job.total_count', $rowCount)
            ->assertJsonPath('data.job.processed_count', $rowCount)
            ->assertJsonPath('data.summary.matched', $rowCount);

        $jobId = $response->json('data.job.id');
        $this->assertSame($rowCount, MatchingResult::where('matching_job_id', $jobId)->count());
    }
}
