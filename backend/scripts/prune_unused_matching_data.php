<?php

// Explicit maintenance for the seven workspaces selected by the user on 2026-10-12.
// Dry run by default. --apply deletes unrelated data; --compact packs retained results.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use App\Models\MatchingResult;
use App\Services\Matching\MatchingResultStorage;

DB::disableQueryLog();
$startedAt = hrtime(true);
$keep = [
    '01a0d658-1f0d-72f3-912b-e1c4c25c28da', '01a11f7b-ae85-7219-b8a4-8f50a1c0f4f7',
    '01a12524-0619-7395-865d-23bcc902c473', '01a12b7a-6c72-7106-8c64-b705aa64c83e',
    '01a12d3f-45f5-72bd-bb53-6933ef9a155d', '01a12dc8-c400-710f-9f48-c63971a3aaf8',
    '01a12e5d-5bb8-7081-92f9-3c185bd61ac8',
];
$workspaces = DB::table('workspaces')->whereIn('id', $keep)->get();
if (count($workspaces) !== 7 || DB::table('workspaces')->count() !== 7) throw new RuntimeException('Workspace selection changed; refusing maintenance.');
if (DB::table('jobs')->count() !== 0) throw new RuntimeException('Queue must be empty during maintenance.');
$state = json_encode($workspaces, JSON_THROW_ON_ERROR);
$jobs = DB::table('matching_jobs')->get();
$keptJobs = $removedJobs = $datasets = [];
foreach ($workspaces as $w) foreach ([$w->reference_dataset_id, $w->input_dataset_id] as $id) if ($id) $datasets[$id] = true;
foreach ($jobs as $j) {
    if (in_array($j->workspace_id, $keep, true) || str_contains($state, $j->id)) {
        $keptJobs[] = $j->id;
        $datasets[$j->reference_dataset_id] = $datasets[$j->input_dataset_id] = true;
    } else $removedJobs[] = $j->id;
}
foreach (DB::table('column_mappings AS m')->join('dataset_columns AS c', function ($join) {
    $join->on('c.id', '=', 'm.reference_column_id')->orOn('c.id', '=', 'm.input_column_id');
})->whereIn('m.matching_job_id', $keptJobs)->distinct()->pluck('c.dataset_id') as $id) $datasets[$id] = true;
foreach (DB::table('datasets')->get() as $d) {
    if (in_array($d->workspace_id, $keep, true) || str_contains($state, $d->id)) $datasets[$d->id] = true;
}
$removedDatasets = DB::table('datasets')->whereNotIn('id', array_keys($datasets))->get();
$decisions = DB::table('review_decisions')->whereIn('matching_job_id', $keptJobs)->orderBy('id')->get();
$decisionHash = hash('sha256', json_encode($decisions, JSON_THROW_ON_ERROR));
$prior = null;
foreach (glob(storage_path('app/maintenance/prune-*.json')) as $file) {
    $candidate = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    if (($candidate['keep_jobs'] ?? []) === $keptJobs && ($candidate['kept_decision_sha256'] ?? '') === $decisionHash) { $prior = $candidate; break; }
}
$keptCounts = $prior !== null ? collect(array_map(static fn ($r) => (object) $r, $prior['kept_result_counts']))
    : DB::table('matching_results')->whereIn('matching_job_id', $keptJobs)
        ->selectRaw('matching_job_id, COUNT(*) AS rows_count')->groupBy('matching_job_id')->orderBy('matching_job_id')->get();
$plan = ['keep_workspace_ids' => $keep, 'keep_jobs' => $keptJobs, 'delete_jobs' => $removedJobs,
    'delete_dataset_ids' => $removedDatasets->pluck('id')->all(),
    'delete_results' => $prior['delete_results'] ?? DB::table('matching_results')->whereIn('matching_job_id', $removedJobs)->count(),
    'using_verified_original_manifest' => $prior !== null,
    'kept_result_counts' => $keptCounts, 'kept_review_decisions' => count($decisions), 'kept_decision_sha256' => $decisionHash];
