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
            $locale = $request->input('locale')
                ?? $request->header('X-Locale')
                ?? $request->header('Accept-Language')
                ?? app()->getLocale();
            $locale = str_starts_with(strtolower((string) $locale), 'en') ? 'en' : 'id';

            $draftMappings = $request->input('mappings');
            if (is_string($draftMappings)) {
                $draftMappings = json_decode($draftMappings, true);
            }

            $response = $this->assistant->suggest(
                $request->user(),
                $job,
                $locale,
                is_array($draftMappings) ? $draftMappings : null,
            );

            return response()->json([
                'success' => $response->success,
                'data' => $response->toArray(),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested matching job was not found.',
            ], 404);
        }
    }
}
