<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewRegionIndexService;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\Request;

class ReviewRegionOptionsController extends Controller
{
    public function __invoke(Request $request, string $job, ResourceOwnership $ownership, ReviewRegionIndexService $regions)
    {
        if (config('workspace_access.enabled') || config('review_transactions.enabled')) {
            $access = new \App\Services\Workspace\WorkspaceAccessService(\Illuminate\Support\Facades\DB::connection(), (bool) config('workspace_access.enabled'));
            $access->job((int) $request->user()->getKey(), $job, 'read');
            $record = \App\Models\MatchingJob::findOrFail($job);
        } else $record = $ownership->findMatchingJob($request->user(), $job);
        return response()->json(['success' => true, 'data' => $regions->options($record)]);
    }
}
