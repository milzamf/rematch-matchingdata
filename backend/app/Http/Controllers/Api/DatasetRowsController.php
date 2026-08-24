<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Dataset;
use App\Services\Datasets\DatasetInspectionService;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DatasetRowsController extends Controller
{
    public function __construct(
        private readonly DatasetInspectionService $inspectionService,
        private readonly ResourceOwnership $ownership,
    ) {
    }

    public function __invoke(Request $request, string $dataset): JsonResponse
    {
        $datasetModel = $this->ownership->scopeDatasets(Dataset::query(), $request->user())
            ->findOrFail($dataset);

        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(250, max(1, (int) $request->query('per_page', 50)));
        $search = $request->query('search');

        $result = $this->inspectionService->getPaginatedRows(
            $datasetModel,
            $page,
            $perPage,
            is_string($search) ? $search : null,
        );

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }
}
