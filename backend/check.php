<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$job = App\Models\MatchingJob::latest()->first();
echo json_encode(['id' => $job->id, 'count' => $job->results()->count(), 'processed' => $job->processed_count, 'total' => $job->total_count]) . "\n";
