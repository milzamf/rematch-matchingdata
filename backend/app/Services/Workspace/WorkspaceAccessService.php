<?php

namespace App\Services\Workspace;

use App\Services\Matching\Transactions\ReviewWriteConflict;
use App\Services\Matching\Transactions\ReviewDeploymentFence;
use App\Support\Auth\PermissionRegistry;
use Illuminate\Database\ConnectionInterface;

/** Isolated access policy. Never extends ownership of unrelated datasets. */
final class WorkspaceAccessService
{
    public function __construct(private readonly ConnectionInterface $db, private readonly bool $enabled = false) {}

    public function guard(): void
    {
        ReviewDeploymentFence::assertConnection($this->db, $this->enabled, 'workspace_access_disabled');
    }

    public function assertConnection(ConnectionInterface $connection): void
    {
        if ($this->db !== $connection) {
            throw new ReviewWriteConflict('access_connection_mismatch', [], 503);
        }
    }

    public function workspace(int $actor, string $id, string $permission = 'read', bool $locked = false): array
    {
        $this->guard();
        $query = $this->db->table('users')->where('id', $actor);
        $user = ($locked ? $query->sharedLock() : $query)->first(['id', 'role']);
        $query = $this->db->table('workspaces')->where('id', $id);
        $workspace = ($locked ? $query->sharedLock() : $query)->first(['id', 'user_id', 'matching_job_id', 'reference_dataset_id', 'input_dataset_id', 'configuration_version']);
        if (! $user || ! $workspace || $workspace->id !== $id) {
            throw new ReviewWriteConflict('workspace_forbidden', [], 403);
        }
        $query = $this->db->table('workspace_members')->where('workspace_id', $id)->where('user_id', $actor);
        $member = ($locked ? $query->sharedLock() : $query)->first();
        // Application role limits workspace roles, including ownership/membership.
        $role = match (true) {
            $user->role === 'admin' => 'admin',
            $user->role === 'pimpinan' => 'pimpinan',
            $user->role !== 'user' => 'none',
            (int) $workspace->user_id === $actor => 'owner',
            $member?->status === 'active' => $member->role,
            default => 'none',
        };
        $permissions = [
            'read' => in_array($role, ['admin', 'owner', 'editor', 'viewer', 'pimpinan'], true),
            'review' => in_array($role, ['admin', 'owner', 'editor'], true) && in_array(PermissionRegistry::REVIEW_DECIDE, PermissionRegistry::forRole($user->role), true),
            'propose' => in_array($role, ['admin', 'owner', 'editor'], true) && in_array(PermissionRegistry::REVIEW_DECIDE, PermissionRegistry::forRole($user->role), true),
            'approve' => in_array($role, ['admin', 'owner'], true),
            'members' => in_array($role, ['admin', 'owner'], true),
            'configure' => in_array($role, ['admin', 'owner'], true),
            'run' => in_array($role, ['admin', 'owner'], true),
            'dataset_write' => in_array($role, ['admin', 'owner'], true),
            'export_read' => in_array($role, ['admin', 'owner', 'editor', 'viewer', 'pimpinan'], true),
        ];
        if (! ($permissions[$permission] ?? false)) {
            throw new ReviewWriteConflict('workspace_forbidden', [], 403);
        }

        return ['workspace' => $workspace, 'role' => $role, 'permissions' => $permissions, 'membership_version' => $member ? (int) $member->version : null];
    }

    public function job(int $actor, string $id, string $permission = 'read', bool $locked = false): array
    {
        $this->guard();
        // Order is actor -> job -> workspace -> membership throughout review paths.
        $query = $this->db->table('users')->where('id', $actor);
        if (! ($locked ? $query->sharedLock() : $query)->first(['id'])) {
            throw new ReviewWriteConflict('workspace_forbidden', [], 403);
        }
        $query = $this->db->table('matching_jobs')->where('id', $id);
        $job = ($locked ? $query->sharedLock() : $query)->first(['id', 'workspace_id', 'input_dataset_id', 'reference_dataset_id', 'status', 'review_state_readiness', 'review_state_schema_version']);
        if (! $job || $job->id !== $id) {
            throw new ReviewWriteConflict('workspace_forbidden', [], 403);
        }
        if ($job->workspace_id !== null) {
            $scope = $job->workspace_id;
        } else {
            $links = $this->db->table('workspaces')->where('matching_job_id', $id)->orderBy('id')->limit(2)->pluck('id');
            if ($links->count() !== 1) {
                throw new ReviewWriteConflict('ambiguous_job_workspace');
            }
            $scope = $links[0];
        }
        $access = $this->workspace($actor, $scope, $permission, $locked);

        return $access + ['job' => $job];
    }

