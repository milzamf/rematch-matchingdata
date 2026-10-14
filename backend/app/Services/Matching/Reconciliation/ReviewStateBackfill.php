<?php

namespace App\Services\Matching\Reconciliation;

use App\Services\Datasets\CsvDatasetParser;
use App\Services\Datasets\XlsxDatasetParser;
use Illuminate\Database\ConnectionInterface;
use PDO;
use RuntimeException;
use ZipArchive;

/** Offline shadow backfill. No routes, queue dispatch, production writer, or similarity invocation. */
final class ReviewStateBackfill
{
    private PDO $stage;

    private int $chunk = 64;

    public function __construct(private readonly ConnectionInterface $db) {}

    public static function stableId(string $scope): string
    {
        $hash = hash('sha256', $scope);

        return substr($hash, 0, 8).'-'.substr($hash, 8, 4).'-5'.substr($hash, 13, 3).'-a'.substr($hash, 17, 3).'-'.substr($hash, 20, 12);
    }

    public function prepare(string $jobId, string $artifact, string $sourceRoot, int $chunk = 64): array
    {
        $this->chunk = max(1, min(256, $chunk));
        $this->open($artifact);
        $job = $this->db->table('matching_jobs')->where('id', $jobId)->first();
        if (! $job || $job->status !== 'completed') {
            throw new RuntimeException('Only completed jobs may be staged.');
        }
        $digest = $this->digest($jobId);
        if ($this->meta('phase') === 'planned') {
            if ($this->meta('job') !== $jobId || $this->meta('digest') !== $digest || ! $this->filesUnchanged()) {
                throw new RuntimeException('Source snapshot changed; create a new audited run.');
            }

            return $this->report();
        }
        if ($this->meta('job') !== null && $this->meta('job') !== $jobId) {
            throw new RuntimeException('Artifact belongs to another job.');
        }
        $this->stage->beginTransaction();
        try {
            foreach (['candidates', 'events', 'members', 'source_rows', 'plans', 'claims', 'issues', 'holds'] as $table) {
                $this->stage->exec("DELETE FROM $table");
            }
            $this->setMeta('job', $jobId);
            $this->setMeta('digest', $digest);
            $this->setMeta('phase', 'capturing');
            $this->setMeta('reference_dataset', $job->reference_dataset_id);
            $this->setMeta('chunk', (string) $this->chunk);
            $this->setMeta('next_seq', '0');
            $this->setMeta('original_readiness', $job->review_state_readiness);
            $this->setMeta('original_version', (string) $job->review_state_schema_version);
            $this->stage->exec('DELETE FROM preexisting');
            $this->stage->exec('DELETE FROM preexisting_state_versions');
            foreach (['review_states', 'review_reconciliation_issues', 'review_reference_holds'] as $table) {
                $last = '';
                do {
                    $existing = $this->db->table($table)->where('matching_job_id', $jobId)->where('id', '>', $last)->orderBy('id')->limit($this->chunk)->get($table === 'review_states' ? ['id', 'version', 'last_operation_id'] : ['id']);
                    foreach ($existing as $row) {
                        $last = $row->id;
                        $this->sql('INSERT INTO preexisting(t,id) VALUES(?,?)', [$table, $row->id]);
                        if ($table === 'review_states') $this->sql('INSERT INTO preexisting_state_versions(id,version,last_operation_id) VALUES(?,?,?)', [$row->id, $row->version, $row->last_operation_id]);
                    }
                } while ($existing->count() === $this->chunk);
            }
            foreach ($this->snapshot($jobId) as [$kind,$row]) {
                if ($kind === 'candidate') {
                    $this->sql('INSERT INTO candidates(id,k,payload) VALUES(?,?,?)', [$row['id'], $row['input_record_key'], json_encode($row, JSON_THROW_ON_ERROR)]);
                }
                if ($kind === 'event') {
                    $this->sql('INSERT INTO events(id,k,payload) VALUES(?,?,?)', [$row['id'], $row['input_record_key'], json_encode($row, JSON_THROW_ON_ERROR)]);
                }
                if ($kind === 'member') {
                    $this->sql('INSERT INTO members(ref,gid) VALUES(?,?)', [$row['reference_record_key'], $row['reference_entity_group_id']]);
                }
            }
            $input = (array) $this->db->table('datasets')->where('id', $job->input_dataset_id)->first();
            $reference = (array) $this->db->table('datasets')->where('id', $job->reference_dataset_id)->first();
            $this->lineage($input, $sourceRoot);
            $refFile = $this->file($reference, $sourceRoot);
            $proof = json_decode($reference['profiling_summary'] ?? '{}', true) ?? [];
            $refVerified = $refFile['state'] === 'present' && ($proof['source_sha256_at_match'] ?? null) === ($refFile['sha256'] ?? null) && ($proof['lineage_parser'] ?? null) === 'rematch-stream-v1';
            $this->setMeta('reference_file', json_encode($refFile, JSON_THROW_ON_ERROR));
            $this->setMeta('reference_count', $refFile['state'] === 'present' ? (string) $this->countSource($reference, $refFile['path']) : 'unknown');
            $this->setMeta('reference_verified', $refVerified && (int) $this->meta('reference_count') === (int) $reference['row_count'] ? '1' : '0');
            $keys = $this->stage->query('SELECT k FROM candidates UNION SELECT k FROM events ORDER BY k COLLATE BINARY');
            while (($key = $keys->fetchColumn()) !== false) {
                $this->plan($jobId, (string) $key);
            }
            $this->detectConflicts();
            if ($this->digest($jobId) !== $digest) {
                throw new RuntimeException('Source changed during audit; nothing can be backfilled.');
            }
            $this->setMeta('phase', 'planned');
            $this->stage->commit();
        } catch (\Throwable $error) {
            if ($this->stage->inTransaction()) {
                $this->stage->rollBack();
            }
            throw $error;
        }

        return $this->report();
    }

