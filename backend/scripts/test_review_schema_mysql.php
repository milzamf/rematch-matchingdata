<?php

/** Standalone schema test: fixed disposable DB/localhost; never boots the application's DB config. */
require __DIR__.'/../vendor/autoload.php';

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

if (getenv('REMATCH_SCHEMA_TEST') !== 'isolated-stage2') {
    throw new RuntimeException('Run only in the isolated stage2 test container.');
}
$capsule = new Capsule;
$capsule->addConnection([
    'driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
    'database' => 'rematch_stage2_test', 'username' => 'root', 'password' => '',
    'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'strict' => true,
]);
$capsule->setAsGlobal();
$capsule->bootEloquent();
$container = $capsule->getContainer();
$container->instance('db', $capsule->getDatabaseManager());
$container->bind('db.schema', fn () => $capsule->getConnection()->getSchemaBuilder());
Facade::setFacadeApplication($container);

$assertions = 0;
function verify(bool $condition, string $message): void
{
    global $assertions;
    if (! $condition) throw new RuntimeException($message);
    $assertions++;
    echo "PASS $message\n";
}
function refuses(callable $write, int $code, string $message): void
{
    try {
        $write();
    } catch (QueryException $error) {
        if (($error->errorInfo[1] ?? null) !== $code) {
            throw new RuntimeException($message.': expected '.$code.', got '.($error->errorInfo[1] ?? 'unknown').': '.$error->getMessage());
        }
        verify(($error->errorInfo[1] ?? null) === $code, $message.' (MySQL '.$code.')');
        return;
    }
    throw new RuntimeException('Expected rejection: '.$message);
}
function refusesRollback(object $migration, string $message): void
{
    try {
        $migration->down();
    } catch (RuntimeException $error) {
        verify(str_starts_with($error->getMessage(), 'Rollback refused:'), $message);
        return;
    }
    throw new RuntimeException('Expected guarded rollback: '.$message);
}
function uid(): string { return (string) Str::uuid(); }

verify(DB::selectOne('SELECT DATABASE() AS name')->name === 'rematch_stage2_test', 'isolated database selected');
verify(count(DB::select('SHOW TABLES')) === 0, 'test database initially empty');
$version = DB::selectOne('SELECT VERSION() AS version')->version;
echo "MySQL version: $version\n";
$paths = glob(__DIR__.'/../database/migrations/*.php');
sort($paths);
$stage = [];
foreach ($paths as $path) {
      if (str_contains(basename($path), '2026_10_13_000003') || str_contains(basename($path), '2026_10_13_000004')) continue; // Stage 2 contract remains independently testable.
    $migration = require $path;
    if (str_contains(basename($path), '2026_10_13_')) $stage[] = $migration;
    else $migration->up();
}
verify(count($stage) === 2, 'exactly two Stage 2 migrations');

// Seed representative pre-stage data, including legacy null actors and opaque keys.
$actor = DB::table('users')->insertGetId(['name' => 'Schema test', 'email' => 'schema@test.invalid', 'password' => 'not-a-login-password']);
$otherActor = DB::table('users')->insertGetId(['name' => 'Other actor', 'email' => 'other@test.invalid', 'password' => 'not-a-login-password']);
$dataset = function (string $role) use ($actor): string {
    $id = uid();
    DB::table('datasets')->insert(['id' => $id, 'user_id' => $actor, 'dataset_role' => $role, 'name' => $role,
        'original_filename' => "$role.csv", 'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => 1,
        'storage_path' => "test/$role.csv", 'row_count' => 2, 'column_count' => 1, 'parse_status' => 'inspected']);
    return $id;
};
$reference = $dataset('reference');
$otherReference = $dataset('reference');
$input = $dataset('input');
$job = uid(); $otherJob = uid(); $differentDatasetJob = uid(); $workspace = uid();
foreach ([$job => $reference, $otherJob => $reference, $differentDatasetJob => $otherReference] as $id => $ref) {
    DB::table('matching_jobs')->insert(['id' => $id, 'reference_dataset_id' => $ref, 'input_dataset_id' => $input,
        'status' => 'completed', 'processed_count' => 2, 'total_count' => 2]);
}
DB::table('workspaces')->insert(['id' => $workspace, 'user_id' => $actor, 'name' => 'Existing workspace', 'matching_job_id' => $job]);
$result = uid();
DB::table('matching_results')->insert(['id' => $result, 'matching_job_id' => $job, 'input_record_key' => '001',
    'reference_record_key' => 'legacy-reference', 'result_type' => 'possible_match', 'overall_score' => 91.95,
    'candidate_metadata' => '{"input_record":{"name":"unchanged"}}']);
