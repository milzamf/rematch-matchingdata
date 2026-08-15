<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AI\ReviewRecommendationService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiReviewRecommendationController extends Controller
{
    public function __construct(
        private readonly ReviewRecommendationService $recommendations,
    ) {
    }

    public function __invoke(Request $request, string $result): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->recommendations->recommend($request->user(), $result)->toArray(),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching result was not found.',
            ], 404);
        }
    }
}
