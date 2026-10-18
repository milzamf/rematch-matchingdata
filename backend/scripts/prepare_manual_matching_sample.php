<?php

/** Read-only extraction. Categories describe system evidence, never human truth labels. */
require __DIR__.'/../vendor/autoload.php';
use App\Models\MatchingResult;
use Illuminate\Support\Facades\DB;

$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$options = getopt('', ['list', 'job:']);
if (array_key_exists('list', $options)) {
    echo DB::table('matching_jobs')->where('status', 'completed')->orderByDesc('updated_at')->limit(7)->get(['id', 'name', 'review_state_readiness'])->toJson(JSON_PRETTY_PRINT); exit;
}
$job = $options['job'] ?? '';
if (! preg_match('/^[0-9a-f-]{36}$/iD', $job)) throw new RuntimeException('Explicit job UUID required.');
DB::statement('SET TRANSACTION READ ONLY');
DB::beginTransaction();
try {
    $metadata = DB::table('matching_jobs')->where('id', $job)->first(['id', 'name', 'review_state_readiness']);
    if (! $metadata || $metadata->review_state_readiness !== 'ready') throw new RuntimeException('Ready job required.');
    $output = []; $seen = [];
    $name = function (array $row): string {
        foreach ($row as $column => $value) if (preg_match('/^(?:nama_perusahaan|nama_usaha|company_name|name|nama)$/i', $column) && $value !== null) return (string) $value;
        foreach ($row as $column => $value) if (preg_match('/nama.*(?:perusahaan|usaha)|company.*name/i', $column) && !str_starts_with($column, '[Generated]') && $value !== null) return (string) $value;
        return '';
    };
    $buckets = ['Exact menurut sistem' => 12, 'Fuzzy match' => 14, 'Perlu cek salah cocok' => 12, 'Konflik referensi' => 12];
    foreach ($buckets as $category => $limit) {
        $q = DB::table('matching_results')->where('matching_job_id', $job)->where('candidate_rank', 1);
        if ($category === 'Exact menurut sistem') $q->where('overall_score', 100);
        elseif ($category === 'Fuzzy match') $q->whereBetween('overall_score', [85, 99.99]);
        elseif ($category === 'Perlu cek salah cocok') $q->whereBetween('overall_score', [70, 99.99])->where('result_type', 'possible_match');
        else {
            $q->whereIn('input_record_key', DB::table('review_states')->where('matching_job_id', $job)->where(fn ($s) => $s->where('status', 'reference_conflict')->orWhere('integrity_status', 'held'))->select('input_record_key'));
        }
        $primary = $q->orderBy('input_record_key')->limit(160)->get(['id', 'input_record_key']);
        $states = DB::table('review_states')->where('matching_job_id', $job)->whereIn('input_record_key', $primary->pluck('input_record_key')->all())->get()->keyBy('input_record_key');
        $ids = $primary->pluck('id')->merge($states->pluck('selected_matching_result_id')->filter())->all();
        $candidates = MatchingResult::where('matching_job_id', $job)->whereIn('id', $ids)->get()->keyBy('id');
        $count = 0;
        foreach ($primary as $row) {
            $s = $states->get($row->input_record_key);
            $r = $candidates->get($s?->selected_matching_result_id ?: $row->id);
            if (! $r || ! $r->reference_record_key) continue;
            $identity = 'key:'.$row->input_record_key.'|'.$r->reference_record_key;
            if (isset($seen[$identity])) continue;
            $evidence = $r->verification_evidence ?? [];
            if ($category === 'Exact menurut sistem' && !($evidence['is_exact_match'] ?? false)) continue;
            $fields = $r->field_scores ?? [];
            if ($category === 'Perlu cek salah cocok' && !collect($fields)->contains(fn ($f) => isset($f['score']) && $f['score'] < 80) && !($evidence['downgraded'] ?? false)) continue;
            $meta = $r->candidate_metadata ?? [];
            $output[] = ['category' => $category, 'input_key' => (string) $row->input_record_key, 'reference_key' => (string) $r->reference_record_key,
                'input_name' => $name($meta['input_record'] ?? []), 'reference_name' => $name($meta['reference_record'] ?? []),
                'similarity' => $r->overall_score, 'system_status' => $s?->status, 'system_decision' => $s?->decision,
                'reason' => $r->decision_reason, 'reviewer_label' => null];
            $seen[$identity] = true;
            if (++$count >= $limit) break;
        }
    }
    echo json_encode(['job' => (array) $metadata, 'selection' => 'Purposive diagnostic sample; not a random estimate of accuracy. System categories are not truth labels.', 'rows' => array_slice($output, 0, 50)], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} finally { DB::rollBack(); }
