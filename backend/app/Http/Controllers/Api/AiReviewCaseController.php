<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AI\ReviewCaseAnalyst;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiReviewCaseController extends Controller
{
    public function __construct(
        private readonly ReviewCaseAnalyst $analyst,
    ) {
    }

    public function __invoke(Request $request, string $result): JsonResponse
    {
        try {
            $analysis = $this->analyst->analyze($request->user(), $result);

            return response()->json([
                'success' => true,
                'data' => $analysis->toArray(),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching result was not found.',
            ], 404);
        }
    }
}