echo json_encode($plan, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
if (!in_array('--apply', $argv, true)) exit(0);
if (in_array('--compact', $argv, true) && DB::getDriverName() === 'mysql') {
    $logging = DB::selectOne('SELECT @@global.log_bin AS enabled, @@session.binlog_row_image AS row_image');
    if ($logging->enabled && $logging->row_image === 'FULL') {
        throw new RuntimeException('Mass conversion refused: FULL binary logging can grow disk usage. Obtain approval for MINIMAL row logging first; this script never changes global settings.');
    }
}
$manifestPath = storage_path('app/maintenance/prune-'.date('Ymd-His').'.json');
if (!is_dir(dirname($manifestPath))) mkdir(dirname($manifestPath), 0755, true);
file_put_contents($manifestPath, json_encode($plan, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
$deleted = 0;
$nextDeleteReport = 50000;
foreach ($removedJobs as $id) {
    do {
        $n = DB::delete('DELETE FROM matching_results WHERE matching_job_id = ? LIMIT 5000', [$id]);
        $deleted += $n;
        if ($deleted >= $nextDeleteReport) {
            echo "Deleted unused results: {$deleted}".PHP_EOL;
            $nextDeleteReport = $deleted + 50000;
        }
    } while ($n > 0);
    DB::table('matching_jobs')->where('id', $id)->delete();
}
foreach ($removedDatasets as $d) {
    if (DB::table('matching_jobs')->where('reference_dataset_id', $d->id)->orWhere('input_dataset_id', $d->id)->exists()) throw new RuntimeException('Dataset still referenced.');
    DB::table('datasets')->where('id', $d->id)->delete();
}
echo "Unused jobs/datasets removed; {$deleted} result rows deleted.".PHP_EOL;
$compacted = $savedBytes = $alreadyPacked = $smallUnchanged = 0;
$scannedCounts = [];
if (in_array('--compact', $argv, true)) {
        // Indexed staging avoids quadratic CASE evaluation for large JSON batches.
        DB::statement('CREATE TEMPORARY TABLE maintenance_matching_payloads (id CHAR(36) COLLATE utf8mb4_unicode_ci PRIMARY KEY, candidate_metadata JSON NOT NULL, field_scores JSON NOT NULL) ENGINE=InnoDB');
        // A single primary-key pass avoids scanning the large table once per job.
        DB::table('matching_results')->whereIn('matching_job_id', $keptJobs)->select('id', 'matching_job_id', 'field_scores', 'candidate_metadata', 'verification_evidence')
            ->chunkById(1000, function ($rows) use (&$compacted, &$savedBytes, &$scannedCounts, &$alreadyPacked, &$smallUnchanged) {
                $updates = [];
                foreach ($rows as $r) {
                    $scannedCounts[$r->matching_job_id] = ($scannedCounts[$r->matching_job_id] ?? 0) + 1;
                    $meta = json_decode($r->candidate_metadata ?? '{}', true, 512, JSON_THROW_ON_ERROR);
                    if (isset($meta['_field_scores']) && $r->verification_evidence === null) { $alreadyPacked++; continue; }
                    $original = (new MatchingResult())->setRawAttributes((array) $r);
                    $fields = $original->field_scores ?? [];
                    $evidence = $original->verification_evidence;
                    $packed = MatchingResultStorage::pack($meta, $fields, $evidence);
                    $check = (new MatchingResult())->setRawAttributes($packed);
                    if ($check->field_scores !== $fields || $check->verification_evidence !== $evidence) throw new RuntimeException('Lossless verification failed.');
                    foreach (['input_record', 'reference_record'] as $key) {
                        if (($check->candidate_metadata[$key] ?? null) !== ($meta[$key] ?? null)) throw new RuntimeException('Source record changed.');
                    }
                    $before = strlen($r->field_scores ?? '') + strlen($r->candidate_metadata ?? '') + strlen($r->verification_evidence ?? '');
                    $after = strlen($packed['field_scores']) + strlen($packed['candidate_metadata']);
                    // Preserve small records if packing would increase their payload.
                    if ($after >= $before) { $smallUnchanged++; continue; }
                    $savedBytes += $before - $after;
                    $updates[] = ['id' => $r->id, 'candidate_metadata' => $packed['candidate_metadata'], 'field_scores' => $packed['field_scores']];
                }
                if ($updates !== []) {
                    // Reset the private staging table: repeated DELETE retains old
                    // temporary-table pages and eventually makes every batch slower.
                    DB::statement('TRUNCATE TABLE maintenance_matching_payloads');
                    DB::table('maintenance_matching_payloads')->insert($updates);
                    DB::update('UPDATE matching_results AS r INNER JOIN maintenance_matching_payloads AS p ON p.id = r.id SET r.candidate_metadata = p.candidate_metadata, r.field_scores = p.field_scores, r.verification_evidence = NULL');
                    $compacted += count($updates);
                    if ($compacted % 10000 < count($updates)) echo "Packed {$compacted} rows; saved {$savedBytes} payload bytes".PHP_EOL;
                }
            });
}
$afterCounts = in_array('--compact', $argv, true)
    ? collect($scannedCounts)->sortKeys()->map(static fn ($n, $id) => (object) ['matching_job_id' => $id, 'rows_count' => $n])->values()
    : DB::table('matching_results')->whereIn('matching_job_id', $keptJobs)
        ->selectRaw('matching_job_id, COUNT(*) AS rows_count')->groupBy('matching_job_id')->orderBy('matching_job_id')->get();
$afterDecisions = DB::table('review_decisions')->whereIn('matching_job_id', $keptJobs)->orderBy('id')->get();
if (json_encode($keptCounts) !== json_encode($afterCounts) || $decisionHash !== hash('sha256', json_encode($afterDecisions))) throw new RuntimeException('Preserved result count or decisions changed.');
$summary = ['deleted_results' => $deleted, 'compacted_results' => $compacted, 'payload_bytes_saved' => $savedBytes,
    'already_compact_results' => $alreadyPacked, 'unchanged_small_results' => $smallUnchanged,
    'preserved_workspaces' => 7, 'decisions_verified' => count($afterDecisions),
    'preserved_result_rows' => $afterCounts->sum('rows_count'),
    'elapsed_seconds' => round((hrtime(true) - $startedAt) / 1e9, 2),
    'peak_php_bytes' => memory_get_peak_usage(true), 'manifest' => $manifestPath];
$summaryJson = json_encode($summary, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
file_put_contents(storage_path('app/maintenance/compact-summary-'.date('Ymd-His').'.json'), $summaryJson);
echo $summaryJson.PHP_EOL;
