<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingJob;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MatchingStopController extends Controller
{
    public function __construct(
        private readonly ResourceOwnership $ownership
    ) {
    }

    public function __invoke(Request $request, string $job): JsonResponse
    {
        if (\App\Services\Matching\SharedMatchingLifecycle::enabled()) {
            $request->validate(['expected_workspace_version' => ['required', 'integer', 'min:1']]);
            $job = app(\App\Services\Matching\SharedMatchingLifecycle::class)->stop($request->user(), $job, (int) $request->input('expected_workspace_version'));
            $workspace = $job->workspace()->firstOrFail();
            return response()->json(['success' => true, 'data' => ['job' => $job, 'workspace' => ['id' => $workspace->id, 'configuration_version' => (int) $workspace->configuration_version]]]);
        }
        $matchingJob = $this->ownership->findMatchingJob($request->user(), $job);

        if (in_array($matchingJob->status, ['running', 'pending', 'processing', 'queued'])) {
            $matchingJob->update([
                'status' => 'cancelled',
                'error_message' => 'Matching stopped by user.',
                'finished_at' => \Illuminate\Support\Carbon::now(),
            ]);

            if ($matchingJob->workspace !== null) {
                $matchingJob->workspace->update([
                    'status' => 'configuring',
                ]);
            }

            try {
                \Illuminate\Support\Facades\DB::table('jobs')
                    ->where('payload', 'like', '%' . $matchingJob->id . '%')
                    ->delete();
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("Failed to delete cancelled job {$matchingJob->id} from queue table: " . $e->getMessage());
            }
        }
        
        return response()->json([
            'success' => true,
            'message' => 'Job termination signal sent.',
            'data' => [
                'job' => $matchingJob->fresh(),
            ],
        ]);
    }
}
