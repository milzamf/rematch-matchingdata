<?php

require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;
if (getenv('REMATCH_BACKFILL_TEST') !== 'isolated-stage3') throw new RuntimeException('Isolated schema fixture only');
$c = new Capsule;
$c->addConnection(['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage3_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci']);
$c->setAsGlobal(); $db = $c->getConnection();
$container = $c->getContainer(); $container->instance('db', $c->getDatabaseManager()); $container->bind('db.schema', fn () => $db->getSchemaBuilder()); Facade::setFacadeApplication($container);
$checks = 0;
$check = function ($ok, $msg) use (&$checks) { if (! $ok) throw new RuntimeException($msg); $checks++; echo "PASS $msg\n"; };
$snapshot = fn () => (array) $db->selectOne("SELECT COUNT(*) n, BIT_XOR(CRC32(CONCAT_WS('|',id,input_record_key,status,COALESCE(decision,''),version,COALESCE(reviewer_user_id,''),COALESCE(selected_matching_result_id,'')))) checksum FROM review_states");
$before = $snapshot(); $history = $db->table('review_decisions')->count();
$migration = require __DIR__.'/../database/migrations/2026_10_13_000004_add_review_display_score_indexes.php';
$migration->down(); $check($snapshot() === $before, 'Projection rollback preserves keys, versions, decisions and authors');
$migration->up(); $check($snapshot() === $before && $db->table('review_decisions')->count() === $history, 'Additive reapply does not backfill or rewrite history');
$check($db->table('review_states')->where('display_score_indexed', false)->count() === $before['n'], 'Existing states explicitly remain unindexed for safe reader fallback');
$last = null;
do {
    $q = $db->table('review_states')->orderBy('id')->limit(200);
    if ($last !== null) $q->where('id', '>', $last);
    $ids = $q->pluck('id');
    if ($ids->isNotEmpty()) { $db->table('review_states')->whereIn('id', $ids)->update(['display_score_indexed' => true]); $last = $ids->last(); }
} while ($ids->count() === 200);
$check($db->table('review_states')->where('display_score_indexed', false)->count() === 0 && $snapshot() === $before, 'Bounded projection refresh leaves effective state/version unchanged');
$mismatch = $db->selectOne("SELECT COUNT(*) n FROM review_states s LEFT JOIN matching_results p ON p.matching_job_id=s.matching_job_id AND p.input_record_key=CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci AND BINARY p.input_record_key=BINARY s.input_record_key AND p.candidate_rank=1 LEFT JOIN matching_results c ON c.id=s.selected_matching_result_id AND c.matching_job_id=s.matching_job_id AND BINARY c.input_record_key=BINARY s.input_record_key WHERE NOT (s.display_score <=> CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END)");
$check((int) $mismatch->n === 0, 'Every projection equals actual selected-or-primary immutable score, NULL-safe');
$indexes = $db->select("SHOW INDEX FROM review_states WHERE Key_name LIKE 'review_display_%'");
$check(count(array_unique(array_column($indexes, 'Key_name'))) === 5, 'Ascending/descending, status/all and readiness indexes present');
$state = $db->table('review_states')->whereNotNull('selected_matching_result_id')->first();
if ($state) {
    $db->table('review_states')->where('id', $state->id)->update(['display_score' => 12.34]);
    $expected = $db->table('matching_results')->where('id', $state->selected_matching_result_id)->value('overall_score');
    $actual = $db->table('review_states')->where('id', $state->id)->value('display_score');
    $check($actual === $expected, 'Projection cannot be overwritten with an arbitrary score');
}
$source = $db->table('matching_jobs')->first();
$job = (string) \Illuminate\Support\Str::uuid();
$db->table('matching_jobs')->insert(['id' => $job, 'input_dataset_id' => $source->input_dataset_id, 'reference_dataset_id' => $source->reference_dataset_id, 'status' => 'completed']);
$primary = (string) \Illuminate\Support\Str::uuid(); $alternative = (string) \Illuminate\Support\Str::uuid();
foreach ([$primary => [1,95], $alternative => [2,63]] as $id => [$rank,$score]) $db->table('matching_results')->insert(['id' => $id, 'matching_job_id' => $job, 'input_record_key' => '001', 'reference_record_key' => 'ref-'.$rank, 'candidate_rank' => $rank, 'overall_score' => $score, 'result_type' => 'possible_match']);
$stateId = (string) \Illuminate\Support\Str::uuid();
$db->table('review_states')->insert(['id' => $stateId, 'matching_job_id' => $job, 'reference_dataset_id' => $source->reference_dataset_id, 'input_record_key' => '001', 'selected_matching_result_id' => $alternative]);
$check((float) $db->table('review_states')->where('id', $stateId)->value('display_score') === 63.0, 'Insert projects chosen rank, not primary or highest score');
$db->table('review_states')->where('id', $stateId)->update(['display_score' => 12.34]);
$check((float) $db->table('review_states')->where('id', $stateId)->value('display_score') === 63.0, 'Cannot inject arbitrary display score');
$db->table('review_states')->where('id', $stateId)->update(['selected_matching_result_id' => null]);
$check((float) $db->table('review_states')->where('id', $stateId)->value('display_score') === 95.0, 'Removing selected candidate restores primary score');
$check((int) $db->table('review_states')->where('id', $stateId)->value('version') === 1, 'Projection refresh does not invent decision versions');
echo "SUCCESS $checks projection checks; PHP peak ".(memory_get_peak_usage(true)/1048576)." MiB\n";
