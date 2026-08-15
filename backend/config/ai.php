<?php

return [
    'enabled' => (bool) env('REMATCH_AI_ENABLED', false),

    'provider' => env('REMATCH_AI_PROVIDER', 'openai'),

    'model' => env('REMATCH_AI_MODEL', ''),

    'timeout' => (int) env('REMATCH_AI_TIMEOUT', 30),

    'providers' => [
        'openai' => [
            'base_url' => env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
            'api_key' => env('OPENAI_API_KEY', ''),
            'model' => env('REMATCH_AI_MODEL', ''),
            'timeout' => (int) env('REMATCH_AI_TIMEOUT', 30),
        ],
        'tabitoken' => [
            'base_url' => env('TABITOKEN_BASE_URL', 'https://tabitoken.com/v1'),
            'api_key' => env('TABITOKEN_API_KEY', ''),
            'model' => env('REMATCH_AI_MODEL', ''),
            'timeout' => (int) env('REMATCH_AI_TIMEOUT', 30),
        ],
    ],
];