    /** Penulisan hanya pada fixture terisolasi atau maintenance produksi yang disetujui dan terkunci. */
    public function apply(string $jobId, string $artifact, ?int $maxChunks = null, ?callable $afterCommit = null): array
    {
        return \App\Services\Matching\Transactions\ReviewDeploymentFence::withMaintenance($this->db, fn () => $this->applyAdmitted($jobId, $artifact, $maxChunks, $afterCommit));
    }

    private function applyAdmitted(string $jobId, string $artifact, ?int $maxChunks, ?callable $afterCommit): array
    {
        $production = \App\Services\Matching\Transactions\ReviewDeploymentFence::productionMode();
        if (! $production && ($this->db->getDriverName() !== 'mysql' || $this->db->getDatabaseName() !== 'rematch_stage3_test'
            || getenv('REMATCH_BACKFILL_TEST') !== 'isolated-stage3')) {
            throw new RuntimeException('Production backfill is disabled.');
        }
        $this->open($artifact);
        if ($this->meta('job') !== $jobId || $this->meta('phase') !== 'planned') {
            throw new RuntimeException('A completed dry-run plan is required.');
        }
        $this->chunk = (int) $this->meta('chunk');
        $this->assertPreexistingStatesUnchanged($jobId);
        if ($this->digest($jobId) !== $this->meta('digest') || ! $this->filesUnchanged()) {
            throw new RuntimeException('Stale snapshot; backfill refused.');
        }
        $this->db->table('matching_jobs')->where('id', $jobId)->update(['review_state_readiness' => 'reconciling']);
        $chunks = 0;
        // Resource reservations are neutral: every conflicting owner will be held, none chosen.
        foreach ($this->stage->query('SELECT * FROM holds ORDER BY kind,resource') as $hold) {
            $this->db->transaction(function () use ($jobId, $hold) {
                $record = ['id' => self::stableId("hold:$jobId:{$hold['kind']}:{$hold['resource']}"), 'matching_job_id' => $jobId,
                    'reference_dataset_id' => $this->meta('reference_dataset'), 'status' => 'active',
                    'reference_record_key' => $hold['kind'] === 'record' ? $hold['resource'] : null,
                    'reference_entity_group_id' => $hold['kind'] === 'entity' ? $hold['resource'] : null,
                    'evidence_fingerprint' => $this->meta('digest')];
                $this->insertIdentical('review_reference_holds', $record);
            });
        }
        while ($rows = $this->sql('SELECT * FROM plans WHERE seq>? AND preserved=0 ORDER BY seq LIMIT ?', [(int) $this->meta('next_seq'), $this->chunk])->fetchAll(PDO::FETCH_ASSOC)) {
            $last = (int) end($rows)['seq'];
            $this->db->transaction(function () use ($jobId, $rows) {
                foreach ($rows as $row) {
                    $state = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
                    $state = ['id' => self::stableId("state:$jobId:{$row['k']}"), 'matching_job_id' => $jobId,
                        'reference_dataset_id' => $this->meta('reference_dataset'), 'input_record_key' => $row['k'], 'version' => 1, ...$state];
                    $this->insertIdentical('review_states', $state);
                }
            });
            // Fault here tests crash between MySQL commit and sidecar checkpoint; replay must be identical.
            if ($afterCommit !== null) {
                $afterCommit($last);
            }
            $this->setMeta('next_seq', (string) $last);
            if ($maxChunks !== null && ++$chunks >= $maxChunks) {
                return $this->report() + ['finished' => false];
            }
        }
        // Preserved verified duplicate states are never re-created or overwritten.
        foreach ($this->stage->query('SELECT k,reason FROM issues ORDER BY k,reason') as $issue) {
            $this->insertIdentical('review_reconciliation_issues', ['id' => self::stableId("issue:$jobId:{$issue['k']}:{$issue['reason']}"),
                'matching_job_id' => $jobId, 'input_record_key' => $issue['k'], 'reason_code' => $issue['reason'],
                'evidence_fingerprint' => $this->meta('digest'), 'status' => 'open']);
        }
        $this->validate($jobId);
        $this->setMeta('finished', '1');

        return $this->report() + ['finished' => true];
    }

    public function rollback(string $jobId, string $artifact): void
    {
        \App\Services\Matching\Transactions\ReviewDeploymentFence::withMaintenance($this->db, fn () => $this->rollbackAdmitted($jobId, $artifact));
    }

