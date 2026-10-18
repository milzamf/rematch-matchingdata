<?php

namespace Tests\Unit;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Services\Matching\MatchingEngineService;
use App\Services\Matching\MatchingCheckpointManager;
use App\Services\Matching\MatchingRecordSnapshots;
use App\Services\Matching\MatchingRowStore;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class MatchingSnapshotIntegrationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        Schema::create('matching_results', function (Blueprint $table) {
            $table->uuid('id')->primary(); $table->uuid('matching_job_id');
            $table->string('input_record_key'); $table->string('reference_record_key')->nullable();
            $table->integer('candidate_rank'); $table->json('candidate_metadata');
            $table->json('field_scores')->nullable(); $table->json('verification_evidence')->nullable();
            $table->timestamps();
        });
        (require database_path('migrations/2026_10_19_000001_create_matching_record_snapshots.php'))->up();
    }

    private function makeResult(string $input, int $rank, array $meta, string $job = 'fixture'): MatchingResult
    {
        $id = (string) Str::uuid();
        DB::table('matching_results')->insert(['id' => $id, 'matching_job_id' => $job, 'input_record_key' => $input,
            'candidate_rank' => $rank, 'candidate_metadata' => json_encode($meta, JSON_THROW_ON_ERROR)]);
        return MatchingResult::findOrFail($id);
    }

    public function test_batch_hydration_preserves_keys_without_n_plus_one_or_source_mutation(): void
    {
        $source = ['nama' => 'Nama asli', 'kode' => '001', 'unmapped' => 'Utuh'];
        $id = MatchingRecordSnapshots::store($source);
        $this->assertSame($id, MatchingRecordSnapshots::store($source)); MatchingRecordSnapshots::flush();
        foreach (['001', '1', 'two'] as $key) {
            $this->makeResult($key, 1, ['input_record' => ['kode' => $key], '_reference_snapshot' => $id]);
            $this->makeResult($key, 2, ['_input_primary' => $key, '_reference_snapshot' => $id, '_reference_generated' => ['[Generated] Nama' => 'nama']]);
        }
        $results = MatchingResult::where('candidate_rank', 2)->get();
        DB::enableQueryLog(); DB::flushQueryLog();
        MatchingResult::preloadSnapshots($results);
        foreach ($results as $result) {
            $meta = $result->candidate_metadata;
            $this->assertSame($result->input_record_key, $meta['input_record']['kode']);
            $this->assertSame('nama', $meta['reference_record']['[Generated] Nama']);
            $this->assertSame('Utuh', $meta['reference_record']['unmapped']);
            $this->assertNull($result->verification_evidence);
            $this->assertNull($result->field_scores);
        }
        $this->assertCount(2, DB::getQueryLog()); DB::disableQueryLog();
        $this->assertSame($source, MatchingRecordSnapshots::load($id));
        $this->assertSame(1, DB::table('matching_record_snapshots')->count());
    }

    public function test_hydration_cannot_reuse_a_row_after_transaction_rollback(): void
    {
        DB::beginTransaction();
        $id = MatchingRecordSnapshots::store(['name' => 'Rolled back']); MatchingRecordSnapshots::flush();
        $this->assertSame('Rolled back', MatchingRecordSnapshots::load($id)['name']);
        DB::rollBack();
        $this->expectExceptionMessage('Immutable reference snapshot is unavailable.');
        MatchingRecordSnapshots::load($id);
    }

    public function test_snapshot_is_read_from_the_models_own_connection(): void
    {
        $id = MatchingRecordSnapshots::store(['name' => 'Connection A']); MatchingRecordSnapshots::flush();
        MatchingRecordSnapshots::load($id);
        config(['database.connections.snapshot_fixture' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]);
        $other = DB::connection('snapshot_fixture');
        $other->getSchemaBuilder()->create('matching_record_snapshots', fn (Blueprint $t) => [$t->char('id', 64)->primary(), $t->text('payload')]);
        $model = (new MatchingResult)->setConnection('snapshot_fixture')->setRawAttributes(['candidate_metadata' => json_encode(['_reference_snapshot' => $id])]);
        try { $model->candidate_metadata; $this->fail('A snapshot from another database must not be served.'); }
        catch (\RuntimeException $error) { $this->assertStringContainsString('unavailable', $error->getMessage()); }
        finally { DB::purge('snapshot_fixture'); }
    }

    public function test_missing_or_corrupt_checkpoint_dependencies_fail_closed(): void
    {
        $id = MatchingRecordSnapshots::store(['name' => 'Original']); MatchingRecordSnapshots::flush();
        DB::table('matching_record_snapshots')->where('id', $id)->update(['payload' => '{"name":"Modified"}']);
        try { MatchingRecordSnapshots::load($id); $this->fail('Corruption must be rejected.'); }
        catch (\RuntimeException $error) { $this->assertStringContainsString('integrity', $error->getMessage()); }
        $this->expectExceptionMessage('Checkpoint reference evidence is unavailable');
        MatchingRecordSnapshots::assertReferences([['input_record_key' => '001', 'candidate_rank' => 1, 'candidate_metadata' => json_encode(['_reference_snapshot' => str_repeat('f', 64)])]]);
    }

    public function test_input_pointer_cannot_resolve_to_a_different_string_key(): void
    {
        $this->makeResult('1', 1, ['input_record' => ['name' => 'Wrong identity']]);
        $model = $this->makeResult('001', 2, ['_input_primary' => '001']);
        $this->expectExceptionMessage('Immutable input snapshot is unavailable');
        $model->candidate_metadata;
    }

    public function test_engine_writes_full_source_and_generated_overlay_in_both_storage_modes(): void
    {
        $job = new MatchingJob; $job->id = (string) Str::uuid();
        $input = ['key' => '001', 'row' => ['name' => 'Input', 'extra' => 'Original'], 'normalized' => ['[Generated] Name' => 'input']];
        $ref = ['key' => 'ref', 'row' => ['name' => 'Acuan', 'extra' => 'Utuh'], 'normalized' => ['[Generated] Name' => 'acuan']];
        $method = new \ReflectionMethod(MatchingEngineService::class, 'resultRow');
        $row = $method->invoke(app(MatchingEngineService::class), $job, $input, $ref, 98, 1, [], 'matched', 'fixture', 0);
        MatchingRecordSnapshots::flush();
        $model = (new MatchingResult)->setRawAttributes($row);
        $this->assertSame('Original', $model->candidate_metadata['input_record']['extra']);
        $this->assertSame('acuan', $model->candidate_metadata['reference_record']['[Generated] Name']);
        $this->assertSame($ref['row'], MatchingRecordSnapshots::load(json_decode($row['candidate_metadata'], true)['_reference_snapshot']));
        Schema::drop('matching_record_snapshots');
        $legacy = $method->invoke(app(MatchingEngineService::class), $job, $input, $ref, 98, 1, [], 'matched', 'fixture', 0);
        $this->assertArrayNotHasKey('_reference_snapshot', json_decode($legacy['candidate_metadata'], true));
        $this->assertSame('acuan', (new MatchingResult)->setRawAttributes($legacy)->candidate_metadata['reference_record']['[Generated] Name']);
    }

    public function test_exact_ambiguity_is_not_hidden_by_top_one_or_memoization(): void
    {
        $refs = new MatchingRowStore;
        foreach (['001', '1'] as $n => $key) {
            $refs->append(['key' => $key, 'row' => ['title' => 'SAMA'], 'normalized' => ['title' => 'sama'], 'identity' => []]);
            $refs->setExactKeys($n + 1, 'sama', md5('sama'));
        }
        $job = new MatchingJob; $job->id = (string) Str::uuid();
        $input = ['key' => 'input', 'row' => ['title' => 'SAMA'], 'normalized' => ['title' => 'sama'], 'identity' => []];
        $mappings = [['input_column_name' => 'title', 'reference_column_name' => 'title', 'algorithm' => 'Exact', 'weight' => 100, 'required_match' => true]];
        $method = new \ReflectionMethod(MatchingEngineService::class, 'processChunk');
        foreach ([true, false] as $mandatory) {
            $result = $method->invoke(app(MatchingEngineService::class), [$input, [...$input, 'key' => 'other']], 0, 0, $job, $mappings, [], $mandatory ? $mappings : [], $mandatory, $mandatory ? [] : $mappings, ! $mandatory, $refs, [], 12, 1);
            $this->assertSame(2, $result['summaryDelta']['possible_match']);
            $this->assertSame(0, $result['summaryDelta']['matched']);
            $this->assertCount(2, $result['batchResults']);
            $this->assertSame(['possible_match', 'possible_match'], array_column($result['batchResults'], 'result_type'));
        }
    }

    public function test_checkpoint_resume_keeps_snapshot_pointers_and_refuses_missing_evidence(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'rematch-checkpoint-fixture-');
        $manager = new MatchingCheckpointManager($path);
        $id = MatchingRecordSnapshots::store(['name' => 'Original']); MatchingRecordSnapshots::flush();
        $primary = $this->makeResult('001', 1, ['input_record' => ['code' => '001'], '_reference_snapshot' => $id]);
        $second = $this->makeResult('001', 2, ['_input_primary' => '001', '_reference_snapshot' => $id]);
        try {
            $manager->saveChunk('fixture', 'fixture', null, 0, 1, 2, [], [$primary->getAttributes(), $second->getAttributes()]);
            $restored = $manager->restoreResultsForJob('fixture', 'resumed');
            $this->assertTrue($restored['restored']);
            $this->assertSame('001', MatchingResult::where('matching_job_id', 'resumed')->where('candidate_rank', 2)->firstOrFail()->candidate_metadata['input_record']['code']);
            DB::table('matching_record_snapshots')->delete();
            $failed = $manager->restoreResultsForJob('fixture', 'missing');
            $this->assertFalse($failed['restored']);
            $this->assertSame(0, MatchingResult::where('matching_job_id', 'missing')->count());
        } finally {
            unset($manager);
            foreach ([$path, $path.'-wal', $path.'-shm'] as $file) if (is_file($file)) unlink($file);
        }
    }

    public function test_migration_rollback_refuses_to_drop_referenced_snapshots(): void
    {
        $id = MatchingRecordSnapshots::store(['name' => 'Original']); MatchingRecordSnapshots::flush();
        $this->makeResult('001', 1, ['_reference_snapshot' => $id]);
        $migration = require database_path('migrations/2026_10_19_000001_create_matching_record_snapshots.php');
        try { $migration->down(); $this->fail('Referenced evidence must survive rollback.'); }
        catch (\RuntimeException $error) { $this->assertStringContainsString('referenced', $error->getMessage()); }
        $this->assertTrue(Schema::hasTable('matching_record_snapshots'));
        DB::table('matching_results')->delete(); $migration->down();
        $this->assertFalse(Schema::hasTable('matching_record_snapshots'));
    }
}
