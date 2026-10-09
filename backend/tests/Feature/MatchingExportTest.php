<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MatchingExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_streamed_export_master_update(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Export Smoke',
            'status' => 'completed',
            'processed_count' => 2,
            'total_count' => 2,
        ]);

        $job->results()->create([
            'input_record_key' => '1',
            'reference_record_key' => 'REF-1',
            'result_type' => 'matched',
            'overall_score' => 99.0,
            'candidate_rank' => 1,
            'candidate_metadata' => [
                'input_record' => ['name' => 'PT Sumber Makmur', 'city' => 'Jakarta'],
                'reference_record' => ['name' => 'PT SUMBER MAKMUR', 'city' => 'JAKARTA PUSAT'],
            ],
        ]);

        $job->results()->create([
            'input_record_key' => '2',
            'reference_record_key' => null,
            'result_type' => 'unmatched',
            'overall_score' => 0.0,
            'candidate_rank' => 1,
            'candidate_metadata' => [
                'input_record' => ['name' => 'Toko Baru', 'city' => 'Surabaya'],
                'reference_record' => [],
            ],
        ]);

        $response = $this->get("/api/matching-jobs/{$job->id}/export?preset=master_update&auto_enrich=1");
        $response->assertOk();
        $this->assertStringContainsString('text/csv', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment; filename=', (string) $response->headers->get('Content-Disposition'));

        $content = $response->streamedContent();
        $this->assertStringContainsString('input_record_key,match_status,reference_record_key', $content);
        $this->assertStringContainsString('1,MATCHED,REF-1', $content);
        $this->assertStringContainsString('2,NEW_ENTITY', $content);
        $this->assertStringContainsString('PT SUMBER MAKMUR', $content);
    }

    public function test_streamed_export_full_audit(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Export Audit',
            'status' => 'completed',
            'processed_count' => 1,
            'total_count' => 1,
        ]);

        $job->results()->create([
            'input_record_key' => '10',
            'reference_record_key' => 'REF-10',
            'result_type' => 'possible_match',
            'overall_score' => 78.5,
            'candidate_rank' => 1,
            'candidate_metadata' => [
                'input_record' => ['name' => 'CV Maju Jaya'],
                'reference_record' => ['name' => 'PT Maju Jaya'],
            ],
            'decision_reason' => 'Score 78.5 needs review',
        ]);

        $response = $this->get("/api/matching-jobs/{$job->id}/export?preset=full_audit");
        $response->assertOk();
        $content = $response->streamedContent();
        $this->assertStringContainsString('input_record_key,match_status,matching_score,reference_record_key', $content);
        $this->assertStringContainsString('10,NEED_REVIEW,78.5,REF-10', $content);
    }

    private function dataset(string $role): Dataset
    {
        return Dataset::create([
            'dataset_role' => $role,
            'name' => "{$role} dataset",
            'original_filename' => "{$role}.csv",
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 1024,
            'storage_path' => "datasets/{$role}.csv",
            'header_row' => 1,
            'row_count' => 1,
            'column_count' => 1,
            'parse_status' => 'completed',
        ]);
    }
}
