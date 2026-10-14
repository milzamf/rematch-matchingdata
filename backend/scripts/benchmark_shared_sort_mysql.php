<?php

require __DIR__.'/../vendor/autoload.php';
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Database\Capsule\Manager as Capsule;
if (getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') throw new RuntimeException('Isolated benchmark only');
$c = new Capsule;
$c->addConnection(['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci']);
$db = $c->getConnection();
$w = $db->table('workspaces')->where('name', '300k reader fixture')->first();
if (! $w || $db->getDatabaseName() !== 'rematch_stage4_test') throw new RuntimeException('Missing isolated 300k fixture');
$policy = new WorkspaceAccessService($db, true);
$reader = new SharedWorkspaceReader($db, $policy);
// Same reader/fixture/server with only the projection branch disabled. This
// temporary class is benchmark-only; there is no public runtime bypass flag.
$source = file_get_contents(__DIR__.'/../app/Services/Workspace/SharedWorkspaceReader.php');
$source = str_replace('final class SharedWorkspaceReader', 'final class JoinedReaderBaseline', $source);
$source = preg_replace('/\$projected = \$scoreQuery[^;]+;/', '\$projected = false;', $source, 1, $changed);
if ($changed !== 1) throw new RuntimeException('Baseline projection branch not found');
file_put_contents('/tmp/joined-reader-baseline.php', $source);
require '/tmp/joined-reader-baseline.php';
$baseline = new \App\Services\Workspace\JoinedReaderBaseline($db, $policy);
$legacySql = "SELECT s.* FROM review_states s LEFT JOIN matching_results p ON p.matching_job_id=s.matching_job_id AND p.input_record_key=s.input_record_key AND BINARY p.input_record_key=BINARY s.input_record_key AND p.candidate_rank=1 LEFT JOIN matching_results c ON c.id=s.selected_matching_result_id AND c.matching_job_id=s.matching_job_id AND BINARY c.input_record_key=BINARY s.input_record_key WHERE s.matching_job_id=? ORDER BY (CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END) IS NULL ASC, (CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END) DESC, s.input_record_key ASC LIMIT 25";
$newSql = 'SELECT s.* FROM review_states s USE INDEX (review_display_all_desc_idx) WHERE s.matching_job_id=? ORDER BY s.display_score_null ASC, s.display_score DESC, s.input_record_key ASC LIMIT 25';
$output = ['rows' => 300000, 'samples' => 20, 'before_explain_analyze' => $db->select('EXPLAIN ANALYZE '.$legacySql, [$w->matching_job_id]), 'after_explain_analyze' => $db->select('EXPLAIN ANALYZE '.$newSql, [$w->matching_job_id])];
$old = $db->select($legacySql, [$w->matching_job_id]); $new = $db->select($newSql, [$w->matching_job_id]);
if (array_column($old, 'input_record_key') !== array_column($new, 'input_record_key')) throw new RuntimeException('Sorting changed');
foreach (['before_sql' => fn () => $db->select($legacySql, [$w->matching_job_id]), 'after_sql' => fn () => $db->select($newSql, [$w->matching_job_id]), 'before_reader' => fn () => $baseline->review($w->user_id, $w->id, $w->matching_job_id, ['sort' => 'similarity_desc']), 'after_reader' => fn () => $reader->review($w->user_id, $w->id, $w->matching_job_id, ['sort' => 'similarity_desc'])] as $profile => $run) {
    $times = []; $queries = []; $bytes = [];
    for ($i = 0; $i < 21; $i++) {
        $db->flushQueryLog(); $db->enableQueryLog(); $start = microtime(true); $data = $run();
        if ($i) { $times[] = 1000 * (microtime(true) - $start); $queries[] = count($db->getQueryLog()); $bytes[] = strlen(json_encode($data)); }
        $db->disableQueryLog();
    }
    sort($times); $output[$profile] = ['p50_ms' => $times[9], 'p95_ms' => $times[18], 'queries' => max($queries), 'bytes' => max($bytes)];
}
$output['php_peak_mib'] = memory_get_peak_usage(true) / 1048576;
file_put_contents('/tmp/shared-sort-benchmark.json', json_encode($output, JSON_PRETTY_PRINT));
echo json_encode($output, JSON_PRETTY_PRINT)."\n";
if ($output['after_reader']['p95_ms'] > 1000) throw new RuntimeException('Reader p95 target missed');
