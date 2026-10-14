<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$job = App\Models\MatchingJob::findOrFail($argv[1]);
echo json_encode(['cache_store' => config('cache.default'), 'job' => $job->id,
    'primary_counts' => $job->results()->where('candidate_rank', 1)->selectRaw('result_type, count(*) AS total')->groupBy('result_type')->pluck('total', 'result_type'),
], JSON_THROW_ON_ERROR).PHP_EOL;
if (in_array('--read', $argv, true)) {
    $started = microtime(true);
    $data = app(App\Services\Matching\ReviewResultService::class)->list(App\Models\User::where('role', 'admin')->firstOrFail(), $job->id,
        ['include_groups' => 'true', 'include_quality' => 'false', 'per_page' => 10]);
    echo json_encode(['elapsed_seconds' => microtime(true) - $started, 'peak_php_bytes' => memory_get_peak_usage(true),
        'groups' => array_map(fn ($g) => ['id' => $g['id'], 'count' => $g['item_count']], $data['case_groups'])], JSON_THROW_ON_ERROR).PHP_EOL;
}
