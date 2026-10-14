<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewResultService;
use App\Http\Requests\ReviewResultsRequest;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Contracts\Cache\LockTimeoutException;

class ReviewResultsController extends Controller
{
    public function __construct(private readonly ReviewResultService $reviewResults)
    {
    }

    public function __invoke(ReviewResultsRequest $request, string $job): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->reviewResults->list($request->user(), $job, $request->query()),
            ]);
        } catch (LockTimeoutException) {
            return response()->json(['success' => false, 'code' => 'case_groups_preparing',
                'message' => 'Kelompok kasus sedang disiapkan. Silakan coba lagi sebentar.'], 503)->header('Retry-After', '5');
        } catch (ModelNotFoundException $exception) {
            return response()->json([
                'success' => false,
                'message' => $exception->getModel() === 'ReviewCaseGroup' ? 'The requested case group was not found. Refresh the group list.' : 'The requested matching job was not found.',
            ], 404);
        }
    }
}