$legacyDecision = uid();
DB::table('review_decisions')->insert(['id' => $legacyDecision, 'matching_job_id' => $job, 'matching_result_id' => $result,
    'input_record_key' => '001', 'decision' => 'reject_match', 'new_result_type' => 'possible_match',
    'previous_result_type' => 'possible_match', 'metadata' => '{"reviewer":"local_frontend"}']);
$legacy = [];
foreach (['users','datasets','matching_jobs','matching_results','workspaces','review_decisions'] as $table) {
    $columns = Schema::getColumnListing($table);
    $legacy[$table] = [$columns, json_encode(DB::table($table)->select($columns)->orderBy('id')->get()), Schema::getIndexes($table)];
}
foreach ($stage as $migration) $migration->up();
$newTables = ['review_states','review_operations','review_change_requests','workspace_members','reference_entity_groups','reference_entity_members'];
foreach ($newTables as $table) {
    verify(DB::table($table)->count() === 0, "$table empty; no backfill");
    verify(DB::selectOne('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table])->engine === 'InnoDB', "$table uses InnoDB");
}
foreach ($legacy as $table => [$columns, $snapshot]) {
    verify(json_encode(DB::table($table)->select($columns)->orderBy('id')->get()) === $snapshot, "$table legacy data unchanged after up");
}
verify(DB::table('matching_jobs')->where('id', $job)->value('review_state_readiness') === 'pending', 'no readiness activation');
verify((int) DB::table('workspaces')->where('id', $workspace)->value('configuration_version') === 1, 'workspace version prepared');

$state = function (string $key, array $changes = []) use ($job, $reference): array {
    return array_replace(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference,
        'input_record_key' => $key, 'status' => 'possible_match'], $changes);
};
$insertState = fn (string $key, array $changes = []) => DB::table('review_states')->insert($state($key, $changes));
$insertState('001'); $insertState('1'); $insertState('Case'); $insertState('case'); $insertState('space'); $insertState('space ');
verify(DB::table('review_states')->count() === 6, 'numeric-looking, case, trailing-space keys remain distinct');
refuses(fn () => $insertState('001'), 1062, 'same job/input identity unique');
$insertState('other-job-key', ['matching_job_id' => $otherJob]);
refuses(fn () => $insertState('wrong-dataset', ['reference_dataset_id' => $otherReference]), 1452, 'state dataset must match its job');
refuses(fn () => $insertState('missing-job', ['matching_job_id' => uid()]), 1452, 'orphan job rejected');
refuses(fn () => $insertState('bad-version', ['version' => 0]), 3819, 'positive state version enforced');
refuses(fn () => $insertState('bad-status', ['status' => 'invented']), 3819, 'unsupported state rejected');
refuses(fn () => $insertState('missing-ref', ['status' => 'matched']), 3819, 'matched requires reference key');
$insertState('matched-owner', ['status' => 'matched', 'selected_reference_record_key' => 'ref-claimed']);
refuses(fn () => $insertState('double-claim', ['status' => 'matched', 'selected_reference_record_key' => 'ref-claimed']), 1062, 'double active reference claim rejected');
$insertState('pending-same-ref', ['selected_reference_record_key' => 'ref-claimed']);
$insertState('other-job-owner', ['matching_job_id' => $otherJob, 'status' => 'matched', 'selected_reference_record_key' => 'ref-claimed']);
verify(DB::table('review_states')->where('selected_reference_record_key', 'ref-claimed')->count() === 3, 'pending and different-job references do not collide');
$insertState('held-owner', ['status' => 'reference_conflict', 'integrity_status' => 'held', 'selected_reference_record_key' => 'ref-held']);
refuses(fn () => $insertState('steal-held', ['status' => 'matched', 'selected_reference_record_key' => 'ref-held']), 1062, 'integrity hold reserves reference');
DB::table('review_states')->where('input_record_key', 'matched-owner')->where('matching_job_id', $job)->update(['status' => 'unmatched']);
$insertState('new-owner', ['status' => 'matched', 'selected_reference_record_key' => 'ref-claimed']);
verify(DB::table('review_states')->where('input_record_key', 'new-owner')->exists(), 'non-matched state releases active assignment');

$group = uid();
DB::table('reference_entity_groups')->insert(['id' => $group, 'reference_dataset_id' => $reference,
    'verified_by_user_id' => $actor, 'verified_at' => '2026-10-13 00:00:00', 'verification_note' => 'Verified test identities']);
foreach (['entity-ref-A','entity-ref-B'] as $key) {
    DB::table('reference_entity_members')->insert(['id' => uid(), 'reference_dataset_id' => $reference,
        'reference_entity_group_id' => $group, 'reference_record_key' => $key,
        'verified_by_user_id' => $actor, 'verified_at' => '2026-10-13 00:00:00']);
}
$insertState('entity-owner', ['status' => 'matched', 'selected_reference_record_key' => 'entity-ref-A', 'selected_reference_entity_group_id' => $group]);
refuses(fn () => $insertState('entity-double', ['status' => 'matched', 'selected_reference_record_key' => 'entity-ref-B', 'selected_reference_entity_group_id' => $group]), 1062, 'different IDs of verified entity cannot have two active owners');
refuses(fn () => $insertState('invalid-member', ['selected_reference_record_key' => 'not-a-member', 'selected_reference_entity_group_id' => $group]), 1452, 'group assignment must be a verified member');
refuses(fn () => $insertState('cross-dataset-entity', ['matching_job_id' => $differentDatasetJob, 'reference_dataset_id' => $otherReference,
    'status' => 'matched', 'selected_reference_record_key' => 'entity-ref-B', 'selected_reference_entity_group_id' => $group]), 1452, 'group cannot cross datasets');

$insertState('duplicate', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => '001']);
refuses(fn () => $insertState('self-duplicate', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => 'self-duplicate']), 3819, 'self duplicate rejected');
refuses(fn () => $insertState('chain', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => 'duplicate']), 1452, 'duplicate chain rejected');
refuses(fn () => $insertState('cross-job-duplicate', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => 'other-job-key']), 1452, 'canonical cannot be in another job');
refuses(fn () => DB::table('review_states')->where('matching_job_id', $job)->where('input_record_key', '001')
    ->update(['status' => 'duplicate_input', 'duplicate_of_input_record_key' => '1']), 1451, 'canonical cannot become duplicate while children point to it');
