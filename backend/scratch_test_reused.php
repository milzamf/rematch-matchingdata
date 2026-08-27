<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Services\Matching\MatchingEngineService;
use App\Models\Workspace;

$workspace = Workspace::first();
if (!$workspace) {
    echo "No workspace found.\n";
    exit(1);
}

// Find a job with reference dataset
$job = MatchingJob::with(['referenceDataset', 'inputDataset'])->latest()->first();
if (!$job) {
    echo "No matching job found.\n";
    exit(1);
}

$engine = app(MatchingEngineService::class);
echo "Running first time...\n";
$engine->runJob($job);

echo "Running second time...\n";
$engine->runJob($job);
