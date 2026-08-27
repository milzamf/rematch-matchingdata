<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class IndexReuseTest extends TestCase
{
    use RefreshDatabase;

    public function test_index_is_reused()
    {
        \Illuminate\Support\Facades\Storage::fake('local');

        $refCsv = "id,nama_perusahaan\n1,PT Maju\n";
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/ref.csv', $refCsv);
        $inpCsv = "id,nama_vendor\n1,PT Maju\n";
        \Illuminate\Support\Facades\Storage::disk('local')->put('datasets/inp.csv', $inpCsv);

        $reference = Dataset::create([
            'dataset_role' => 'reference', 'name' => 'ref', 'original_filename' => 'ref.csv',
            'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => strlen($refCsv),
            'storage_path' => 'datasets/ref.csv', 'column_count' => 2, 'row_count' => 1,
            'preview_rows' => [['id' => '1', 'nama_perusahaan' => 'PT Maju']],
        ]);
        $input = Dataset::create([
            'dataset_role' => 'input', 'name' => 'inp', 'original_filename' => 'inp.csv',
            'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => strlen($inpCsv),
            'storage_path' => 'datasets/inp.csv', 'column_count' => 2, 'row_count' => 1,
            'preview_rows' => [['id' => '1', 'nama_vendor' => 'PT Maju']],
        ]);

        $workspace = \App\Models\Workspace::create(['name' => 'Test WS']);
        $job = MatchingJob::create([
            'workspace_id' => $workspace->id, 'name' => 'Test Job',
            'reference_dataset_id' => $reference->id, 'input_dataset_id' => $input->id,
            'status' => 'pending', 'total_count' => 1,
        ]);
        
        \App\Models\ColumnMapping::create([
            'matching_job_id' => $job->id,
            'reference_column_name' => 'nama_perusahaan',
            'input_column_name' => 'nama_vendor',
            'is_mandatory' => true,
        ]);
        
        \App\Models\MatchingConfiguration::create([
            'matching_job_id' => $job->id,
            'configuration' => ['runOptions' => ['chunkSize' => 500, 'workerCount' => 1], 'candidateGeneration' => ['topN' => 3]],
        ]);

        $this->postJson('/api/matching-jobs/' . $job->id . '/run');
        
        $job->update(['status' => 'pending']);
        $this->postJson('/api/matching-jobs/' . $job->id . '/run');
    }
}
