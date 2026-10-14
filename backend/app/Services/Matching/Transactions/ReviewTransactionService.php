<?php

namespace App\Services\Matching\Transactions;

use App\Services\Matching\ReviewContract;
use App\Services\Workspace\WorkspaceAccessService;
use App\Support\Auth\PermissionRegistry;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/** Isolated versioned writer. No legacy projection or live cutover. */
final class ReviewTransactionService
{
    private float $lockDeadline = 0;

    private const FIELDS = ['status', 'decision', 'decision_origin', 'decision_protection', 'selected_reference_record_key', 'selected_matching_result_id', 'selected_reference_entity_group_id', 'duplicate_of_input_record_key', 'reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'];

    public array $diagnostics = ['deadlocks' => 0, 'retries' => 0, 'lock_wait_ms' => 0];

    public function __construct(private readonly ConnectionInterface $db, private readonly bool $enabled = false, private readonly ?\Closure $testProbe = null, private readonly ?WorkspaceAccessService $access = null)
    {
        $access?->assertConnection($db);
    }

    public function propose(int $actor, string $job, string $idempotency, array $item, string $reason): array
    {
        $this->requireAccess();
        if (array_diff(array_keys($item), ['input_record_key', 'expected_version', 'decision', 'candidate_id']) || trim($reason) === '' || mb_strlen($reason) > 1000) {
            throw new ReviewWriteConflict('invalid_proposal', [], 422);
        }

        return $this->execute($actor, $job, $idempotency, [$item + ['reason' => $reason]], 'proposal');
    }

    public function resolve(int $actor, string $job, string $idempotency, string $request, int $expectedRequestVersion, bool $approve, string $reason = ''): array
    {
        $this->requireAccess();
        $this->authorize($actor, $job, false, 'approve');
        if ($expectedRequestVersion < 1 || mb_strlen($reason) > 1000 || (! $approve && trim($reason) === '')) {
            throw new ReviewWriteConflict('invalid_resolution', [], 422);
        }
        $row = $this->db->table('review_change_requests as r')->join('review_states as s', 's.id', '=', 'r.review_state_id')
            ->where('r.matching_job_id', $job)->where('r.id', $request)->first(['r.*', 's.input_record_key']);
        if (! $row || $row->id !== $request) {
            throw new ReviewWriteConflict('proposal_not_found', [], 404);
        }
        $item = ['input_record_key' => $row->input_record_key, 'expected_version' => (int) $row->expected_version,
            'decision' => $row->proposed_decision, 'candidate_id' => $row->proposed_matching_result_id,
            'change_request_id' => $request, 'expected_request_version' => $expectedRequestVersion, 'resolution_reason' => $reason];

        return $this->execute($actor, $job, $idempotency, [$item], $approve ? 'approval' : 'rejection');
    }

    private function requireAccess(): void
    {
        $this->guard();
        if ($this->access === null) {
            throw new ReviewWriteConflict('workspace_access_disabled', [], 503);
        }
        $this->access->guard();
    }

    /** items are explicit {input_record_key, expected_version, decision, candidate_id?}; never expand a UI filter. */
    public function decide(int $actor, string $job, string $idempotency, array $items, bool $bulk = false): array
    {
        return $this->execute($actor, $job, $idempotency, $items, $bulk ? 'bulk' : 'one');
    }

