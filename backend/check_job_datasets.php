<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$job = App\Models\MatchingJob::find('01a03320-fc63-7385-9320-1a0effe6ca57');
echo json_encode([
    'input_ds' => $job->inputDataset->id,
    'input_storage' => $job->inputDataset->storage_path,
    'input_preview_count' => count($job->inputDataset->preview_rows ?? []),
    'ref_ds' => $job->referenceDataset->id,
    'ref_storage' => $job->referenceDataset->storage_path,
    'ref_preview_count' => count($job->referenceDataset->preview_rows ?? []),
]);
