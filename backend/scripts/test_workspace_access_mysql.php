<?php

/** Reuse the complete Stage 4 regression and independent-connection harness on a disposable DB. */
require __DIR__.'/test_review_transactions_mysql.php';

use App\Models\User;
use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Workspace\WorkspaceAccessService;
use App\Services\Workspace\WorkspaceMembershipService;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

$stage5Start = microtime(true);
$stage5AssertionsBefore = $assertions;
$workspace = $db->table('workspaces')->where('matching_job_id', $job)->value('id');
$people = [];
foreach (['owner', 'editor', 'viewer', 'outsider', 'pimpinan', 'other-editor'] as $role) {
    $people[$role] = $db->table('users')->insertGetId(['name' => $role, 'email' => "$role@stage5.invalid", 'role' => $role === 'pimpinan' ? 'pimpinan' : 'user', 'password' => 'not-a-login']);
}
$db->table('workspaces')->where('id', $workspace)->update(['user_id' => $people['owner'], 'reference_dataset_id' => $reference, 'input_dataset_id' => $input]);
$access = fn () => new WorkspaceAccessService($GLOBALS['db'], true);
$members = fn () => new WorkspaceMembershipService($GLOBALS['db'], $access());
$shared = fn (?Closure $probe = null) => new ReviewTransactionService($GLOBALS['db'], true, $probe, $access());
$owner = $people['owner'];
$editor = $people['editor'];
$viewer = $people['viewer'];

refuses(fn () => (new WorkspaceAccessService($db))->workspace($owner, $workspace), 'workspace_access_disabled', 503);
$members()->set($owner, $workspace, $editor, 'editor', 0);
$members()->set($owner, $workspace, $viewer, 'viewer', 0);
verify($access()->workspace($editor, $workspace, 'review')['role'] === 'editor', 'Owner grants Editor access');
verify($access()->workspace($viewer, $workspace)['permissions']['review'] === false, 'Viewer reads without review');
verify($access()->workspace($owner, $workspace)['role'] === 'owner', 'Owner stays workspaces.user_id');
verify($access()->workspace($actors[1], $workspace, 'members')['role'] === 'admin', 'Admin requires no membership');
refuses(fn () => $members()->set($editor, $workspace, $people['outsider'], 'editor', 0), 'workspace_forbidden', 403);
refuses(fn () => $members()->set($owner, $workspace, $owner, 'editor', 0), 'invalid_membership_target', 422);
refuses(fn () => $members()->set($owner, $workspace, $editor, 'owner', 1), 'invalid_membership', 422);
refuses(fn () => $access()->workspace($editor, $workspace, 'run'), 'workspace_forbidden', 403);
refuses(fn () => $access()->workspace($editor, $workspace, 'configure'), 'workspace_forbidden', 403);
refuses(fn () => $access()->workspace($editor, $workspace, 'dataset_write'), 'workspace_forbidden', 403);
verify(count($members()->search($owner, $workspace, 'editor')) === 2, 'Registered users search bounded and owner excluded');
verify($access()->workspaces($editor)['total'] === 1, 'Shared workspace list includes membership');
verify($access()->workspaces($actors[1])['total'] === $db->table('workspaces')->count(), 'Admin list includes all');
$members()->set($owner, $workspace, $people['other-editor'], 'editor', 0);
$db->table('users')->where('id', $people['other-editor'])->update(['role' => 'pimpinan']);
verify($access()->workspace($people['other-editor'], $workspace)['permissions']['review'] === false, 'Application role change overrides existing Editor membership');
verify($members()->set($owner, $workspace, $people['other-editor'], null, 1)['status'] === 'revoked', 'Owner can revoke stale membership after target application role changes');

