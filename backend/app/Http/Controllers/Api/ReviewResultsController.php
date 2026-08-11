<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewResultService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;

class ReviewResultsController extends Controller
{
    public function __construct(private readonly ReviewResultService $reviewResults)
    {
    }

    public function __invoke(string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->reviewResults->list($job),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job was not found.',
            ], 404);
        }
    }
}
