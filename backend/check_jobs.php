<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$jobs = App\Models\MatchingJob::latest()->take(5)->get();
foreach ($jobs as $job) {
    echo json_encode(['id' => $job->id, 'created' => $job->created_at->toIso8601String(), 'count' => $job->results()->count(), 'processed' => $job->processed_count, 'total' => $job->total_count]) . "\n";
}
