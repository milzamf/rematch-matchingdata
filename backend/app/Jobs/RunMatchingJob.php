<?php

namespace App\Jobs;

use App\Models\MatchingJob;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Throwable;

class RunMatchingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 3600;

    public int $tries = 1;

    public function __construct(public string $matchingJobId)
    {
    }

    public function handle(MatchingEngineService $engine): void
    {
        $job = MatchingJob::with(['workspace', 'referenceDataset', 'inputDataset'])->find($this->matchingJobId);

        if (! $job) {
            Log::error("RunMatchingJob failed: MatchingJob ID [{$this->matchingJobId}] not found.");
            return;
        }

        try {
            $engine->runJob($job);
        } catch (Throwable $exception) {
            Log::error("RunMatchingJob failed for Job ID [{$this->matchingJobId}]: {$exception->getMessage()}", [
                'trace' => $exception->getTraceAsString(),
            ]);

            $job->update([
                'status' => 'failed',
                'error_message' => $exception->getMessage(),
                'finished_at' => Carbon::now(),
            ]);

            if ($job->workspace) {
                $job->workspace->update([
                    'status' => 'failed',
                ]);
            }

            throw $exception;
        }
    }
}
