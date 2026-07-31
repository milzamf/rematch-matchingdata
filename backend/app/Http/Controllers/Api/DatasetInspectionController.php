<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\DatasetParsingException;
use App\Exceptions\UnsupportedDatasetFormatException;
use App\Http\Controllers\Controller;
use App\Http\Requests\InspectDatasetRequest;
use App\Services\Datasets\DatasetInspectionService;
use Illuminate\Http\JsonResponse;

class DatasetInspectionController extends Controller
{
    public function __construct(private readonly DatasetInspectionService $inspectionService) {}

    public function __invoke(InspectDatasetRequest $request): JsonResponse
    {
        try {
            return response()->json([
                'success' => true,
                'data' => $this->inspectionService->inspect(
                    $request->file('file'),
                    $request->validated(),
                ),
            ]);
        } catch (UnsupportedDatasetFormatException $exception) {
            return response()->json([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 415);
        } catch (DatasetParsingException $exception) {
            return response()->json([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }
    }
}
