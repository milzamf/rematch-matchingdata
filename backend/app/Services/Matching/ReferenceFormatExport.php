<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use App\Models\User;
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Support\Facades\DB;

final class ReferenceFormatExport
{
    public function create(User $user, string $jobId): string
    {
        $versioned = (bool) (config('workspace_access.enabled') || config('review_transactions.enabled'));
        $authorize = function () use ($versioned, $user, $jobId) {
            if (! $versioned) { app(ResourceOwnership::class)->findMatchingJob($user, $jobId); return; }
            $access = new WorkspaceAccessService(DB::connection(), (bool) config('workspace_access.enabled'));
            $access->guard();
            $scope = $access->job((int) $user->getKey(), $jobId, 'export_read');
            (new SharedWorkspaceReader(DB::connection(), $access))->assertExport((int) $user->getKey(), $scope['workspace']->id, $jobId);
        };
        $authorize();
        $job = MatchingJob::findOrFail($jobId);
        $columns = $job->referenceDataset->columns()->pluck('name')->all();
        $inputColumns = $job->inputDataset->columns()->pluck('name')->all();
        $mappings = $job->mappings()->get();
        $scoreColumns = $mappings->map(fn ($m) => $m->input_column_name.' → '.$m->reference_column_name.' (%)')->all();
        if (! $columns) throw new \RuntimeException('Kolom dataset acuan tidak tersedia; ekspor dibatalkan.');
        $writer = new TabularWorkbook([
            ['name' => 'Data Acuan', 'columns' => $columns],
            ['name' => 'Audit Matching', 'columns' => ['Key Input', 'Status Efektif', 'Keputusan', 'Key Acuan', 'Versi Review', 'WLS (%)', ...array_map(fn ($c) => 'Input: '.$c, $inputColumns), ...$scoreColumns]],
        ]);
        $source = null;
        try {
            $last = null;
            do {
                $authorize();
                $q = $versioned ? DB::table('review_states')->where('matching_job_id', $jobId) : DB::table('matching_results')->where('matching_job_id', $jobId)->where('candidate_rank', 1);
                if ($last !== null) $q->where('id', '>', $last);
                $batch = $q->orderBy('id')->limit(250)->get();
                $keys = $batch->pluck('input_record_key')->all();
                $decisions = $versioned ? collect() : ReviewDecision::where('matching_job_id', $jobId)->whereIn('input_record_key', $keys)->whereNull('undone_at')->orderByDesc('created_at')->orderByDesc('id')->get()->unique('input_record_key')->keyBy('input_record_key');
                $selected = $versioned ? $batch->pluck('selected_matching_result_id')->filter()->all() : $decisions->pluck('matching_result_id')->filter()->all();
                $results = MatchingResult::where('matching_job_id', $jobId)->whereIn('input_record_key', $keys)->where(fn ($r) => $r->where('candidate_rank', 1)->orWhereIn('id', $selected))->get();
                $primary = $results->where('candidate_rank', 1)->keyBy('input_record_key'); $byId = $results->keyBy('id');
                foreach ($batch as $state) {
                    $last = $state->id;
                    $key = (string) $state->input_record_key;
                    $decision = $decisions->get($key);
                    $id = $versioned ? $state->selected_matching_result_id : $decision?->matching_result_id;
                    $candidate = $id ? $byId->get($id) : $primary->get($key);
                    if ($id && ! $candidate) throw new \RuntimeException('Kandidat pilihan tidak valid; ekspor dibatalkan.');
                    $status = $versioned ? $state->status : ($decision?->new_result_type ?? $state->result_type);
                    $meta = $candidate?->candidate_metadata ?? [];
                    $ref = $meta['reference_record'] ?? [];
                    if ($status === 'matched') {
                        if (! $candidate?->reference_record_key) throw new \RuntimeException('Pasangan matched tidak memiliki acuan.');
                        if (array_diff($columns, array_keys($ref))) {
                            $source ??= new OriginalReferenceRows($job->referenceDataset);
                            $ref = $source->get((string) $candidate->reference_record_key, $ref);
                        }
                        if (array_diff($columns, array_keys($ref))) throw new \RuntimeException('Baris acuan asli tidak lengkap; ekspor dibatalkan.');
                        $writer->row(0, array_map(fn ($c) => $ref[$c], $columns));
                    }
                    $scores = collect($candidate?->field_scores ?? []);
                    $writer->row(1, [$key, $status, $versioned ? $state->decision : $decision?->decision,
                        $status === 'matched' ? $candidate?->reference_record_key : null, $versioned ? (int) $state->version : null, $candidate?->overall_score,
                        ...array_map(fn ($c) => ($meta['input_record'] ?? [])[$c] ?? null, $inputColumns),
                        ...$mappings->map(fn ($m) => data_get($scores->first(fn ($f) => ($f['input_column'] ?? null) === $m->input_column_name && ($f['reference_column'] ?? null) === $m->reference_column_name), 'score'))->all()]);
                }
            } while ($batch->count() === 250);
            $authorize();
            return $writer->finish();
        } finally { unset($source, $writer); }
    }
}
