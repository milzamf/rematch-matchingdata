<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewResultService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;

class UndoReviewDecisionController extends Controller
{
    public function __construct(private readonly ReviewResultService $reviewResults)
    {
    }

    public function __invoke(string $job, string $decision): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->reviewResults->undo($job, $decision),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested review decision was not found.',
            ], 404);
        }
    }
}
