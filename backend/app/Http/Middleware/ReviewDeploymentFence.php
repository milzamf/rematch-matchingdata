<?php

namespace App\Http\Middleware;

use App\Services\Matching\Transactions\ReviewDeploymentFence as Fence;
use Illuminate\Http\Request;

final class ReviewDeploymentFence
{
    public function handle(Request $request, \Closure $next)
    {
        if ($request->is('api/*') && ! $request->is('api/login', 'api/logout', 'api/me')) {
            return Fence::withAdmission(fn () => $this->handleAdmitted($request, $next));
        }
        return $next($request);
    }

    private function handleAdmitted(Request $request, \Closure $next)
    {
        // Keep session login/logout/bootstrap available, not business endpoints.
        if ($request->is('api/*') && ! $request->is('api/login', 'api/logout', 'api/me')) {
            if (Fence::frozen()) Fence::assertWritable();
            // Inspection creates a new, actor-owned dataset only. It cannot attach it
            // to a workspace or alter matching/review state. Keep admission + freeze,
            // authentication and matching.create authorization on this upload route.
            $createsDataset = $request->isMethod('POST') && $request->is('api/datasets/inspect');
            // These routes dispatch to DraftWorkspaceService in shared mode. That
            // service refuses any workspace with a job, and requires a current version.
            $draftWorkspace = ($request->isMethod('POST') && $request->is('api/workspaces'))
                || ($request->isMethod('PATCH') && preg_match('#^api/workspaces/[^/]+$#D', $request->path()));
            // Run/Stop use scoped admission; advisory POST only reads configuration.
            $matchingLifecycle = ($request->isMethod('POST') && ($request->is('api/matching-jobs/run')
                || preg_match('#^api/matching-jobs/[^/]+/(stop|ai-matching-configuration)$#D', $request->path())));
            if (! $request->isMethodSafe() && ! $request->is('api/stage5a/*') && ! $createsDataset && ! $draftWorkspace && ! $matchingLifecycle) {
                if (Fence::legacyBlocked() && $request->is('api/matching-jobs/*/review-decisions*')) {
                    throw new \App\Services\Matching\Transactions\ReviewWriteConflict('legacy_review_write_disabled');
                }
                Fence::assertWritable(true);
            }
        }
        return $next($request);
    }
}
