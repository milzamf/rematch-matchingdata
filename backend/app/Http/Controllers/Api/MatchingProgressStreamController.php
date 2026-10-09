<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingJob;
use App\Services\Matching\MatchingEngineService;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MatchingProgressStreamController extends Controller
{
    public function __construct(
        private readonly MatchingEngineService $engine,
        private readonly ResourceOwnership $ownership
    ) {
    }

    public function __invoke(Request $request, ?string $job = null): StreamedResponse
    {
        $jobId = $job ?: $request->query('job_id') ?: $request->query('job');

        if (! $jobId) {
            return response()->stream(function () {
                echo "data: " . json_encode(['status' => 'failed', 'error' => 'Job ID is required']) . "\n\n";
            }, 400, [
                'Content-Type' => 'text/event-stream',
            ]);
        }

        try {
            $matchingJob = $this->ownership->findMatchingJob($request->user(), $jobId);
        } catch (ModelNotFoundException) {
            return response()->stream(function () {
                echo "data: " . json_encode(['status' => 'failed', 'error' => 'The requested matching job was not found.']) . "\n\n";
            }, 404, [
                'Content-Type' => 'text/event-stream',
            ]);
        }

        return response()->stream(function () use ($jobId) {
            @ini_set('max_execution_time', '0');
            @set_time_limit(0);

            // Clean existing output buffers
            while (ob_get_level() > 0) {
                ob_end_clean();
            }

            $lastProcessed = -1;
            $lastPercentage = -1;
            $lastStatus = '';
            $lastStage = '';
            $heartbeatCount = 0;

            while (true) {
                if (connection_aborted()) {
                    break;
                }

                $job = MatchingJob::find($jobId);
                if (! $job) {
                    echo "data: " . json_encode([
                        'processed' => 0,
                        'total' => 0,
                        'percentage' => 0,
                        'status' => 'failed',
                        'error' => 'Matching job was deleted or not found.',
                    ]) . "\n\n";
                    flush();
                    break;
                }

                $total = (int) $job->total_count;
                $processed = (int) $job->processed_count;
                $percent = $total > 0 ? round(($processed / $total) * 100, 2) : 0;
                $status = $job->status;
                $stage = (string) data_get($job->record_counts, 'current_stage', '');

                $shouldSend = ($processed !== $lastProcessed)
                    || ($percent !== $lastPercentage)
                    || ($status !== $lastStatus)
                    || ($stage !== $lastStage)
                    || ($heartbeatCount % 8 === 0);

                if ($shouldSend) {
                    $counts = $job->record_counts ?? [];
                    $payload = [
                        'processed' => $processed,
                        'total' => $total,
                        'percentage' => $percent,
                        'status' => $status,
                        'stage' => $stage,
                        'summary' => [
                            'matched' => (int) ($counts['matched'] ?? 0),
                            'possible_match' => (int) ($counts['possible_match'] ?? 0),
                            'unmatched' => (int) ($counts['unmatched'] ?? 0),
                            'candidates_scored' => (int) ($counts['candidates_scored'] ?? 0),
                            'total_raw_input' => (int) ($counts['total_raw_input'] ?? $total),
                            'total_unique_input' => (int) ($counts['total_unique_input'] ?? $total),
                            'total_duplicates' => (int) ($counts['total_duplicates'] ?? 0),
                        ],
                        'job' => [
                            'id' => $job->id,
                            'name' => $job->name,
                            'status' => $job->status,
                            'reference_dataset_id' => $job->reference_dataset_id,
                            'input_dataset_id' => $job->input_dataset_id,
                            'started_at' => optional($job->started_at)->toISOString(),
                            'finished_at' => optional($job->finished_at)->toISOString(),
                            'error_message' => $job->error_message,
                        ],
                        'checkpoint' => [
                            'is_resumed' => (bool) data_get($counts, 'is_resumed', false),
                            'resumed_at_record' => (int) data_get($counts, 'resumed_at_record', 0),
                        ],
                    ];

                    echo "data: " . json_encode($payload) . "\n\n";
                    if (ob_get_level() > 0) {
                        ob_flush();
                    }
                    flush();

                    $lastProcessed = $processed;
                    $lastPercentage = $percent;
                    $lastStatus = $status;
                    $lastStage = $stage;
                } else {
                    // Send lightweight SSE comment ping to actively detect disconnected/aborted clients
                    echo ": ping\n\n";
                    if (ob_get_level() > 0) {
                        ob_flush();
                    }
                    flush();
                }

                if (in_array($status, ['completed', 'failed', 'cancelled', 'stopped'], true)) {
                    break;
                }

                $heartbeatCount++;
                usleep(500000); // 500ms interval for balanced responsiveness and DB efficiency
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
