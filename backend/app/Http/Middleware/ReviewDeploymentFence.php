<?php

namespace App\Http\Middleware;

use App\Services\Matching\Transactions\ReviewDeploymentFence as Fence;
use Illuminate\Http\Request;

final class ReviewDeploymentFence
{
    public function handle(Request $request, \Closure $next)
    {
        // Keep session login/logout/bootstrap available, not business endpoints.
        if ($request->is('api/*') && ! $request->is('api/login', 'api/logout', 'api/me')) {
            if (Fence::frozen()) Fence::assertWritable();
            if (! $request->isMethodSafe() && ! $request->is('api/stage5a/*')) {
                if (Fence::legacyBlocked() && $request->is('api/matching-jobs/*/review-decisions*')) {
                    throw new \App\Services\Matching\Transactions\ReviewWriteConflict('legacy_review_write_disabled');
                }
                Fence::assertWritable(true);
            }
        }
        return $next($request);
    }
}
