<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$input_storage = 'datasets/F114t2L0DcC8Bg9tfMb6mYRszTwwPzSomVDXXZHx.xlsx';
$path = storage_path('app/private/' . $input_storage);

if (file_exists($path)) {
    echo "Found at: $path\n";
    $parser = new App\Services\Datasets\XlsxDatasetParser();
    $uploaded = new \Illuminate\Http\UploadedFile($path, 'test.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    $parsed = $parser->parse($uploaded, ['header_row' => 1]);
    echo "Rows parsed: " . count($parsed->rows) . "\n";
} else {
    echo "File not found\n";
}
