<?php

use App\Http\Controllers\Api\DatasetInspectionController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\MatchingRunController;
use App\Http\Controllers\Api\MatchingStatusController;
use App\Http\Controllers\Api\ReviewDecisionController;
use App\Http\Controllers\Api\ReviewResultsController;
use App\Http\Controllers\Api\UndoReviewDecisionController;
use App\Http\Controllers\Api\WorkspaceController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);
Route::apiResource('workspaces', WorkspaceController::class)->only([
    'index',
    'store',
    'show',
    'update',
    'destroy',
]);
Route::post('/datasets/inspect', DatasetInspectionController::class);
Route::post('/matching-jobs/run', MatchingRunController::class);
Route::get('/matching-jobs/{job}/status', MatchingStatusController::class);
Route::get('/matching-jobs/{job}/review-results', ReviewResultsController::class);
Route::post('/matching-jobs/{job}/review-decisions', ReviewDecisionController::class);
Route::post('/matching-jobs/{job}/review-decisions/{decision}/undo', UndoReviewDecisionController::class);

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
