<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Services\Matching\Reconciliation\ReviewStateBackfill;
use Illuminate\Support\Facades\DB;
use PDO;
use RuntimeException;

/** Publishes machine output for a newly admitted job, never reconstructs or rewrites history. */
final class NewMatchingReviewInitializer
{
    public function initialize(MatchingJob $job, MatchingRowStore $input): void
    {
        $lifecycle = app(SharedMatchingLifecycle::class);
        $lifecycle->assertJob($job);
        $lifecycle->verifySources($job);
        $this->assertUnused($job);
        $path = tempnam(sys_get_temp_dir(), 'rematch-init-');
        $plan = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        try {
            $plan->exec('PRAGMA cache_size=-4096; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; CREATE TABLE members(ref TEXT PRIMARY KEY COLLATE BINARY,gid TEXT); CREATE TABLE plan(k TEXT PRIMARY KEY COLLATE BINARY,candidate TEXT,ref TEXT,gid TEXT,status TEXT,n INTEGER); CREATE TABLE conflicts(k TEXT PRIMARY KEY COLLATE BINARY)');
            $plan->beginTransaction();
            $memberHash = $this->members($job, $plan);
            $insert = $plan->prepare('INSERT INTO plan VALUES(?,?,?,?,?,?)');
            $group = $plan->prepare('SELECT gid FROM members WHERE ref=?');
            foreach ($job->results()->select(['id', 'input_record_key', 'reference_record_key', 'result_type'])->where('candidate_rank', 1)->orderBy('id')->lazyById(500) as $result) {
                $key = (string) $result->input_record_key;
                $ref = $result->result_type === 'matched' ? $result->reference_record_key : null;
                if (!in_array($result->result_type, ['matched', 'possible_match', 'unmatched'], true)
                    || ($result->result_type === 'matched' && ($ref === null || !ctype_digit($ref) || (int) $ref < 1 || (int) $ref > $job->referenceDataset->row_count))) {
                    throw new RuntimeException('Invalid initial matching classification or reference key.');
                }
                $n = $input->occurrenceCount($key);
                if ($n < 1) throw new RuntimeException('Input lineage is missing from the matching row store.');
                $group->execute([$ref]);
                $gid = $group->fetchColumn();
                $insert->execute([$key, $ref === null ? null : $result->id, $ref, $gid === false ? null : $gid, $result->result_type, $n]);
            }
            $plan->commit();
            if ((int) $plan->query('SELECT COUNT(*) FROM plan')->fetchColumn() !== (int) $job->total_count
                || (int) $plan->query('SELECT COALESCE(SUM(n),0) FROM plan')->fetchColumn() !== (int) data_get($job->record_counts, 'total_raw_input')) {
                throw new RuntimeException('Initial review accounting does not match matching output.');
            }
            $plan->exec('CREATE INDEX plan_ref ON plan(ref); CREATE INDEX plan_gid ON plan(gid);
                INSERT OR IGNORE INTO conflicts SELECT k FROM plan WHERE ref IN (SELECT ref FROM plan WHERE ref IS NOT NULL GROUP BY ref HAVING COUNT(*)>1);
                INSERT OR IGNORE INTO conflicts SELECT k FROM plan WHERE gid IN (SELECT gid FROM plan WHERE gid IS NOT NULL GROUP BY gid HAVING COUNT(*)>1)');
            $fingerprint = hash('sha256', json_encode(data_get($job->configuration->advanced_settings, 'shared_matching.sources'), JSON_THROW_ON_ERROR).$memberHash);
            $job->forceFill(['review_state_readiness' => 'reconciling'])->save();
            foreach (['ref' => 'reference_record_key', 'gid' => 'reference_entity_group_id'] as $column => $field) {
                foreach ($plan->query("SELECT DISTINCT p.$column AS resource FROM plan p JOIN conflicts c ON c.k=p.k WHERE p.$column IS NOT NULL") as $hold) {
                    $this->insert('review_reference_holds', [
                        'id' => ReviewStateBackfill::stableId("new-hold:$job->id:$field:{$hold['resource']}"),
                        'matching_job_id' => $job->id, 'reference_dataset_id' => $job->reference_dataset_id,
                        $field => $hold['resource'], 'status' => 'active', 'evidence_fingerprint' => $fingerprint,
                    ]);
                }
            }
            $batch = [];
            foreach ($plan->query('SELECT p.*, c.k IS NOT NULL AS held FROM plan p LEFT JOIN conflicts c ON c.k=p.k ORDER BY p.k COLLATE BINARY') as $row) {
                $batch[] = $row;
                if (count($batch) === 250) { $this->states($job, $batch, $fingerprint); $batch = []; }
            }
            if ($batch) $this->states($job, $batch, $fingerprint);
            $lifecycle->verifySources($job);
            if ($this->members($job) !== $memberHash) throw new RuntimeException('Verified reference entities changed during initialization.');
            $lifecycle->assertJob($job->refresh());
            DB::transaction(function () use ($job, $fingerprint) {
                $locked = MatchingJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
                // Stop can commit between the preceding check and this transaction.
                app(SharedMatchingLifecycle::class)->assertJob($locked);
                $this->assertUnused($locked);
                if (DB::table('review_states')->where('matching_job_id', $job->id)->count() !== (int) $locked->total_count) throw new RuntimeException('Missing initialized review states.');
                $counts = $locked->record_counts;
                $counts['review_initialization_fingerprint'] = $fingerprint;
                $counts['current_stage'] = 'Matching selesai; review siap';
                $locked->forceFill(['status' => 'completed', 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1, 'record_counts' => $counts, 'error_message' => null, 'finished_at' => now()])->save();
                $workspace = $locked->workspace()->lockForUpdate()->firstOrFail();
                $workflow = $workspace->workflow_state ?? [];
                $workflow['runState'] = 'success'; $workflow['progress'] = 100;
                $workspace->update(['status' => 'reviewing', 'current_step' => 3, 'workflow_state' => $workflow]);
            });
        } finally { $plan = null; if (is_file($path)) unlink($path); }
    }

    private function members(MatchingJob $job, ?PDO $plan = null): string
    {
        $hash = hash_init('sha256');
        $insert = $plan?->prepare('INSERT INTO members VALUES(?,?)');
        $query = DB::table('reference_entity_members as m')->join('reference_entity_groups as g', 'g.id', '=', 'm.reference_entity_group_id')
            ->where('m.reference_dataset_id', $job->reference_dataset_id)->select('m.*', 'g.version as group_version', 'g.verified_by_user_id as group_verifier', 'g.verified_at as group_verified_at', 'g.verification_note as group_note');
        foreach ($query->lazyById(500, 'm.id', 'id') as $member) {
            hash_update($hash, json_encode($member, JSON_THROW_ON_ERROR));
            $insert?->execute([$member->reference_record_key, $member->reference_entity_group_id]);
        }
        return hash_final($hash);
    }

    private function states(MatchingJob $job, array $rows, string $fingerprint): void
    {
        app(SharedMatchingLifecycle::class)->assertJob($job->refresh());
        DB::transaction(function () use ($job, $rows, $fingerprint) {
            $states = []; $issues = [];
            foreach ($rows as $row) {
                $states[] = [
                    'id' => ReviewStateBackfill::stableId("new-state:$job->id:{$row['k']}"),
                    'matching_job_id' => $job->id, 'reference_dataset_id' => $job->reference_dataset_id, 'input_record_key' => (string) $row['k'],
                    'status' => $row['held'] ? 'reference_conflict' : $row['status'], 'decision' => null,
                    'selected_reference_record_key' => $row['ref'], 'selected_matching_result_id' => $row['candidate'], 'selected_reference_entity_group_id' => $row['gid'],
                    'version' => 1, 'decision_origin' => 'auto', 'decision_protection' => 'open',
                    'integrity_status' => $row['held'] ? 'held' : 'consistent', 'lineage_status' => 'verified', 'source_occurrence_count' => (int) $row['n'],
                ];
                if ($row['held']) $issues[] = [
                    'id' => ReviewStateBackfill::stableId("new-conflict:$job->id:{$row['k']}"), 'matching_job_id' => $job->id,
                    'input_record_key' => (string) $row['k'], 'reason_code' => 'initial_reference_collision', 'status' => 'open', 'evidence_fingerprint' => $fingerprint,
                ];
            }
            $this->inserts('review_states', $states);
            $this->inserts('review_reconciliation_issues', $issues);
        });
    }

    private function assertUnused(MatchingJob $job): void
    {
        if (DB::table('review_operations')->where('matching_job_id', $job->id)->exists() || DB::table('review_decisions')->where('matching_job_id', $job->id)->exists()
            || DB::table('review_states')->where('matching_job_id', $job->id)->where('version', '<>', 1)->exists()) throw new RuntimeException('A reviewed job cannot be initialized again.');
    }

    private function insert(string $table, array $record): void { $this->inserts($table, [$record]); }

    private function inserts(string $table, array $records): void
    {
        if (!$records) return;
        $existing = DB::table($table)->whereIn('id', array_column($records, 'id'))->get()->keyBy('id');
        $new = []; $now = now();
        foreach ($records as $record) {
            $row = $existing->get($record['id']);
            if ($row) {
                foreach ($record as $key => $value) {
                    $actual = $row->$key ?? null;
                    if (is_int($value) && $actual !== null) $actual = (int) $actual;
                    if ($actual !== $value) throw new RuntimeException('Initialization replay differs; no overwrite allowed.');
                }
            } else $new[] = $record + ['created_at' => $now, 'updated_at' => $now];
        }
        if ($new) DB::table($table)->insert($new);
    }
}