$viewInput = $seed('stage5-viewer-write', 'stage5-viewer-ref');
refuses(fn () => $shared()->decide($viewer, $job, 'viewer-write', [$viewInput]), 'workspace_forbidden', 403);
refuses(fn () => $shared()->decide($people['pimpinan'], $job, 'leader-write', [$viewInput]), 'workspace_forbidden', 403);
verify($access()->workspace($people['pimpinan'], $workspace)['permissions']['read'], 'Pimpinan remains cross-workspace read-only');
refuses(fn () => $access()->workspace($people['outsider'], $workspace), 'workspace_forbidden', 403);
$otherWorkspace = uid();
$db->table('workspaces')->insert(['id' => $otherWorkspace, 'user_id' => $people['outsider'], 'name' => 'Unshared']);
refuses(fn () => $access()->workspace($editor, $otherWorkspace), 'workspace_forbidden', 403);
$privateDataset = uid();
$db->table('datasets')->insert(['id' => $privateDataset, 'user_id' => $owner, 'dataset_role' => 'input', 'name' => 'Unlinked private dataset', 'original_filename' => 'private.csv', 'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => 1, 'storage_path' => 'fixture/private.csv', 'row_count' => 1, 'column_count' => 1, 'parse_status' => 'inspected']);
verify($access()->resource($editor, $workspace, 'dataset', $reference)->id === $reference, 'Only linked legacy dataset readable');
$db->table('datasets')->where('id', $reference)->update(['workspace_id' => $otherWorkspace]);
verify($access()->resource($editor, $workspace, 'dataset', $reference)->id === $reference, 'Explicitly reused reference dataset remains scoped to associated job');
refuses(fn () => $access()->resource($editor, $workspace, 'dataset', $privateDataset), 'workspace_resource_forbidden', 403);
$otherJob = uid();
$db->table('matching_jobs')->insert(['id' => $otherJob, 'workspace_id' => $otherWorkspace, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'status' => 'completed', 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
refuses(fn () => $access()->job($editor, $otherJob), 'workspace_forbidden', 403);
refuses(fn () => $access()->resource($editor, $workspace, 'job', $otherJob), 'workspace_resource_forbidden', 403);
$foreignResult = uid();
$db->table('matching_results')->insert(['id' => $foreignResult, 'matching_job_id' => $otherJob, 'input_record_key' => 'foreign', 'reference_record_key' => 'foreign-ref', 'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 99]);
refuses(fn () => $access()->resource($editor, $workspace, 'result', $foreignResult), 'workspace_resource_forbidden', 403);
refuses(fn () => $shared()->decide($editor, $job, 'foreign-candidate', [array_replace($viewInput, ['candidate_id' => $foreignResult])]), 'candidate_identity_mismatch', 422);
$foreignAudit = uid();
$db->table('review_decisions')->insert(['id' => $foreignAudit, 'matching_job_id' => $otherJob, 'input_record_key' => 'foreign', 'decision' => 'mark_unmatched', 'previous_result_type' => 'possible_match', 'new_result_type' => 'unmatched']);
refuses(fn () => $access()->resource($editor, $workspace, 'history', $foreignAudit), 'workspace_resource_forbidden', 403);
$legacyScoped = uid();
$db->table('review_decisions')->insert(['id' => $legacyScoped, 'matching_job_id' => $job, 'matching_result_id' => $viewInput['candidate_id'], 'input_record_key' => $viewInput['input_record_key'], 'decision' => 'reject_match', 'previous_result_type' => 'possible_match', 'new_result_type' => 'possible_match']);
verify($access()->resource($editor, $workspace, 'history', $legacyScoped)->id === $legacyScoped, 'Unversioned legacy history remains readable through its actual job');

$memberRace = parallel(2, function ($child, $i) use ($actors, $workspace, $viewer) {
    return (new WorkspaceMembershipService($child, new WorkspaceAccessService($child, true)))->set($actors[$i], $workspace, $viewer, $i ? 'viewer' : 'editor', 1);
});
verify(count(array_filter($memberRace, fn ($r) => isset($r['version']))) === 1 && count(array_filter($memberRace, fn ($r) => ($r['error'] ?? '') === 'stale_membership_version')) === 1, 'Two admins membership CAS: one commit one 409');

$own = $seed('stage5-own', 'stage5-own-ref');
$first = $shared()->decide($editor, $job, 'editor-first', [$own]);
$ownUpdate = ['input_record_key' => $own['input_record_key'], 'expected_version' => 2, 'decision' => 'mark_unmatched'];
$ownAck = $shared()->decide($editor, $job, 'editor-own-update', [$ownUpdate]);
verify($ownAck['applied'] === 1, 'Editor revises own current unapproved decision');
refuses(fn () => $shared()->decide($owner, $job, 'owner-direct-other', [['input_record_key' => $own['input_record_key'], 'expected_version' => 3, 'decision' => 'mark_unmatched']]), 'approval_required');

$protected = $seed('stage5-protected', 'stage5-approved-ref');
$shared()->decide($owner, $job, 'owner-original', [$protected]);
$proposalItem = $protected;
$proposalItem['expected_version'] = 2;
refuses(fn () => $shared()->decide($editor, $job, 'editor-overwrite', [$proposalItem]), 'approval_required');
$originalAudit = $db->table('review_decisions')->where('input_record_key', $protected['input_record_key'])->first();
$p = $shared()->propose($editor, $job, 'proposal-valid', $proposalItem, 'Reviewed evidence');
verify($p['applied'] === 0 && $p['submitted'] === 1, 'Proposal acknowledgement distinguishes submitted from effective applied');
$requestId = $p['items'][0]['request_id'];
verify((int) $db->table('review_states')->where('input_record_key', $protected['input_record_key'])->value('version') === 2, 'Pending proposal does not change effective decision/version');
verify($shared()->propose($editor, $job, 'proposal-valid', $proposalItem, 'Reviewed evidence') === $p, 'Proposal transport retry exact acknowledgement');
refuses(fn () => $shared()->propose($editor, $job, 'duplicate-pending', $proposalItem, 'Other proposal'), 'pending_proposal_exists');
refuses(fn () => $shared()->resolve($editor, $job, 'editor-approve', $requestId, 1, true), 'workspace_forbidden', 403);
$resolved = $shared()->resolve($owner, $job, 'approval-valid', $requestId, 1, true, 'Approved');
verify($resolved['applied'] === 1 && $resolved['items'][0]['status'] === 'approved', 'Owner approves through same transactional writer');
$state = $db->table('review_states')->where('input_record_key', $protected['input_record_key'])->first();
$req = $db->table('review_change_requests')->where('id', $requestId)->first();
verify((int) $state->reviewer_user_id === $editor && (int) $state->proposed_by_user_id === $editor && (int) $state->approved_by_user_id === $owner && (int) $state->last_modified_by_user_id === $owner && (int) $req->previous_reviewer_user_id === $owner, 'Previous reviewer/proposer/approver/operation actor remain distinct fields');
verify($state->decision_protection === 'approved', 'Approved revision remains protected');
refuses(fn () => $shared()->decide($editor, $job, 'editor-after-approval', [['input_record_key' => $protected['input_record_key'], 'expected_version' => 3, 'decision' => 'mark_unmatched']]), 'approval_required');
refuses(fn () => $shared()->undo($editor, $job, 'editor-undo-approved', $resolved['operation_id'], [['input_record_key' => $protected['input_record_key'], 'expected_version' => 3]]), 'approval_required');
verify($shared()->resolve($owner, $job, 'approval-valid', $requestId, 1, true, 'Approved') === $resolved && $db->table('review_decisions')->where('change_request_id', $requestId)->count() === 1, 'Approval timeout/retry no duplicate decision/history');
verify((array) $db->table('review_decisions')->where('id', $originalAudit->id)->first() === (array) $originalAudit, 'Original audit remains unchanged after approval');
refuses(fn () => $shared()->resolve($owner, $job, 'changed-approval-payload', $requestId, 1, true), 'stale_proposal_version');

$prepare = function (string $name, string $ref) use ($seed, $shared, $owner, $editor, $job) {
    $item = $seed($name, $ref);
    $shared()->decide($owner, $job, "$name-original", [$item]);
    $item['expected_version'] = 2;
    $proposal = $shared()->propose($editor, $job, "$name-proposal", $item, 'Request revision');

    return [$item, $proposal['items'][0]['request_id']];
};
[$stale, $staleId] = $prepare('stage5-stale', 'stage5-stale-ref');
$shared()->decide($owner, $job, 'change-after-proposal', [['input_record_key' => $stale['input_record_key'], 'expected_version' => 2, 'decision' => 'mark_unmatched']]);
$staleAck = $shared()->resolve($owner, $job, 'approval-stale', $staleId, 1, true);
verify($staleAck['conflicted'] === 1 && $staleAck['items'][0]['status'] === 'stale', 'Stale approval persists conflict event without changing state');
verify($shared()->resolve($owner, $job, 'approval-stale', $staleId, 1, true) === $staleAck, 'Conflict retry remains idempotent');

[$collide, $collideId] = $prepare('stage5-collision', 'stage5-collision-ref');
$shared()->decide($owner, $job, 'release-before-approval', [['input_record_key' => $collide['input_record_key'], 'expected_version' => 2, 'decision' => 'mark_unmatched']]);
// New proposal anchored to current state, while another input claims its proposed reference.
$collide['expected_version'] = 3;
$shared()->resolve($owner, $job, 'collision-old-stale', $collideId, 1, true);
$collideP = $shared()->propose($editor, $job, 'collision-current-proposal', $collide, 'Claim previous reference');
$newClaim = $seed('stage5-collision-owner', 'stage5-collision-ref');
$shared()->decide($owner, $job, 'new-reference-owner', [$newClaim]);
$c = $shared()->resolve($owner, $job, 'collision-approve', $collideP['items'][0]['request_id'], 1, true);
verify($c['conflicted'] === 1 && $c['items'][0]['conflict_code'] === 'reference_conflict', 'Approval cannot bypass one-to-one constraint');

[$rejectItem, $rejectId] = $prepare('stage5-reject', 'stage5-reject-ref');
$rejected = $shared()->resolve($actors[1], $job, 'admin-reject', $rejectId, 1, false, 'Insufficient evidence');
verify($rejected['items'][0]['status'] === 'rejected' && (int) $db->table('review_states')->where('input_record_key', $rejectItem['input_record_key'])->value('version') === 2, 'Admin rejects proposal with immutable operation event, no effective write');

[$holdItem, $holdId] = $prepare('stage5-held', 'stage5-held-ref');
$db->table('review_reference_holds')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'reference_record_key' => 'stage5-held-ref', 'evidence_fingerprint' => str_repeat('c', 64), 'status' => 'active']);
$heldAck = $shared()->resolve($owner, $job, 'held-approval', $holdId, 1, true);
verify($heldAck['items'][0]['conflict_code'] === 'reference_integrity_hold', 'Approval cannot bypass integrity hold');

// In-transaction probe establishes review-before-revocation ordering, on independent PDOs.
$revItem = $seed('stage5-review-revoke', 'stage5-review-revoke-ref');
$rev = parallel(2, function ($child, $i, $dir) use ($job, $workspace, $editor, $actors, $revItem) {
    $a = new WorkspaceAccessService($child, true);
    if ($i === 0) {
        return (new ReviewTransactionService($child, true, function () use ($dir) {
            touch("$dir/review-held");
            usleep(250000);
        }, $a))->decide($editor, $job, 'review-before-revoke', [$revItem]);
    }
    while (! file_exists("$dir/review-held")) {
        usleep(1000);
    }

    return (new WorkspaceMembershipService($child, $a))->set($actors[0], $workspace, $editor, null, 1);
});
verify(($rev[0]['applied'] ?? 0) === 1 && ($rev[1]['status'] ?? '') === 'revoked', 'Review commits before waiting revocation; audit preserved');
refuses(fn () => $shared()->decide($editor, $job, 'review-before-revoke', [$revItem]), 'workspace_forbidden', 403);
refuses(fn () => $shared()->propose($editor, $job, 'revoked-proposal', $rejectItem, 'Retry with revoked permission'), 'workspace_forbidden', 403);
verify($access()->workspaces($editor)['total'] === 0, 'Revoked membership removed from accessible workspace list');

// Revocation-first committed barrier rejects a subsequently started save.
$members()->set($owner, $workspace, $editor, 'editor', 2);
$revFirstItem = $seed('stage5-revoke-first', 'stage5-revoke-first-ref');
$revFirst = parallel(2, function ($child, $i, $dir) use ($job, $workspace, $editor, $actors, $revFirstItem) {
    $a = new WorkspaceAccessService($child, true);
    if ($i === 0) {
        $out = (new WorkspaceMembershipService($child, $a))->set($actors[0], $workspace, $editor, null, 3);
        touch("$dir/revoked-commit");

        return $out;
    }
    while (! file_exists("$dir/revoked-commit")) {
        usleep(1000);
    }

    return (new ReviewTransactionService($child, true, null, $a))->decide($editor, $job, 'revocation-first-save', [$revFirstItem]);
});
verify(($revFirst[1]['error'] ?? '') === 'workspace_forbidden' && (int) $db->table('review_states')->where('input_record_key', $revFirstItem['input_record_key'])->value('version') === 1, 'Revocation commits first: later review rejected');
$members()->set($owner, $workspace, $editor, 'editor', 4);
[$pendingRev, $pendingRevId] = $prepare('stage5-pending-revoked', 'stage5-pending-revoked-ref');
$members()->set($owner, $workspace, $editor, null, 5);
$pRev = $shared()->resolve($owner, $job, 'revoked-proposer-approval', $pendingRevId, 1, true);
verify($pRev['items'][0]['status'] === 'conflicted' && $pRev['items'][0]['conflict_code'] === 'workspace_forbidden', 'Revoked proposer prevents pending revision activation');

// Concurrent approval is one durable write; a transport retry may replay the same result.
$members()->set($owner, $workspace, $editor, 'editor', 6);
[$raceItem, $raceId] = $prepare('stage5-approval-race', 'stage5-approval-race-ref');
$race = parallel(2, fn ($child, $i) => (new ReviewTransactionService($child, true, null, new WorkspaceAccessService($child, true)))->resolve($actors[$i], $job, 'approve-race-'.$i, $raceId, 1, true));
verify(count(array_filter($race, fn ($r) => ($r['applied'] ?? 0) === 1)) === 1 && count(array_filter($race, fn ($r) => ($r['error'] ?? '') === 'stale_proposal_version')) === 1 && $db->table('review_decisions')->where('change_request_id', $raceId)->count() === 1, 'Two approvers: one applied, one stale 409, one audit');
verify($db->table('review_states')->where('matching_job_id', $job)->whereNotNull('active_reference_record_key')->count() === $db->table('review_states')->where('matching_job_id', $job)->whereNotNull('active_reference_record_key')->distinct()->count('active_reference_record_key'), 'No duplicate assignments after Stage 5 operations');
$members()->set($owner, $workspace, $editor, 'viewer', 7);
refuses(fn () => $shared()->decide($editor, $job, 'editor-first', [$own]), 'workspace_forbidden', 403);
$members()->set($owner, $workspace, $editor, 'editor', 8);
verify($access()->workspace($editor, $workspace)['membership_version'] === 9, 'Role downgrade fences old retry and restoration increments membership version');

$nullReviewer = $seed('stage5-null-reviewer', 'stage5-null-reviewer-ref', ['decision' => 'reject_match', 'decision_origin' => 'legacy', 'decision_protection' => 'legacy_unknown']);
$nullP = $shared()->propose($editor, $job, 'null-reviewer-proposal', ['input_record_key' => $nullReviewer['input_record_key'], 'expected_version' => 1, 'decision' => 'mark_unmatched'], 'Historical reviewer unknown');
$nullAck = $shared()->resolve($owner, $job, 'null-reviewer-approve', $nullP['items'][0]['request_id'], 1, true);
verify($nullAck['items'][0]['previous_reviewer_user_id'] === null, 'Approval preserves unknown previous reviewer as NULL');
[$rejectApprovalItem, $unusedRequest] = $prepare('stage5-reject-action', 'stage5-reject-action-ref');
$shared()->resolve($owner, $job, 'cancel-accept-proposal', $unusedRequest, 1, false, 'Use candidate rejection instead');
$rejectApprovalItem['decision'] = 'reject_match';
$rejectP = $shared()->propose($editor, $job, 'reject-action-proposal', $rejectApprovalItem, 'Reject candidate while keeping input pending');
$rejectAck = $shared()->resolve($owner, $job, 'reject-action-approve', $rejectP['items'][0]['request_id'], 1, true);
$rejectState = $db->table('review_states')->where('input_record_key', $rejectApprovalItem['input_record_key'])->first();
verify($rejectAck['applied'] === 1 && $rejectState->status === 'possible_match' && $rejectState->selected_reference_record_key === null && $db->table('review_decisions')->where('change_request_id', $rejectP['items'][0]['request_id'])->value('decision') === 'reject_match', 'Approval preserves reject_match semantics distinct from mark_unmatched');

$stage5Bench = [];
foreach (['legacy-owner', 'membership-editor'] as $profile) {
    $times = [];
    $queries = 0;
    $waits = 0;
    for ($n = 0; $n < 40; $n++) {
        $key = 'bench-'.(($profile === 'legacy-owner' ? 700 : 740) + $n);
        $cid = $db->table('matching_results')->where('matching_job_id', $job)->where('input_record_key', $key)->value('id');
        $svc = new ReviewTransactionService($db, true, null, $profile === 'legacy-owner' ? null : $access());
        $db->enableQueryLog();
        $timer = microtime(true);
        $ack = $svc->decide($profile === 'legacy-owner' ? $owner : $editor, $job, 'stage5-bench-'.$key, [['input_record_key' => $key, 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $cid]]);
        $times[] = (microtime(true) - $timer) * 1000;
        $queries += count($db->getQueryLog());
        $waits += $svc->diagnostics['lock_wait_ms'];
        $db->flushQueryLog();
        $db->disableQueryLog();
        if ($ack['applied'] !== 1) {
            throw new RuntimeException('Benchmark lost decision');
        }
    }
    sort($times);
    $stage5Bench[] = ['profile' => $profile, 'requests' => 40, 'p50_ms' => $times[19], 'p95_ms' => $times[37], 'sql_per_request' => $queries / 40, 'lock_call_ms_per_request' => $waits / 40];
}
echo 'STAGE5_BENCH '.json_encode($stage5Bench)."\n";

// Boot HTTP kernel only in this network-isolated container, force the same fixed test DB.
$httpComplete = false;
register_shutdown_function(function () use (&$httpComplete) {
    if (! $httpComplete) {
        fwrite(STDERR, "HTTP regression did not finish\n");
        exit(1);
    }
});
$app = require __DIR__.'/../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
$app['config']->set('app.env', 'testing');
$app['config']->set('database.default', 'mysql');
$app['config']->set('database.connections.mysql', ['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'strict' => true]);
$app['config']->set('workspace_access.enabled', true);
$app['config']->set('review_transactions.enabled', true);
$app['config']->set('cache.default', 'array');
$app['config']->set('session.driver', 'array');
$app['config']->set('logging.default', 'stderr');
DB::purge('mysql');
verify(DB::connection()->getDatabaseName() === 'rematch_stage4_test', 'HTTP kernel fixed to isolated MySQL');
$api = function (int $actor, string $method, string $path, array $body = []) use ($app, $kernel): array {
    $req = Request::create('/api/stage5a/'.$path, $method, [], [], [], ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json'], json_encode($body));
    $app->instance('request', $req);
    $app['auth']->forgetGuards();
    $app['auth']->guard('sanctum')->setUser(User::findOrFail($actor));
    $response = $kernel->handle($req);
    $payload = json_decode($response->getContent(), true);
    $kernel->terminate($req, $response);
    if ($response->getStatusCode() >= 500) {
        throw new RuntimeException('HTTP failure: '.$response->getContent());
    }

    return ['status' => $response->getStatusCode(), 'body' => $payload];
};
verify($api($editor, 'GET', 'workspaces')['status'] === 200, 'HTTP Editor reads shared workspace list');
verify($api($editor, 'GET', "workspaces/$workspace/members")['status'] === 403, 'HTTP Editor cannot list/manage members');
verify($api($owner, 'GET', "workspaces/$workspace/members")['status'] === 200, 'HTTP Owner member list');
verify($api($owner, 'POST', "workspaces/$workspace/members", ['user_id' => $people['outsider'], 'role' => 'viewer', 'expected_version' => 0])['status'] === 200, 'HTTP Owner grants registered user');
verify($api($owner, 'DELETE', "workspaces/$workspace/members/{$people['outsider']}", ['expected_version' => 1])['status'] === 200, 'HTTP Owner revokes access');
verify($api($editor, 'GET', "workspaces/$workspace/resources/dataset/$privateDataset")['status'] === 403, 'HTTP unrelated dataset denied');
verify($api($editor, 'GET', "workspaces/$workspace/resources/job/$job")['status'] === 200, 'HTTP scoped job progress metadata');
$inbox = $api($owner, 'GET', "jobs/$job/proposals");
verify($inbox['status'] === 200 && array_key_exists('before_decision', $inbox['body']['data']['data'][0]), 'HTTP Owner approval inbox includes prior decision provenance');
verify($api($editor, 'GET', "jobs/$job/proposals")['status'] === 403, 'HTTP Editor cannot access approval inbox');
$apiInput = $seed('stage5-api-review', 'stage5-api-review-ref');
$apiBody = ['idempotency_key' => 'http-original', 'items' => [$apiInput]];
verify($api($owner, 'POST', "jobs/$job/decisions", $apiBody)['status'] === 200, 'HTTP authenticated actor creates CAS decision');
$apiBody['actor_user_id'] = $owner;
verify($api($editor, 'POST', "jobs/$job/decisions", $apiBody)['status'] === 422, 'HTTP payload actor spoofing rejected');
$apiInput['expected_version'] = 2;
$apiProposal = $api($editor, 'POST', "jobs/$job/proposals", $apiInput + ['reason' => 'HTTP revision', 'idempotency_key' => 'http-proposal']);
verify($apiProposal['status'] === 200, 'HTTP Editor submits revision');
$apiRequest = $apiProposal['body']['data']['items'][0]['request_id'];
$apiApproveBody = ['approve' => true, 'expected_request_version' => 1, 'idempotency_key' => 'http-approve'];
$apiApproved = $api($owner, 'POST', "jobs/$job/proposals/$apiRequest/resolve", $apiApproveBody);
verify($apiApproved['status'] === 200 && $apiApproved['body']['data']['items'][0]['status'] === 'approved', 'HTTP Owner resolves approval');
verify($api($owner, 'POST', "jobs/$job/proposals/$apiRequest/resolve", $apiApproveBody) === $apiApproved, 'HTTP approval retry exact response');
verify($api($owner, 'POST', "jobs/$job/proposals/$staleId/resolve", ['approve' => true, 'expected_request_version' => 1, 'idempotency_key' => 'approval-stale'])['status'] === 409, 'HTTP persisted stale approval maps to 409');
$opaque = $seed('  stage5-opaque  ', 'stage5-opaque-ref');
$opaqueAck = $api($owner, 'POST', "jobs/$job/decisions", ['idempotency_key' => '  opaque-op  ', 'items' => [$opaque]]);
verify($opaqueAck['status'] === 200 && $opaqueAck['body']['data']['items'][0]['input_record_key'] === $opaque['input_record_key']
    && DB::table('review_operations')->where('idempotency_key', '  opaque-op  ')->count() === 1
    && DB::table('review_operations')->where('idempotency_key', 'opaque-op')->count() === 0, 'HTTP preserves padded opaque input and idempotency keys');

$httpComplete = true;
echo json_encode(['stage5_assertions' => $assertions - $stage5AssertionsBefore, 'stage5_seconds' => microtime(true) - $stage5Start, 'php_peak_mib' => memory_get_peak_usage(true) / 1048576], JSON_PRETTY_PRINT)."\n";
