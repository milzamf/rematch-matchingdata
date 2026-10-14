<?php

// All Stage 4/5A fixtures and independent-connection regressions, fixed disposable DB.
require __DIR__.'/test_workspace_access_mysql.php';

use App\Services\Workspace\SharedWorkspaceReader;

$before = $assertions;
// Dedicated reader job so prior regression keys/decisions are never reused or changed.
$job = uid(); $workspace = uid();
$db->table('matching_jobs')->insert(['id' => $job, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'status' => 'completed', 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
$db->table('workspaces')->insert(['id' => $workspace, 'user_id' => $owner, 'name' => 'Reader fixture', 'matching_job_id' => $job, 'input_dataset_id' => $input, 'reference_dataset_id' => $reference]);
$db->table('matching_jobs')->where('id', $job)->update(['workspace_id' => $workspace]);
$members()->set($owner, $workspace, $editor, 'editor', 0);
$members()->set($owner, $workspace, $viewer, 'viewer', 0);
$seed = function (string $key, string $ref, array $changes = []) use ($db, $job, $reference) {
    $id = uid();
    $db->table('matching_results')->insert(['id' => $id, 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => $ref, 'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 98]);
    $db->table('review_states')->insert(array_replace(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => $key, 'status' => 'possible_match', 'decision_origin' => 'auto', 'decision_protection' => 'open', 'lineage_status' => 'verified', 'source_occurrence_count' => 1], $changes));
    return ['input_record_key' => $key, 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $id];
};
$reader = fn () => new SharedWorkspaceReader($db, $access());
$read = fn ($who, $options = []) => $reader()->review($who, $workspace, $job, $options);
$one = fn ($who, $key) => $read($who, ['record_key' => $key])['data'][0];
foreach ([$owner, $editor, $viewer, $actors[1], $people['pimpinan']] as $who) {
    $w = $reader()->workspace($who, $workspace);
    verify($w['owner']->id === $owner && $w['job']->ready, 'Scoped workspace with actual owner/job/readiness');
}
verify($reader()->workspace($viewer, $workspace)['configuration'] === null, 'Viewer configuration is not exposed');
refuses(fn () => $reader()->workspace($people['outsider'], $workspace), 'workspace_forbidden', 403);
refuses(fn () => $reader()->review($actors[1], $otherWorkspace, $job, []), 'workspace_resource_forbidden', 403);
refuses(fn () => $reader()->dataset($editor, $workspace, $privateDataset, []), 'workspace_resource_forbidden', 403);
$a = $seed('001', 'reader-ref-001');
$b = $seed('1', 'reader-ref-1');
verify($one($viewer, '001')['input_record_key'] === '001' && $one($viewer, '1')['input_record_key'] === '1', 'Opaque 001 and 1 distinct');
$second = uid();
$db->table('matching_results')->insert(['id' => $second, 'matching_job_id' => $job, 'input_record_key' => '001', 'reference_record_key' => 'reader-rank2', 'candidate_rank' => 2, 'overall_score' => 63, 'result_type' => 'possible_match', 'candidate_metadata' => json_encode(['input_record' => ['nama' => 'Input'], 'reference_record' => ['nama' => 'Reference']]), 'field_scores' => '[]']);
$rank = $reader()->candidates($viewer, $workspace, $job, '001', ['rank' => 2]);
verify(count($rank['data']) === 1 && $rank['data'][0]['id'] === $second && $rank['data'][0]['score'] === 63.0, 'Rank-specific immutable candidate snapshot');
verify(! $one($viewer, '001')['actions']['review'], 'Viewer state has no write action');
$ack = $shared()->decide($owner, $job, 'reader-accept', [$a]);
verify($one($editor, '001')['decision'] === 'accept_match' && $one($editor, '001')['version'] === 2, 'Read after accept exposes committed version');
$ack2 = $shared()->decide($owner, $job, 'reader-select', [['input_record_key' => '001', 'expected_version' => 2, 'decision' => 'select_candidate', 'candidate_id' => $second]]);
verify($one($editor, '001')['similarity_score'] === 63.0 && $one($editor, '001')['displayed_candidate']['rank'] === 2, 'Selected reviewer candidate drives score');
verify($read($viewer, ['similarity_max' => 70])['pagination']['total'] === 1 && $read($viewer, ['sort' => 'similarity_asc', 'per_page' => 1])['data'][0]['input_record_key'] === '001', 'Filter and cross-page score sorting use selected candidate');
$shared()->undo($owner, $job, 'reader-undo', $ack2['operation_id'], [['input_record_key' => '001', 'expected_version' => 3]]);
verify($one($viewer, '001')['version'] === 4 && $one($viewer, '001')['selected_matching_result_id'] === $a['candidate_id'], 'Read after Undo obtains actual version and restored candidate');
$shared()->decide($owner, $job, 'reader-reject', [array_replace($b, ['decision' => 'reject_match'])]);
verify($one($viewer, '1')['status'] === 'possible_match' && $one($viewer, '1')['decision'] === 'reject_match', 'Reject stays review, not unmatched');
$shared()->decide($owner, $job, 'reader-unmatched', [['input_record_key' => '1', 'expected_version' => 2, 'decision' => 'mark_unmatched']]);
verify($one($viewer, '1')['status'] === 'unmatched', 'Read confirmed unmatched');
$p = $shared()->propose($editor, $job, 'reader-propose', ['input_record_key' => '001', 'expected_version' => 4, 'decision' => 'mark_unmatched'], 'Reader integration');
verify($one($viewer, '001')['version'] === 4, 'Pending proposal leaves effective version unchanged');
$shared()->resolve($owner, $job, 'reader-approve', $p['items'][0]['request_id'], 1, true);
$s = $one($editor, '001');
verify($s['decision_protection'] === 'approved' && $s['actors']['reviewer']['id'] === $editor && $s['actors']['approver']['id'] === $owner && $s['actions']['requires_proposal'], 'Approved decision author and approver remain separate, including same author');
$p = $shared()->propose($editor, $job, 'reader-propose-reject', ['input_record_key' => '001', 'expected_version' => 5, 'decision' => 'accept_match', 'candidate_id' => $a['candidate_id']], 'Rejected revision');
$shared()->resolve($owner, $job, 'reader-reject-proposal', $p['items'][0]['request_id'], 1, false, 'Keep current');
verify($one($viewer, '001')['version'] === 5 && $one($viewer, '001')['decision'] === 'mark_unmatched', 'Proposal rejection leaves actual effective state intact');
$held = $seed('reader-held', 'reader-held-ref', ['integrity_status' => 'held']);
verify($one($owner, 'reader-held')['integrity_status'] === 'held' && ! $one($owner, 'reader-held')['actions']['review'], 'Integrity hold blocks affected record only');
$seed('reader-duplicate', 'reader-duplicate-ref', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => '1']);
verify($one($viewer, 'reader-duplicate')['duplicate_of_input_record_key'] === '1', 'Business duplicate canonical lineage preserved');
$db->table('matching_jobs')->where('id', $job)->update(['review_state_readiness' => 'pending']);
verify(! $reader()->workspace($owner, $workspace)['job']->ready, 'Unready workspace metadata readable');
refuses(fn () => $read($owner), 'review_state_not_ready');
$db->table('matching_jobs')->where('id', $job)->update(['review_state_readiness' => 'ready']);
$rev = $members()->set($owner, $workspace, $viewer, null, (int) $db->table('workspace_members')->where('workspace_id', $workspace)->where('user_id', $viewer)->value('version'));
refuses(fn () => $read($viewer), 'workspace_forbidden', 403);
$members()->set($owner, $workspace, $viewer, 'viewer', $rev['version']);
$response = $api($editor, 'GET', "workspaces/$workspace/jobs/$job/review-results?record_key=001");
verify($response['status'] === 200 && $response['body']['data']['data'][0]['version'] === 5, 'Laravel HTTP reader follows effective version');
verify($api($owner, 'GET', "workspaces/$workspace/jobs/$job/review-results?user_id=$owner")['status'] === 422, 'HTTP actor spoofing/unknown params rejected');
verify($api($owner, 'GET', "workspaces/$workspace/jobs/$job/review-results?similarity_min=99&similarity_max=50")['status'] === 422, 'HTTP invalid similarity range rejected');
verify($api($owner, 'GET', "workspaces/$workspace/jobs/$job/candidates?record_key=001&rank=2")['status'] === 200, 'HTTP candidate pagination scoped');
verify($api($owner, 'GET', "workspaces/$workspace/datasets/$privateDataset/rows")['status'] === 403, 'HTTP private dataset IDOR denied');
$db->table('datasets')->where('id', $input)->update(['preview_rows' => json_encode([['nama' => 'First'], ['nama' => 'Second']])]);
$preview = $reader()->dataset($editor, $workspace, $input, ['per_page' => 1, 'page' => 2]);
verify($preview['partial'] && $preview['total'] === 2 && $preview['data'][0]['nama'] === 'Second', 'Missing source preview stays partial with honest pagination');
verify($api($editor, 'GET', "workspaces/$workspace/datasets/$input/rows?per_page=1&page=2")['body']['data']['total'] === 2, 'HTTP preview pagination follows scoped actual snapshot');
refuses(fn () => $reader()->candidates($editor, $workspace, $job, '001 ', []), 'review_record_not_found', 404);
$padded = $seed(' padded ', 'padded-ref');
verify($api($editor, 'GET', "workspaces/$workspace/jobs/$job/candidates?record_key=%20padded%20")['body']['data']['input_record_key'] === ' padded ', 'HTTP exact padded key maintained');
refuses(fn () => $read($editor, ['input_province_code' => '32']), 'review_regions_not_ready');
$db->table('matching_results')->where('matching_job_id', $job)->where('candidate_rank', 1)->update(['input_region_indexed' => true]);
$db->table('matching_results')->where('id', $a['candidate_id'])->update(['input_province_code' => '32', 'input_regency_code' => '3204']);
verify($read($viewer, ['input_province_code' => '32', 'input_regency_code' => '3204'])['pagination']['total'] === 1, 'Indexed input region filters applied before paging');
verify($read($viewer, ['sort' => 'similarity_asc', 'per_page' => 1])['data'][0]['similarity_score'] === 98.0, 'Similarity tie ordering stable');
verify($read($viewer, ['search' => 'Input'])['pagination']['total'] === 0, 'Search uses rank-one input snapshot, not selected reference or legacy decisions');
verify($one($viewer, 'reader-duplicate')['canonical']->input_record_key === '1', 'Canonical state is scoped and batch fetched');
verify((int) $db->table('datasets')->where('id', $input)->value('row_count') === 5000, 'Partial preview does not mutate source metadata');
file_put_contents('/tmp/stage5c-dataset.csv', "nama,id\nAlpha,001\nBeta,1\nGamma,3\n");
$app['config']->set('filesystems.disks.local.root', '/tmp');
$app['filesystem']->forgetDisk('local');
$db->table('datasets')->where('id', $input)->update(['storage_path' => 'stage5c-dataset.csv', 'row_count' => 3]);
$preview = $reader()->dataset($viewer, $workspace, $input, ['page' => 2, 'per_page' => 1]);
verify(! $preview['partial'] && $preview['data'][0]['nama'] === 'Beta', 'Actual CSV source streams paginated rows');
verify($reader()->dataset($viewer, $workspace, $input, ['search' => 'Gamma'])['total'] === 1, 'CSV search streams without whole dataset RAM');
$packed = \App\Services\Matching\MatchingResultStorage::pack(['input_record' => ['nama' => 'Input']], [['score' => 92.25, 'detail' => str_repeat('address ', 100)]], ['reason' => str_repeat('evidence ', 100)]);
$db->table('matching_results')->where('id', $second)->update($packed);
verify($reader()->candidates($editor, $workspace, $job, '001', ['rank' => 2])['data'][0]['field_scores'][0]['score'] === 92.25, 'Packed existing score explanation decoded losslessly');
$db->table('matching_results')->where('id', $second)->update(['candidate_metadata' => json_encode(['_field_scores' => 'gz1:'.base64_encode(gzencode(str_repeat('x', 2097153)))])]);
refuses(fn () => $reader()->candidates($editor, $workspace, $job, '001', ['rank' => 2]), 'reader_payload_too_large', 413);
$db->table('matching_results')->where('id', $second)->update($packed);

// Large indexed fixture, chunks bounded to 500. No primary DB, history rewrite, or engine.
$bulkJob = uid(); $bulkWorkspace = uid();
$db->table('matching_jobs')->insert(['id' => $bulkJob, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'status' => 'completed', 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
$db->table('workspaces')->insert(['id' => $bulkWorkspace, 'user_id' => $owner, 'name' => '300k reader fixture', 'matching_job_id' => $bulkJob]);
$db->table('matching_jobs')->where('id', $bulkJob)->update(['workspace_id' => $bulkWorkspace]);
for ($offset = 0; $offset < 300000; $offset += 500) {
    $batch = [];
    for ($n = $offset; $n < $offset + 500; $n++) $batch[] = ['id' => uid(), 'matching_job_id' => $bulkJob, 'reference_dataset_id' => $reference, 'input_record_key' => sprintf('%06d', $n), 'status' => $n % 2 ? 'unmatched' : 'possible_match', 'decision_origin' => 'auto', 'decision_protection' => 'open'];
    $db->table('review_states')->insert($batch);
}
$timings = []; $queries = []; $sizes = [];
for ($n = 0; $n < 21; $n++) {
    $db->flushQueryLog(); $db->enableQueryLog(); $start = microtime(true);
    $out = $reader()->review($owner, $bulkWorkspace, $bulkJob, ['status' => 'possible_match', 'page' => 2, 'per_page' => 25]);
    $ms = (microtime(true) - $start) * 1000;
    verify($out['pagination']['total'] === 150000 && count($out['data']) === 25 && $out['data'][0]['input_record_key'] === '000050', '300k indexed status pagination');
    if ($n > 0) { $timings[] = $ms; $queries[] = count($db->getQueryLog()); $sizes[] = strlen(json_encode($out)); }
    $db->disableQueryLog();
}
sort($timings);
$plan = $db->select('EXPLAIN SELECT input_record_key FROM review_states USE INDEX (review_states_job_status_idx) WHERE matching_job_id = ? AND status = ? ORDER BY input_record_key LIMIT 25 OFFSET 25', [$bulkJob, 'possible_match']);
verify($plan[0]->key === 'review_states_job_status_idx', 'EXPLAIN uses job/status/key index');
$benchmark = ['rows' => 300000, 'samples' => count($timings), 'p50_ms' => $timings[9], 'p95_ms' => $timings[18], 'queries' => max($queries), 'php_process_peak_mib' => memory_get_peak_usage(true) / 1048576, 'response_bytes' => max($sizes), 'explain' => $plan, 'stage5c_assertions' => $assertions - $before];
file_put_contents('/tmp/stage5c-benchmark.json', json_encode($benchmark, JSON_PRETTY_PRINT));
echo json_encode($benchmark, JSON_PRETTY_PRINT)."\n";
