<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\DatasetColumn;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\User;
use App\Services\Matching\MatchingCheckpointManager;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class MatchingCheckpointTest extends TestCase
{
    use RefreshDatabase;

    private User $user;
    private MatchingCheckpointManager $checkpointManager;
    private string $testSqlitePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create([
            'role' => 'operator',
        ]);

        $this->testSqlitePath = storage_path('app/test_checkpoints_' . Str::random(8) . '.sqlite');
        $this->checkpointManager = new MatchingCheckpointManager($this->testSqlitePath);
    }

    protected function tearDown(): void
    {
        if (file_exists($this->testSqlitePath)) {
            @unlink($this->testSqlitePath);
        }
        $wal = $this->testSqlitePath . '-wal';
        if (file_exists($wal)) {
            @unlink($wal);
        }
        $shm = $this->testSqlitePath . '-shm';
        if (file_exists($shm)) {
            @unlink($shm);
        }

        parent::tearDown();
    }

    public function test_checkpoint_lifecycle_save_restore_and_complete(): void
    {
        $key = 'test_chk_' . Str::random(10);
        $jobId1 = (string) Str::uuid();

        $this->assertFalse($this->checkpointManager->hasIncompleteCheckpoint($key));

        // Save chunk 0
        $batchResultsChunk0 = [
            [
                'id' => (string) Str::uuid(),
                'matching_job_id' => $jobId1,
                'input_record_key' => '1',
                'reference_record_key' => '101',
                'result_type' => 'matched',
                'overall_score' => 100.0,
                'candidate_rank' => 1,
                'field_scores' => '[]',
                'candidate_metadata' => '[]',
                'decision_reason' => 'Exact',
                'created_at' => now()->toISOString(),
                'updated_at' => now()->toISOString(),
            ],
        ];

        $this->checkpointManager->saveChunk(
            $key,
            $jobId1,
            null,
            0,
            1,
            2,
            ['matched' => 1, 'possible_match' => 0, 'unmatched' => 0, 'candidates_scored' => 1],
            $batchResultsChunk0
        );

        $this->assertTrue($this->checkpointManager->hasIncompleteCheckpoint($key));

        $checkpoint = $this->checkpointManager->getCheckpoint($key);
        $this->assertNotNull($checkpoint);
        $this->assertEquals(0, $checkpoint['last_chunk_index']);
        $this->assertEquals(1, $checkpoint['processed_count']);
        $this->assertEquals(2, $checkpoint['total_count']);
        $this->assertEquals(1, $checkpoint['summary']['matched']);

        // Now simulate resuming into a NEW job ID (e.g. rerun/restart after docker reboot)
        $refDataset = Dataset::create([
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
        ]);
        $inpDataset = Dataset::create([
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
        ]);

        $newJob = MatchingJob::create([
            'id' => (string) Str::uuid(),
            'name' => 'Resumed Job',
            'status' => 'processing',
            'processed_count' => 0,
            'total_count' => 2,
            'reference_dataset_id' => $refDataset->id,
            'input_dataset_id' => $inpDataset->id,
        ]);

        $restored = $this->checkpointManager->restoreResultsForJob($key, $newJob->id);
        $this->assertTrue($restored['restored']);
        $this->assertEquals(1, $restored['processed_count']);
        $this->assertEquals(0, $restored['last_chunk_index']);
        $this->assertEquals(1, $restored['restored_records_count']);

        // Verify MySQL has the restored record with the new job ID
        $this->assertDatabaseHas('matching_results', [
            'matching_job_id' => $newJob->id,
            'input_record_key' => '1',
            'result_type' => 'matched',
        ]);

        // Complete job
        $this->checkpointManager->markCompleted($key);
        $this->assertFalse($this->checkpointManager->hasIncompleteCheckpoint($key));

        $completedCheckpoint = $this->checkpointManager->getCheckpoint($key);
        $this->assertEquals('completed', $completedCheckpoint['status']);
    }

    public function test_clear_checkpoint(): void
    {
        $key = 'test_clear_' . Str::random(10);
        $jobId = (string) Str::uuid();

        $this->checkpointManager->saveChunk($key, $jobId, null, 0, 10, 100, [], []);
        $this->assertTrue($this->checkpointManager->hasIncompleteCheckpoint($key));

        $this->checkpointManager->clearCheckpoint($key);
        $this->assertFalse($this->checkpointManager->hasIncompleteCheckpoint($key));
        $this->assertNull($this->checkpointManager->getCheckpoint($key));
    }

    public function test_restoration_does_not_conflict_with_previously_inserted_job_results(): void
    {
        $key = 'test_conflict_' . Str::random(10);
        $jobId1 = (string) Str::uuid();
        $jobId2 = (string) Str::uuid();

        $refDataset = Dataset::create([
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
        ]);
        $inpDataset = Dataset::create([
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
        ]);

        $job1 = MatchingJob::create([
            'name' => 'Job 1 Interrupted',
            'status' => 'cancelled',
            'processed_count' => 1,
            'total_count' => 2,
            'reference_dataset_id' => $refDataset->id,
            'input_dataset_id' => $inpDataset->id,
        ]);

        $job2 = MatchingJob::create([
            'name' => 'Job 2 Resumed',
            'status' => 'processing',
            'processed_count' => 0,
            'total_count' => 2,
            'reference_dataset_id' => $refDataset->id,
            'input_dataset_id' => $inpDataset->id,
        ]);

        $sharedResultId = (string) Str::uuid();
        $batchResults = [
            [
                'id' => $sharedResultId,
                'matching_job_id' => $job1->id,
                'input_record_key' => '1',
                'reference_record_key' => '101',
                'result_type' => 'matched',
                'overall_score' => 98.5,
                'candidate_rank' => 1,
                'field_scores' => '[]',
                'candidate_metadata' => '[]',
                'decision_reason' => 'Exact',
                'created_at' => now()->toISOString(),
                'updated_at' => now()->toISOString(),
            ],
        ];

        // Job 1 actually inserted its result into MySQL before being interrupted
        MatchingResult::insert($batchResults);
        $this->assertDatabaseHas('matching_results', [
            'id' => $sharedResultId,
            'matching_job_id' => $job1->id,
        ]);

        // Save chunk into SQLite checkpoint
        $this->checkpointManager->saveChunk($key, $job1->id, null, 0, 1, 2, ['matched' => 1], $batchResults);

        // Now Job 2 restores from the SQLite checkpoint.
        // It must NOT fail with a duplicate primary key error for $sharedResultId!
        $restored = $this->checkpointManager->restoreResultsForJob($key, $job2->id);
        $this->assertTrue($restored['restored']);
        $this->assertEquals(1, $restored['processed_count']);
        $this->assertEquals(1, $restored['restored_records_count']);

        // Both jobs have their result in MySQL with distinct IDs
        $this->assertDatabaseHas('matching_results', [
            'matching_job_id' => $job1->id,
            'id' => $sharedResultId,
        ]);
        $this->assertDatabaseHas('matching_results', [
            'matching_job_id' => $job2->id,
            'input_record_key' => '1',
        ]);
        $this->assertEquals(2, MatchingResult::count());
    }

    public function test_saving_chunk_upserts_without_duplicate_chunk_entries(): void
    {
        $key = 'test_upsert_' . Str::random(10);
        $jobId = (string) Str::uuid();

        // Save chunk 0 first time
        $this->checkpointManager->saveChunk($key, $jobId, null, 0, 25, 100, ['matched' => 10], []);

        // Save chunk 0 second time (simulating chunk re-write or retry)
        $this->checkpointManager->saveChunk($key, $jobId, null, 0, 25, 100, ['matched' => 12], []);

        // Check SQLite directly to verify only 1 chunk record exists for chunk_index 0
        $pdo = $this->checkpointManager->getPdo();
        $stmt = $pdo->prepare('SELECT COUNT(*) as cnt FROM matching_checkpoint_chunks WHERE checkpoint_key = :k AND chunk_index = 0');
        $stmt->execute([':k' => $key]);
        $row = $stmt->fetch();
        $this->assertEquals(1, (int) $row['cnt']);
    }

    public function test_generate_checkpoint_key_consistency_with_metadata(): void
    {
        $refId = (string) Str::uuid();
        $inpId = (string) Str::uuid();
        $config = ['preset' => 'Default', 'strategy' => 'Hybrid'];

        $mappingsDirect = [
            [
                'reference_column_name' => 'nama_perusahaan',
                'input_column_name' => 'nama_perusahaan',
                'algorithm' => 'Fuzzy',
                'required_match' => false,
                'parent_reference_column' => 'nama',
                'parent_input_column' => 'nama',
                'transform' => 'EXTRACT_CORE_NAME',
            ],
        ];

        $mappingsInMetadata = [
            [
                'reference_column_name' => 'nama_perusahaan',
                'input_column_name' => 'nama_perusahaan',
                'algorithm' => 'Fuzzy',
                'required_match' => false,
                'metadata' => [
                    'parent_reference_column' => 'nama',
                    'parent_input_column' => 'nama',
                    'transform' => 'EXTRACT_CORE_NAME',
                ],
            ],
        ];

        $keyDirect = $this->checkpointManager->generateCheckpointKey($refId, $inpId, $mappingsDirect, $config);
        $keyMeta = $this->checkpointManager->generateCheckpointKey($refId, $inpId, $mappingsInMetadata, $config);

        $this->assertEquals($keyDirect, $keyMeta);
    }
}
