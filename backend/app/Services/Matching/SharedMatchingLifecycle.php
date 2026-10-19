<?php

namespace App\Services\Matching;

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\User;
use App\Models\Workspace;
use App\Services\Matching\Transactions\ReviewDeploymentFence as Fence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use App\Support\Auth\PermissionRegistry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/** Admits scoped runs and retries; confirmed reruns preserve the previous job and history. */
final class SharedMatchingLifecycle
{
    public static function enabled(): bool { return Fence::legacyBlocked() && !Fence::frozen(); }
    public static function owns(MatchingJob $job): bool { return data_get($job->configuration?->advanced_settings, 'shared_matching.version') === 1; }

    public function admit(User $actor, array $payload, \Closure $create): MatchingJob
    {
        Fence::assertWritable();
        if (Fence::productionMode()) Fence::assertConnection(DB::connection(), true, 'matching_disabled');
        if (empty($payload['workspace_id'])) throw new ReviewWriteConflict('matching_workspace_required', [], 422);
        return DB::transaction(function () use ($actor, $payload, $create) {
            $user = User::whereKey($actor->id)->sharedLock()->first();
            $snapshot = Workspace::findOrFail($payload['workspace_id']);
            if ($snapshot->matching_job_id) MatchingJob::whereKey($snapshot->matching_job_id)->lockForUpdate()->firstOrFail();
            $workspace = Workspace::whereKey($payload['workspace_id'])->lockForUpdate()->firstOrFail();
            if ($workspace->matching_job_id !== $snapshot->matching_job_id) throw new ReviewWriteConflict('stale_workspace_version');
            $this->authorize($user, $workspace);
            if ((int) ($payload['expected_workspace_version'] ?? 0) !== (int) $workspace->configuration_version) {
                throw new ReviewWriteConflict('stale_workspace_version', ['current_version' => (int) $workspace->configuration_version]);
            }
            foreach (['input_dataset_id', 'reference_dataset_id'] as $field) {
                if ($workspace->$field !== $payload[$field]) throw new ReviewWriteConflict('matching_dataset_changed');
            }
            $hash = hash('sha256', json_encode($this->canonical([$payload['input_dataset_id'], $payload['reference_dataset_id'], $payload['mappings'],
                app(MatchingConfigResolver::class)->resolve($payload['configuration'])]), JSON_THROW_ON_ERROR));
            $rerun = false;
            if ($workspace->matching_job_id !== null || MatchingJob::where('workspace_id', $workspace->id)->exists()) {
                if ($workspace->matching_job_id === null) throw new ReviewWriteConflict('historical_matching_protected');
                $job = MatchingJob::findOrFail($workspace->matching_job_id);
                $confirmed = (bool) ($payload['force_restart'] ?? data_get($payload, 'configuration.runOptions.forceRestart', false));
                if ($confirmed && $job->status === 'completed' && $job->review_state_readiness === 'ready') {
                    // Explicit rerun creates a fresh job; never clears the previous results/history.
                    if (DB::getDriverName() === 'mysql') {
                        $lock = 'rematch-run:'.$job->id;
                        if ((int) DB::selectOne('SELECT GET_LOCK(?,0) AS acquired', [$lock])->acquired !== 1) throw new ReviewWriteConflict('matching_job_busy');
                        DB::selectOne('SELECT RELEASE_LOCK(?) AS released', [$lock]);
                    }
                    $rerun = true;
                } else {
                    if (!self::owns($job)) throw new ReviewWriteConflict('historical_matching_protected');
                    if (data_get($job->configuration->advanced_settings, 'shared_matching.request_hash') !== $hash) throw new ReviewWriteConflict('matching_configuration_locked');
                    if (in_array($job->status, ['failed', 'cancelled', 'stopped'], true)) {
                        if (DB::table('review_decisions')->where('matching_job_id', $job->id)->exists()
                            || DB::table('review_operations')->where('matching_job_id', $job->id)->exists()) throw new ReviewWriteConflict('historical_matching_protected');
                        $settings = $job->configuration->advanced_settings;
                        $settings['shared_matching']['actor_user_id'] = (int) $user->id;
                        $job->configuration->update(['advanced_settings' => $settings]);
                        $job->update(['status' => 'queued', 'error_message' => null, 'finished_at' => null]);
                        $workspace->configuration_version = (int) $workspace->configuration_version + 1;
                        $workspace->status = 'processing';
                        $workspace->save();
                    }
                    return $job;
                }
            }
            if (!$rerun && !in_array($workspace->status, ['draft', 'configuring'], true)) throw new ReviewWriteConflict('draft_workspace_only');
            $proof = [];
            foreach (['input', 'reference'] as $side) {
                $dataset = Dataset::findOrFail($payload[$side.'_dataset_id']);
                if ($dataset->dataset_role !== $side || ($user->role !== 'admin' && (int) $dataset->user_id !== (int) $user->id)) throw new ReviewWriteConflict('workspace_resource_forbidden', [], 403);
                $proof[$side] = $this->fingerprint($dataset);
            }
            // A first run never clears another job's checkpoint, even if the UI sends forceRestart.
            $payload['force_restart'] = false;
            $payload['configuration']['runOptions']['forceRestart'] = false;
            $job = $create($payload);
            $config = $job->configuration;
            $settings = $config->advanced_settings;
            $settings['shared_matching'] = ['version' => 1, 'actor_user_id' => (int) $user->id, 'request_hash' => $hash, 'sources' => $proof];
            $config->update(['advanced_settings' => $settings]);
            $workspace->refresh();
            $workspace->configuration_version = (int) $workspace->configuration_version + 1;
            $workflow = $workspace->workflow_state ?? [];
            $workflow['runResult'] = null; $workflow['runState'] = 'running'; $workflow['progress'] = 0;
            $workflow['matchingConfiguration'] = $payload['configuration'];
            $workflow['inputScope'] = app(MatchingConfigResolver::class)->resolve($payload['configuration'])['inputScope'];
            $workspace->workflow_state = $workflow;
            $workspace->save();
            return $job->refresh()->load('configuration');
        });
    }

