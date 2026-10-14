<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (Illuminate\Support\Facades\DB::table('jobs')->count() !== 0) throw new RuntimeException('Queue must be empty.');
$manifests = glob(storage_path('app/maintenance/prune-*.json'));
sort($manifests);
if ($manifests === []) throw new RuntimeException('Verified cleanup manifest missing.');
$plan = json_decode(file_get_contents($manifests[0]), true, 512, JSON_THROW_ON_ERROR);
$remove = $plan['delete_jobs'];
$paths = array_unique([storage_path('app/matching_checkpoints.sqlite'), rtrim(env('MATCHING_CACHE_PATH') ?: storage_path('app'), '/').'/matching_checkpoints.sqlite']);
foreach ($paths as $path) {
    if (!is_file($path)) continue;
    $before = filesize($path);
    $pdo = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]);
    $pdo->exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE');
    $pdo->exec('PRAGMA auto_vacuum=INCREMENTAL');
    $marks = implode(',', array_fill(0, count($remove), '?'));
    $stmt = $pdo->prepare("SELECT checkpoint_key FROM matching_checkpoints WHERE matching_job_id IN ({$marks})");
    $stmt->execute($remove);
    $keys = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $remaining = (int) $pdo->query('SELECT COUNT(*) FROM matching_checkpoints')->fetchColumn() - count($keys);
    $pdo->beginTransaction();
    $chunks = $pdo->prepare('DELETE FROM matching_checkpoint_chunks WHERE checkpoint_key = ?');
    $header = $pdo->prepare('DELETE FROM matching_checkpoints WHERE checkpoint_key = ?');
    foreach ($keys as $key) { $chunks->execute([$key]); $header->execute([$key]); }
    $pdo->commit();
    $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    $pdo->exec('VACUUM');
    $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if ((int) $pdo->query('SELECT COUNT(*) FROM matching_checkpoints')->fetchColumn() !== $remaining) throw new RuntimeException('Checkpoint preservation failed.');
    clearstatcache(true, $path);
    echo json_encode(['path' => $path, 'removed_checkpoint_headers' => count($keys), 'retained_headers' => $remaining,
        'before_bytes' => $before, 'after_bytes' => filesize($path)], JSON_THROW_ON_ERROR).PHP_EOL;
}
