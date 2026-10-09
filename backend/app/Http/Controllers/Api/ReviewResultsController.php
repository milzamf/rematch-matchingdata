<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewResultService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReviewResultsController extends Controller
{
    public function __construct(private readonly ReviewResultService $reviewResults)
    {
    }

    public function __invoke(Request $request, string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->reviewResults->list($request->user(), $job, $request->query()),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job was not found.',
            ], 404);
        }
    }
}
