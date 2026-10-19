<?php

namespace App\Services\Workspace;

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\User;
use App\Models\Workspace;
use App\Services\Matching\Transactions\ReviewDeploymentFence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use App\Support\Auth\PermissionRegistry;
use Illuminate\Support\Facades\DB;

/** Only preparation/configuration of an owner/admin draft with no matching job. */
final class DraftWorkspaceService
{
    public function save(User $actor, array $data, ?string $id = null): Workspace
    {
        ReviewDeploymentFence::assertWritable();
        foreach (['name', 'status', 'current_step'] as $field) {
            if (array_key_exists($field, $data) && $data[$field] === null) unset($data[$field]);
        }
        return DB::transaction(function () use ($actor, $data, $id) {
            // Serialize role changes with writes, then lock the job-free draft.
            $user = User::whereKey($actor->getKey())->sharedLock()->first();
            $permission = $id === null ? PermissionRegistry::WORKSPACE_CREATE : PermissionRegistry::WORKSPACE_UPDATE;
            if (!$user || !$user->hasPermission($permission)) throw new ReviewWriteConflict('workspace_forbidden', [], 403);
            $workspace = $id === null ? new Workspace(['user_id' => $user->getKey()])
                : Workspace::whereKey($id)->lockForUpdate()->firstOrFail();
            if ($id !== null) {
                if ((int) $workspace->user_id !== (int) $user->getKey() && $user->role !== 'admin') {
                    throw new ReviewWriteConflict('workspace_forbidden', [], 403);
                }
                if ($workspace->matching_job_id !== null || !in_array($workspace->status, ['draft', 'configuring'], true)
                    || MatchingJob::where('workspace_id', $id)->exists()) {
                    throw new ReviewWriteConflict('draft_workspace_only');
                }
                $expected = $data['expected_version'] ?? null;
                if (!is_int($expected) && !(is_string($expected) && ctype_digit($expected))) {
                    throw new ReviewWriteConflict('invalid_workspace_version');
                }
                if ((int) $expected !== (int) $workspace->configuration_version) {
                    throw new ReviewWriteConflict('stale_workspace_version', ['current_version' => (int) $workspace->configuration_version]);
                }
            }
            if (!in_array($data['status'] ?? $workspace->status ?? 'draft', ['draft', 'configuring'], true)
                || !in_array((int) ($data['current_step'] ?? $workspace->current_step ?? 1), [1, 2], true)
                || !empty($data['matching_job_id']) || !empty($data['sync_state']) || !empty($data['export_history'])
                || !empty($data['workflow_state']['runResult']) || !empty($data['workflow_state']['syncState'])
                || !in_array($data['workflow_state']['runState'] ?? 'idle', ['idle', 'failed'], true)) {
                throw new ReviewWriteConflict('draft_payload_not_allowed', [], 422);
            }
            // Do not let an owner attach another user's dataset through a guessed ID.
            foreach (['input_dataset_id' => 'input', 'reference_dataset_id' => 'reference'] as $field => $role) {
                if (empty($data[$field])) continue;
                $dataset = Dataset::whereKey($data[$field])->sharedLock()->first();
                if (!$dataset || ($user->role !== 'admin' && (int) $dataset->user_id !== (int) $user->getKey())
                    || $dataset->dataset_role !== $role) {
                    throw new ReviewWriteConflict('workspace_resource_forbidden', [], 403);
                }
            }
            unset($data['expected_version']);
            if ($id === null) $data = array_merge(['name' => 'Untitled Workspace', 'status' => 'draft', 'current_step' => 1], $data);
            $workspace->fill($data);
            $workspace->configuration_version = $id === null ? 1 : (int) $workspace->configuration_version + 1;
            $workspace->save();
            return $workspace;
        });
    }
}
