<?php

// Inactive by default. Marker must be shared by every HTTP/queue instance.
return [
    'write_frozen' => env('REVIEW_DEPLOYMENT_WRITE_FROZEN', false),
    'freeze_file' => env('REVIEW_DEPLOYMENT_FREEZE_FILE', storage_path('framework/review-write.freeze')),
];
