<?php

/** Follow-up on the existing disposable fixture; never migrates or connects to main. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Str;

if (getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') throw new RuntimeException('Isolated fixture only');
$c = new Capsule;
$c->addConnection(['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci']);
$db = $c->getConnection();
$w = $db->table('workspaces')->where('name', 'Reader fixture')->first();
if (! $w || $db->getDatabaseName() !== 'rematch_stage4_test') throw new RuntimeException('Expected reader fixture');
$policy = new WorkspaceAccessService($db, true);
$reader = new SharedWorkspaceReader($db, $policy);
$checks = 0;
$check = function ($bool, $message) use (&$checks) { if (! $bool) throw new RuntimeException($message); $checks++; echo "PASS $message\n"; };
$list = $policy->workspaces($w->user_id);
$row = collect($list['data'])->firstWhere('id', $w->id);
$check($row['owner_name'] === 'owner' && $row['access_role'] === 'owner' && $row['matching_job_id'] === $w->matching_job_id, 'List enriches owner/role without dropping existing DTO fields');
$meta = $reader->workspace($w->user_id, $w->id);
$check($meta['job']->datasets['input_dataset_id']->id === $w->input_dataset_id && isset($meta['job']->review_counts['unmatched']), 'Actual job datasets and review progress are explicit');
$group = (string) Str::uuid();
$db->table('reference_entity_groups')->insert(['id' => $group, 'reference_dataset_id' => $w->reference_dataset_id, 'verified_by_user_id' => $w->user_id, 'verified_at' => date('Y-m-d H:i:s'), 'verification_note' => 'Verified test entity']);
foreach (['reader-ref-001', 'reader-group-other'] as $ref) $db->table('reference_entity_members')->insert(['id' => (string) Str::uuid(), 'reference_dataset_id' => $w->reference_dataset_id, 'reference_entity_group_id' => $group, 'reference_record_key' => $ref, 'verified_by_user_id' => $w->user_id, 'verified_at' => date('Y-m-d H:i:s')]);
$db->table('review_states')->insert(['id' => (string) Str::uuid(), 'matching_job_id' => $w->matching_job_id, 'reference_dataset_id' => $w->reference_dataset_id, 'input_record_key' => 'entity-claim', 'status' => 'matched', 'selected_reference_record_key' => 'reader-group-other', 'decision_origin' => 'auto', 'decision_protection' => 'open']);
$data = $reader->candidates($w->user_id, $w->id, $w->matching_job_id, '001', ['rank' => 1]);
$check($data['data'][0]['reference_occupied'], 'Verified group collision detected even with historical NULL group projection');
$db->table('review_reference_holds')->insert(['id' => (string) Str::uuid(), 'matching_job_id' => $w->matching_job_id, 'reference_dataset_id' => $w->reference_dataset_id, 'reference_record_key' => 'reader-ref-001', 'evidence_fingerprint' => str_repeat('a', 64)]);
$check($reader->candidates($w->user_id, $w->id, $w->matching_job_id, '001', ['rank' => 1])['data'][0]['integrity_hold'], 'Candidate reference hold exposed safely');
$foreign = $db->table('matching_results')->where('matching_job_id', '<>', $w->matching_job_id)->value('id');
$db->table('review_states')->where('matching_job_id', $w->matching_job_id)->where('input_record_key', '001')->update(['selected_matching_result_id' => $foreign]);
$state = $reader->review($w->user_id, $w->id, $w->matching_job_id, ['record_key' => '001'])['data'][0];
$check(! $state['selected_candidate_valid'] && $state['displayed_candidate'] === null && ! $state['actions']['review'], 'Unproven foreign selected ID never exposes candidate or enables write');
$db->table('review_states')->where('matching_job_id', $w->matching_job_id)->where('input_record_key', '001')->update(['selected_matching_result_id' => null]);
$bulk = $db->table('workspaces')->where('name', '300k reader fixture')->first();
$extra = [];
foreach (['similarity_desc', 'record_order'] as $sort) {
    $times = [];
    for ($i = 0; $i < 5; $i++) {
        $start = microtime(true);
        $r = $reader->review($bulk->user_id, $bulk->id, $bulk->matching_job_id, ['sort' => $sort, 'per_page' => 25]);
        $times[] = (microtime(true) - $start) * 1000;
        $check($r['data'][0]['input_record_key'] === '000000', 'Stable null score order across 300k states');
    }
    sort($times); $extra[$sort] = ['p50_ms' => $times[2], 'p95_ms' => $times[4], 'samples' => 5];
}
file_put_contents('/tmp/stage5c-edge-benchmark.json', json_encode(['checks' => $checks, 'profiles' => $extra, 'php_peak_mib' => memory_get_peak_usage(true) / 1048576], JSON_PRETTY_PRINT));
echo "SUCCESS $checks checks\n";
