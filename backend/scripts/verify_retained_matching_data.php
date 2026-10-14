<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;

$files = glob(storage_path('app/maintenance/prune-*.json'));
sort($files);
if ($files === []) throw new RuntimeException('Maintenance manifest missing.');
$plan = json_decode(file_get_contents($files[0]), true, 512, JSON_THROW_ON_ERROR);
$workspaceIds = DB::table('workspaces')->orderBy('id')->pluck('id')->all();
$expected = $plan['keep_workspace_ids'];
sort($expected);
if ($workspaceIds !== $expected) throw new RuntimeException('Retained workspaces changed.');
$decisions = DB::table('review_decisions')->whereIn('matching_job_id', $plan['keep_jobs'])->orderBy('id')->get();
if (hash('sha256', json_encode($decisions, JSON_THROW_ON_ERROR)) !== $plan['kept_decision_sha256']) {
    throw new RuntimeException('Retained decisions changed.');
}
if (DB::table('matching_jobs')->whereNotIn('id', $plan['keep_jobs'])->exists()) throw new RuntimeException('Unused jobs remain.');
$retainedRows = null;
if (in_array('--count-results', $argv, true)) {
    $counts = DB::table('matching_results')->whereIn('matching_job_id', $plan['keep_jobs'])
        ->selectRaw('matching_job_id, COUNT(*) AS rows_count')->groupBy('matching_job_id')->orderBy('matching_job_id')->get();
    if (json_encode($counts, JSON_THROW_ON_ERROR) !== json_encode($plan['kept_result_counts'], JSON_THROW_ON_ERROR)) {
        throw new RuntimeException('Retained result counts changed.');
    }
    if (DB::table('matching_results')->whereNotIn('matching_job_id', $plan['keep_jobs'])->exists()) throw new RuntimeException('Unused results remain.');
    $retainedRows = $counts->sum('rows_count');
}
echo json_encode([
    'workspaces' => count($workspaceIds),
    'jobs' => DB::table('matching_jobs')->count(),
    'datasets' => DB::table('datasets')->count(),
    'decisions' => count($decisions),
    'decision_hash_verified' => true,
    'retained_result_rows_verified' => $retainedRows,
    'unused_datasets_remaining' => DB::table('datasets')->whereIn('id', $plan['delete_dataset_ids'])->count(),
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
