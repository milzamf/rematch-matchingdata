<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$ds = App\Models\Dataset::first();
echo json_encode([
    'id' => $ds->id,
    'storage_path' => $ds->storage_path ?? null,
    'file_path' => $ds->file_path ?? null
]);
