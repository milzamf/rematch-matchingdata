<?php

// No controller/route uses this flag yet. Enabling alone cannot perform cutover.
return ['enabled' => env('REVIEW_STATE_TRANSACTIONS_ENABLED', false)];
