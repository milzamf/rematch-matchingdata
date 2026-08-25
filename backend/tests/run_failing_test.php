<?php

require __DIR__.'/../vendor/autoload.php';
\ = require_once __DIR__.'/../bootstrap/app.php';
\ = \->make(Illuminate\Contracts\Console\Kernel::class);
\->bootstrap();

\Illuminate\Support\Facades\Log::info('TEST SCRIPT');
