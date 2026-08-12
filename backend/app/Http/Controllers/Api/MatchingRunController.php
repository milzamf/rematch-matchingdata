<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\RunMatchingRequest;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Throwable;

class MatchingRunController extends Controller
{
    public function __construct(private readonly MatchingEngineService $engine)
    {
    }

    public function __invoke(RunMatchingRequest $request): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->engine->run($request->user(), $request->validated()),
            ]);
        } catch (InvalidArgumentException $exception) {
            return response()->json([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        } catch (ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'The requested dataset, workspace, or matching job was not found.',
            ], 404);
        } catch (Throwable) {
            return response()->json([
                'success' => false,
                'message' => 'Matching run failed. Please check the datasets and configuration.',
            ], 500);
        }
    }
}
