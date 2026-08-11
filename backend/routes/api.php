<?php

use App\Http\Controllers\Api\DatasetInspectionController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\MatchingRunController;
use App\Http\Controllers\Api\MatchingStatusController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);
Route::post('/datasets/inspect', DatasetInspectionController::class);
Route::post('/matching-jobs/run', MatchingRunController::class);
Route::get('/matching-jobs/{job}/status', MatchingStatusController::class);

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
