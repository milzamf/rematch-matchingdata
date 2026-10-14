<?php

namespace App\Http\Middleware;

use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class EnsureIsolatedWorkspaceAccess
{
    public function handle(Request $request, \Closure $next)
    {
        (new WorkspaceAccessService(DB::connection(), (bool) config('workspace_access.enabled')))->guard();

        return $next($request);
    }
}
