<?php

namespace Tests\Unit;

use App\Models\MatchingResult;
use App\Services\Matching\MatchingPayloadCodec;
use App\Services\Matching\MatchingResultStorage;
use Tests\TestCase;

class MatchingPayloadCodecTest extends TestCase
{
    public function test_compression_is_lossless_and_reads_legacy_json(): void
    {
        $payload = ['rules' => array_fill(0, 100, ['passed' => false, 'score' => 91.95, 'exact' => 100.0, 'zero' => 0.0, 'message' => 'Alamat berbeda — nomor 14A', 'value' => null])];
        $raw = json_encode($payload, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        $encoded = MatchingPayloadCodec::encode($payload);
        $this->assertLessThan(strlen($raw), strlen($encoded));
        $this->assertSame($payload, MatchingPayloadCodec::decode($encoded));
        $this->assertSame($payload, MatchingPayloadCodec::decode($raw));
        $this->assertSame([], MatchingPayloadCodec::decode(MatchingPayloadCodec::encode([])));
    }

    public function test_review_evidence_has_identical_api_shape_for_old_and_compact_results(): void
    {
        $evidence = ['weighted_similarity' => 98.0, 'rules_evaluated' => [['passed' => true]]];
        $legacy = new MatchingResult(['verification_evidence' => $evidence]);
        $compact = new MatchingResult(['candidate_metadata' => ['input_record' => ['name' => 'A'], '_verification_evidence' => MatchingPayloadCodec::encode($legacy->verification_evidence)]]);
        $compact->setRawAttributes([...$compact->getAttributes(), 'verification_evidence' => null]);
        $this->assertSame($legacy->verification_evidence, $compact->verification_evidence);
        $this->assertSame($legacy->toArray()['verification_evidence'], $compact->toArray()['verification_evidence']);
        $this->assertNull((new MatchingResult())->verification_evidence);
    }

    public function test_corrupted_compressed_payload_is_rejected(): void
    {
        $this->expectException(\RuntimeException::class);
        MatchingPayloadCodec::decode('gz1:invalid!');
    }

    public function test_hydration_budget_rejects_a_small_compressed_but_large_decoded_payload(): void
    {
        $payload = MatchingPayloadCodec::encode(['data' => str_repeat('original ', 1000)]);
        $this->expectExceptionMessage('hydration budget');
        MatchingPayloadCodec::decode($payload, 128);
    }

    public function test_compact_scores_preserve_explanation_and_sql_quality_projection(): void
    {
        $fields = array_fill(0, 5, ['reference_column' => 'alamat', 'input_column' => 'address', 'score' => 92,
            'algorithm' => 'Levenshtein', 'weight' => 25, 'identity_conflict' => false,
            'address_evidence' => ['compatible' => true, 'richer_side' => 'input']]);
        $meta = ['input_record' => ['address' => 'JL A NO 14A'], 'reference_record' => ['alamat' => 'JALAN A NO 14A']];
        $packed = MatchingResultStorage::pack($meta, $fields, ['summary' => ['all_passed' => true]]);
        $model = (new MatchingResult())->setRawAttributes($packed);
        $this->assertSame($fields, $model->field_scores);
        $this->assertSame($meta['input_record'], $model->candidate_metadata['input_record']);
        $this->assertSame(array_fill(0, 5, ['reference_column' => 'alamat', 'input_column' => 'address', 'score' => 92]), json_decode($packed['field_scores'], true));
        $this->assertSame($fields, $model->toArray()['field_scores']);
        // Aggregates intentionally select only the score projection without metadata.
        $projection = (new MatchingResult())->setRawAttributes(['field_scores' => $packed['field_scores']]);
        $this->assertSame(92, $projection->field_scores[0]['score']);
    }
}
