<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingJob;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Http\JsonResponse;

class MonitoringOverviewController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $workspaces = Workspace::query()
            ->with(['user', 'matchingJob'])
            ->latest('updated_at')
            ->get();

        $statusCounts = $workspaces
            ->groupBy('status')
            ->map(fn ($items) => $items->count())
            ->all();

        $ownerBreakdown = $workspaces
            ->groupBy(fn (Workspace $workspace) => $workspace->user?->name ?? 'Unassigned')
            ->map(function ($items, string $owner) {
                $first = $items->first();

                return [
                    'owner' => $owner,
                    'user_id' => $first?->user?->getKey(),
                    'role' => $first?->user?->roleEnum()->value,
                    'workspace_count' => $items->count(),
                    'pending_review' => $items->sum(fn (Workspace $workspace) => (int) data_get($workspace->matchingJob?->record_counts, 'possible_match', 0)),
                ];
            })
            ->sortByDesc('workspace_count')
            ->values()
            ->all();

        $recentWorkspaces = $workspaces->take(12)->map(function (Workspace $workspace) {
            return [
                'id' => $workspace->id,
                'name' => $workspace->name,
                'status' => $workspace->status,
                'current_step' => $workspace->current_step,
                'record_count' => $workspace->matchingJob?->total_count,
                'pending_review' => (int) data_get($workspace->matchingJob?->record_counts, 'possible_match', 0),
                'owner' => $workspace->user ? [
                    'id' => $workspace->user->getKey(),
                    'name' => $workspace->user->name,
                    'email' => $workspace->user->email,
                    'role' => $workspace->user->roleEnum()->value,
                ] : null,
                'updated_at' => optional($workspace->updated_at)->toISOString(),
            ];
        })->values()->all();

        return response()->json([
            'success' => true,
            'data' => [
                'summary' => [
                    'workspace_total' => $workspaces->count(),
                    'user_total' => User::query()->count(),
                    'matching_job_total' => MatchingJob::query()->count(),
                    'pending_review_total' => $workspaces->sum(fn (Workspace $workspace) => (int) data_get($workspace->matchingJob?->record_counts, 'possible_match', 0)),
                    'status_counts' => $statusCounts,
                ],
                'owner_breakdown' => $ownerBreakdown,
                'recent_workspaces' => $recentWorkspaces,
            ],
        ]);
    }
}
