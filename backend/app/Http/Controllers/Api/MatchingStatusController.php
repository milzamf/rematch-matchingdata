<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MatchingStatusController extends Controller
{
    public function __construct(private readonly MatchingEngineService $engine)
    {
    }

    public function __invoke(Request $request, string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->engine->status($request->user(), $job),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job was not found.',
            ], 404);
        }
    }
}
