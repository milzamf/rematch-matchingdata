<?php

namespace App\Services\Workspace;

use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

final class WorkspaceMembershipService
{
    public function __construct(private readonly ConnectionInterface $db, private readonly WorkspaceAccessService $access)
    {
        $access->assertConnection($db);
    }

    public function members(int $actor, string $workspace, int $page = 1): array
    {
        $this->access->workspace($actor, $workspace, 'members');
        $result = $this->db->table('workspace_members as m')->join('users as u', 'u.id', '=', 'm.user_id')->where('m.workspace_id', $workspace)->orderBy('m.user_id')
            ->paginate(50, ['m.id', 'm.user_id', 'u.name', 'u.email', 'm.role', 'm.status', 'm.version', 'm.granted_by_user_id', 'm.revoked_by_user_id', 'm.revoked_at'], 'page', max(1, $page));

        return ['data' => array_map(fn ($r) => (array) $r, $result->items()), 'total' => $result->total(), 'current_page' => $result->currentPage(), 'last_page' => $result->lastPage(), 'per_page' => $result->perPage()];
    }

    public function search(int $actor, string $workspace, string $term): array
    {
        $access = $this->access->workspace($actor, $workspace, 'members');
        if (mb_strlen(trim($term)) < 2 || mb_strlen($term) > 100) {
            throw new ReviewWriteConflict('invalid_user_search', [], 422);
        }
        $pattern = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $term).'%';

        return $this->db->table('users')->where('role', 'user')->where('id', '<>', $access['workspace']->user_id)
            ->where(fn ($q) => $q->whereRaw("name LIKE ? ESCAPE '!'", [$pattern])->orWhereRaw("email LIKE ? ESCAPE '!'", [$pattern]))->orderBy('id')->limit(25)->get(['id', 'name', 'email'])->map(fn ($r) => (array) $r)->all();
    }

    /** expected=0 creates; existing active/revoked rows require their current version. Never delete a revoked row. */
    public function set(int $actor, string $workspace, int $target, ?string $role, int $expected): array
    {
        $this->access->guard();
        if ($target < 1 || $expected < 0 || ($role !== null && ! in_array($role, ['editor', 'viewer'], true))) {
            throw new ReviewWriteConflict('invalid_membership', [], 422);
        }
        if ($this->db->transactionLevel() !== 0) {
            throw new ReviewWriteConflict('nested_review_transaction_not_supported', [], 503);
        }
        $lock = 'rm:'.substr(hash('sha256', "membership:$workspace:$target"), 0, 60);
        if ((int) $this->db->selectOne('SELECT GET_LOCK(?,2) AS acquired', [$lock])->acquired !== 1) {
            throw new ReviewWriteConflict('membership_busy');
        }
        $timeout = (int) $this->db->selectOne('SELECT @@SESSION.innodb_lock_wait_timeout AS seconds')->seconds;
        try {
            $this->db->statement('SET SESSION innodb_lock_wait_timeout=2');

            return $this->db->transaction(function () use ($actor, $workspace, $target, $role, $expected) {
                $users = [$actor, $target];
                sort($users);
                $this->db->table('users')->whereIn('id', $users)->orderBy('id')->sharedLock()->get(['id']);
                $access = $this->access->workspace($actor, $workspace, 'members', true);
                $user = $this->db->table('users')->where('id', $target)->first(['id', 'role']);
                if (! $user || ($role !== null && $user->role !== 'user') || (int) $access['workspace']->user_id === $target) {
                    throw new ReviewWriteConflict('invalid_membership_target', [], 422);
                }
                $row = $this->db->table('workspace_members')->where('workspace_id', $workspace)->where('user_id', $target)->lockForUpdate()->first();
                if (($row ? (int) $row->version : 0) !== $expected) {
                    throw new ReviewWriteConflict('stale_membership_version', ['current_version' => $row ? (int) $row->version : 0]);
                }
                if (! $row && $role === null) {
                    throw new ReviewWriteConflict('membership_not_found', [], 404);
                }
                $now = (new \DateTimeImmutable)->format('Y-m-d H:i:s.u');
                $change = ['role' => $role ?? $row->role, 'status' => $role === null ? 'revoked' : 'active', 'version' => $expected + 1,
                    'granted_by_user_id' => $role === null ? $row->granted_by_user_id : $actor,
                    'revoked_by_user_id' => $role === null ? $actor : null, 'revoked_at' => $role === null ? $now : null, 'updated_at' => $now];
                if ($row) {
                    $this->db->table('workspace_members')->where('id', $row->id)->where('version', $expected)->update($change);
                } else {
                    $this->db->table('workspace_members')->insert($change + ['id' => (string) Str::uuid(), 'workspace_id' => $workspace, 'user_id' => $target, 'created_at' => $now]);
                }

                return ['user_id' => $target, 'role' => $change['role'], 'status' => $change['status'], 'version' => $change['version']];
            }, 3);
        } catch (QueryException $error) {
            if (in_array($error->errorInfo[1] ?? 0, [1062, 1205, 1213], true)) {
                throw new ReviewWriteConflict('membership_busy', ['attempts' => 3]);
            }
            throw $error;
        } finally {
            $this->db->selectOne('SELECT RELEASE_LOCK(?) AS released', [$lock]);
            $this->db->statement('SET SESSION innodb_lock_wait_timeout='.$timeout);
        }
    }
}
