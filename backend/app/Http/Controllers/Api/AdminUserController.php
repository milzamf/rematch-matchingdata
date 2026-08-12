<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Auth\UserRole;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminUserController extends Controller
{
    public function index(): JsonResponse
    {
        $workspaceCountSubquery = Workspace::query()
            ->selectRaw('count(*)')
            ->whereColumn('workspaces.user_id', 'users.id');

        $datasetCountSubquery = Workspace::query()
            ->selectRaw('count(distinct datasets.id)')
            ->leftJoin('datasets', function ($join) {
                $join
                    ->on('datasets.id', '=', 'workspaces.reference_dataset_id')
                    ->orOn('datasets.id', '=', 'workspaces.input_dataset_id');
            })
            ->whereColumn('workspaces.user_id', 'users.id');

        $matchingJobCountSubquery = Workspace::query()
            ->selectRaw('count(distinct matching_jobs.id)')
            ->leftJoin('matching_jobs', 'matching_jobs.id', '=', 'workspaces.matching_job_id')
            ->whereColumn('workspaces.user_id', 'users.id');

        $users = User::query()
            ->select('users.*')
            ->selectSub($workspaceCountSubquery, 'workspace_count')
            ->selectSub($datasetCountSubquery, 'dataset_count')
            ->selectSub($matchingJobCountSubquery, 'matching_job_count')
            ->orderBy('name')
            ->get()
            ->map(fn (User $user) => $this->payload($user));

        return response()->json([
            'success' => true,
            'data' => $users,
        ]);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:160'],
            'role' => ['sometimes', Rule::in(UserRole::values())],
        ]);

        $user->update($data);
        $user = $this->loadUserWithOwnershipCounts($user->getKey());

        return response()->json([
            'success' => true,
            'data' => $this->payload($user),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(User $user): array
    {
        return [
            'id' => $user->getKey(),
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->roleEnum()->value,
            'workspace_count' => (int) ($user->workspace_count ?? 0),
            'dataset_count' => (int) ($user->dataset_count ?? 0),
            'matching_job_count' => (int) ($user->matching_job_count ?? 0),
            'created_at' => optional($user->created_at)->toISOString(),
            'updated_at' => optional($user->updated_at)->toISOString(),
        ];
    }

    private function loadUserWithOwnershipCounts(int|string $userId): User
    {
        return User::query()
            ->select('users.*')
            ->selectSub(
                Workspace::query()
                    ->selectRaw('count(*)')
                    ->whereColumn('workspaces.user_id', 'users.id'),
                'workspace_count',
            )
            ->selectSub(
                Workspace::query()
                    ->selectRaw('count(distinct datasets.id)')
                    ->leftJoin('datasets', function ($join) {
                        $join
                            ->on('datasets.id', '=', 'workspaces.reference_dataset_id')
                            ->orOn('datasets.id', '=', 'workspaces.input_dataset_id');
                    })
                    ->whereColumn('workspaces.user_id', 'users.id'),
                'dataset_count',
            )
            ->selectSub(
                Workspace::query()
                    ->selectRaw('count(distinct matching_jobs.id)')
                    ->leftJoin('matching_jobs', 'matching_jobs.id', '=', 'workspaces.matching_job_id')
                    ->whereColumn('workspaces.user_id', 'users.id'),
                'matching_job_count',
            )
            ->findOrFail($userId);
    }
}