    /** Undo the entire operation, including every applied input, or roll back all changes. */
    public function undo(int $actor, string $job, string $idempotency, string $targetOperation, array $expected): array
    {
        $this->guard();
        if (! array_is_list($expected) || count($expected) < 1 || count($expected) > 50) {
            throw new ReviewWriteConflict('invalid_review_request', [], 422);
        }
        foreach ($expected as $row) {
            if (! is_array($row) || ! is_string($row['input_record_key'] ?? null) || ! is_int($row['expected_version'] ?? null)) {
                throw new ReviewWriteConflict('invalid_review_item', [], 422);
            }
        }
        $audits = $this->db->table('review_decisions')->where('matching_job_id', $job)->where('review_operation_id', $targetOperation)->orderBy('id')->limit(51)->get();
        if ($audits->isEmpty() || $audits->count() > 50) {
            throw new ReviewWriteConflict('undo_operation_not_available');
        }
        $items = [];
        foreach ($audits as $audit) {
            $matches = array_values(array_filter($expected, fn ($row) => ($row['input_record_key'] ?? null) === $audit->input_record_key));
            if (count($matches) !== 1) {
                throw new ReviewWriteConflict('undo_requires_all_versions');
            }
            $items[] = ['input_record_key' => $audit->input_record_key, 'expected_version' => $matches[0]['expected_version'], 'decision' => 'undo', 'undo_decision_id' => $audit->id];
        }
        if (count($items) !== count($expected)) {
            throw new ReviewWriteConflict('undo_requires_all_versions');
        }

        return $this->execute($actor, $job, $idempotency, $items, 'undo');
    }

    private function guard(): void
    {
        ReviewDeploymentFence::assertWritable();
        if (! $this->enabled || $this->db->getDriverName() !== 'mysql' || $this->db->getDatabaseName() !== 'rematch_stage4_test' || getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') {
            throw new ReviewWriteConflict('review_transactions_disabled', [], 503);
        }
        if ($this->db->transactionLevel() !== 0) {
            throw new ReviewWriteConflict('nested_review_transaction_not_supported', [], 503);
        }
    }

