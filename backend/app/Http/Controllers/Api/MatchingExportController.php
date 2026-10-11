<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MatchingExportController extends Controller
{
    public function __construct(private readonly ResourceOwnership $ownership)
    {
    }

    public function __invoke(Request $request, string $job): StreamedResponse
    {
        $user = $request->user();
        $matchingJob = $this->ownership->findMatchingJob($user, $job);

        $preset = $request->query('preset', 'master_update');
        $autoEnrich = filter_var($request->query('auto_enrich', true), FILTER_VALIDATE_BOOLEAN);
        $sheet = strtolower(trim((string) $request->query('sheet', '')));

        // Export the latest accepted candidate, including a manually selected
        // rank 2/3 candidate, and use the same effective status as Review.
        $effectiveType = \Illuminate\Support\Facades\DB::raw('COALESCE(active_decision.new_result_type, matching_results.result_type)');
        $query = MatchingResult::query()
            ->leftJoin('review_decisions as active_decision', function ($join) {
                $join->on('active_decision.matching_job_id', '=', 'matching_results.matching_job_id')
                    ->on('active_decision.input_record_key', '=', 'matching_results.input_record_key')
                    ->whereNull('active_decision.undone_at')
                    ->whereRaw('active_decision.id = (SELECT rd.id FROM review_decisions rd WHERE rd.matching_job_id = matching_results.matching_job_id AND rd.input_record_key = matching_results.input_record_key AND rd.undone_at IS NULL ORDER BY rd.created_at DESC, rd.id DESC LIMIT 1)');
            })
            ->select('matching_results.*')
            ->selectRaw('COALESCE(active_decision.new_result_type, matching_results.result_type) AS result_type')
            ->where('matching_results.matching_job_id', $matchingJob->id)
            ->where(function ($q) {
                $q->whereColumn('matching_results.id', 'active_decision.matching_result_id')
                    ->orWhere(fn ($base) => $base->whereNull('active_decision.matching_result_id')->where('candidate_rank', 1));
            })
            ->orderBy('matching_results.id');

        // Apply filters based on preset and optional sheet tab
        if ($preset === 'master_update') {
            if ($sheet === 'matched') {
                $query->where($effectiveType, 'matched');
            } elseif ($sheet === 'unmatched' || $sheet === 'new' || $sheet === 'new_entity') {
                $query->where($effectiveType, 'unmatched');
            } else {
                $query->whereIn($effectiveType, ['matched', 'unmatched']);
            }
        } elseif ($preset === 'pending_review') {
            $query->where($effectiveType, 'possible_match');
        } elseif ($preset === 'full_audit') {
            if ($sheet === 'matched') {
                $query->where($effectiveType, 'matched');
            } elseif ($sheet === 'unmatched') {
                $query->where($effectiveType, 'unmatched');
            } elseif ($sheet === 'need_review' || $sheet === 'pending') {
                $query->where($effectiveType, 'possible_match');
            } elseif ($sheet === 'rejected') {
                $query->where('review_status', 'reviewed')
                    ->where('review_decision', 'reject_match');
            }
        }

        // Determine column list
        $inputCols = $matchingJob->inputDataset?->columns()->pluck('name')->all() ?? [];
        $refCols = $matchingJob->referenceDataset?->columns()->pluck('name')->all() ?? [];

        if (empty($inputCols) && !empty($matchingJob->inputDataset?->preview_rows)) {
            $inputCols = array_keys((array) ($matchingJob->inputDataset->preview_rows[0] ?? []));
        }
        if (empty($refCols) && !empty($matchingJob->referenceDataset?->preview_rows)) {
            $refCols = array_keys((array) ($matchingJob->referenceDataset->preview_rows[0] ?? []));
        }

        // Fallback: inspect MatchingResult candidate_metadata
        if (empty($inputCols)) {
            $sampleInput = MatchingResult::where('matching_job_id', $matchingJob->id)
                ->where('candidate_rank', 1)
                ->first();
            if ($sampleInput) {
                $inputCols = array_keys((array) data_get($sampleInput->candidate_metadata, 'input_record', []));
            }
        }

        if (empty($refCols)) {
            $sampleRef = MatchingResult::where('matching_job_id', $matchingJob->id)
                ->where('candidate_rank', 1)
                ->whereNotNull('reference_record_key')
                ->first();
            if ($sampleRef) {
                $refCols = array_keys((array) data_get($sampleRef->candidate_metadata, 'reference_record', []));
            }
        }

        if ($preset === 'master_update') {
            $headers = ['input_record_key', 'match_status', 'reference_record_key'];
            foreach ($inputCols as $c) {
                $headers[] = "input.{$c}";
            }
            if ($autoEnrich) {
                foreach ($refCols as $c) {
                    $headers[] = "enriched.{$c}";
                }
            }
        } else {
            // full_audit or pending_review
            $pairedFields = array_values(array_unique(array_merge($inputCols, $refCols)));
            $headers = ['input_record_key', 'match_status', 'matching_score', 'reference_record_key'];
            foreach ($pairedFields as $field) {
                $headers[] = "input.{$field}";
                $headers[] = "ref.{$field}";
                if ($autoEnrich) {
                    $headers[] = "enriched.{$field}";
                }
            }
            $headers[] = 'review_decision';
            $headers[] = 'review_reason';
        }

        if ($autoEnrich) $headers[] = 'enrichment_changes';

        $baseName = Str::slug($matchingJob->name ?: 'matching-results');
        $presetSuffix = match ($preset) {
            'master_update' => 'master-update',
            'full_audit' => 'full-audit',
            default => 'pending-review',
        };
        $sheetSuffix = $sheet ? "-{$sheet}" : '';
        $dateStr = now()->format('Y-m-d');
        $filename = "batchmatch-{$baseName}-{$presetSuffix}{$sheetSuffix}-{$dateStr}.csv";

        return new StreamedResponse(function () use ($query, $preset, $autoEnrich, $inputCols, $refCols, $headers) {
            if (function_exists('set_time_limit')) {
                @set_time_limit(0);
            }

            $out = fopen('php://output', 'wb');
            // Write UTF-8 BOM for Microsoft Excel compatibility
            fputs($out, "\xEF\xBB\xBF");
            // Write header
            fputcsv($out, $headers);

            $pairedFields = ($preset !== 'master_update')
                ? array_values(array_unique(array_merge($inputCols, $refCols)))
                : [];

            foreach ($query->lazy(1500) as $record) {
                $meta = (array) ($record->candidate_metadata ?? []);
                $inp = (array) ($meta['input_record'] ?? []);
                $ref = (array) ($meta['reference_record'] ?? []);
                $status = $record->result_type;
                $isMatched = $status === 'matched';
                $enrichment = $autoEnrich && $isMatched
                    ? app(\App\Services\Matching\AddressComparator::class)->enrich($ref, $inp, $record->field_scores ?? [])
                    : ['values' => $ref, 'changes' => []];
                $enrichedReference = $enrichment['values'];

                if ($preset === 'master_update') {
                    $row = [
                        $record->input_record_key,
                        $isMatched ? 'MATCHED' : 'NEW_ENTITY',
                        $isMatched ? $record->reference_record_key : null,
                    ];
                    foreach ($inputCols as $c) {
                        $row[] = $inp[$c] ?? null;
                    }
                    if ($autoEnrich) {
                        foreach ($refCols as $c) {
                            if ($isMatched) {
                                $row[] = $enrichedReference[$c] ?? null;
                            } else {
                                $row[] = null;
                            }
                        }
                    }
                    if ($autoEnrich) $row[] = json_encode($enrichment['changes'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    fputcsv($out, $row);
                } else {
                    $matchStatus = match ($status) {
                        'matched' => 'MATCHED',
                        'possible_match' => 'NEED_REVIEW',
                        'unmatched' => 'UNMATCHED',
                        default => strtoupper((string) $status),
                    };
                    if ($record->review_decision === 'reject_match') {
                        $matchStatus = 'REJECTED';
                    }

                    $row = [
                        $record->input_record_key,
                        $matchStatus,
                        $status === 'unmatched' ? 0 : $record->overall_score,
                        $record->reference_record_key,
                    ];

                    foreach ($pairedFields as $field) {
                        $inpVal = $inp[$field] ?? null;
                        $refVal = $ref[$field] ?? null;
                        $row[] = $inpVal;
                        $row[] = $refVal;
                        if ($autoEnrich) {
                            if ($isMatched) {
                                $row[] = $enrichedReference[$field] ?? $refVal;
                            } else {
                                $row[] = null;
                            }
                        }
                    }

                    $row[] = $record->review_decision;
                    $row[] = $record->decision_reason;

                    if ($autoEnrich) $row[] = json_encode($enrichment['changes'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    fputcsv($out, $row);
                }
            }

            fclose($out);
        }, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
            'Expires' => '0',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
