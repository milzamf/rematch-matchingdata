<?php

/** Disposable MySQL only. pcntl forks create fresh independent PDO connections. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Str;

if (getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4' || ! extension_loaded('pcntl')) {
    throw new RuntimeException('Isolated Stage 4 + pcntl required.');
}
function connection(): ConnectionInterface
{
    $capsule = new Capsule;
    $capsule->addConnection(['driver' => 'mysql', 'host' => '127.0.0.1', 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'strict' => true]);
    $capsule->setAsGlobal();
    $capsule->bootEloquent();
    $container = $capsule->getContainer();
    $container->instance('db', $capsule->getDatabaseManager());
    $container->bind('db.schema', fn () => $capsule->getConnection()->getSchemaBuilder());
    Facade::setFacadeApplication($container);

    return $capsule->getConnection();
}
$db = connection();
$assertions = 0;
$start = microtime(true);
$root = '/tmp/rematch-stage4';
mkdir($root);
function verify(bool $condition, string $message): void
{
    global $assertions;
    if (! $condition) {
        throw new RuntimeException($message);
    } $assertions++;
    echo "PASS $message\n";
}
function refuses(callable $call, string $reason, int $status = 409): void
{
    try {
        $call();
    } catch (ReviewWriteConflict $error) {
        verify($error->reason === $reason && $error->getStatusCode() === $status, "$reason HTTP $status");

        return;
    }
    throw new RuntimeException('Expected conflict '.$reason);
}
function uid(): string
{
    return (string) Str::uuid();
}
function barrier(string $name, int $n): void
{
    $begin = microtime(true);
    while (count(glob($name.'-*')) < $n) {
        if (microtime(true) - $begin > 8) {
            throw new RuntimeException('Barrier timeout '.$name);
        }usleep(1000);
    }
}
/** Parent sockets disconnected before fork; results go to task-owned files. */
function parallel(int $workers, callable $work): array
{
    global $db,$root;
    $dir = $root.'/fork-'.uid();
    mkdir($dir);
    $db->disconnect();
    $pids = [];
    for ($i = 0; $i < $workers; $i++) {
        $pid = pcntl_fork();
        if ($pid < 0) {
            throw new RuntimeException('fork failed');
        }
        if ($pid === 0) {
            $child = connection();
            touch("$dir/ready-$i");
            try {
                barrier("$dir/ready", $workers);
                $value = $work($child, $i, $dir);
            } catch (ReviewWriteConflict $error) {
                $value = ['error' => $error->reason, 'status' => $error->getStatusCode()];
            } catch (Throwable $error) {
                $value = ['fatal' => get_class($error).': '.$error->getMessage()];
            }
            file_put_contents("$dir/result-$i.json", json_encode($value, JSON_THROW_ON_ERROR));
            $child->disconnect();
            exit(isset($value['fatal']) ? 1 : 0);
        } $pids[] = $pid;
    }
    foreach ($pids as $pid) {
        pcntl_waitpid($pid, $status);
    }
    $values = [];
    for ($i = 0; $i < $workers; $i++) {
        $values[] = json_decode(file_get_contents("$dir/result-$i.json"), true, 512, JSON_THROW_ON_ERROR);
    }
    $db = connection();
    foreach ($values as $value) {
        if (isset($value['fatal'])) {
            throw new RuntimeException($value['fatal']);
        }
    }

    return $values;
}
verify($db->getDatabaseName() === 'rematch_stage4_test' && count($db->select('SHOW TABLES')) === 0, 'empty fixed isolated database');
echo 'MySQL '.$db->selectOne('SELECT VERSION() AS v')->v."\n";
$paths = glob(__DIR__.'/../database/migrations/*.php');
sort($paths);
foreach ($paths as $path) {
    $migration = require $path;
    $migration->up();
}
$actors = [];
for ($n = 0; $n < 10; $n++) {
    $actors[] = $db->table('users')->insertGetId(['name' => "Reviewer $n", 'email' => "reviewer$n@stage4.invalid", 'role' => 'admin', 'password' => 'not-a-login']);
}
$input = uid();
$reference = uid();
foreach ([$input => 'input', $reference => 'reference'] as $id => $role) {
    $db->table('datasets')->insert(['id' => $id, 'user_id' => $actors[0], 'dataset_role' => $role, 'name' => $role, 'original_filename' => "$role.csv", 'file_format' => 'csv', 'mime_type' => 'text/csv', 'file_size' => 1, 'storage_path' => "fixture/$role.csv", 'row_count' => 5000, 'column_count' => 1, 'parse_status' => 'inspected']);
}
$job = uid();
$db->table('matching_jobs')->insert(['id' => $job, 'reference_dataset_id' => $reference, 'input_dataset_id' => $input, 'status' => 'completed', 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
$db->table('workspaces')->insert(['id' => uid(), 'user_id' => $actors[0], 'name' => 'Isolated concurrency fixture', 'matching_job_id' => $job]);
$baselineResults = [];
$seed = function (string $key, string $ref, array $changes = []) use ($job, $reference): array {
    global $db,$baselineResults;
    $candidate = uid();
    $state = uid();
    $initialType = ($changes['status'] ?? null) === 'matched' ? 'matched' : 'possible_match';
    $db->table('matching_results')->insert(['id' => $candidate, 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => $ref, 'candidate_rank' => 1, 'result_type' => $initialType, 'overall_score' => 98]);
    $baselineResults[$candidate] = $initialType;
    if ($initialType === 'matched') {
        $changes += ['selected_matching_result_id' => $candidate];
    }
    $db->table('review_states')->insert(array_replace(['id' => $state, 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => $key, 'status' => 'possible_match', 'decision_origin' => 'auto', 'decision_protection' => 'open', 'lineage_status' => 'verified', 'source_occurrence_count' => 1], $changes));

    return ['input_record_key' => $key, 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $candidate];
};
$service = fn (?Closure $probe = null) => new ReviewTransactionService($GLOBALS['db'], true, $probe);
$legacyInput = $seed('legacy-existing', 'legacy-reference', ['status' => 'unmatched', 'decision' => 'mark_unmatched', 'integrity_status' => 'held', 'decision_origin' => 'legacy', 'decision_protection' => 'legacy_unknown']);
$oldAudit = uid();
$db->table('review_decisions')->insert(['id' => $oldAudit, 'matching_job_id' => $job, 'input_record_key' => 'legacy-existing', 'decision' => 'mark_unmatched', 'new_result_type' => 'unmatched', 'previous_result_type' => 'possible_match', 'reviewer_user_id' => null, 'metadata' => '{"legacy":"unchanged"}']);
$oldAuditSnapshot = json_encode($db->table('review_decisions')->where('id', $oldAudit)->first());
refuses(fn () => (new ReviewTransactionService($db))->decide($actors[0], $job, 'disabled', []), 'review_transactions_disabled', 503);
refuses(fn () => $service()->decide($actors[0], $job, 'invalid-shape', ['not-an-item']), 'invalid_review_item', 422);
$same = $seed('same-input', 'ref-same-input');
$results = parallel(2, fn ($conn, $i) => (new ReviewTransactionService($conn, true))->decide($actors[$i], $job, "same-input-$i", [$same]));
verify(count(array_filter($results, fn ($r) => ($r['applied'] ?? 0) === 1)) === 1 && count(array_filter($results, fn ($r) => ($r['error'] ?? '') === 'stale_review_version')) === 1, 'concurrent same input: exactly one winner, stale request HTTP 409');
verify($db->table('review_decisions')->where('input_record_key', 'same-input')->count() === 1, 'same input produces one audit');
$a = $seed('same-ref-A', 'ref-shared');
$b = $seed('same-ref-B', 'ref-shared');
$results = parallel(2, fn ($conn, $i) => (new ReviewTransactionService($conn, true))->decide($actors[$i], $job, "same-ref-$i", [[$a, $b][$i]]));
verify(count(array_filter($results, fn ($r) => ($r['applied'] ?? 0) === 1)) === 1 && count(array_filter($results, fn ($r) => ($r['error'] ?? '') === 'reference_conflict')) === 1, 'concurrent same reference: one assignment, one conflict');
$a = $seed('parallel-A', 'ref-parallel-A');
$b = $seed('parallel-B', 'ref-parallel-B');
$results = parallel(2, function ($conn, $i, $dir) use ($a, $b, $actors, $job) {
    $probe = function () use ($i, $dir) {
        touch("$dir/inside-$i");
        barrier("$dir/inside", 2);
    };

    return (new ReviewTransactionService($conn, true, $probe))->decide($actors[$i], $job, "different-$i", [[$a, $b][$i]]);
});
verify($results[0]['applied'] === 1 && $results[1]['applied'] === 1, 'different resources concurrently inside transaction; no exclusive workspace lock');
$retry = $seed('retry', 'ref-retry');
$reply = $service()->decide($actors[0], $job, 'timeout-retry', [$retry]);
verify($service()->decide($actors[0], $job, 'timeout-retry', [$retry]) === $reply, 'retry after commit replays exact acknowledgement');
verify($db->table('review_decisions')->where('input_record_key', 'retry')->count() === 1, 'idempotent retry appends no second history');
// Duplicate concurrent transport request: same actor/key/hash, independent PDOs.
$idem = $seed('concurrent-idempotent', 'concurrent-idempotent-ref');
$sameReplies = parallel(2, fn ($conn, $i) => (new ReviewTransactionService($conn, true))->decide($actors[0], $job, 'concurrent-idempotent', [$idem]));
verify($sameReplies[0] === $sameReplies[1] && $db->table('review_decisions')->where('input_record_key', 'concurrent-idempotent')->count() === 1, 'concurrent duplicate idempotency key returns one durable operation');
$changed = $retry;
$changed['expected_version'] = 2;
refuses(fn () => $service()->decide($actors[0], $job, 'timeout-retry', [$changed]), 'idempotency_payload_mismatch');
refuses(fn () => $service()->decide($actors[0], $job, 'stale-version', [$retry]), 'stale_review_version');
$db->table('users')->where('id', $actors[0])->update(['role' => 'pimpinan']);
refuses(fn () => $service()->decide($actors[0], $job, 'timeout-retry', [$retry]), 'review_forbidden', 403);
$db->table('users')->where('id', $actors[0])->update(['role' => 'admin']);
$db->table('users')->where('id', $actors[1])->update(['role' => 'user']);
refuses(fn () => $service()->decide($actors[1], $job, 'non-owner', [$retry]), 'review_forbidden', 403);
$db->table('users')->where('id', $actors[1])->update(['role' => 'admin']);
$ownerInput = $seed('ordinary-owner', 'ordinary-owner-ref');
$db->table('users')->where('id', $actors[0])->update(['role' => 'user']);
verify($service()->decide($actors[0], $job, 'ordinary-owner', [$ownerInput])['applied'] === 1, 'ordinary owner can review without enabling Workspace Sharing');
$db->table('users')->where('id', $actors[0])->update(['role' => 'admin']);
$ownedNoDecision = $seed('protected-no-decision', 'protected-no-decision-ref', ['decision_protection' => 'reviewer_owned', 'reviewer_user_id' => $actors[1]]);
refuses(fn () => $service()->decide($actors[0], $job, 'protected-no-decision', [$ownedNoDecision]), 'approval_required');
$db->table('matching_jobs')->where('id', $job)->update(['review_state_readiness' => 'pending']);
refuses(fn () => $service()->decide($actors[0], $job, 'pending', [$retry]), 'review_job_not_ready');
$db->table('matching_jobs')->where('id', $job)->update(['review_state_readiness' => 'ready']);
// Undo cannot release newer decisions, or steal a released reference from its new owner.
$u = $seed('undo', 'ref-undo', ['status' => 'matched', 'selected_reference_record_key' => 'ref-undo']);
$mark = ['input_record_key' => 'undo', 'expected_version' => 1, 'decision' => 'mark_unmatched'];
$unmatch = $service()->decide($actors[0], $job, 'release-undo', [$mark]);
$other = $seed('undo-other', 'ref-undo');
$service()->decide($actors[1], $job, 'new-owner', [$other]);
refuses(fn () => $service()->undo($actors[0], $job, 'restore-taken', $unmatch['operation_id'], [['input_record_key' => 'undo', 'expected_version' => 2]]), 'reference_conflict');
$service()->decide($actors[0], $job, 'revise-undo', [['input_record_key' => 'undo', 'expected_version' => 2, 'decision' => 'mark_unmatched']]);
refuses(fn () => $service()->undo($actors[0], $job, 'superseded-undo', $unmatch['operation_id'], [['input_record_key' => 'undo', 'expected_version' => 3]]), 'undo_superseded');
$entity = uid();
$db->table('reference_entity_groups')->insert(['id' => $entity, 'reference_dataset_id' => $reference, 'verified_by_user_id' => $actors[0], 'verified_at' => '2026-10-13 00:00:00', 'verification_note' => 'Explicit entity verification']);
foreach (['entity-ref-A', 'entity-ref-B'] as $ref) {
    $db->table('reference_entity_members')->insert(['id' => uid(), 'reference_dataset_id' => $reference, 'reference_entity_group_id' => $entity, 'reference_record_key' => $ref, 'verified_by_user_id' => $actors[0], 'verified_at' => '2026-10-13 00:00:00']);
}
$ea = $seed('entity-A', 'entity-ref-A');
$eb = $seed('entity-B', 'entity-ref-B');
$results = parallel(2, fn ($conn, $i) => (new ReviewTransactionService($conn, true))->decide($actors[$i], $job, "entity-$i", [[$ea, $eb][$i]]));
verify(count(array_filter($results, fn ($r) => ($r['applied'] ?? 0) === 1)) === 1 && count(array_filter($results, fn ($r) => ($r['error'] ?? '') === 'reference_conflict')) === 1, 'verified entity aliases cannot be assigned to different inputs');
// Preexisting Auto Match remains an owner even before its group projection was populated.
$legacyEntity = uid();
$db->table('reference_entity_groups')->insert(['id' => $legacyEntity, 'reference_dataset_id' => $reference, 'verified_by_user_id' => $actors[0], 'verified_at' => '2026-10-13 00:00:00', 'verification_note' => 'Verified fixture']);
foreach (['auto-entity-A', 'auto-entity-B'] as $ref) {
    $db->table('reference_entity_members')->insert(['id' => uid(), 'reference_dataset_id' => $reference, 'reference_entity_group_id' => $legacyEntity, 'reference_record_key' => $ref, 'verified_by_user_id' => $actors[0], 'verified_at' => '2026-10-13 00:00:00']);
}
$seed('existing-auto', 'auto-entity-A', ['status' => 'matched', 'selected_reference_record_key' => 'auto-entity-A']);
$manualAlias = $seed('manual-alias', 'auto-entity-B');
refuses(fn () => $service()->decide($actors[0], $job, 'manual-alias', [$manualAlias]), 'reference_conflict');
$ih = $seed('input-held', 'ref-input-held', ['integrity_status' => 'held']);
refuses(fn () => $service()->decide($actors[0], $job, 'input-held', [$ih]), 'input_integrity_hold');
$rh = $seed('ref-held', 'ref-held');
$db->table('review_reference_holds')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'reference_record_key' => 'ref-held', 'evidence_fingerprint' => str_repeat('a', 64)]);
refuses(fn () => $service()->decide($actors[0], $job, 'ref-held', [$rh]), 'reference_integrity_hold');
$safe = $seed('unaffected', 'ref-unaffected');
verify($service()->decide($actors[0], $job, 'unaffected', [$safe])['applied'] === 1, 'integrity hold does not block unrelated input');
// Partial bulk acknowledgement with every outcome category; no automatic conflict retry.
$good = $seed('bulk-good', 'bulk-good-ref');
$collision = $seed('bulk-conflict', 'ref-retry');
$stale = $seed('bulk-stale', 'bulk-stale-ref');
$stale['expected_version'] = 8;
$protected = $seed('bulk-protected', 'bulk-protected-ref', ['decision' => 'mark_unmatched', 'reviewer_user_id' => $actors[1], 'decision_protection' => 'reviewer_owned']);
$canonical = $seed('canonical', 'canonical-ref');
$duplicate = $seed('business-duplicate', 'duplicate-ref', ['status' => 'duplicate_input', 'duplicate_of_input_record_key' => 'canonical', 'decision_origin' => 'manual', 'reviewer_user_id' => $actors[0]]);
$bulk = $service()->decide($actors[0], $job, 'bulk-partial', [$good, $collision, $stale, $protected, $duplicate], true);
verify([$bulk['applied'], $bulk['conflicted'], $bulk['skipped'], $bulk['approval_required']] === [1, 2, 1, 1], 'bulk reports applied/conflicted/skipped/approval_required separately');
verify($db->table('review_change_requests')->count() === 0 && $db->table('workspace_members')->count() === 0, 'approval and sharing remain inactive');
$ua = $seed('bulk-undo-A', 'bulk-undo-ref-A');
$ub = $seed('bulk-undo-B', 'bulk-undo-ref-B');
$undoTarget = $service()->decide($actors[0], $job, 'bulk-undo-target', [$ua, $ub], true);
$service()->decide($actors[0], $job, 'bulk-undo-revision', [['input_record_key' => 'bulk-undo-B', 'expected_version' => 2, 'decision' => 'mark_unmatched']]);
$beforeUndo = $db->table('review_decisions')->count();
refuses(fn () => $service()->undo($actors[0], $job, 'bulk-undo-fail', $undoTarget['operation_id'], [['input_record_key' => 'bulk-undo-A', 'expected_version' => 2], ['input_record_key' => 'bulk-undo-B', 'expected_version' => 3]]), 'undo_superseded');
verify($db->table('review_states')->where('input_record_key', 'bulk-undo-A')->value('version') === 2 && $db->table('review_decisions')->count() === $beforeUndo, 'bulk Undo failure rolls back earlier item and appended audit atomically');
$xa = $seed('successful-undo-A', 'successful-undo-ref-A');
$xb = $seed('successful-undo-B', 'successful-undo-ref-B');
$ok = $service()->decide($actors[0], $job, 'successful-undo-target', [$xa, $xb], true);
$oldHistory = json_encode($db->table('review_decisions')->where('review_operation_id', $ok['operation_id'])->orderBy('id')->get());
$undone = $service()->undo($actors[0], $job, 'successful-undo', $ok['operation_id'], [['input_record_key' => 'successful-undo-A', 'expected_version' => 2], ['input_record_key' => 'successful-undo-B', 'expected_version' => 2]]);
verify($undone['applied'] === 2, 'bulk Undo restores every input');
verify(json_encode($db->table('review_decisions')->where('review_operation_id', $ok['operation_id'])->orderBy('id')->get()) === $oldHistory, 'Undo append-only: original audit unchanged');
verify($db->table('review_states')->where('input_record_key', 'successful-undo-A')->first()->reviewer_user_id === null, 'Undo restores original reviewer instead of replacing with undo actor');
$switch = $seed('switch', 'switch-old-ref');
$service()->decide($actors[0], $job, 'switch-initial', [$switch]);
$alternative = uid();
$db->table('matching_results')->insert(['id' => $alternative, 'matching_job_id' => $job, 'input_record_key' => 'switch', 'reference_record_key' => 'switch-new-ref', 'candidate_rank' => 2, 'result_type' => 'possible_match', 'overall_score' => 98]);
$switched = $service()->decide($actors[0], $job, 'switch-candidate', [['input_record_key' => 'switch', 'expected_version' => 2, 'decision' => 'select_candidate', 'candidate_id' => $alternative]]);
verify($db->table('review_states')->where('input_record_key', 'switch')->value('active_reference_record_key') === 'switch-new-ref', 'candidate switch atomically acquires new reference and releases old');
$oldClaim = $seed('switch-other', 'switch-old-ref');
verify($service()->decide($actors[1], $job, 'switch-old-claim', [$oldClaim])['applied'] === 1, 'released reference can be assigned to another input');
refuses(fn () => $service()->undo($actors[0], $job, 'switch-undo', $switched['operation_id'], [['input_record_key' => 'switch', 'expected_version' => 3]]), 'reference_conflict');
$db->table('review_reference_holds')->insert(['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'reference_entity_group_id' => $legacyEntity, 'evidence_fingerprint' => str_repeat('b', 64)]);
$groupHeld = $seed('group-held', 'auto-entity-B');
refuses(fn () => $service()->decide($actors[0], $job, 'group-held', [$groupHeld]), 'reference_integrity_hold');
// Real InnoDB deadlock: test-only probe obtains cross-user X locks over shared permission locks.
$da = $seed('deadlock-A', 'deadlock-ref-A');
$dba = $seed('deadlock-B', 'deadlock-ref-B');
$dead = parallel(2, function ($conn, $i, $dir) use ($da, $dba, $actors, $job) {
    $probe = function ($attempt) use ($conn, $i, $dir, $actors) {
        if ($attempt !== 0) {
            return;
        }touch("$dir/dead-$i");
        barrier("$dir/dead", 2);
        $conn->table('users')->where('id', $actors[1 - $i])->update(['name' => 'Fixture deadlock']);
    };
    $svc = new ReviewTransactionService($conn, true, $probe);
    $result = $svc->decide($actors[$i], $job, "dead-$i", [[$da, $dba][$i]]);

    return ['result' => $result, 'metrics' => $svc->diagnostics];
});
verify($dead[0]['result']['applied'] === 1 && $dead[1]['result']['applied'] === 1 && array_sum(array_column(array_column($dead, 'metrics'), 'deadlocks')) >= 1, 'real InnoDB deadlock retried within bound without duplicate commits');
$exhaust = $seed('exhaust', 'exhaust-ref');
$calls = 0;
$probe = function () use (&$calls) {
    $calls++;
    $pdo = new PDOException('Deadlock found when trying to get lock');
    $pdo->errorInfo = ['40001', 1213, 'Injected retry exhaustion'];
    throw new QueryException('default', 'fixture', [], $pdo);
};
refuses(fn () => $service($probe)->decide($actors[0], $job, 'exhaust', [$exhaust]), 'review_busy_retry_later');
verify($calls === 3 && $db->table('review_states')->where('input_record_key', 'exhaust')->value('version') === 1 && $db->table('review_decisions')->where('input_record_key', 'exhaust')->count() === 0 && $db->table('review_operations')->where('idempotency_key', 'exhaust')->count() === 0, 'injected persistent deadlock stops at three attempts with no state/history changes');
// Validate latest audit against the live state and ensure candidate scores/results were not rewritten.
verify($db->selectOne('SELECT COUNT(*) AS n FROM review_states s JOIN review_decisions d ON d.review_state_id=s.id AND d.state_version_after=s.version WHERE s.last_operation_id IS NOT NULL AND (d.review_operation_id<>s.last_operation_id OR d.new_result_type<>s.status)')->n === 0, 'latest versioned history agrees with state');
verify($db->table('review_states')->whereNotNull('active_reference_record_key')->count() === $db->table('review_states')->whereNotNull('active_reference_record_key')->distinct()->count('active_reference_record_key'), 'no duplicate active assignment');
$sourceUnchanged = $db->table('matching_results')->where('overall_score', '<>', 98)->count() === 0;
foreach ($baselineResults as $id => $initialType) {
    $sourceUnchanged = $sourceUnchanged && $db->table('matching_results')->where('id', $id)->value('result_type') === $initialType;
}
verify($sourceUnchanged, 'similarity and legacy candidate outcomes unchanged, including original Auto Matched');
verify(json_encode($db->table('review_decisions')->where('id', $oldAudit)->first()) === $oldAuditSnapshot, 'historical unversioned decision and NULL reviewer untouched');
$stringA = $seed('001', 'string-ref-001');
$stringB = $seed('1', 'string-ref-1');
verify($service()->decide($actors[0], $job, 'string-keys', [$stringA, $stringB], true)['applied'] === 2, 'string keys 001 and 1 remain separate under bulk CAS');
$reject = $seed('reject-contract', 'reject-contract-ref');
$reject['decision'] = 'reject_match';
$rejectAck = $service()->decide($actors[0], $job, 'reject-contract', [$reject]);
$rejectAudit = $db->table('review_decisions')->where('id', $rejectAck['items'][0]['decision_id'])->first();
verify($rejectAudit->matching_result_id === $reject['candidate_id'] && $rejectAudit->selected_reference_record_key === 'reject-contract-ref' && $db->table('review_states')->where('input_record_key', 'reject-contract')->first()->selected_reference_record_key === null, 'reject audit retains rejected candidate while state remains unassigned Need Review');
$holdPlan = $db->select('EXPLAIN SELECT id FROM review_reference_holds WHERE matching_job_id=? AND active_reference_record_key=?', [$job, 'ref-held']);
verify($holdPlan[0]->key === 'review_holds_reference_uq', 'EXPLAIN hold check uses unique resource index');
$referencePlan = $db->select('EXPLAIN SELECT id FROM review_states WHERE matching_job_id=? AND active_reference_record_key=?', [$job, 'ref-retry']);
verify($referencePlan[0]->key === 'review_states_active_reference_uq', 'EXPLAIN reference assignment check uses unique index');
$entityPlan = $db->select('EXPLAIN SELECT id FROM review_states WHERE matching_job_id=? AND active_reference_entity_group_id=?', [$job, $entity]);
verify($entityPlan[0]->key === 'review_states_active_entity_uq', 'EXPLAIN entity assignment check uses unique index');

// Representative moderate fixture; never a guarantee for 300k records.
$batchStates = [];
$batchCandidates = [];
for ($n = 0; $n < 5000; $n++) {
    $key = "bench-$n";
    $ref = "bench-ref-$n";
    $cid = uid();
    $batchCandidates[] = ['id' => $cid, 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => $ref, 'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 98];
    $batchStates[] = ['id' => uid(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => $key, 'status' => 'possible_match', 'decision_origin' => 'auto', 'decision_protection' => 'open', 'lineage_status' => 'verified', 'source_occurrence_count' => 1];
    if (count($batchStates) === 250) {
        $db->table('matching_results')->insert($batchCandidates);
        $db->table('review_states')->insert($batchStates);
        $batchCandidates = [];
        $batchStates = [];
    }
}
$bench = [];
$offset = 0;
foreach ([1, 5, 10] as $workers) {
    $before = $db->select("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time')");
    $deadlockBefore = (int) $db->selectOne("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE name='lock_deadlocks'")->n;
    $t = microtime(true);
    $rows = parallel($workers, function ($conn, $i) use ($actors, $job, $offset) {
        $latency = [];
        $queries = 0;
        $wait = 0;
        $deadlocks = 0;
        for ($n = 0; $n < 40; $n++) {
            $key = 'bench-'.($offset + $i * 40 + $n);
            $cid = $conn->table('matching_results')->where('matching_job_id', $job)->where('input_record_key', $key)->value('id');
            $conn->enableQueryLog();
            $begin = microtime(true);
            $svc = new ReviewTransactionService($conn, true);
            $r = $svc->decide($actors[$i], $job, 'bench-'.$key, [['input_record_key' => $key, 'expected_version' => 1, 'decision' => 'accept_match', 'candidate_id' => $cid]]);
            if ($r['applied'] !== 1) {
                throw new RuntimeException('Benchmark lost decision');
            }
            $latency[] = (microtime(true) - $begin) * 1000;
            $queries += count($conn->getQueryLog());
            $conn->flushQueryLog();
            $conn->disableQueryLog();
            $wait += $svc->diagnostics['lock_wait_ms'];
            $deadlocks += $svc->diagnostics['deadlocks'];
        }
        preg_match('/VmRSS:\s+(\d+)/', file_get_contents('/proc/self/status'), $rss);

        return ['latency' => $latency, 'queries' => $queries, 'wait' => $wait, 'deadlocks' => $deadlocks, 'peak' => memory_get_peak_usage(true), 'rss_kib' => (int) ($rss[1] ?? 0)];
    });
    $elapsed = microtime(true) - $t;
    $latency = [];
    foreach ($rows as $row) {
        $latency = [...$latency, ...$row['latency']];
    }sort($latency);
    $n = count($latency);
    $after = $db->select("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time')");
    $deadlockAfter = (int) $db->selectOne("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE name='lock_deadlocks'")->n;
    $metrics = ['reviewers' => $workers, 'requests' => $n, 'p50_ms' => $latency[(int) floor(($n - 1) * .5)], 'p95_ms' => $latency[(int) floor(($n - 1) * .95)], 'throughput_per_second' => $n / $elapsed, 'queries_per_request' => array_sum(array_column($rows, 'queries')) / $n, 'advisory_wait_ms_per_request' => array_sum(array_column($rows, 'wait')) / $n, 'deadlocks' => array_sum(array_column($rows, 'deadlocks')), 'php_peak_mib' => max(array_column($rows, 'peak')) / 1048576, 'max_worker_rss_mib' => max(array_column($rows, 'rss_kib')) / 1024, 'innodb_before' => $before, 'innodb_after' => $after];
    $metrics['server_deadlock_delta'] = $deadlockAfter - $deadlockBefore;
    $bench[] = $metrics;
    echo 'BENCH '.json_encode($metrics)."\n";
    $offset += $workers * 40;
}
file_put_contents('/tmp/stage4-benchmark.json', json_encode($bench, JSON_PRETTY_PRINT));
verify($db->table('review_operations')->where('status', 'processing')->count() === 0, 'no unfinished operation published');
echo sprintf("SUCCESS %d assertions; total %.3fs\n", $assertions, microtime(true) - $start);