refuses(fn () => $insertState('duplicate-claim', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => '001', 'selected_reference_record_key' => 'invalid']), 3819, 'duplicate cannot claim reference');

$operation = ['id' => uid(), 'matching_job_id' => $job, 'actor_user_id' => $actor, 'operation_type' => 'decision', 'idempotency_key' => 'retry-001', 'request_hash' => str_repeat('a',64)];
DB::table('review_operations')->insert($operation);
refuses(fn () => DB::table('review_operations')->insert(array_replace($operation, ['id' => uid()])), 1062, 'operation idempotency unique per job/actor');
DB::table('review_operations')->insert(array_replace($operation, ['id' => uid(), 'actor_user_id' => $otherActor]));
verify(DB::table('review_operations')->count() === 2, 'idempotency namespaces actors separately');
$stateId = DB::table('review_states')->where('matching_job_id',$job)->where('input_record_key','001')->value('id');
$request = ['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'review_state_id' => $stateId,
    'expected_version' => 1, 'previous_reviewer_user_id' => $actor, 'proposed_by_user_id' => $otherActor,
    'before_status' => 'possible_match', 'proposed_decision' => 'mark_unmatched', 'proposed_status' => 'unmatched', 'reason' => 'Proposed revision'];
DB::table('review_change_requests')->insert($request);
refuses(fn () => DB::table('review_change_requests')->insert(array_replace($request, ['id' => uid()])), 1062, 'one pending request per state');
verify(DB::table('review_states')->where('id',$stateId)->value('status') === 'possible_match', 'pending request does not modify effective state');
DB::table('review_change_requests')->where('id',$request['id'])->update(['status' => 'rejected']);
DB::table('review_change_requests')->insert(array_replace($request, ['id' => uid()]));
refuses(fn () => DB::table('review_change_requests')->insert(array_replace($request, ['id' => uid(), 'matching_job_id' => $otherJob, 'status' => 'cancelled'])), 1452, 'request/state job mismatch rejected');