    private function canonical(mixed $value): mixed
    {
        if (!is_array($value)) return $value;
        if (!array_is_list($value)) ksort($value, SORT_STRING);
        return array_map(fn ($item) => $this->canonical($item), $value);
    }

    private function authorize(?User $user, Workspace $workspace): void
    {
        if (!$user || !$user->hasPermission(PermissionRegistry::MATCHING_RUN)
            || ($user->role !== 'admin' && (int) $workspace->user_id !== (int) $user->id)) throw new ReviewWriteConflict('workspace_forbidden', [], 403);
    }

    public function assertJob(MatchingJob $job): void
    {
        Fence::assertWritable();
        if (!self::owns($job) || !$job->workspace || $job->workspace->matching_job_id !== $job->id) throw new ReviewWriteConflict('historical_matching_protected');
        $this->authorize(User::find(data_get($job->configuration->advanced_settings, 'shared_matching.actor_user_id')), $job->workspace);
        if (!in_array($job->status, ['processing', 'queued'], true)) throw new ReviewWriteConflict('matching_job_not_running');
        if ($job->review_state_readiness === 'ready') throw new ReviewWriteConflict('historical_matching_protected');
    }

    public function verifySources(MatchingJob $job): void
    {
        foreach (['input', 'reference'] as $side) {
            $actual = $this->fingerprint($job->{$side.'Dataset'});
            $expected = data_get($job->configuration->advanced_settings, 'shared_matching.sources.'.$side, []);
            if (($expected['sha256'] ?? null) !== $actual['sha256'] || ($expected['bytes'] ?? null) !== $actual['bytes']) {
                throw new ReviewWriteConflict('matching_source_changed');
            }
        }
    }

    private function fingerprint(Dataset $dataset): array
    {
        $relative = $dataset->storage_path;
        foreach ([Storage::disk('local')->path($relative), storage_path('app/'.$relative), storage_path('app/private/'.$relative)] as $path) {
            if (is_file($path) && is_readable($path) && filesize($path) === (int) $dataset->file_size) {
                return ['sha256' => hash_file('sha256', $path), 'bytes' => (int) filesize($path)];
            }
        }
        throw new ReviewWriteConflict('matching_source_missing', [], 422);
    }

    public function stop(User $actor, string $id, int $expected): MatchingJob
    {
        Fence::assertWritable();
        return DB::transaction(function () use ($actor, $id, $expected) {
            $user = User::whereKey($actor->id)->sharedLock()->first();
            $job = MatchingJob::whereKey($id)->lockForUpdate()->firstOrFail();
            if (!self::owns($job) || $job->review_state_readiness === 'ready') throw new ReviewWriteConflict('historical_matching_protected');
            $workspace = $job->workspace()->lockForUpdate()->firstOrFail();
            $this->authorize($user, $workspace);
            if ($workspace->matching_job_id !== $id || (int) $workspace->configuration_version !== $expected) throw new ReviewWriteConflict('stale_workspace_version');
            if (in_array($job->status, ['processing', 'queued'], true)) {
                $job->update(['status' => 'cancelled', 'error_message' => 'Matching stopped by user.', 'finished_at' => now()]);
                $workspace->status = 'configuring';
                $workspace->configuration_version = (int) $workspace->configuration_version + 1;
                $workspace->save();
            }
            return $job;
        });
    }

    public function withRunner(MatchingJob $job, \Closure $work): mixed
    {
        if (DB::getDriverName() !== 'mysql') return $work();
        $key = 'rematch-run:'.$job->id;
        if ((int) DB::selectOne('SELECT GET_LOCK(?,0) AS acquired', [$key])->acquired !== 1) throw new ReviewWriteConflict('matching_job_busy');
        try { return $work(); } finally { DB::selectOne('SELECT RELEASE_LOCK(?) AS released', [$key]); }
    }
}