    private function rollbackAdmitted(string $jobId, string $artifact): void
    {
        $production = \App\Services\Matching\Transactions\ReviewDeploymentFence::productionMode();
        if (! $production && ($this->db->getDriverName() !== 'mysql' || $this->db->getDatabaseName() !== 'rematch_stage3_test' || getenv('REMATCH_BACKFILL_TEST') !== 'isolated-stage3')) {
            throw new RuntimeException('Production rollback is disabled.');
        }
        $this->open($artifact);
        if ($this->meta('job') !== $jobId) {
            throw new RuntimeException('Wrong artifact.');
        }
        if ($this->meta('phase') !== 'planned') throw new RuntimeException('Completed rollback checkpoint required.');
        $this->assertPreexistingStatesUnchanged($jobId);
        if ($this->digest($jobId) !== $this->meta('digest') || ! $this->filesUnchanged()) {
            throw new RuntimeException('Source/history changed; rollback refused.');
        }
        // Validate all owned rows before the first delete, so a used state cannot cause partial cleanup.
        foreach ($this->rollbackBatches($jobId) as $plans) {
            $rows = $this->db->table('review_states')->whereIn('id', array_keys($plans))->get()->keyBy('id');
            $this->validateRollbackRows($plans, $rows);
        }
        foreach ($this->stage->query('SELECT k,reason FROM issues') as $issue) {
            $this->deleteOwned('review_reconciliation_issues', self::stableId("issue:$jobId:{$issue['k']}:{$issue['reason']}"), false);
        }
        foreach ($this->stage->query('SELECT kind,resource FROM holds') as $hold) {
            $this->deleteOwned('review_reference_holds', self::stableId("hold:$jobId:{$hold['kind']}:{$hold['resource']}"), false);
        }
        $this->db->table('matching_jobs')->where('id', $jobId)->update(['review_state_readiness' => 'reconciling']);
        // Delete only rows absent in the original snapshot. Each transaction is short.
        foreach ($this->rollbackBatches($jobId) as $plans) {
            $this->db->transaction(function () use ($plans) {
                $rows = $this->db->table('review_states')->whereIn('id', array_keys($plans))->lockForUpdate()->get()->keyBy('id');
                $this->validateRollbackRows($plans, $rows);
                $this->db->table('review_states')->whereIn('id', $rows->keys()->all())->delete();
            });
        }
        foreach ($this->stage->query('SELECT k,reason FROM issues') as $issue) {
            $this->deleteOwned('review_reconciliation_issues', self::stableId("issue:$jobId:{$issue['k']}:{$issue['reason']}"));
        }
        foreach ($this->stage->query('SELECT kind,resource FROM holds') as $hold) {
            $this->deleteOwned('review_reference_holds', self::stableId("hold:$jobId:{$hold['kind']}:{$hold['resource']}"));
        }
        $this->db->table('matching_jobs')->where('id', $jobId)->update(['review_state_readiness' => $this->meta('original_readiness'), 'review_state_schema_version' => (int) $this->meta('original_version')]);
        $this->setMeta('next_seq', '0');
        $this->setMeta('finished', '0');
    }

    /** Bounded reverse keyset; preserve the original whole-run preflight. */
    private function rollbackBatches(string $jobId): \Generator
    {
        $last = PHP_INT_MAX;
        do {
            $batch = $this->sql('SELECT seq,k,payload FROM plans WHERE preserved=0 AND seq<? ORDER BY seq DESC LIMIT ?', [$last, $this->chunk])->fetchAll(PDO::FETCH_ASSOC);
            $plans = [];
            foreach ($batch as $plan) {
                $last = (int) $plan['seq'];
                $id = self::stableId("state:$jobId:{$plan['k']}");
                if (! $this->sql('SELECT 1 FROM preexisting WHERE t=? AND id=?', ['review_states', $id])->fetchColumn()) $plans[$id] = $plan;
            }
            if ($plans) yield $plans;
        } while (count($batch) === $this->chunk);
    }

    private function validateRollbackRows(array $plans, \Illuminate\Support\Collection $rows): void
    {
        foreach ($plans as $id => $plan) {
            $current = $rows->get($id);
            if ($current && ($current->version !== 1 || $current->last_operation_id !== null)) throw new RuntimeException('A state has been used; rollback refused.');
            if ($current) $this->assertFields((array) $current, json_decode($plan['payload'], true, 512, JSON_THROW_ON_ERROR));
        }
    }

    private function assertPreexistingStatesUnchanged(string $jobId): void
    {
        $last = '';
        do {
            $original = $this->sql("SELECT p.id,v.version,v.last_operation_id FROM preexisting p LEFT JOIN preexisting_state_versions v ON v.id=p.id WHERE p.t='review_states' AND p.id>? ORDER BY p.id LIMIT ?", [$last, $this->chunk])->fetchAll(PDO::FETCH_ASSOC);
            $current = $this->db->table('review_states')->where('matching_job_id', $jobId)->whereIn('id', array_column($original, 'id'))->get(['id', 'version', 'last_operation_id'])->keyBy('id');
            foreach ($original as $row) {
                $last = $row['id'];
                if ($row['version'] === null) throw new RuntimeException('Preexisting state checkpoint is incomplete; re-audit required.');
                $state = $current->get($row['id']);
                if (! $state || (int) $state->version !== (int) $row['version'] || $state->last_operation_id !== $row['last_operation_id']) {
                    throw new RuntimeException('Preexisting state changed; recovery refused.');
                }
            }
        } while (count($original) === $this->chunk);
    }

