<?php

namespace App\Services\Workspace;

use App\Services\Matching\Transactions\ReviewDeploymentFence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Database\ConnectionInterface;

/** Metadata-only management. Matching datasets, results and review history are retained. */
final class WorkspaceManagementService
{
    public function __construct(private readonly ConnectionInterface $db, private readonly WorkspaceAccessService $access)
    {
        $access->assertConnection($db);
    }

    public function rename(int $actor, string $workspace, int $expected, string $name): array
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 255) throw new ReviewWriteConflict('invalid_workspace_name', [], 422);
        return $this->manage($actor, $workspace, $expected, $name);
    }

    public function delete(int $actor, string $workspace, int $expected): array
    {
        return $this->manage($actor, $workspace, $expected, null);
    }

    private function manage(int $actor, string $workspace, int $expected, ?string $name): array
    {
        $this->access->guard();
        ReviewDeploymentFence::assertWritable();
        if ($expected < 1) throw new ReviewWriteConflict('invalid_workspace_version', [], 422);
        if ($this->db->transactionLevel() !== 0) throw new ReviewWriteConflict('nested_review_transaction_not_supported', [], 503);
        return $this->db->transaction(function () use ($actor, $workspace, $expected, $name) {
            // Same actor -> job -> workspace lock order used by review transactions.
            $this->db->table('users')->where('id', $actor)->sharedLock()->first(['id']);
            $scope = $this->access->workspace($actor, $workspace);
            if (! in_array($scope['role'], ['owner', 'admin'], true)) throw new ReviewWriteConflict('workspace_forbidden', [], 403);
            $jobs = $this->db->table('matching_jobs')->where(fn ($q) => $q->where('workspace_id', $workspace)
                ->orWhere('id', $scope['workspace']->matching_job_id))->orderBy('id')->lockForUpdate()->get(['id', 'status']);
            $row = $this->db->table('workspaces')->where('id', $workspace)->lockForUpdate()->first();
            $scope = $this->access->workspace($actor, $workspace, 'read', true);
            if (! in_array($scope['role'], ['owner', 'admin'], true)) throw new ReviewWriteConflict('workspace_forbidden', [], 403);
            if ((int) $row->configuration_version !== $expected) throw new ReviewWriteConflict('stale_workspace_version', ['current_version' => (int) $row->configuration_version]);
            if ($jobs->contains(fn ($j) => in_array($j->status, ['queued', 'processing'], true))) throw new ReviewWriteConflict('workspace_busy');
            if ($name !== null) {
                $this->db->table('workspaces')->where('id', $workspace)->update(['name' => $name, 'configuration_version' => $expected + 1, 'updated_at' => now()]);
                return ['id' => $workspace, 'name' => $name, 'configuration_version' => $expected + 1];
            }
            // FK SET NULL detaches jobs/datasets; no matching or historical review rows are deleted.
            $this->db->table('workspaces')->where('id', $workspace)->delete();
            return ['id' => $workspace];
        });
    }
}
