<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AI\ReviewKnowledgeService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiReviewKnowledgeController extends Controller
{
    public function __construct(
        private readonly ReviewKnowledgeService $knowledge,
    ) {
    }

    public function __invoke(Request $request, string $result): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->knowledge->retrieve($request->user(), $result),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching result was not found.',
            ], 404);
        }
    }
}