    private function execute(int $actor, string $job, string $idempotency, array $items, string $mode): array
    {
        $this->guard();
        if ($actor < 1 || $idempotency === '' || strlen($idempotency) > 128 || ! array_is_list($items) || count($items) < 1 || count($items) > 50 || ($mode === 'one' && count($items) !== 1)) {
            throw new ReviewWriteConflict('invalid_review_request', [], 422);
        }
        $seen = [];
        foreach ($items as $item) {
            if (! is_array($item)) {
                throw new ReviewWriteConflict('invalid_review_item', [], 422);
            }
            $key = $item['input_record_key'] ?? null;
            if (! is_string($key) || $key === '' || strlen($key) > 255 || ! is_int($item['expected_version'] ?? null) || $item['expected_version'] < 1 || isset($seen['key:'.$key]) || ! in_array($item['decision'] ?? null, ['accept_match', 'select_candidate', 'reject_match', 'mark_unmatched', 'undo'], true) || (($item['decision'] === 'undo') !== ($mode === 'undo'))) {
                throw new ReviewWriteConflict('invalid_review_item', [], 422);
            }
            $seen['key:'.$key] = true;
            if ($item['decision'] === 'mark_unmatched' && isset($item['candidate_id'])) {
                throw new ReviewWriteConflict('invalid_review_item', [], 422);
            }
            foreach (['candidate_id', 'undo_decision_id'] as $field) {
                if (isset($item[$field]) && ! is_string($item[$field])) {
                    throw new ReviewWriteConflict('invalid_review_item', [], 422);
                }
            }
            $extra = match ($mode) {
                'proposal' => ['reason'], 'approval', 'rejection' => ['change_request_id', 'expected_request_version', 'resolution_reason'], default => [],
            };
            if (array_diff(array_keys($item), [...['input_record_key', 'expected_version', 'decision', 'candidate_id', 'undo_decision_id'], ...$extra])) {
                throw new ReviewWriteConflict('unknown_review_fields', [], 422);
            }
        }
        usort($items, fn ($a, $b) => strcmp($a['input_record_key'], $b['input_record_key']));
        foreach ($items as &$item) {
            ksort($item);
        } unset($item);
        $hash = hash('sha256', json_encode([$actor, $job, $mode, $items], JSON_THROW_ON_ERROR));
        $locks = [];
        $this->lockDeadline = microtime(true) + 2;
        $previousTimeout = (int) $this->db->selectOne('SELECT @@SESSION.innodb_lock_wait_timeout AS seconds')->seconds;
        $this->diagnostics = ['deadlocks' => 0, 'retries' => 0, 'lock_wait_ms' => 0];
        try {
            $this->db->statement('SET SESSION innodb_lock_wait_timeout=2');
            $this->lock('operation', "$job:$actor:$idempotency", $locks);
            // A completed retry is authorized again, but does not plan new resources or inspect stale versions.
            $permission = in_array($mode, ['approval', 'rejection'], true) ? 'approve' : ($mode === 'proposal' ? 'propose' : 'review');
            $this->authorize($actor, $job, false, $permission);
            if ($cached = $this->db->table('review_operations')->where('matching_job_id', $job)->where('actor_user_id', $actor)->where('idempotency_key', $idempotency)->first()) {
                if ($cached->request_hash !== $hash) {
                    throw new ReviewWriteConflict('idempotency_payload_mismatch');
                }
                if ($cached->status !== 'completed') {
                    throw new ReviewWriteConflict('operation_not_completed');
                }

                return $this->db->transaction(function () use ($actor, $job, $permission, $cached) {
                    $this->authorize($actor, $job, true, $permission);

                    return json_decode($cached->response_summary, true, 512, JSON_THROW_ON_ERROR);
                });
            }
            $plans = [];
            $resources = [];
            foreach ($items as $item) {
                $state = $this->db->table('review_states')->where('matching_job_id', $job)->where('input_record_key', $item['input_record_key'])->first();
                $error = null;
                try {
                    $desired = $mode === 'rejection' ? [] : $this->desired($job, $item);
                } catch (ReviewWriteConflict $failure) {
                    if (! in_array($mode, ['bulk', 'approval'], true)) {
                        throw $failure;
                    } $error = $failure;
                    $desired = [];
                }
                $plans[] = ['item' => $item, 'desired' => $desired, 'error' => $error];
                $resources[] = ['input', "$job:{$item['input_record_key']}"];
                foreach ([$state ? (array) $state : [], $desired] as $value) {
                    if (($value['selected_reference_record_key'] ?? null) !== null) {
                        $resources[] = ['reference', "$job:{$value['selected_reference_record_key']}"];
                    }
                    if (($value['selected_reference_entity_group_id'] ?? null) !== null) {
                        $resources[] = ['entity', "$job:{$value['selected_reference_entity_group_id']}"];
                    }
                }
            }
            usort($resources, fn ($a, $b) => strcmp(json_encode($a), json_encode($b)));
            foreach ($resources as [$kind,$resource]) {
                $this->lock($kind, $resource, $locks);
            }
            if (isset($items[0]['change_request_id'])) {
                $this->lock('proposal', "$job:{$items[0]['change_request_id']}", $locks);
            }
            for ($attempt = 0; $attempt < 3; $attempt++) {
                try {
                    $this->db->statement('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

                    return $this->db->transaction(function () use ($actor, $job, $idempotency, $hash, $plans, $mode, $attempt, $permission) {
                        $this->authorize($actor, $job, true, $permission);
                        $op = (string) Str::uuid();
                        $now = $this->now();
                        $this->db->table('review_operations')->insert(['id' => $op, 'matching_job_id' => $job, 'actor_user_id' => $actor, 'idempotency_key' => $idempotency, 'request_hash' => $hash, 'operation_type' => in_array($mode, ['proposal', 'approval', 'rejection', 'undo'], true) ? $mode : 'review', 'status' => 'processing', 'created_at' => $now, 'updated_at' => $now]);
                        $result = ['operation_id' => $op, 'applied' => 0, 'conflicted' => 0, 'skipped' => 0, 'approval_required' => 0, 'items' => []];
                        foreach ($plans as $plan) {
                            try {
                                if (in_array($mode, ['approval', 'rejection'], true)) {
                                    $ack = $this->resolution($actor, $job, $op, $plan, $attempt, $mode);
                                } else {
                                    $ack = $this->db->transaction(fn () => $this->write($actor, $job, $op, $plan, $attempt, $mode));
                                }
                                $category = isset($ack['conflict_code']) ? 'conflicted' : match ($mode) {
                                    'proposal' => 'submitted', 'rejection' => 'rejected', default => 'applied',
                                };
                                $result[$category] ??= 0;
                                $result[$category]++;
                                $result['items'][] = $ack + ['outcome' => $category];
                            } catch (ReviewWriteConflict $error) {
                                if ($mode !== 'bulk') {
                                    throw $error;
                                }
                                $category = match ($error->reason) {
                                    'approval_required' => 'approval_required','duplicate_input_requires_resolution' => 'skipped',default => 'conflicted'
                                };
                                $result[$category]++;
                                $result['items'][] = ['input_record_key' => $plan['item']['input_record_key'], 'outcome' => $category, 'code' => $error->reason];
                            } catch (QueryException $error) {
                                if (($error->errorInfo[1] ?? 0) !== 1062) {
                                    throw $error;
                                }
                                if ($mode !== 'bulk') {
                                    throw new ReviewWriteConflict('reference_conflict');
                                }
                                $result['conflicted']++;
                                $result['items'][] = ['input_record_key' => $plan['item']['input_record_key'], 'outcome' => 'conflicted', 'code' => 'reference_conflict'];
                            }
                        }
                        $response = json_encode($result, JSON_THROW_ON_ERROR);
                        if (strlen($response) > 32768) {
                            throw new ReviewWriteConflict('operation_ack_too_large', [], 422);
                        }
                        $this->db->table('review_operations')->where('id', $op)->update(['status' => 'completed', 'response_summary' => $response, 'completed_at' => $this->now(), 'updated_at' => $this->now()]);

                        // MySQL canonicalizes JSON object order; return the durable acknowledgement on both first call and retry.
                        return json_decode($this->db->table('review_operations')->where('id', $op)->value('response_summary'), true, 512, JSON_THROW_ON_ERROR);
                    });
                } catch (\Throwable $error) {
                    $cause = $error;
                    $errno = 0;
                    do {
                        if ($cause instanceof QueryException || $cause instanceof \PDOException) {
                            $errno = $cause->errorInfo[1] ?? $errno;
                        } $cause = $cause->getPrevious();
                    } while ($cause !== null);
                    if (! in_array($errno, [1213, 1205], true)) {
                        if ($errno === 1062) {
                            throw new ReviewWriteConflict('reference_conflict');
                        }
                        throw $error;
                    }
                    if ($errno === 1213) {
                        $this->diagnostics['deadlocks']++;
                    }
                    if ($attempt === 2) {
                        throw new ReviewWriteConflict('review_busy_retry_later', ['attempts' => 3]);
                    }
                    $this->diagnostics['retries']++;
                    usleep(random_int(10000, 40000));
                }
            }
            throw new ReviewWriteConflict('review_busy_retry_later');
        } finally {
            foreach (array_reverse($locks) as $name) {
                $this->db->selectOne('SELECT RELEASE_LOCK(?) AS released', [$name]);
            }
            $this->db->statement('SET SESSION innodb_lock_wait_timeout='.$previousTimeout);
        }
    }

    private function authorize(int $actor, string $job, bool $lock, string $permission = 'review'): void
    {
        if ($this->access !== null) {
            $access = $this->access->job($actor, $job, $permission, $lock);
            $record = $access['job'];
            if ($record->status !== 'completed' || $record->review_state_readiness !== 'ready' || (int) $record->review_state_schema_version !== 1) {
                throw new ReviewWriteConflict('review_job_not_ready');
            }

            return;
        }
        $query = $this->db->table('users')->where('id', $actor);
        $user = ($lock ? $query->sharedLock() : $query)->first();
        if (! $user || ! in_array(PermissionRegistry::REVIEW_DECIDE, PermissionRegistry::forRole($user->role), true)) {
            throw new ReviewWriteConflict('review_forbidden', [], 403);
        }
        $query = $this->db->table('matching_jobs')->where('id', $job);
        $record = ($lock ? $query->sharedLock() : $query)->first();
        if (! $record || $record->id !== $job || $record->status !== 'completed' || $record->review_state_readiness !== 'ready' || (int) $record->review_state_schema_version !== 1) {
            throw new ReviewWriteConflict('review_job_not_ready');
        }
        $query = $this->db->table('workspaces')->where('matching_job_id', $job)->orderBy('id');
        if ($user->role !== 'admin') {
            $query->where('user_id', $actor);
        }
        $workspace = ($lock ? $query->sharedLock() : $query)->first();
        if (! $workspace) {
            throw new ReviewWriteConflict('review_forbidden', [], 403);
        }
    }

    private function desired(string $job, array $item, bool $locked = false): array
    {
        if ($item['decision'] === 'undo') {
            $query = $this->db->table('review_decisions')->where('matching_job_id', $job)->where('id', $item['undo_decision_id'] ?? '');
            $audit = ($locked ? $query->sharedLock() : $query)->first();
            if (! $audit || $audit->id !== ($item['undo_decision_id'] ?? null) || $audit->input_record_key !== $item['input_record_key'] || $audit->review_operation_id === null || $audit->decision === 'undo') {
                throw new ReviewWriteConflict('undo_not_available');
            }
            $metadata = json_decode($audit->metadata, true, 512, JSON_THROW_ON_ERROR);
            if (! isset($metadata['before']) || ! is_array($metadata['before']) || count($metadata['before']) !== count(self::FIELDS) || array_diff(array_keys($metadata['before']), self::FIELDS)) {
                throw new ReviewWriteConflict('undo_snapshot_unproven');
            }

            return $metadata['before'];
        }
        $status = ReviewContract::resultType($item['decision']);
        $ref = null;
        $candidate = null;
        if ($item['decision'] !== 'mark_unmatched') {
            $query = $this->db->table('matching_results')->where('matching_job_id', $job)->where('id', $item['candidate_id'] ?? '')->select('id', 'input_record_key', 'reference_record_key');
            $candidate = ($locked ? $query->sharedLock() : $query)->first();
            if (! $candidate || $candidate->id !== ($item['candidate_id'] ?? null) || $candidate->input_record_key !== $item['input_record_key']) {
                throw new ReviewWriteConflict('candidate_identity_mismatch', [], 422);
            }
            if ($status === 'matched') {
                $ref = $candidate->reference_record_key;
                if ($ref === null) {
                    throw new ReviewWriteConflict('reference_missing');
                }
            }
        }
        $member = $ref === null ? null : $this->db->table('reference_entity_members')->where('reference_dataset_id', $this->db->table('matching_jobs')->where('id', $job)->value('reference_dataset_id'))->where('reference_record_key', $ref)->first();

        return ['status' => $status, 'decision' => $item['decision'], 'selected_reference_record_key' => $ref, 'selected_matching_result_id' => $status === 'matched' ? $candidate->id : null, 'selected_reference_entity_group_id' => $member?->reference_entity_group_id, 'duplicate_of_input_record_key' => null];
    }

    private function write(int $actor, string $job, string $op, array $plan, int $attempt, string $mode = 'one', ?object $approval = null): array
    {
        if ($plan['error'] !== null) {
            throw $plan['error'];
        }
        $item = $plan['item'];
        $state = $this->db->table('review_states')->where('matching_job_id', $job)->where('input_record_key', $item['input_record_key'])->lockForUpdate()->first();
        if (! $state) {
            throw new ReviewWriteConflict('review_state_not_ready');
        }
        if ((int) $state->version !== $item['expected_version']) {
            throw new ReviewWriteConflict('stale_review_version', ['current_version' => (int) $state->version]);
        }
        if ($state->integrity_status !== 'consistent') {
            throw new ReviewWriteConflict('input_integrity_hold');
        }
        if ($state->status === 'duplicate_input') {
            throw new ReviewWriteConflict('duplicate_input_requires_resolution');
        }
        $desired = $this->desired($job, $item, true);
        if ($desired !== $plan['desired']) {
            throw new ReviewWriteConflict('reference_snapshot_changed');
        }
        if ($mode === 'proposal') {
            return $this->createProposal($actor, $job, $op, $state, $item, $desired);
        }
        if ($approval === null && ($state->decision_protection === 'approved'
            || ($state->decision_protection === 'reviewer_owned' && ($state->reviewer_user_id === null || (int) $state->reviewer_user_id !== $actor))
            || ($state->decision !== null && ($state->reviewer_user_id === null || (int) $state->reviewer_user_id !== $actor)))) {
            throw new ReviewWriteConflict('approval_required');
        }
        if ($item['decision'] === 'undo') {
            $audit = $this->db->table('review_decisions')->where('id', $item['undo_decision_id'])->first();
            if ($audit->review_operation_id !== $state->last_operation_id || (int) $audit->state_version_after !== (int) $state->version) {
                throw new ReviewWriteConflict('undo_superseded');
            }
        }
        foreach ([(array) $state, $desired] as $value) {
            $ref = $value['selected_reference_record_key'] ?? null;
            $group = $value['selected_reference_entity_group_id'] ?? null;
            if ($ref === null && $group === null) {
                continue;
            }
            $hold = $ref === null ? null : $this->db->table('review_reference_holds')->where('matching_job_id', $job)->where('active_reference_record_key', $ref)->sharedLock()->first();
            if (! $hold && $group !== null) {
                $hold = $this->db->table('review_reference_holds')->where('matching_job_id', $job)->where('active_reference_entity_group_id', $group)->sharedLock()->first();
            }
            if ($hold) {
                throw new ReviewWriteConflict('reference_integrity_hold');
            }
        }
        if (($desired['selected_reference_record_key'] ?? null) !== null) {
            $member = $this->db->table('reference_entity_members')->where('reference_dataset_id', $state->reference_dataset_id)->where('reference_record_key', $desired['selected_reference_record_key'])->sharedLock()->first();
            if ($member?->reference_entity_group_id !== ($desired['selected_reference_entity_group_id'] ?? null)) {
                throw new ReviewWriteConflict('reference_snapshot_changed');
            }
            $other = $this->db->table('review_states')->where('matching_job_id', $job)->where('active_reference_record_key', $desired['selected_reference_record_key'])->where('id', '<>', $state->id)->first();
            if (! $other && $desired['selected_reference_entity_group_id'] !== null) {
                $other = $this->db->table('review_states')->where('matching_job_id', $job)->where('active_reference_entity_group_id', $desired['selected_reference_entity_group_id'])->where('id', '<>', $state->id)->first();
                // Also protects preexisting Auto Match if a member's group projection is not populated.
                if (! $other) {
                    $other = $this->db->table('reference_entity_members as m')->join('review_states as s', function ($join) use ($job) {
                        $join->on('s.active_reference_record_key', '=', 'm.reference_record_key')->where('s.matching_job_id', $job);
                    })
                        ->where('m.reference_dataset_id', $state->reference_dataset_id)->where('m.reference_entity_group_id', $desired['selected_reference_entity_group_id'])->where('s.id', '<>', $state->id)->select('s.id')->first();
                }
            }
            if ($other) {
                throw new ReviewWriteConflict('reference_conflict');
            }
        }
        $before = array_intersect_key((array) $state, array_flip(self::FIELDS));
        $after = array_replace($before, $desired, ['last_modified_by_user_id' => $actor]);
        if ($item['decision'] !== 'undo') {
            $after = array_replace($after, ['reviewer_user_id' => $approval ? $approval->proposed_by_user_id : $actor,
                'proposed_by_user_id' => $approval?->proposed_by_user_id, 'approved_by_user_id' => $approval ? $actor : null,
                'decision_origin' => $approval ? 'approval' : 'manual', 'decision_protection' => $approval ? 'approved' : 'reviewer_owned']);
        }
        $updated = $this->db->table('review_states')->where('id', $state->id)->where('version', $item['expected_version'])->where('integrity_status', 'consistent')->update([...$after, 'version' => $state->version + 1, 'last_operation_id' => $op, 'updated_at' => $this->now()]);
        if ($updated !== 1) {
            throw new ReviewWriteConflict('stale_review_version');
        }
        $id = (string) Str::uuid();
        $auditCandidate = $item['decision'] === 'undo' ? $after['selected_matching_result_id'] : ($item['decision'] === 'mark_unmatched' ? null : ($item['candidate_id'] ?? null));
        $auditReference = $after['selected_reference_record_key'];
        if ($item['decision'] === 'reject_match') {
            $auditReference = $this->db->table('matching_results')->where('id', $auditCandidate)->value('reference_record_key');
        }
        $this->db->table('review_decisions')->insert(['id' => $id, 'matching_job_id' => $job, 'matching_result_id' => $auditCandidate, 'input_record_key' => $state->input_record_key,
            'selected_reference_record_key' => $auditReference, 'decision' => $item['decision'], 'previous_result_type' => $state->status, 'new_result_type' => $after['status'],
            'reviewer_user_id' => $approval ? $approval->proposed_by_user_id : $actor, 'proposed_by_user_id' => $approval?->proposed_by_user_id, 'approved_by_user_id' => $approval ? $actor : null,
            'change_request_id' => $approval?->id, 'last_modified_by_user_id' => $actor, 'review_state_id' => $state->id, 'review_operation_id' => $op, 'state_version_before' => $state->version, 'state_version_after' => $state->version + 1,
            'metadata' => json_encode(['before' => $before, 'after' => $after, 'before_operation_id' => $state->last_operation_id, 'undo_of' => $item['undo_decision_id'] ?? null], JSON_THROW_ON_ERROR), 'created_at' => $this->now(), 'updated_at' => $this->now()]);
        if ($this->testProbe !== null) {
            ($this->testProbe)($attempt, $state->input_record_key);
        }

        return ['input_record_key' => $state->input_record_key, 'version' => $state->version + 1, 'decision_id' => $id];
    }

    private function createProposal(int $actor, string $job, string $op, object $state, array $item, array $desired): array
    {
        if ($state->decision_protection === 'open' && ($state->decision === null || (int) $state->reviewer_user_id === $actor)
            || ($state->decision_protection === 'reviewer_owned' && $state->reviewer_user_id !== null && (int) $state->reviewer_user_id === $actor)) {
            throw new ReviewWriteConflict('proposal_not_required', [], 422);
        }
        if ($this->db->table('review_change_requests')->where('review_state_id', $state->id)->where('status', 'pending')->exists()) {
            throw new ReviewWriteConflict('pending_proposal_exists');
        }
        $id = (string) Str::uuid();
        $this->db->table('review_change_requests')->insert([
            'id' => $id, 'matching_job_id' => $job, 'review_state_id' => $state->id, 'reference_dataset_id' => $state->reference_dataset_id,
            'expected_version' => $state->version, 'previous_reviewer_user_id' => $state->reviewer_user_id,
            'proposed_by_user_id' => $actor, 'last_modified_by_user_id' => $actor,
            'before_status' => $state->status, 'before_reference_record_key' => $state->selected_reference_record_key,
            'before_duplicate_of_input_record_key' => $state->duplicate_of_input_record_key,
            'proposed_decision' => $item['decision'], 'proposed_status' => $desired['status'],
            'proposed_reference_record_key' => $desired['selected_reference_record_key'],
            'proposed_reference_entity_group_id' => $desired['selected_reference_entity_group_id'],
            'proposed_matching_result_id' => $item['candidate_id'] ?? null,
            'reason' => $item['reason'], 'status' => 'pending', 'created_at' => $this->now(), 'updated_at' => $this->now(),
        ]);

        return ['input_record_key' => $state->input_record_key, 'request_id' => $id, 'request_version' => 1, 'status' => 'pending',
            'version' => (int) $state->version, 'previous_reviewer_user_id' => $state->reviewer_user_id,
            'proposed_by_user_id' => $actor, 'reason' => $item['reason'],
            'before' => array_intersect_key((array) $state, array_flip(self::FIELDS)), 'proposed' => $desired];
    }

    /** Resolve proposal and write state in the same outer transaction, through write() only. */
    private function resolution(int $actor, string $job, string $op, array $plan, int $attempt, string $mode): array
    {
        $item = $plan['item'];
        $state = $this->db->table('review_states')->where('matching_job_id', $job)->where('input_record_key', $item['input_record_key'])->lockForUpdate()->first();
        $request = $this->db->table('review_change_requests')->where('matching_job_id', $job)->where('id', $item['change_request_id'])->lockForUpdate()->first();
        if (! $state || ! $request || $request->review_state_id !== $state->id || $request->id !== $item['change_request_id']) {
            throw new ReviewWriteConflict('proposal_not_found', [], 404);
        }
        if ($request->status !== 'pending' || (int) $request->version !== $item['expected_request_version']) {
            throw new ReviewWriteConflict('stale_proposal_version', ['current_version' => (int) $request->version, 'status' => $request->status]);
        }
        // Snapshot fields cannot be substituted by a caller or changed between planning and commit.
        if ((int) $request->expected_version !== $item['expected_version'] || $request->proposed_decision !== $item['decision'] || $request->proposed_matching_result_id !== $item['candidate_id']) {
            throw new ReviewWriteConflict('proposal_snapshot_changed');
        }
        $status = 'rejected';
        $conflict = null;
        $ack = [];
        if ($mode === 'approval') {
            try {
                if ($plan['error'] !== null) {
                    throw $plan['error'];
                }
                $this->authorize((int) $request->proposed_by_user_id, $job, true, 'propose');
                if ((int) $state->version !== (int) $request->expected_version) {
                    throw new ReviewWriteConflict('stale_review_version', ['current_version' => (int) $state->version]);
                }
                $snapshot = $plan['desired'];
                foreach (['status' => 'proposed_status', 'selected_reference_record_key' => 'proposed_reference_record_key', 'selected_reference_entity_group_id' => 'proposed_reference_entity_group_id'] as $field => $column) {
                    if (($snapshot[$field] ?? null) !== $request->$column) {
                        throw new ReviewWriteConflict('proposal_snapshot_changed');
                    }
                }
                $ack = $this->db->transaction(fn () => $this->write($actor, $job, $op, $plan, $attempt, 'approval', $request));
                $status = 'approved';
            } catch (ReviewWriteConflict $error) {
                $conflict = $error->reason;
                $status = $conflict === 'stale_review_version' ? 'stale' : 'conflicted';
            } catch (QueryException $error) {
                if (($error->errorInfo[1] ?? 0) !== 1062) {
                    throw $error;
                }
                $conflict = 'reference_conflict';
                $status = 'conflicted';
            }
        }
        $updated = $this->db->table('review_change_requests')->where('id', $request->id)->where('version', $request->version)->where('status', 'pending')->update([
            'status' => $status, 'version' => $request->version + 1, 'approved_by_user_id' => $status === 'approved' ? $actor : null,
            'last_modified_by_user_id' => $actor, 'resolution_reason' => $conflict ?? $item['resolution_reason'],
            'resolved_at' => $this->now(), 'applied_operation_id' => $status === 'approved' ? $op : null, 'updated_at' => $this->now(),
        ]);
        if ($updated !== 1) {
            throw new ReviewWriteConflict('stale_proposal_version');
        }

        return $ack + ['input_record_key' => $state->input_record_key, 'request_id' => $request->id, 'request_version' => $request->version + 1,
            'status' => $status, 'previous_status' => 'pending', 'previous_reviewer_user_id' => $request->previous_reviewer_user_id,
            'proposed_by_user_id' => $request->proposed_by_user_id, 'approved_by_user_id' => $status === 'approved' ? $actor : null,
            'last_modified_by_user_id' => $actor, 'resolution_reason' => $conflict ?? $item['resolution_reason']]
            + ($conflict === null ? [] : ['conflict_code' => $conflict]);
    }

    private function lock(string $kind, string $resource, array &$locks): void
    {
        $name = 'rm:'.substr(hash('sha256', $kind.':'.$resource), 0, 60);
        if (in_array($name, $locks, true)) {
            return;
        }
        $start = microtime(true);
        $remaining = $this->lockDeadline - $start;
        if ($remaining <= 0) {
            throw new ReviewWriteConflict('review_resource_busy');
        }
        $got = $this->db->selectOne('SELECT GET_LOCK(?,?) AS acquired', [$name, $remaining])->acquired;
        $this->diagnostics['lock_wait_ms'] += (microtime(true) - $start) * 1000;
        if ((int) $got !== 1) {
            throw new ReviewWriteConflict('review_resource_busy');
        }
        $locks[] = $name;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable)->format('Y-m-d H:i:s.u');
    }
}
