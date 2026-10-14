<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Matching\ReviewRegionIndexService;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\Request;

class ReviewRegionOptionsController extends Controller
{
    public function __invoke(Request $request, string $job, ResourceOwnership $ownership, ReviewRegionIndexService $regions)
    {
        return response()->json(['success' => true, 'data' => $regions->options($ownership->findMatchingJob($request->user(), $job))]);
    }
}
