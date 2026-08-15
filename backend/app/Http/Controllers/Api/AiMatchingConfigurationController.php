<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AI\MatchingConfigurationAssistant;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiMatchingConfigurationController extends Controller
{
    public function __construct(
        private readonly MatchingConfigurationAssistant $assistant,
    ) {
    }

    public function __invoke(Request $request, string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->assistant->suggest($request->user(), $job)->toArray(),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job was not found.',
            ], 404);
        }
    }
}
