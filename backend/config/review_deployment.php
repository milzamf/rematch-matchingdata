<?php

// Inactive by default. Marker must be shared by every HTTP/queue instance.
return [
    // No main environment is authorized by installing this code or enabling UI flags.
    'mode' => env('REVIEW_DEPLOYMENT_MODE', 'isolated'),
    'database' => env('REVIEW_DEPLOYMENT_DATABASE'),
    'release' => env('REVIEW_DEPLOYMENT_RELEASE'),
    'approval_file' => env('REVIEW_DEPLOYMENT_APPROVAL_FILE'),
    'approval_sha256' => env('REVIEW_DEPLOYMENT_APPROVAL_SHA256'),
    'write_frozen' => env('REVIEW_DEPLOYMENT_WRITE_FROZEN', false),
    'freeze_file' => env('REVIEW_DEPLOYMENT_FREEZE_FILE', storage_path('framework/review-write.freeze')),
];
