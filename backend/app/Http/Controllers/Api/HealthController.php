<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [
                'service' => 'BatchMatch API',
                'status' => 'healthy',
                'version' => '0.1.0',
            ],
        ]);
    }
}
