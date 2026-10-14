<?php

/** Fixed disposable MySQL database; application config and main storage are never booted. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Matching\Reconciliation\ReviewStateBackfill;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Str;

if (getenv('REMATCH_BACKFILL_TEST') !== 'isolated-stage3') {
    throw new RuntimeException('Isolated runner required.');
}
$capsule = new Capsule;
$capsule->addConnection(['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage3_test', 'username' => 'root', 'password' => '',
    'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'strict' => true]);
$capsule->setAsGlobal();
$capsule->bootEloquent();
$container = $capsule->getContainer();
$container->instance('db', $capsule->getDatabaseManager());
$container->bind('db.schema', fn () => $capsule->getConnection()->getSchemaBuilder());
Facade::setFacadeApplication($container);
$assertions = 0;
$start = microtime(true);
function verify(bool $ok, string $message): void
{
    global $assertions;
    if (! $ok) {
        throw new RuntimeException($message);
    } $assertions++;
    echo "PASS $message\n";
}
function refuses(callable $work, string $message, string $contains = ''): void
{
    try {
        $work();
    } catch (Throwable $error) {
        verify($contains === '' || str_contains($error->getMessage(), $contains), $message.': '.$error->getMessage());

        return;
    }
    throw new RuntimeException('Expected refusal: '.$message);
}
function uid(): string
{
    return (string) Str::uuid();
}
verify(DB::selectOne('SELECT DATABASE() AS name')->name === 'rematch_stage3_test', 'isolated database selected');
verify(count(DB::select('SHOW TABLES')) === 0, 'empty disposable database');
echo 'MySQL '.DB::selectOne('SELECT VERSION() AS version')->version."\n";
$paths = glob(__DIR__.'/../database/migrations/*.php');
sort($paths);
foreach ($paths as $path) {
    $migration = require $path;
    $migration->up();
    if (str_contains($path, '2026_10_13_000003')) {
        $holdsMigration = $migration;
    }
}
foreach (['review_states', 'review_reference_holds', 'review_reconciliation_issues'] as $table) {
    verify(DB::selectOne('SELECT ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [$table])->e === 'InnoDB', "$table InnoDB");
}
$actor = DB::table('users')->insertGetId(['name' => 'Fixture owner', 'email' => 'fixture@stage3.invalid', 'password' => 'not-a-login']);
$root = '/tmp/rematch-stage3-sources';
mkdir($root);
$dataset = function (string $role, string $filename, array $names, bool $attested = true) use ($actor, $root): string {
    $fh = fopen("$root/$filename", 'w');
    fputcsv($fh, ['name']);
    foreach ($names as $name) {
        fputcsv($fh, [$name]);
    } fclose($fh);
    $id = uid();
    DB::table('datasets')->insert(['id' => $id, 'user_id' => $actor, 'dataset_role' => $role, 'name' => $filename, 'original_filename' => $filename,
        'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => filesize("$root/$filename"), 'storage_path' => $filename, 'row_count' => count($names),
        'column_count' => 1, 'header_row' => 1, 'delimiter' => ',', 'parse_status' => 'inspected',
        'profiling_summary' => json_encode($attested ? ['source_sha256_at_match' => hash_file('sha256', "$root/$filename"), 'lineage_parser' => 'rematch-stream-v1'] : [])]);

    return $id;
};
$reference = $dataset('reference', 'reference.csv', ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
$makeJob = function (string $input) use ($reference): string {
    $job = uid();
    DB::table('matching_jobs')->insert(['id' => $job, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'status' => 'completed', 'total_count' => 12]);

    return $job;
};
$names = ['001' => 'Alpha', '1' => 'Beta', 'reject' => 'Rejected', 'mark' => 'Unmatched', 'undo' => 'Undone', 'multi' => 'Ambiguous',
    'collision-a' => 'Collision A', 'collision-b' => 'Collision B', 'entity-alias' => 'Entity Alias', 'duplicate' => 'Business duplicate', 'pending' => 'Pending'];
$input = $dataset('input', 'input.csv', [...array_values($names), 'Alpha']);
$job = $makeJob($input);
$result = function (string $job, string $key, string $name, string $status, ?string $ref = '1'): string {
    $id = uid();
    DB::table('matching_results')->insert(['id' => $id, 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => $ref,
        'candidate_rank' => 1, 'result_type' => $status, 'overall_score' => 98, 'candidate_metadata' => json_encode(['input_record' => ['name' => $name]])]);

    return $id;
};
$ids = [];
foreach ($names as $key => $name) {
    // PHP array keys are coerced for '1'; explicitly convert back to the historical string.
    $key = (string) $key;
    [$status,$ref] = match ($key) {
        '001' => ['matched', '1'],'1' => ['matched', '2'],'reject','undo','pending','duplicate' => ['possible_match', '5'],
        'mark' => ['unmatched', '5'],'multi' => ['matched', '6'],'entity-alias' => ['matched', '4'],default => ['matched', '3']
    };
    $ids[$key] = $result($job, $key, $name, $status, $ref);
}
$event = function (string $key, string $action, string $type, array $changes = []) use ($job, $ids): string {
    $id = uid();
    DB::table('review_decisions')->insert(array_replace(['id' => $id, 'matching_job_id' => $job, 'matching_result_id' => $ids[$key] ?? null,
        'input_record_key' => $key, 'decision' => $action, 'new_result_type' => $type, 'previous_result_type' => 'possible_match',
        'selected_reference_record_key' => $key === '1' ? '2' : '6', 'reviewer_user_id' => null, 'created_at' => '2026-10-13 01:00:00', 'metadata' => '{}'], $changes));

    return $id;
};
$event('1', 'accept_match', 'matched');
$event('reject', 'reject_match', 'possible_match');
$event('mark', 'mark_unmatched', 'unmatched');
$event('undo', 'accept_match', 'matched', ['undone_at' => '2026-10-13 02:00:00', 'reviewer_user_id' => $actor, 'metadata' => json_encode(['undone_by_user_id' => $actor])]);
$event('multi', 'accept_match', 'matched');
$event('multi', 'accept_match', 'matched', ['created_at' => '2026-10-13 02:00:00']);
$event('orphan', 'accept_match', 'matched', ['matching_result_id' => null]);
$group = uid();
DB::table('reference_entity_groups')->insert(['id' => $group, 'reference_dataset_id' => $reference, 'verified_by_user_id' => $actor,
    'verified_at' => '2026-10-13 00:00:00', 'verification_note' => 'Verified by fixture owner, not name similarity']);
foreach (['3', '4'] as $ref) {
    DB::table('reference_entity_members')->insert(['id' => uid(), 'reference_dataset_id' => $reference,
        'reference_entity_group_id' => $group, 'reference_record_key' => $ref, 'verified_by_user_id' => $actor, 'verified_at' => '2026-10-13 00:00:00']);
}
// Existing verified business resolution is imported neither from similarity nor name duplicates.
$canonical = uid();
$duplicate = uid();
DB::table('review_states')->insert(['id' => $canonical, 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => '001', 'status' => 'matched',
    'selected_reference_record_key' => '1', 'selected_matching_result_id' => $ids['001'], 'decision_origin' => 'auto', 'source_occurrence_count' => 2, 'lineage_status' => 'verified']);
DB::table('review_states')->insert(['id' => $duplicate, 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => 'duplicate', 'status' => 'duplicate_input',
    'duplicate_of_input_record_key' => '001', 'reviewer_user_id' => $actor, 'last_modified_by_user_id' => $actor, 'decision_origin' => 'manual', 'decision_protection' => 'reviewer_owned', 'lineage_status' => 'verified', 'source_occurrence_count' => 1]);
$old = [];
foreach (['matching_results', 'review_decisions', 'datasets', 'reference_entity_groups', 'reference_entity_members'] as $table) {
    $old[$table] = json_encode(DB::table($table)->orderBy('id')->get());
}
$existingStates = json_encode(DB::table('review_states')->orderBy('id')->get());
$service = new ReviewStateBackfill($capsule->getConnection());
$artifact = '/tmp/stage3.sqlite';
$report = $service->prepare($job, $artifact, $root, 2);
verify(DB::table('review_states')->count() === 2, 'dry-run never writes shadow states');
verify($report['source_rows'] === 12 && $report['preprocessing_duplicates'] === 1, 'all source occurrences retained; preprocessing duplicate counted separately');
verify($report['plans'] === 12 && $report['held_inputs'] === 5, 'orphan reported and all collisions held without a winner');
verify($report['unmapped_source_rows'] === 0, 'fixture complete source lineage proven');
verify($report['total_source_rows'] === 12 && $report['unique_computation_inputs'] === 11 && $report['verified_business_duplicates'] === 1 && $report['safe_matched_assignments'] === 2 && $report['matched_entity_count'] === null, 'source, computational input, business duplicate and assignments separate; entity identity never guessed');
$plan = new PDO('sqlite:'.$artifact);
verify((int) $plan->query("SELECT COUNT(*) FROM plans WHERE json_extract(payload,'$.status')='duplicate_input'")->fetchColumn() === 1, 'only existing business-verified duplicate preserved');
$paused = $service->apply($job, $artifact, 1);
verify($paused['finished'] === false, 'bounded chunk pause');
$count = DB::table('review_states')->count();
refuses(fn () => $service->apply($job, $artifact, null, fn () => throw new RuntimeException('injected crash after commit')), 'crash after commit injected', 'injected crash');
verify(DB::table('review_states')->count() > $count, 'commit occurred before sidecar checkpoint');
$done = $service->apply($job, $artifact);
verify($done['finished'] === true, 'resume after committed chunk replay');
verify(DB::table('matching_jobs')->where('id', $job)->value('review_state_readiness') === 'ready', 'test-only consistent database ready despite ordinary pending review and local holds');
verify(DB::table('review_states')->where('matching_job_id', $job)->count() === 11, 'no invented orphan input record');
$state = fn (string $key) => DB::table('review_states')->where('matching_job_id', $job)->where('input_record_key', $key)->first();
verify($state('001')->id !== $state('1')->id, '001 and 1 remain distinct opaque string identities');
verify($state('1')->decision === 'accept_match' && $state('1')->reviewer_user_id === null, 'legacy accept and unknown reviewer retained');
verify($state('reject')->decision === 'reject_match' && $state('reject')->status === 'possible_match', 'reject remains Need Review');
verify($state('mark')->decision === 'mark_unmatched' && $state('mark')->status === 'unmatched', 'mark_unmatched remains separate');
verify($state('undo')->status === 'possible_match' && $state('undo')->reviewer_user_id === null && $state('undo')->last_modified_by_user_id === $actor, 'Undo actor distinct; previous decision not reapplied');
verify($state('multi')->integrity_status === 'held' && $state('multi')->selected_reference_record_key === null, 'ambiguous history has no selected winner');
foreach (['collision-a', 'collision-b', 'entity-alias'] as $key) {
    verify($state($key)->status === 'matched' && $state($key)->integrity_status === 'held' && $state($key)->active_reference_record_key === null, "$key historical match held without publishing assignment");
}
verify($state('pending')->integrity_status === 'consistent', 'safe input is not globally blocked');
verify($state('duplicate')->id === $duplicate, 'verified business duplicate not overwritten');
verify(DB::table('review_reference_holds')->where('matching_job_id', $job)->count() === 4, 'neutral holds cover record claims and verified entity');
$beforeRepeat = json_encode(DB::table('review_states')->orderBy('id')->get());
$service->apply($job, $artifact);
verify(json_encode(DB::table('review_states')->orderBy('id')->get()) === $beforeRepeat, 'backfill idempotent');
foreach ($old as $table => $snapshot) {
    verify(json_encode(DB::table($table)->orderBy('id')->get()) === $snapshot, "$table unchanged including historical decisions");
}
refuses(fn () => $holdsMigration->down(), 'schema rollback refuses populated reconciliation data', 'Rollback refused');
refuses(fn () => DB::table('review_states')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => 'extra', 'status' => 'matched', 'selected_reference_record_key' => '2']), 'unique active assignment still enforced', '1062');
refuses(fn () => DB::table('review_reference_holds')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'reference_record_key' => '3', 'evidence_fingerprint' => str_repeat('a', 64)]), 'duplicate neutral reservation prevented', '1062');
refuses(fn () => DB::table('review_reference_holds')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'evidence_fingerprint' => str_repeat('a', 64)]), 'empty resource rejected', '3819');
DB::table('reference_entity_groups')->where('id', $group)->update(['version' => 2]);
refuses(fn () => $service->apply($job, $artifact), 'dataset-scoped entity verification change invalidates snapshot', 'Stale snapshot');
DB::table('reference_entity_groups')->where('id', $group)->update(['version' => 1]);
DB::table('review_states')->where('id', $duplicate)->update(['version' => 2]);
$beforePreexistingRefusal = json_encode(DB::table('review_states')->orderBy('id')->get());
refuses(fn () => $service->rollback($job, $artifact), 'rollback refuses a changed preexisting duplicate', 'Preexisting state changed');
verify(json_encode(DB::table('review_states')->orderBy('id')->get()) === $beforePreexistingRefusal, 'preexisting refusal deletes no states');
DB::table('review_states')->where('id', $duplicate)->update(['version' => 1]);
DB::table('review_states')->where('matching_job_id', $job)->where('input_record_key', 'reject')->update(['version' => 2]);
$beforeFailedRollback = json_encode(DB::table('review_states')->orderBy('id')->get());
refuses(fn () => $service->rollback($job, $artifact), 'rollback refuses used shadow state before any delete', 'has been used');
verify(json_encode(DB::table('review_states')->orderBy('id')->get()) === $beforeFailedRollback, 'failed rollback deletes no states');
DB::table('review_states')->where('matching_job_id', $job)->where('input_record_key', 'reject')->update(['version' => 1]);
$service->rollback($job, $artifact);
verify(json_encode(DB::table('review_states')->orderBy('id')->get()) === $existingStates, 'rollback preserves every preexisting state');
verify(DB::table('review_reference_holds')->count() === 0 && DB::table('review_reconciliation_issues')->count() === 0, 'rollback removes only test run ledgers');
verify(DB::table('matching_jobs')->where('id', $job)->value('review_state_readiness') === 'pending', 'rollback restores original readiness');

// Missing, partial, modified files, and shared reference groups across jobs.
$partial = $dataset('input', 'partial.csv', ['Partial'], false);
$partialJob = $makeJob($partial);
$result($partialJob, '1', 'Partial', 'matched', '7');
$partialReport = $service->prepare($partialJob, '/tmp/partial.sqlite', $root);
verify($partialReport['total_source_rows'] === null && $partialReport['observed_source_rows'] === 1, 'unattested file count is observed rather than invented historical total');
$service->apply($partialJob, '/tmp/partial.sqlite');
verify(DB::table('review_states')->where('matching_job_id', $partialJob)->first()->lineage_status === 'partial', 'unattested original source remains partial');
$missing = $dataset('input', 'missing.csv', ['Missing']);
unlink("$root/missing.csv");
$missingJob = $makeJob($missing);
$result($missingJob, '001', 'Missing', 'possible_match');
$missingReport = $service->prepare($missingJob, '/tmp/missing.sqlite', $root);
$service->apply($missingJob, '/tmp/missing.sqlite');
verify($missingReport['source_rows'] === 0 && DB::table('review_states')->where('matching_job_id', $missingJob)->first()->source_occurrence_count === null, 'missing file never invents source rows or occurrence count');
$changed = $dataset('input', 'changed.csv', ['Changed']);
$changedJob = $makeJob($changed);
$result($changedJob, '1', 'Changed', 'matched', '7');
$service->prepare($changedJob, '/tmp/changed.sqlite', $root);
file_put_contents("$root/changed.csv", "name\nAltered\n");
refuses(fn () => $service->apply($changedJob, '/tmp/changed.sqlite'), 'changed file invalidates prepared run', 'Stale snapshot');
verify(DB::table('review_states')->where('matching_job_id', $changedJob)->count() === 0, 'stale file produces no writes');
$untrustedReference = $dataset('reference', 'untrusted-reference.csv', ['A'], false);
$untrustedInput = $dataset('input', 'untrusted-input.csv', ['Untrusted']);
$untrustedJob = $makeJob($untrustedInput);
DB::table('matching_jobs')->where('id', $untrustedJob)->update(['reference_dataset_id' => $untrustedReference]);
$result($untrustedJob, '1', 'Untrusted', 'matched', '1');
$service->prepare($untrustedJob, '/tmp/untrusted.sqlite', $root);
$service->apply($untrustedJob, '/tmp/untrusted.sqlite');
verify(DB::table('review_states')->where('matching_job_id', $untrustedJob)->first()->integrity_status === 'held' && DB::table('review_reference_holds')->where('matching_job_id', $untrustedJob)->count() === 1, 'unproven reference source retained but assignment held');
$service->rollback($untrustedJob, '/tmp/untrusted.sqlite');
$source = $dataset('input', 'alias.csv', ['Alias']);
$aliasJob = $makeJob($source);
$result($aliasJob, '1', 'Alias', 'matched', '3');
$service->prepare($aliasJob, '/tmp/alias.sqlite', $root);
$service->apply($aliasJob, '/tmp/alias.sqlite');
verify(DB::table('review_states')->where('matching_job_id', $aliasJob)->first()->active_reference_entity_group_id === $group, 'verified reference entity reusable in another job without cross-job collision');
$service->rollback($aliasJob, '/tmp/alias.sqlite');
$service->rollback($partialJob, '/tmp/partial.sqlite');
$service->rollback($missingJob, '/tmp/missing.sqlite');
// Business duplicate must be removed first, only from isolated test fixtures, before schema rollback.
DB::table('review_states')->where('id', $duplicate)->delete();
DB::table('review_states')->where('id', $canonical)->delete();
$holdsMigration->down();
verify(! DB::getSchemaBuilder()->hasTable('review_reference_holds'), 'Stage 3 schema rollback succeeds after explicit fixture cleanup');
$holdsMigration->up();
verify(DB::getSchemaBuilder()->hasTable('review_reference_holds'), 'Stage 3 schema reapply succeeds');

// Size test exercises disk-backed streaming, not a claim about a 300k production workload.
$largeNames = (function () {
    for ($n = 0; $n < 2000; $n++) {
        yield "Load $n";
    }
})();
$largeFile = "$root/load.csv";
$fh = fopen($largeFile, 'w');
fputcsv($fh, ['name']);
foreach ($largeNames as $name) {
    fputcsv($fh, [$name]);
} fclose($fh);
$large = uid();
DB::table('datasets')->insert(['id' => $large, 'user_id' => $actor, 'dataset_role' => 'input', 'name' => 'load', 'original_filename' => 'load.csv', 'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => filesize($largeFile), 'storage_path' => 'load.csv', 'row_count' => 2000, 'column_count' => 1, 'delimiter' => ',', 'header_row' => 1, 'parse_status' => 'inspected']);
$largeJob = $makeJob($large);
for ($n = 0; $n < 2000; $n++) {
    $result($largeJob, (string) ($n + 1), "Load $n", 'possible_match');
}
$loadStart = microtime(true);
$service->prepare($largeJob, '/tmp/load.sqlite', $root, 64);
$service->apply($largeJob, '/tmp/load.sqlite');
verify(DB::table('review_states')->where('matching_job_id', $largeJob)->count() === 2000, '2000-input bounded streaming run completed');
echo sprintf("LOAD %.3fs; PHP peak %.2f MiB; artifact %.2f MiB\n", microtime(true) - $loadStart, memory_get_peak_usage(true) / 1048576, filesize('/tmp/load.sqlite') / 1048576);
echo sprintf("SUCCESS %d assertions; total %.3fs\n", $assertions, microtime(true) - $start);