$member = ['id' => uid(), 'workspace_id' => $workspace, 'user_id' => $otherActor, 'role' => 'editor'];
DB::table('workspace_members')->insert($member);
refuses(fn () => DB::table('workspace_members')->insert(array_replace($member, ['id'=>uid()])), 1062, 'one membership per workspace/user');
refuses(fn () => DB::table('workspace_members')->where('id',$member['id'])->update(['role' => 'owner']), 3819, 'ownership cannot drift into membership');
refuses(fn () => DB::table('workspaces')->where('id',$workspace)->update(['configuration_version'=>0]), 3819, 'positive workspace version enforced');

$audit = ['id' => uid(), 'matching_job_id' => $job, 'input_record_key' => '001', 'decision' => 'mark_unmatched',
    'new_result_type' => 'unmatched', 'review_state_id' => $stateId, 'review_operation_id' => $operation['id'],
    'state_version_before' => 1, 'state_version_after' => 2, 'reviewer_user_id' => $actor,
    'proposed_by_user_id' => $otherActor, 'approved_by_user_id' => $actor, 'last_modified_by_user_id' => $actor];
DB::table('review_decisions')->insert($audit);
refuses(fn () => DB::table('review_decisions')->insert(array_replace($audit, ['id'=>uid()])), 1062, 'one audit per state version');
refuses(fn () => DB::table('review_decisions')->insert(array_replace($audit, ['id'=>uid(),'state_version_before'=>1,'state_version_after'=>4])), 3819, 'audit versions advance by one');
refuses(fn () => DB::table('review_decisions')->insert(array_replace($audit, ['id'=>uid(),'review_state_id'=>null])), 3819, 'versioned audit must identify its state');
refuses(fn () => DB::table('matching_jobs')->where('id',$job)->delete(), 1451, 'referenced parent cannot be deleted');
refusesRollback($stage[1], 'rollback refuses populated new audit fields');
DB::table('review_decisions')->where('id',$audit['id'])->delete();
refusesRollback($stage[0], 'rollback refuses populated foundation tables');

$expectedIndexes = [
    'review_states' => ['review_states_job_input_uq','review_states_active_reference_uq','review_states_active_entity_uq','review_states_job_status_idx'],
    'reference_entity_members' => ['entity_members_dataset_key_uq','entity_members_assignment_uq'],
    'review_operations' => ['review_ops_idempotency_uq'],
    'review_change_requests' => ['review_requests_pending_uq','review_requests_inbox_idx'],
    'workspace_members' => ['workspace_members_workspace_user_uq','workspace_members_access_idx'],
    'review_decisions' => ['review_decisions_state_version_uq'],
];
foreach ($expectedIndexes as $table => $names) {
    $found = array_column(DB::select('SHOW INDEX FROM '.$table), 'Key_name');
    foreach ($names as $name) verify(in_array($name,$found,true), 'index '.$name.' exists');
}
verify(DB::selectOne("SELECT COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'review_states' AND COLUMN_NAME = 'input_record_key'")->collation === 'utf8mb4_0900_bin', 'input key binary NO PAD collation');

// Remove only new test fixtures, then roll back additions; old fixture bytes must remain identical.
DB::table('workspace_members')->delete();
DB::table('review_change_requests')->delete();
DB::table('review_states')->whereNotNull('duplicate_of_input_record_key')->delete();
DB::table('review_states')->delete();
DB::table('review_operations')->delete();
DB::table('reference_entity_members')->delete();
DB::table('reference_entity_groups')->delete();
$stage[1]->down(); $stage[0]->down();
foreach ($newTables as $table) verify(!Schema::hasTable($table), "$table rolled back");
foreach ($legacy as $table => [$columns,$snapshot,$indexes]) {
    verify(json_encode(DB::table($table)->select($columns)->orderBy('id')->get()) === $snapshot, "$table legacy data unchanged after down");
    verify(Schema::getColumnListing($table) === $columns, "$table existing column layout restored");
    verify(Schema::getIndexes($table) === $indexes, "$table existing indexes restored");
}
foreach ($stage as $migration) $migration->up();
verify(DB::table('review_states')->count() === 0, 'reapply succeeds without backfill');
echo "SUCCESS: $assertions assertions; migration up/down/reapply on MySQL $version, InnoDB.\n";
