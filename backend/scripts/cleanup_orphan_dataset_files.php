<?php

// Only files from the recorded database inventory; never recursive directory deletion.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$path = storage_path('app/maintenance/dataset-paths-before-prune.json');
$inventory = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
$root = realpath(storage_path('app/private'));
if ($root === false) throw new RuntimeException('Dataset root missing.');
$count = $bytes = 0;
foreach ($inventory as $record) {
    if (Illuminate\Support\Facades\DB::table('datasets')->where('id', $record['id'])->orWhere('storage_path', $record['storage_path'])->exists()) continue;
    $target = realpath($root.DIRECTORY_SEPARATOR.$record['storage_path']);
    if ($target === false) continue;
    if (!str_starts_with($target, $root.DIRECTORY_SEPARATOR) || !is_file($target)) throw new RuntimeException('Unsafe dataset path.');
    $bytes += filesize($target);
    $count++;
    if (in_array('--apply', $argv, true) && !unlink($target)) throw new RuntimeException('Could not remove orphan dataset file.');
}
echo json_encode(['files' => $count, 'bytes' => $bytes, 'applied' => in_array('--apply', $argv, true)], JSON_PRETTY_PRINT).PHP_EOL;