    private function snapshot(string $jobId): \Generator
    {
        yield ['job', (array) $this->db->table('matching_jobs')->where('id', $jobId)->first()];
        $job = $this->db->table('matching_jobs')->where('id', $jobId)->first();
        foreach ([$job->input_dataset_id, $job->reference_dataset_id] as $id) {
            yield ['dataset', (array) $this->db->table('datasets')->where('id', $id)->first()];
        }
        // Covering (job, rank, id) index supports bounded keyset reads without OFFSET.
        $max = (int) $this->db->table('matching_results')->where('matching_job_id', $jobId)->max('candidate_rank');
        if ($max > 1000) {
            throw new RuntimeException('Candidate rank admission limit exceeded.');
        }
        for ($rank = 1; $rank <= $max; $rank++) {
            $last = '';
            do {
                $rows = $this->db->table('matching_results')->where('matching_job_id', $jobId)->where('candidate_rank', $rank)->where('id', '>', $last)->orderBy('id')->limit($this->chunk)
                    ->select(['id', 'matching_job_id', 'input_record_key', 'reference_record_key', 'candidate_rank', 'result_type', 'overall_score', 'review_decision', 'reviewed_at', 'updated_at'])
                    ->selectRaw("LEFT(CAST(JSON_EXTRACT(candidate_metadata, '$.input_record') AS CHAR), 262145) AS input_snapshot")->get();
                foreach ($rows as $row) {
                    $last = $row->id;
                    yield ['candidate', (array) $row];
                }
            } while ($rows->count() === $this->chunk);
        }
        foreach (['review_decisions' => 'event', 'reference_entity_members' => 'member', 'review_states' => 'verified_duplicate'] as $table => $kind) {
            $last = '';
            do {
                $query = $this->db->table($table)->where('id', '>', $last)->orderBy('id')->limit($this->chunk);
                if ($kind === 'member') {
                    $query = $this->db->table('reference_entity_members as m')->join('reference_entity_groups as g', 'g.id', '=', 'm.reference_entity_group_id')
                        ->where('m.reference_dataset_id', $job->reference_dataset_id)->where('m.id', '>', $last)->orderBy('m.id')->limit($this->chunk)
                        ->select('m.*', 'g.version as group_version', 'g.verified_by_user_id as group_verifier', 'g.verified_at as group_verified_at', 'g.verification_note as group_note');
                } else {
                    $query->where('matching_job_id', $jobId);
                }
                if ($kind === 'verified_duplicate') {
                    $query->where('status', 'duplicate_input');
                }
                if ($kind === 'event') {
                    $query->select(['id', 'matching_job_id', 'matching_result_id', 'input_record_key', 'selected_reference_record_key', 'decision', 'previous_result_type', 'new_result_type', 'reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id', 'review_state_id', 'review_operation_id', 'change_request_id', 'state_version_before', 'state_version_after', 'created_at', 'undone_at'])
                        ->selectRaw('LEFT(CAST(metadata AS CHAR),32769) AS metadata, SHA2(CAST(metadata AS CHAR),256) AS metadata_fingerprint');
                }
                $rows = $query->get();
                foreach ($rows as $row) {
                    $last = $row->id;
                    $value = (array) $row;
                    if ($kind === 'event') {
                        $value['metadata'] = strlen($value['metadata'] ?? '') > 32768 ? ['audit_truncated' => true] : json_decode($value['metadata'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
                    }
                    yield [$kind, $value];
                }
            } while ($rows->count() === $this->chunk);
        }
    }

    private function digest(string $jobId): string
    {
        $context = hash_init('sha256');
        foreach ($this->snapshot($jobId) as [$kind,$row]) {
            if ($kind === 'job') {
                unset($row['review_state_readiness'],$row['review_state_schema_version']);
            }
            hash_update($context, $kind.':'.json_encode($row, JSON_THROW_ON_ERROR)."\n");
        }

        return hash_final($context);
    }

    private function plan(string $jobId, string $key): void
    {
        $bytes = (int) $this->sql('SELECT COALESCE(SUM(LENGTH(payload)),0) FROM candidates WHERE k=?', [$key])->fetchColumn();
        if ($bytes > 8 * 1024 * 1024) {
            throw new RuntimeException('Per-input candidate audit admission limit exceeded.');
        }
        $candidates = array_map(fn ($row) => json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR), $this->sql('SELECT payload FROM candidates WHERE k=? ORDER BY id LIMIT 1001', [$key])->fetchAll(PDO::FETCH_ASSOC));
        if (count($candidates) > 1000) {
            throw new RuntimeException('Candidate count admission limit exceeded.');
        }
        $events = (function () use ($key) {
            foreach ($this->sql('SELECT payload FROM events WHERE k=? ORDER BY id', [$key]) as $row) {
                yield json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
            }
        })();
        $proposal = (new HistoricalReviewResolver)->resolve($jobId, $key, $candidates, $events);
        $verified = $this->db->table('review_states')->where('matching_job_id', $jobId)->where('input_record_key', $key)->where('status', 'duplicate_input')->first();
        $preserved = 0;
        if ($verified && $verified->reviewer_user_id !== null && $verified->decision_origin === 'manual') {
            $payload = array_intersect_key((array) $verified, array_flip(['status', 'decision', 'selected_reference_record_key', 'selected_matching_result_id', 'selected_reference_entity_group_id', 'duplicate_of_input_record_key', 'reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id', 'decision_origin', 'decision_protection', 'integrity_status', 'lineage_status', 'source_occurrence_count']));
            $preserved = 1;
        } else {
            $payload = $proposal['effective_state'] ?? ['status' => 'reference_conflict', 'decision' => null, 'selected_reference_record_key' => null, 'selected_matching_result_id' => null,
                'reviewer_user_id' => null, 'last_modified_by_user_id' => null, 'proposed_by_user_id' => null, 'approved_by_user_id' => null, 'decision_origin' => 'legacy', 'decision_protection' => 'legacy_unknown'];
            $payload += ['duplicate_of_input_record_key' => null, 'selected_reference_entity_group_id' => null, 'integrity_status' => $proposal['requires_reconciliation'] ? 'held' : 'consistent'];
            foreach ($proposal['issues'] as $reason) {
                $this->issue($key, $reason);
            }
            $lineage = $this->sql('SELECT COUNT(*) AS n, MIN(confidence) AS confidence FROM source_rows WHERE k=?', [$key])->fetch(PDO::FETCH_ASSOC);
            $payload['source_occurrence_count'] = $lineage['n'] > 0 ? (int) $lineage['n'] : null;
            $payload['lineage_status'] = $lineage['n'] > 0 ? $lineage['confidence'] : 'unverified';
            if ($payload['lineage_status'] !== 'verified') {
                $this->issue($key, 'lineage_'.$payload['lineage_status']);
            }
        }
        if (! $candidates) {
            $preserved = 2;
        } // Orphan history is an issue, never a fabricated input state.
        $ref = $payload['selected_reference_record_key'] ?? null;
        if ($ref !== null && ! $preserved) {
            $group = $this->sql('SELECT gid FROM members WHERE ref=?', [$ref])->fetchColumn();
            $payload['selected_reference_entity_group_id'] = $group === false ? null : $group;
            if ($this->meta('reference_count') === 'unknown' || $this->meta('reference_verified') !== '1') {
                $this->issue($key, 'reference_source_unproven');
                $payload['integrity_status'] = 'held';
            } elseif (! preg_match('/^[1-9][0-9]*$/D', $ref) || strlen($ref) > 10 || (int) $ref > (int) $this->meta('reference_count')) {
                $this->issue($key, 'reference_key_not_in_source');
                $payload['integrity_status'] = 'held';
            }
        }
        $this->sql('INSERT INTO plans(k,payload,preserved) VALUES(?,?,?)', [$key, json_encode($payload, JSON_THROW_ON_ERROR), $preserved]);
        // Reserve every plausible matched claim for ambiguous history, never the highest score.
        if ($payload['status'] === 'matched') {
            $this->claim($key, $ref);
        }
        if ($proposal['requires_reconciliation'] && $preserved !== 1) {
            foreach ($candidates as $candidate) {
                if ($candidate['result_type'] === 'matched') {
                    $this->claim($key, $candidate['reference_record_key']);
                }
            }
            foreach ($this->sql('SELECT payload FROM events WHERE k=?', [$key]) as $row) {
                $event = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
                if (empty($event['undone_at']) && $event['new_result_type'] === 'matched') {
                    $this->claim($key, $event['selected_reference_record_key']);
                }
            }
        }
    }

    private function claim(string $key, ?string $ref): void
    {
        if ($ref === null) {
            return;
        }
        $this->sql('INSERT OR IGNORE INTO claims(k,kind,resource) VALUES(?,?,?)', [$key, 'record', $ref]);
        $group = $this->sql('SELECT gid FROM members WHERE ref=?', [$ref])->fetchColumn();
        if ($group !== false) {
            $this->sql('INSERT OR IGNORE INTO claims(k,kind,resource) VALUES(?,?,?)', [$key, 'entity', $group]);
        }
    }

    private function detectConflicts(): void
    {
        foreach ($this->stage->query('SELECT kind,resource FROM claims GROUP BY kind,resource HAVING COUNT(*)>1') as $collision) {
            foreach ($this->sql('SELECT k FROM claims WHERE kind=? AND resource=?', [$collision['kind'], $collision['resource']]) as $row) {
                $this->issue($row['k'], $collision['kind'] === 'record' ? 'reference_collision' : 'verified_entity_collision');
                $this->hold($row['k']);
            }
        }
        // Disk-backed queue visits each held input once, rather than rescanning the dataset.
        $this->stage->exec("DELETE FROM hold_queue; INSERT INTO hold_queue(k) SELECT k FROM plans WHERE json_extract(payload,'$.integrity_status')='held'");
        while (($key = $this->stage->query('SELECT k FROM hold_queue WHERE processed=0 LIMIT 1')->fetchColumn()) !== false) {
            $this->sql('UPDATE hold_queue SET processed=1 WHERE k=?', [$key]);
            foreach ($this->sql('SELECT kind,resource FROM claims WHERE k=?', [$key]) as $claim) {
                $this->sql('INSERT OR IGNORE INTO holds(kind,resource) VALUES(?,?)', [$claim['kind'], $claim['resource']]);
                foreach ($this->sql('SELECT k FROM claims WHERE kind=? AND resource=?', [$claim['kind'], $claim['resource']]) as $other) {
                    if ($this->hold($other['k'])) {
                        $this->sql('INSERT OR IGNORE INTO hold_queue(k) VALUES(?)', [$other['k']]);
                        $this->issue($other['k'], 'connected_integrity_hold');
                    }
                }
            }
        }
    }

    private function hold(string $key): bool
    {
        $row = $this->sql('SELECT payload,preserved FROM plans WHERE k=?', [$key])->fetch(PDO::FETCH_ASSOC);
        if ((int) $row['preserved'] === 1) {
            throw new RuntimeException('Verified duplicate resolution conflicts with legacy assignments; explicit reconciliation required.');
        }
        $payload = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
        if ($payload['integrity_status'] === 'held') {
            return false;
        }
        $payload['integrity_status'] = 'held';
        $this->sql('UPDATE plans SET payload=? WHERE k=?', [json_encode($payload, JSON_THROW_ON_ERROR), $key]);

        return true;
    }

    private function lineage(array $dataset, string $root): void
    {
        $this->setMeta('source_verified', '0');
        $file = $this->file($dataset, $root);
        $this->setMeta('input_file', json_encode($file, JSON_THROW_ON_ERROR));
        if ($file['state'] !== 'present') {
            return;
        }
        $meta = json_decode($dataset['profiling_summary'] ?? '{}', true) ?? [];
        if (isset($meta['source_sha256_at_match']) && $meta['source_sha256_at_match'] !== $file['sha256']) {
            $this->setMeta('input_file', json_encode([...$file, 'state' => 'checksum_mismatch']));

            return;
        }
        $this->stage->exec('CREATE TABLE IF NOT EXISTS signatures(sig TEXT,k TEXT COLLATE BINARY, PRIMARY KEY(sig,k))');
        $this->stage->exec('DELETE FROM signatures');
        foreach ($this->stage->query('SELECT k,payload FROM candidates') as $row) {
            $candidate = json_decode($row['payload'], true);
            if ($candidate['candidate_rank'] !== 1 || strlen($candidate['input_snapshot'] ?? '') > 262144) {
                continue;
            }
            $snapshot = json_decode($candidate['input_snapshot'] ?? 'null', true);
            if (! is_array($snapshot)) {
                continue;
            }
            $snapshot = array_filter($snapshot, fn ($name) => ! str_starts_with((string) $name, '[Generated]') && ! str_starts_with((string) $name, '_'), ARRAY_FILTER_USE_KEY);
            $this->sql('INSERT OR IGNORE INTO signatures(sig,k) VALUES(?,?)', [$this->signature($snapshot), $row['k']]);
        }
        $n = 0;
        $confidence = isset($meta['source_sha256_at_match']) && ($meta['lineage_parser'] ?? null) === 'rematch-stream-v1' ? 'verified' : 'partial';
        try {
            foreach ($this->rows($dataset, $file['path']) as $raw) {
                $n++;
                $signature = $this->signature($raw);
                $keys = $this->sql('SELECT k FROM signatures WHERE sig=? LIMIT 2', [$signature])->fetchAll(PDO::FETCH_COLUMN);
                $this->sql('INSERT INTO source_rows(ordinal,sig,k,confidence) VALUES(?,?,?,?)', [$n, $signature, count($keys) === 1 ? $keys[0] : null, count($keys) === 1 ? $confidence : 'unverified']);
            }
            $this->setMeta('observed_source_rows', (string) $n);
            if ($confidence === 'verified' && $n === (int) $dataset['row_count']) {
                $this->setMeta('source_verified', '1');
            }
            if ($n !== (int) $dataset['row_count']) {
                $this->stage->exec("UPDATE source_rows SET confidence='partial'");
            }
        } catch (\Throwable $error) {
            $this->stage->exec('DELETE FROM source_rows');
            $this->setMeta('input_file', json_encode([...$file, 'state' => 'parse_unproven', 'reason' => $error->getMessage()]));
        }
    }

    private function signature(array $row): string
    {
        $row = array_map(fn ($value) => is_string($value) ? strtolower(trim($value)) : $value, $row);
        ksort($row);

        return hash('sha256', json_encode($row, JSON_THROW_ON_ERROR));
    }

    private function file(array $dataset, string $root): array
    {
        $path = realpath(rtrim($root, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$dataset['storage_path']);
        $base = realpath($root);
        $requested = rtrim($root, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$dataset['storage_path'];
        if (! $path || ! $base || ! str_starts_with($path, $base.DIRECTORY_SEPARATOR) || ! is_file($path)) {
            return ['state' => 'missing', 'requested' => $requested];
        }
        if (filesize($path) !== (int) $dataset['file_size']) {
            return ['state' => 'size_mismatch', 'path' => $path, 'sha256' => hash_file('sha256', $path)];
        }

        return ['state' => 'present', 'path' => $path, 'sha256' => hash_file('sha256', $path)];
    }

    private function rows(array $dataset, string $path): iterable
    {
        $format = strtolower($dataset['file_format']);
        if ($format === 'xlsx') {
            $zip = new ZipArchive;
            if ($zip->open($path) !== true) {
                throw new RuntimeException('Cannot read workbook.');
            }
            $strings = $zip->statName('xl/sharedStrings.xml');
            $zip->close();
            if ($strings && $strings['size'] > 8 * 1024 * 1024) {
                throw new RuntimeException('Shared string admission limit exceeded; lineage remains unverified.');
            }
        }
        $parser = match ($format) {
            'csv','tsv' => new CsvDatasetParser,'xlsx' => new XlsxDatasetParser,default => throw new RuntimeException('Unsupported lineage format.')
        };

        return $parser->streamRows($path, ['delimiter' => $dataset['delimiter'], 'header_row' => max(1, (int) $dataset['header_row']), 'sheet_name' => $dataset['selected_sheet']]);
    }

    private function countSource(array $dataset, string $path): int
    {
        try {
            $n = 0;
            foreach ($this->rows($dataset, $path) as $_) {
                $n++;
            }

            return $n;
        } catch (\Throwable) {
            $this->setMeta('reference_file', json_encode(['state' => 'parse_unproven', 'path' => $path]));

            return 0;
        }
    }

    private function filesUnchanged(): bool
    {
        foreach (['input_file', 'reference_file'] as $name) {
            $file = json_decode($this->meta($name), true);
            if (isset($file['sha256']) && (! is_file($file['path']) || hash_file('sha256', $file['path']) !== $file['sha256'])) {
                return false;
            }
            if ($file['state'] === 'missing' && is_file($file['requested'])) {
                return false;
            }
        }

        return true;
    }

    private function validate(string $jobId): void
    {
        if ($this->db->table('matching_jobs')->where('id', $jobId)->value('status') !== 'completed') {
            throw new RuntimeException('Only a completed job can become ready.');
        }
        $this->assertPreexistingStatesUnchanged($jobId);
        if ($this->digest($jobId) !== $this->meta('digest') || ! $this->filesUnchanged()) {
            $this->db->table('matching_jobs')->where('id', $jobId)->update(['review_state_readiness' => 'blocked']);
            throw new RuntimeException('Source changed during backfill; shadow states are not ready.');
        }
        foreach ($this->stage->query('SELECT k,payload,preserved FROM plans') as $plan) {
            if ((int) $plan['preserved'] === 2) {
                continue;
            }
            $current = $this->db->table('review_states')->where('matching_job_id', $jobId)->where('input_record_key', $plan['k'])->first();
            if (! $current) {
                throw new RuntimeException('Missing backfilled input.');
            }
            $this->assertFields((array) $current, json_decode($plan['payload'], true, 512, JSON_THROW_ON_ERROR));
            if ($current->integrity_status === 'consistent' && $current->status === 'matched') {
                if ($this->db->table('review_reference_holds')->where('matching_job_id', $jobId)->where('status', 'active')
                    ->where(fn ($q) => $q->where('reference_record_key', $current->selected_reference_record_key)
                        ->when($current->selected_reference_entity_group_id, fn ($q) => $q->orWhere('reference_entity_group_id', $current->selected_reference_entity_group_id)))->exists()) {
                    throw new RuntimeException('Active assignment overlaps hold.');
                }
            }
        }
        $this->db->table('matching_jobs')->where('id', $jobId)->update(['review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
    }

    private function insertIdentical(string $table, array $record): void
    {
        $existing = $this->db->table($table)->where('id', $record['id'])->first();
        if ($existing) {
            $this->assertFields((array) $existing, $record);

            return;
        }
        if ($table === 'review_states') {
            $existing = $this->db->table($table)->where('matching_job_id', $record['matching_job_id'])->where('input_record_key', $record['input_record_key'])->first();
            if ($existing) {
                $this->assertFields((array) $existing, array_diff_key($record, ['id' => true]));

                return;
            }
        }
        $this->db->table($table)->insert($record);
    }

    private function deleteOwned(string $table, string $id, bool $delete = true): void
    {
        if ($this->sql('SELECT 1 FROM preexisting WHERE t=? AND id=?', [$table, $id])->fetchColumn()) {
            return;
        }
        $this->db->transaction(function () use ($table, $id, $delete) {
            // Recheck under the same lock as deletion: preflight alone cannot protect resolved evidence.
            $query = $this->db->table($table)->where('id', $id);
            $row = ($delete ? $query->lockForUpdate() : $query)->first();
            if ($row && ($row->evidence_fingerprint !== $this->meta('digest') || $row->resolved_at !== null || $row->resolved_by_user_id !== null || ! in_array($row->status, ['open', 'active'], true))) {
                throw new RuntimeException('Reconciliation evidence has been used; rollback refused.');
            }
            if ($delete && $row) {
                $this->db->table($table)->where('id', $id)->delete();
            }
        });
    }

    private function assertFields(array $existing, array $expected): void
    {
        foreach ($expected as $key => $value) {
            if (($existing[$key] ?? null) !== $value) {
                throw new RuntimeException('Existing shadow row differs: '.$key.'. No overwrite permitted.');
            }
        }
    }

    private function issue(string $key, string $reason): void
    {
        $this->sql('INSERT OR IGNORE INTO issues(k,reason) VALUES(?,?)', [$key, $reason]);
    }

    private function open(string $path): void
    {
        $this->stage = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $this->stage->exec('PRAGMA cache_size=-8192; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
        $this->stage->exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,k TEXT COLLATE BINARY,payload TEXT); CREATE INDEX IF NOT EXISTS candidates_key ON candidates(k);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,k TEXT COLLATE BINARY,payload TEXT); CREATE INDEX IF NOT EXISTS events_key ON events(k);
            CREATE TABLE IF NOT EXISTS members(ref TEXT COLLATE BINARY PRIMARY KEY,gid TEXT);
            CREATE TABLE IF NOT EXISTS source_rows(ordinal INTEGER PRIMARY KEY,sig TEXT,k TEXT COLLATE BINARY,confidence TEXT); CREATE INDEX IF NOT EXISTS source_key ON source_rows(k);
            CREATE TABLE IF NOT EXISTS plans(seq INTEGER PRIMARY KEY,k TEXT COLLATE BINARY UNIQUE,payload TEXT,preserved INTEGER);
            CREATE TABLE IF NOT EXISTS claims(k TEXT COLLATE BINARY,kind TEXT,resource TEXT COLLATE BINARY,PRIMARY KEY(k,kind,resource)); CREATE INDEX IF NOT EXISTS claim_resource ON claims(kind,resource);
            CREATE TABLE IF NOT EXISTS issues(k TEXT COLLATE BINARY,reason TEXT,PRIMARY KEY(k,reason));
            CREATE TABLE IF NOT EXISTS holds(kind TEXT,resource TEXT COLLATE BINARY,PRIMARY KEY(kind,resource));');
        $this->stage->exec('CREATE TABLE IF NOT EXISTS preexisting(t TEXT,id TEXT,PRIMARY KEY(t,id)); CREATE TABLE IF NOT EXISTS preexisting_state_versions(id TEXT PRIMARY KEY,version INTEGER NOT NULL,last_operation_id TEXT); CREATE TABLE IF NOT EXISTS hold_queue(k TEXT PRIMARY KEY,processed INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS hold_queue_pending ON hold_queue(processed);');
    }

    private function sql(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->stage->prepare($sql);
        foreach ($params as $i => $value) {
            $stmt->bindValue($i + 1, $value, is_int($value) ? PDO::PARAM_INT : ($value === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
        } $stmt->execute();

        return $stmt;
    }

    private function meta(string $key): ?string
    {
        $value = $this->sql('SELECT v FROM meta WHERE k=?', [$key])->fetchColumn();

        return $value === false ? null : (string) $value;
    }

    private function setMeta(string $key, string $value): void
    {
        $this->sql('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [$key, $value]);
    }

    public function report(): array
    {
        $summary = ['job' => $this->meta('job'), 'source_fingerprint' => $this->meta('digest'), 'phase' => $this->meta('phase'), 'checkpoint' => (int) $this->meta('next_seq')];
        foreach (['plans', 'issues', 'holds', 'source_rows'] as $table) {
            $summary[$table] = (int) $this->stage->query("SELECT COUNT(*) FROM $table")->fetchColumn();
        }
        $summary['held_inputs'] = (int) $this->stage->query("SELECT COUNT(*) FROM plans WHERE json_extract(payload,'$.integrity_status')='held'")->fetchColumn();
        $summary['preprocessing_duplicates'] = (int) $this->stage->query('SELECT COALESCE(SUM(n-1),0) FROM (SELECT COUNT(*) n FROM source_rows GROUP BY sig)')->fetchColumn();
        $summary['unmapped_source_rows'] = (int) $this->stage->query('SELECT COUNT(*) FROM source_rows WHERE k IS NULL')->fetchColumn();
        $summary['input_file'] = json_decode($this->meta('input_file') ?? 'null', true);
        $summary['reference_file'] = json_decode($this->meta('reference_file') ?? 'null', true);
        $summary['observed_source_rows'] = $summary['input_file']['state'] === 'present' ? $summary['source_rows'] : null;
        $summary['total_source_rows'] = $this->meta('source_verified') === '1' ? $summary['source_rows'] : null;
        $summary['unique_computation_inputs'] = (int) $this->stage->query('SELECT COUNT(DISTINCT k) FROM candidates')->fetchColumn();
        $summary['verified_business_duplicates'] = (int) $this->stage->query("SELECT COUNT(*) FROM plans WHERE preserved=1 AND json_extract(payload,'$.status')='duplicate_input'")->fetchColumn();
        $summary['safe_matched_assignments'] = (int) $this->stage->query("SELECT COUNT(*) FROM plans WHERE preserved<>2 AND json_extract(payload,'$.status')='matched' AND json_extract(payload,'$.integrity_status')='consistent'")->fetchColumn();
        $summary['verified_entity_claims'] = (int) $this->stage->query("SELECT COUNT(DISTINCT json_extract(payload,'$.selected_reference_entity_group_id')) FROM plans WHERE json_extract(payload,'$.status')='matched' AND json_extract(payload,'$.integrity_status')='consistent'")->fetchColumn();
        $unverifiedEntities = (int) $this->stage->query("SELECT COUNT(*) FROM plans WHERE json_extract(payload,'$.status')='matched' AND json_extract(payload,'$.integrity_status')='consistent' AND json_extract(payload,'$.selected_reference_entity_group_id') IS NULL")->fetchColumn();
        $summary['matched_entity_count'] = $unverifiedEntities > 0 ? null : $summary['verified_entity_claims'];
        $summary['issue_counts'] = $this->stage->query('SELECT reason,COUNT(*) AS inputs FROM issues GROUP BY reason ORDER BY reason')->fetchAll(PDO::FETCH_ASSOC);

        return $summary;
    }
}
