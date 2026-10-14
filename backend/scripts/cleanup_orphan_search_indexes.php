<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

$manifests = glob(storage_path('app/maintenance/prune-*.json'));
sort($manifests);
if ($manifests === []) throw new RuntimeException('Cleanup manifest missing.');
$plan = json_decode(file_get_contents($manifests[0]), true, 512, JSON_THROW_ON_ERROR);
$removed = array_filter($plan['delete_dataset_ids'], static fn ($id) => !DB::table('datasets')->where('id', $id)->exists());
$client = Http::withToken(env('MEILISEARCH_KEY') ?: config('scout.meilisearch.key') ?: '')->timeout(30);
$host = rtrim(env('MEILISEARCH_HOST') ?: config('scout.meilisearch.host') ?: 'http://meilisearch:7700', '/');
$indexes = $client->get($host.'/indexes', ['limit' => 1000])->throw()->json('results', []);
$deleted = [];
foreach ($indexes as $index) {
    $uid = $index['uid'];
    foreach ($removed as $id) {
        if (!str_starts_with($uid, 'matching_reference_'.str_replace('-', '_', $id).'_')) continue;
        $deleted[] = $uid;
        if (in_array('--apply', $argv, true)) {
            $taskId = $client->delete($host.'/indexes/'.rawurlencode($uid))->throw()->json('taskUid');
            $deadline = microtime(true) + 120;
            do {
                $task = $client->get($host.'/tasks/'.$taskId)->throw()->json();
                if ($task['status'] === 'succeeded') break;
                if (in_array($task['status'], ['failed', 'canceled'], true)) throw new RuntimeException('Search-index cleanup failed.');
                if (microtime(true) > $deadline) throw new RuntimeException('Search-index cleanup timed out.');
                usleep(250000);
            } while (true);
        }
        break;
    }
}
echo json_encode(['orphan_indexes' => $deleted, 'applied' => in_array('--apply', $argv, true)], JSON_PRETTY_PRINT).PHP_EOL;
