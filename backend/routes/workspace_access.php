<?php

use App\Http\Controllers\Api\WorkspaceAccessController;
use App\Http\Controllers\Api\SharedWorkspaceReadController;
use App\Http\Middleware\EnsureIsolatedWorkspaceAccess;
use Illuminate\Support\Facades\Route;

// Always registered for route audit. Auth + runtime fixed-test guard keeps live feature inactive.
Route::prefix('stage5a')->middleware(['auth:sanctum', EnsureIsolatedWorkspaceAccess::class])->group(function () {
    Route::get('workspaces/{workspace}', [SharedWorkspaceReadController::class, 'workspace']);
    Route::get('workspaces/{workspace}/jobs/{job}/review-results', [SharedWorkspaceReadController::class, 'review']);
    Route::get('workspaces/{workspace}/jobs/{job}/candidates', [SharedWorkspaceReadController::class, 'candidates']);
    Route::get('workspaces/{workspace}/jobs/{job}/export', [SharedWorkspaceReadController::class, 'export']);
    Route::get('workspaces/{workspace}/datasets/{dataset}/rows', [SharedWorkspaceReadController::class, 'dataset']);
    Route::get('workspaces', [WorkspaceAccessController::class, 'index']);
    Route::get('workspaces/{workspace}/permissions', [WorkspaceAccessController::class, 'permissions']);
    Route::get('workspaces/{workspace}/members', [WorkspaceAccessController::class, 'listMembers']);
    Route::get('workspaces/{workspace}/users', [WorkspaceAccessController::class, 'searchUsers']);
    Route::post('workspaces/{workspace}/members', [WorkspaceAccessController::class, 'setMember']);
    Route::delete('workspaces/{workspace}/members/{member}', [WorkspaceAccessController::class, 'revokeMember'])->whereNumber('member');
    Route::get('workspaces/{workspace}/resources/{kind}/{resource}', [WorkspaceAccessController::class, 'resource'])->whereIn('kind', ['dataset', 'job', 'result', 'history']);
    Route::get('jobs/{job}/proposals', [WorkspaceAccessController::class, 'proposals']);
    Route::post('jobs/{job}/proposals', [WorkspaceAccessController::class, 'propose']);
    Route::post('jobs/{job}/proposals/{proposal}/resolve', [WorkspaceAccessController::class, 'resolve']);
    Route::post('jobs/{job}/decisions', [WorkspaceAccessController::class, 'decide']);
    Route::post('jobs/{job}/undo', [WorkspaceAccessController::class, 'undo']);
});