    /** Require the explicit workspace context even for administrators. */
    public function resource(int $actor, string $workspace, string $kind, string $id): object
    {
        $access = $this->workspace($actor, $workspace);
        $table = match ($kind) {
            'dataset' => 'datasets', 'job' => 'matching_jobs', 'result' => 'matching_results', 'history' => 'review_decisions',
            default => throw new ReviewWriteConflict('invalid_resource_kind', [], 422),
        };
        $columns = match ($kind) {
            'dataset' => ['id', 'workspace_id', 'name', 'row_count', 'column_count'],
            'job' => ['id', 'workspace_id', 'status', 'processed_count', 'total_count'],
            'result' => ['id', 'matching_job_id', 'input_record_key', 'reference_record_key', 'candidate_rank', 'overall_score'],
            'history' => ['id', 'matching_job_id', 'matching_result_id', 'input_record_key', 'decision', 'reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id', 'state_version_after', 'created_at'],
        };
        $row = $this->db->table($table)->where('id', $id)->first($columns);
        if (! $row || $row->id !== $id) {
            throw new ReviewWriteConflict('workspace_resource_forbidden', [], 403);
        }
        if ($kind === 'dataset') {
            $w = $access['workspace'];
            $linked = in_array($id, [$w->input_dataset_id, $w->reference_dataset_id], true)
                || $this->db->table('matching_jobs')->where(fn ($q) => $q->where('workspace_id', $workspace)->orWhere(fn ($legacy) => $legacy->whereNull('workspace_id')->where('id', $w->matching_job_id ?? '')))
                    ->where(fn ($q) => $q->where('input_dataset_id', $id)->orWhere('reference_dataset_id', $id))->exists();
            $valid = $row->workspace_id === $workspace || $linked;
        } else {
            $jobId = $kind === 'job' ? $id : $row->matching_job_id;
            $job = $kind === 'job' ? $row : $this->db->table('matching_jobs')->where('id', $jobId)->first(['id', 'workspace_id']);
            $valid = $job && ($job->workspace_id === $workspace || ($job->workspace_id === null && $access['workspace']->matching_job_id === $job->id));
        }
        if (! $valid) {
            throw new ReviewWriteConflict('workspace_resource_forbidden', [], 403);
        }

        return $row;
    }

    public function workspaces(int $actor, int $page = 1): array
    {
        $this->guard();
        $user = $this->db->table('users')->where('id', $actor)->first(['id', 'role']);
        if (! $user || ! in_array($user->role, ['user', 'admin', 'pimpinan'], true)) {
            throw new ReviewWriteConflict('workspace_forbidden', [], 403);
        }
        $query = $this->db->table('workspaces as w');
        $query->leftJoin('users as owner', 'owner.id', '=', 'w.user_id')
            ->leftJoin('workspace_members as member', fn ($join) => $join->on('member.workspace_id', '=', 'w.id')->where('member.user_id', $actor)->where('member.status', 'active'));
        if ($user->role === 'user') {
            $query->where(fn ($q) => $q->where('w.user_id', $actor)->orWhereExists(fn ($m) => $m->selectRaw('1')->from('workspace_members')->whereColumn('workspace_id', 'w.id')->where('user_id', $actor)->where('status', 'active')));
        }
        $query->select(['w.id', 'w.name', 'w.user_id', 'w.status', 'w.matching_job_id', 'w.configuration_version', 'owner.name as owner_name'])
            ->selectRaw("CASE WHEN ? IN ('admin','pimpinan') THEN ? WHEN w.user_id = ? THEN 'owner' ELSE member.role END AS access_role", [$user->role, $user->role, $actor]);
        $result = $query->orderBy('w.id')->paginate(50, ['w.id', 'w.name', 'w.user_id', 'w.status', 'w.matching_job_id', 'w.configuration_version', 'owner.name as owner_name'], 'page', max(1, $page));

        return ['data' => array_map(fn ($r) => (array) $r, $result->items()), 'total' => $result->total(), 'current_page' => $result->currentPage(), 'last_page' => $result->lastPage(), 'per_page' => $result->perPage()];
    }
}
