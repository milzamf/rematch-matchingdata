<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminWorkspaceController extends Controller
{
    public function index(): JsonResponse
    {
        $workspaces = Workspace::query()
            ->with(['user', 'referenceDataset', 'inputDataset', 'matchingJob'])
            ->latest('updated_at')
            ->get()
            ->map(fn (Workspace $workspace) => $this->payload($workspace));

        return response()->json([
            'success' => true,
            'data' => $workspaces,
        ]);
    }

    public function assignOwner(Request $request, Workspace $workspace): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'exists:users,id'],
        ]);

        $owner = User::query()->findOrFail($data['user_id']);

        $workspace->update([
            'user_id' => $owner->getKey(),
        ]);

        return response()->json([
            'success' => true,
            'data' => $this->payload($workspace->fresh(['user', 'referenceDataset', 'inputDataset', 'matchingJob'])),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Workspace $workspace): array
    {
        return [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'status' => $workspace->status,
            'current_step' => $workspace->current_step,
            'record_count' => $workspace->inputDataset?->row_count ?? $workspace->matchingJob?->total_count,
            'reference_dataset_id' => $workspace->reference_dataset_id,
            'input_dataset_id' => $workspace->input_dataset_id,
            'matching_job_id' => $workspace->matching_job_id,
            'owner' => $workspace->user ? [
                'id' => $workspace->user->getKey(),
                'name' => $workspace->user->name,
                'email' => $workspace->user->email,
                'role' => $workspace->user->roleEnum()->value,
            ] : null,
            'updated_at' => optional($workspace->updated_at)->toISOString(),
            'created_at' => optional($workspace->created_at)->toISOString(),
        ];
    }
}
