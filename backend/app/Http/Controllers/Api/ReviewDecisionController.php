<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ReviewDecisionRequest;
use App\Services\Matching\ReviewResultService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use InvalidArgumentException;

class ReviewDecisionController extends Controller
{
    public function __construct(private readonly ReviewResultService $reviewResults)
    {
    }

    public function __invoke(ReviewDecisionRequest $request, string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->reviewResults->decide($request->user(), $job, $request->validated()),
            ]);
        } catch (InvalidArgumentException $exception) {
            return response()->json([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job or result was not found.',
            ], 404);
        }
    }
}
