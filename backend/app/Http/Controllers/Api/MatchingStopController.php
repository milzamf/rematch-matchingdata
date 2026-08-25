<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MatchingStopController extends Controller
{
    public function __invoke(Request $request, MatchingJob $job): JsonResponse
    {
        if (in_array($job->status, ['running', 'pending'])) {
            $job->update(['status' => 'cancelled', 'error_message' => 'Matching stopped by user.']);
        }
        
        return response()->json([
            'success' => true,
            'message' => 'Job termination signal sent.',
        ]);
    }
}
