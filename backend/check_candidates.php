<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$input_storage = 'datasets/F114t2L0DcC8Bg9tfMb6mYRszTwwPzSomVDXXZHx.xlsx';
$candidates = [
    \Illuminate\Support\Facades\Storage::disk('local')->path($input_storage),
    storage_path('app/' . $input_storage),
    storage_path('app/private/' . $input_storage),
    $input_storage,
];

foreach ($candidates as $c) {
    echo "Candidate: $c\n";
    echo "  file_exists: " . (file_exists($c) ? "YES" : "NO") . "\n";
    echo "  is_readable: " . (is_readable($c) ? "YES" : "NO") . "\n";
}
