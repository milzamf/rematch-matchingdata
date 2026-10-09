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

    public int $timeout = 0;

    public int $tries = 3;

    public function __construct(public string $matchingJobId)
    {
    }

    public function handle(MatchingEngineService $engine): void
    {
        if (ini_get('memory_limit') !== '-1') {
            @ini_set('memory_limit', '4096M');
        }

        $job = MatchingJob::with(['workspace', 'referenceDataset', 'inputDataset'])->find($this->matchingJobId);

        if (! $job) {
            Log::error("RunMatchingJob failed: MatchingJob ID [{$this->matchingJobId}] not found.");
            return;
        }

        if (in_array($job->status, ['cancelled', 'stopped', 'failed', 'completed']) || $job->error_message === 'Matching stopped by user.') {
            Log::info("RunMatchingJob skipped for Job ID [{$this->matchingJobId}] because status is [{$job->status}] / error: [{$job->error_message}].");
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
                'error_message' => substr($exception->getMessage(), 0, 1000),
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

    public function failed(\Throwable $exception): void
    {
        $rawMessage = $exception->getMessage();
        if (str_contains($rawMessage, 'attempted too many times') || str_contains($rawMessage, 'MaxAttemptsExceededException')) {
            $errorMessage = 'Proses terputus karena antrean/container sempat di-restart saat matching berjalan. Silakan klik tombol "Coba lagi" untuk memulai ulang proses matching.';
        } else {
            $errorMessage = substr($rawMessage, 0, 1000);
        }

        \Log::error("RunMatchingJob permanent failure: " . $rawMessage);
        MatchingJob::where('id', $this->matchingJobId)->update([
            'status' => 'failed',
            'error_message' => $errorMessage,
        ]);
    }
}
