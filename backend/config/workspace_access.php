<?php

// Isolated API only. Both this flag and the fixed DB/env guard are required.
return ['enabled' => env('WORKSPACE_ACCESS_ENABLED', false)];
