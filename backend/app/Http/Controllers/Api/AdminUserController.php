<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Auth\UserRole;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;
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

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'role' => ['required', Rule::in(UserRole::values())],
            'password' => ['required', 'confirmed', Password::min(6)],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'role' => $data['role'],
            'password' => $data['password'],
        ]);

        $user = $this->loadUserWithOwnershipCounts($user->getKey());

        return response()->json([
            'success' => true,
            'data' => $this->payload($user),
        ], 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:160'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->getKey())],
            'role' => ['sometimes', Rule::in(UserRole::values())],
        ]);

        $this->preventLastAdminDemotion($request, $user, $data['role'] ?? null);
        $user->update($data);
        $user = $this->loadUserWithOwnershipCounts($user->getKey());

        return response()->json([
            'success' => true,
            'data' => $this->payload($user),
        ]);
    }

    public function setPassword(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'confirmed', Password::min(6)],
        ]);

        $user->update([
            'password' => $data['password'],
        ]);

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

    private function preventLastAdminDemotion(Request $request, User $targetUser, ?string $nextRole): void
    {
        if ($nextRole === null || $targetUser->roleEnum() !== UserRole::Admin || $nextRole === UserRole::Admin->value) {
            return;
        }

        $actor = $request->user();
        if (! $actor || (string) $actor->getKey() !== (string) $targetUser->getKey()) {
            return;
        }

        $adminCount = User::query()
            ->where('role', UserRole::Admin->value)
            ->count();

        if ($adminCount <= 1) {
            throw new HttpResponseException(response()->json([
                'success' => false,
                'message' => 'The last remaining admin cannot be demoted.',
                'errors' => [
                    'role' => ['The last remaining admin cannot be demoted.'],
                ],
            ], 422));
        }
    }
}
