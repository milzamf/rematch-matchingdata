<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\AdminWorkspaceController;
use App\Http\Controllers\Api\DatasetInspectionController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\AiReviewCaseController;
use App\Http\Controllers\Api\AiReviewKnowledgeController;
use App\Http\Controllers\Api\AiMatchingConfigurationController;
use App\Http\Controllers\Api\AiReviewRecommendationController;
use App\Http\Controllers\Api\MatchingRunController;
use App\Http\Controllers\Api\MatchingStatusController;
use App\Http\Controllers\Api\MonitoringOverviewController;
use App\Http\Controllers\Api\ReviewDecisionController;
use App\Http\Controllers\Api\ReviewResultsController;
use App\Http\Controllers\Api\UndoReviewDecisionController;
use App\Http\Controllers\Api\WorkspaceController;
use App\Support\Auth\PermissionRegistry;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

Route::middleware('web')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::get('/me', [AuthController::class, 'me'])->middleware('auth:sanctum');
    Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/workspaces', [WorkspaceController::class, 'index'])
        ->middleware('permission:'.PermissionRegistry::WORKSPACE_VIEW);
    Route::post('/workspaces', [WorkspaceController::class, 'store'])
        ->middleware('permission:'.PermissionRegistry::WORKSPACE_CREATE);
    Route::get('/workspaces/{workspace}', [WorkspaceController::class, 'show'])
        ->middleware('permission:'.PermissionRegistry::WORKSPACE_VIEW);
    Route::patch('/workspaces/{workspace}', [WorkspaceController::class, 'update'])
        ->middleware('permission:'.PermissionRegistry::WORKSPACE_UPDATE);
    Route::delete('/workspaces/{workspace}', [WorkspaceController::class, 'destroy'])
        ->middleware('permission:'.PermissionRegistry::WORKSPACE_DELETE);

    Route::post('/datasets/inspect', DatasetInspectionController::class)
        ->middleware('permission:'.PermissionRegistry::MATCHING_CREATE);
    Route::post('/matching-jobs/run', MatchingRunController::class)
        ->middleware('permission:'.PermissionRegistry::MATCHING_RUN);
    Route::get('/matching-jobs/{job}/status', MatchingStatusController::class)
        ->middleware('permission:'.PermissionRegistry::MATCHING_VIEW);
    Route::get('/matching-jobs/{job}/ai-matching-configuration', AiMatchingConfigurationController::class)
        ->middleware('permission:'.PermissionRegistry::MATCHING_CONFIGURE);
    Route::get('/matching-jobs/{job}/review-results', ReviewResultsController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_VIEW);
    Route::get('/matching-results/{result}/ai-review-analysis', AiReviewCaseController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_VIEW);
    Route::get('/matching-results/{result}/review-knowledge', AiReviewKnowledgeController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_VIEW);
    Route::get('/matching-results/{result}/ai-review-recommendation', AiReviewRecommendationController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_VIEW);
    Route::post('/matching-jobs/{job}/review-decisions', ReviewDecisionController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_DECIDE);
    Route::post('/matching-jobs/{job}/review-decisions/{decision}/undo', UndoReviewDecisionController::class)
        ->middleware('permission:'.PermissionRegistry::REVIEW_DECIDE);

    Route::get('/monitoring/overview', MonitoringOverviewController::class)
        ->middleware('permission:'.PermissionRegistry::MONITORING_VIEW);

    Route::get('/admin/users', [AdminUserController::class, 'index'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
    Route::post('/admin/users', [AdminUserController::class, 'store'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
    Route::patch('/admin/users/{user}', [AdminUserController::class, 'update'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
    Route::post('/admin/users/{user}/password', [AdminUserController::class, 'setPassword'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
    Route::get('/admin/workspaces', [AdminWorkspaceController::class, 'index'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
    Route::patch('/admin/workspaces/{workspace}/owner', [AdminWorkspaceController::class, 'assignOwner'])
        ->middleware('permission:'.PermissionRegistry::ADMIN_ACCESS);
});
