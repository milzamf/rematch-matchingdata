<?php

namespace App\Jobs;

use App\Services\Matching\ReviewRegionIndexService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

class BuildReviewRegionIndex implements ShouldQueue
{
    use Queueable;

    public int $timeout = 1800;
    public int $tries = 2;

    public function __construct(public readonly string $jobId) {}

    public function handle(ReviewRegionIndexService $regions): void
    {
        \App\Services\Matching\Transactions\ReviewDeploymentFence::assertWritable(true);
        // Connection-owned MySQL locks disappear if a worker dies; no long
        // cache lease can leave the region index stuck after container restart.
        $lockName = "review_regions_{$this->jobId}";
        $mysql = DB::getDriverName() === 'mysql';
        $lock = $mysql ? null : cache()->lock($lockName, 300);
        if ($mysql ? !(bool) DB::selectOne('SELECT GET_LOCK(?, 0) AS acquired', [$lockName])->acquired : !$lock->get()) return;
        try {
            $regions->backfill($this->jobId);
        } finally {
            if ($mysql) DB::selectOne('SELECT RELEASE_LOCK(?)', [$lockName]);
            else $lock->release();
            cache()->forget("review_regions_queued_{$this->jobId}");
        }
    }
}
