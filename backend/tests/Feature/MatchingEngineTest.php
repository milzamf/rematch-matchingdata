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
}
