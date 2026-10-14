<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;

$files = glob(storage_path('app/maintenance/prune-*.json'));
sort($files);
$plan = json_decode(file_get_contents($files[0]), true, 512, JSON_THROW_ON_ERROR);
$query = DB::table('matching_results')->whereIn('matching_job_id', $plan['keep_jobs'])
    ->select('id', 'matching_job_id', 'field_scores', 'candidate_metadata', 'verification_evidence')
    ->where('id', '>', '40000000-0000-0000-0000-000000000000')->orderBy('id')->limit(1000);
echo json_encode(DB::select('EXPLAIN '.$query->toSql(), $query->getBindings()), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
