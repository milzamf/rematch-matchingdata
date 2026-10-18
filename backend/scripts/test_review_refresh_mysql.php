<?php

/** Small, fixed-host MySQL fixture. Never uses the application's configured database. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\User;
use App\Services\Matching\MatchingRecordSnapshots;
use App\Services\Matching\ReferenceFormatExport;
use App\Services\Matching\ReviewResultService;
use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

if (getenv('DB_HOST') !== 'rematch-review-refresh-test' || getenv('DB_DATABASE') !== 'rematch_stage4_test' || getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') throw new RuntimeException('Disposable fixture environment required.');
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
config(['database.default' => 'mysql', 'database.connections.mysql.host' => 'rematch-review-refresh-test', 'database.connections.mysql.database' => 'rematch_stage4_test',
    'database.connections.mysql.username' => 'root', 'database.connections.mysql.password' => '', 'review_deployment.mode' => 'isolated',
    'review_deployment.write_frozen' => false, 'cache.default' => 'array', 'workspace_access.enabled' => true, 'review_transactions.enabled' => true]);
DB::purge('mysql');
$db = DB::connection();
if ($db->getDatabaseName() !== 'rematch_stage4_test' || $db->select('SHOW TABLES')) throw new RuntimeException('Empty isolated database required.');
foreach (glob(__DIR__.'/../database/migrations/*.php') as $path) (require $path)->up();
$n = 0;
$check = function ($ok, $message) use (&$n) { if (! $ok) throw new RuntimeException($message); $n++; echo "PASS $message\n"; };
$uid = fn () => (string) Str::uuid();
$user = User::create(['name' => 'Owner fixture', 'email' => 'owner@fixture.invalid', 'password' => 'fixture-only', 'role' => 'user']);
$editor = User::create(['name' => 'Editor fixture', 'email' => 'editor@fixture.invalid', 'password' => 'fixture-only', 'role' => 'user']);
$viewer = User::create(['name' => 'Viewer fixture', 'email' => 'viewer@fixture.invalid', 'password' => 'fixture-only', 'role' => 'user']);
$input = $uid(); $reference = $uid(); $job = $uid(); $workspace = $uid();
foreach ([$input => 'input', $reference => 'reference'] as $id => $role) {
    $db->table('datasets')->insert(['id' => $id, 'user_id' => $user->id, 'dataset_role' => $role, 'name' => $role, 'original_filename' => $role.'.csv', 'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => 1, 'storage_path' => 'missing-fixture.csv', 'row_count' => 4, 'column_count' => 2, 'parse_status' => 'inspected']);
    foreach (['nama_perusahaan', 'kode'] as $i => $column) $db->table('dataset_columns')->insert(['id' => $uid(), 'dataset_id' => $id, 'name' => $column, 'normalized_name' => $column, 'data_type' => 'text', 'position' => $i + 1]);
}
$db->table('matching_jobs')->insert(['id' => $job, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'name' => 'Small fixture', 'status' => 'completed', 'total_count' => 4, 'processed_count' => 4, 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
$db->table('workspaces')->insert(['id' => $workspace, 'user_id' => $user->id, 'matching_job_id' => $job, 'name' => 'Small fixture', 'input_dataset_id' => $input, 'reference_dataset_id' => $reference]);
$db->table('matching_jobs')->where('id', $job)->update(['workspace_id' => $workspace]);
foreach ([$editor->id => 'editor', $viewer->id => 'viewer'] as $id => $role) $db->table('workspace_members')->insert(['id' => $uid(), 'workspace_id' => $workspace, 'user_id' => $id, 'role' => $role, 'status' => 'active', 'version' => 1]);
$db->table('column_mappings')->insert(['id' => $uid(), 'matching_job_id' => $job, 'input_column_name' => 'nama_perusahaan', 'reference_column_name' => 'nama_perusahaan', 'algorithm' => 'Levenshtein', 'weight' => 100]);
$ids = [];
foreach (['001', '1', 'two', 'three'] as $i => $key) {
    $ids[$key] = $uid();
    $db->table('matching_results')->insert(['id' => $ids[$key], 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => 'ref-'.$key,
        'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 98 - $i,
        'candidate_metadata' => json_encode(['input_record' => ['nama_perusahaan' => 'Input '.$key, 'kode' => $key], 'reference_record' => ['nama_perusahaan' => 'Acuan '.$key, 'kode' => $key]]),
        'field_scores' => json_encode([['input_column' => 'nama_perusahaan', 'reference_column' => 'nama_perusahaan', 'score' => 98 - $i]])]);
    $db->table('review_states')->insert(['id' => $uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => $key,
        'status' => 'possible_match', 'decision_origin' => 'auto', 'decision_protection' => 'open', 'lineage_status' => 'verified', 'source_occurrence_count' => 1]);
}
$reader = app(ReviewResultService::class);
$read = fn ($params = [], $actor = null) => $reader->list($actor ?? $user, $job, ['include_groups' => false, 'include_quality' => false, ...$params]);
$initial = $read();
$check(count($initial['items']) === 4 && $initial['source'] === 'review_states', 'Established DTO reads only current state');
$access = new WorkspaceAccessService($db, true);
$writer = new ReviewTransactionService($db, true, null, $access);
$accept = $writer->decide($user->id, $job, 'accept', [['input_record_key' => '001', 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $ids['001']]]);
$after = $read(['status' => 'matched']);
$check($after['summary']['matched'] === 1 && count($after['items']) === 1 && $after['items'][0]['version'] === 2, 'Accept updates row, count and CAS version');
$check($read(['status' => 'possible_match'])['pagination']['total_items'] === 3, 'Accepted row leaves Need Review');
$db->table('review_decisions')->insert(['id' => $uid(), 'matching_job_id' => $job, 'input_record_key' => '001', 'decision' => 'mark_unmatched', 'new_result_type' => 'unmatched', 'created_at' => '2030-01-01 00:00:00']);
$check($read(['status' => 'matched'])['pagination']['total_items'] === 1, 'Newer audit row never overrides effective state');
$check($after['items'][0]['decision']['operation_id'] === $accept['operation_id'] && $after['items'][0]['decision']['undo_items'][0]['expected_version'] === 2, 'Undo tokens originate in displayed snapshot');
$check(! $read([], $viewer)['items'][0]['actions']['review'], 'Viewer cannot write from established UI');
$check($read(['input_keys' => ['001']], $editor)['items'][0]['actions']['propose'], 'Other reviewer gets revision action');
$writer->undo($user->id, $job, 'undo', $accept['operation_id'], [['input_record_key' => '001', 'expected_version' => 2]]);
$check($read(['input_keys' => ['001']])['items'][0]['decision'] === null && $read()['summary']['matched'] === 0, 'Undo restores state despite append-only audit');
$groups = $read(['include_groups' => true]);
$group = $groups['case_groups'][0];
$detail = $read(['case_group_id' => $group['id'], 'include_groups' => false, 'search' => 'Input']);
$check($detail['pagination']['total_items'] > 0 && count($detail['items']) > 0, 'Case membership independent of include_groups and searches record text');
$check(isset($group['review_versions']['key:001']) || isset($group['review_versions']['key:1']), 'Bulk group exposes snapshot versions');
$snap = MatchingRecordSnapshots::store(['nama_perusahaan' => 'Acuan asli', 'kode' => '001']);
MatchingRecordSnapshots::store(['nama_perusahaan' => 'Acuan asli', 'kode' => '001']); MatchingRecordSnapshots::flush();
$check($db->table('matching_record_snapshots')->count() === 1, 'Repeated reference snapshot stored once');
$db->table('matching_results')->where('id', $ids['001'])->update(['candidate_metadata' => json_encode(['input_record' => ['nama_perusahaan' => 'Input 001', 'kode' => '001'], '_reference_snapshot' => $snap])]);
$writer->decide($user->id, $job, 'export-accept', [['input_record_key' => '001', 'expected_version' => 3, 'decision' => 'accept_match', 'candidate_id' => $ids['001']]]);
$check($read(['input_keys' => ['001']])['items'][0]['candidates'][0]['reference_record']['kode'] === '001', 'Snapshot hydration preserves string keys and original values');
$xlsx = app(ReferenceFormatExport::class)->create($user, $job);
$zip = new ZipArchive; $zip->open($xlsx);
$ref = simplexml_load_string($zip->getFromName('xl/worksheets/sheet1.xml'));
$audit = simplexml_load_string($zip->getFromName('xl/worksheets/sheet2.xml'));
$check(count($ref->sheetData->row) === 2, 'Reference sheet includes only effective Matched');
$check(count($audit->sheetData->row) === 5, 'Audit sheet includes every input');
$check(str_contains($zip->getFromName('xl/worksheets/sheet1.xml'), 'Acuan asli') && str_contains($zip->getFromName('xl/worksheets/sheet1.xml'), '001'), 'Reference export uses original values without enrichment');
$zip->close(); unlink($xlsx);
$check($read()['summary']['matched'] === 1, 'Export does not modify decisions');
$second = $uid();
$db->table('matching_results')->insert(['id' => $second, 'matching_job_id' => $job, 'input_record_key' => '001', 'reference_record_key' => 'rank-two', 'candidate_rank' => 2, 'result_type' => 'possible_match', 'overall_score' => 62,
    'candidate_metadata' => json_encode(['_input_primary' => '001', '_reference_snapshot' => $snap]), 'field_scores' => '[]']);
$selected = $writer->decide($user->id, $job, 'rank-two', [['input_record_key' => '001', 'expected_version' => 4, 'decision' => 'select_candidate', 'candidate_id' => $second]]);
$check($read(['similarity_max' => 70])['items'][0]['candidates'][0]['id'] === $second, 'Score filter follows reviewer-selected candidate');
$check($read(['sort' => 'similarity_asc'])['items'][0]['input_record_key'] === '001', 'Sorting follows selected score across string keys');
$writer->undo($user->id, $job, 'undo-rank-two', $selected['operation_id'], [['input_record_key' => '001', 'expected_version' => 5]]);
$check($read(['input_keys' => ['001']])['items'][0]['decision']['decision'] === 'accept_match', 'Undo audit does not replace restored effective decision');
$bulk = $writer->decide($user->id, $job, 'bulk', array_map(fn ($key) => ['input_record_key' => $key, 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $ids[$key]], ['two', 'three']), true);
$check($bulk['applied'] === 2 && $read()['summary']['matched'] === 3, 'Bulk decisions update latest counts and rows');
$bulkSnapshot = $read(['input_keys' => ['two']])['items'][0]['decision'];
$check(count($bulkSnapshot['undo_items']) === 2, 'Bulk Undo snapshot includes entire committed operation');
$writer->undo($user->id, $job, 'undo-bulk', $bulk['operation_id'], $bulkSnapshot['undo_items']);
$check($read()['summary']['matched'] === 1 && $read()['summary']['possible_match'] === 3, 'Bulk Undo restores counts without replaying old history');
$writer->decide($user->id, $job, 'reject-keeps-review', [['input_record_key' => '1', 'expected_version' => 1, 'decision' => 'reject_match', 'candidate_id' => $ids['1']]]);
$openGroups = $read(['include_groups' => true]);
$check(array_sum(array_map(fn ($group) => $group['decision_summary']['pending'], $openGroups['case_groups'])) === 3, 'Rejected candidate remains an open review case');
$check($read(['search' => 'input'])['pagination']['total_items'] === 4, 'Record text search is case insensitive');
config(['workspace_access.enabled' => false, 'review_transactions.enabled' => false]);
$legacy = $reader->list($user, $job, ['include_groups' => false, 'include_quality' => false]);
$check(! isset($legacy['source']), 'Flag-off keeps established legacy reader');
echo "PASS $n isolated MySQL assertions\n";
