<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\Workspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiMatchingConfigurationTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_handles_global_ai_matching_configuration_request(): void
    {
        $ref = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 5,
            'column_count' => 2,
            'parse_status' => 'inspected',
        ]);
        $inp = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 5,
            'column_count' => 2,
            'parse_status' => 'inspected',
        ]);

        $job = MatchingJob::create([
            'reference_dataset_id' => $ref->id,
            'input_dataset_id' => $inp->id,
            'name' => 'Test Job',
            'status' => 'created',
        ]);

        $workspace = Workspace::create([
            'name' => 'Test Workspace',
            'user_id' => auth()->id(),
            'matching_job_id' => $job->id,
            'reference_dataset_id' => $ref->id,
            'input_dataset_id' => $inp->id,
            'status' => 'ready',
        ]);
        $job->update(['workspace_id' => $workspace->id]);

        $response = $this->getJson("/api/matching-jobs/{$job->id}/ai-matching-configuration?locale=id");
        $response->assertOk();
    }

    public function test_it_handles_partial_draft_mappings_post_request(): void
    {
        $ref = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 5,
            'column_count' => 2,
            'parse_status' => 'inspected',
        ]);
        $inp = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 5,
            'column_count' => 2,
            'parse_status' => 'inspected',
        ]);

        $job = MatchingJob::create([
            'reference_dataset_id' => $ref->id,
            'input_dataset_id' => $inp->id,
            'name' => 'Test Job',
            'status' => 'created',
        ]);

        $workspace = Workspace::create([
            'name' => 'Test Workspace',
            'user_id' => auth()->id(),
            'matching_job_id' => $job->id,
            'reference_dataset_id' => $ref->id,
            'input_dataset_id' => $inp->id,
            'status' => 'ready',
        ]);
        $job->update(['workspace_id' => $workspace->id]);

        $response = $this->postJson("/api/matching-jobs/{$job->id}/ai-matching-configuration", [
            'locale' => 'id',
            'mappings' => [
                [
                    'mapping_id' => 'm1',
                    'reference_column' => 'nama_perusahaan',
                    'input_column' => 'nama_pt',
                    'data_type' => 'text',
                    'strict' => false,
                ],
            ],
        ]);
        $response->assertOk();
    }
}
