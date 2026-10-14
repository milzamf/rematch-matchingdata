<?php

// Read-only sample benchmark; never changes jobs, results, or decisions.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$rows = Illuminate\Support\Facades\DB::table('matching_results')
    ->orderByDesc('id')->limit(1000)->get(['field_scores', 'candidate_metadata', 'verification_evidence']);
$before = $after = $rawEvidence = $packedEvidence = $fullBefore = $fullAfter = 0;
$start = hrtime(true);
$checkpoint = [];
foreach ($rows as $row) {
    $original = (new App\Models\MatchingResult())->setRawAttributes((array) $row);
    $storage = App\Services\Matching\MatchingResultStorage::pack($original->candidate_metadata ?? [], $original->field_scores ?? [], $original->verification_evidence);
    $fullBefore += strlen($row->field_scores ?? '') + strlen($row->candidate_metadata ?? '') + strlen($row->verification_evidence ?? '');
    $fullAfter += strlen($storage['field_scores']) + strlen($storage['candidate_metadata']);
    $meta = json_decode($row->candidate_metadata ?? '{}', true, 512, JSON_THROW_ON_ERROR);
    $evidence = $row->verification_evidence === null ? null : json_decode($row->verification_evidence, true, 512, JSON_THROW_ON_ERROR);
    $before += strlen($row->candidate_metadata ?? '') + strlen($row->verification_evidence ?? '');
    if ($evidence !== null) {
        $encoded = App\Services\Matching\MatchingPayloadCodec::encode($evidence);
        if (App\Services\Matching\MatchingPayloadCodec::decode($encoded) !== $evidence) throw new RuntimeException('Evidence round trip failed');
        $meta['_verification_evidence'] = $encoded;
        $rawEvidence += strlen($row->verification_evidence);
        $packedEvidence += strlen($encoded);
    }
    $after += strlen(json_encode($meta, JSON_THROW_ON_ERROR));
    $checkpoint[] = (array) $row;
}
$evidenceMs = (hrtime(true) - $start) / 1e6;
$rawCheckpoint = json_encode($checkpoint, JSON_THROW_ON_ERROR);
$start = hrtime(true);
$packedCheckpoint = App\Services\Matching\MatchingPayloadCodec::encode($checkpoint);
$encodeMs = (hrtime(true) - $start) / 1e6;
$start = hrtime(true);
if (App\Services\Matching\MatchingPayloadCodec::decode($packedCheckpoint) !== $checkpoint) throw new RuntimeException('Checkpoint round trip failed');
$decodeMs = (hrtime(true) - $start) / 1e6;
echo json_encode([
    'sample_results' => count($rows), 'metadata_and_evidence_before_bytes' => $before,
    'all_result_payload_before_bytes' => $fullBefore, 'all_result_payload_after_bytes' => $fullAfter,
    'metadata_and_evidence_after_bytes' => $after, 'raw_evidence_bytes' => $rawEvidence,
    'packed_evidence_bytes' => $packedEvidence, 'encode_and_verify_evidence_ms' => round($evidenceMs, 2),
    'checkpoint_before_bytes' => strlen($rawCheckpoint), 'checkpoint_after_bytes' => strlen($packedCheckpoint),
    'checkpoint_encode_ms' => round($encodeMs, 2), 'checkpoint_decode_ms' => round($decodeMs, 2),
    'peak_php_bytes' => memory_get_peak_usage(true),
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
