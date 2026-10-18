<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Services\Matching\MatchingPayloadCodec;

class MatchingResult extends Model
{
    private static array $inputSnapshots = [];
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'input_record_key',
        'reference_record_key',
        'result_type',
        'review_status',
        'review_decision',
        'reviewed_at',
        'overall_score',
        'candidate_rank',
        'field_scores',
        'candidate_metadata',
        'decision_reason',
        'verification_evidence',
        'input_province_code',
        'input_regency_code',
        'input_region_indexed',
    ];

    protected function casts(): array
    {
        return [
            'overall_score' => 'float',
            'candidate_rank' => 'integer',
            'field_scores' => 'array',
            'candidate_metadata' => 'array',
            'verification_evidence' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }

    public function reviewDecisions(): HasMany
    {
        return $this->hasMany(ReviewDecision::class, 'matching_result_id');
    }

    public function getCandidateMetadataAttribute(mixed $value): ?array
    {
        if ($value === null) return null;
        $metadata = is_array($value) ? $value : json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        if (isset($metadata['_reference_snapshot'])) {
            $metadata['reference_record'] = \App\Services\Matching\MatchingRecordSnapshots::load($metadata['_reference_snapshot']);
        }
        if (isset($metadata['_input_primary'])) {
            if ((string) $metadata['_input_primary'] !== (string) $this->input_record_key) throw new \RuntimeException('Input snapshot identity mismatch.');
            $key = $this->matching_job_id.':key:'.$metadata['_input_primary'];
            if (! isset(self::$inputSnapshots[$key])) {
                $query = self::where('matching_job_id', $this->matching_job_id)->where('input_record_key', (string) $metadata['_input_primary'])->where('candidate_rank', 1);
                if ($this->getConnection()->getDriverName() === 'mysql') $query->whereRaw('BINARY input_record_key = BINARY ?', [(string) $metadata['_input_primary']]);
                $primary = $query->first(['matching_job_id', 'input_record_key', 'candidate_metadata']);
                if (! $primary) throw new \RuntimeException('Immutable input snapshot is unavailable.');
                if (count(self::$inputSnapshots) >= 128) array_shift(self::$inputSnapshots);
                self::$inputSnapshots[$key] = $primary->candidate_metadata['input_record'] ?? [];
            }
            $metadata['input_record'] = self::$inputSnapshots[$key];
        } elseif (isset($metadata['input_record']) && $this->matching_job_id !== null) {
            if (count(self::$inputSnapshots) >= 128) array_shift(self::$inputSnapshots);
            self::$inputSnapshots[$this->matching_job_id.':key:'.$this->input_record_key] = $metadata['input_record'];
        }
        return $metadata;
    }

    /** Read historical JSON columns and lossless evidence stored with new metadata. */
    public function getVerificationEvidenceAttribute(mixed $value): ?array
    {
        if ($value !== null) return is_array($value) ? $value : MatchingPayloadCodec::decode($value);
        $packed = ($this->candidate_metadata ?? [])['_verification_evidence'] ?? null;
        return is_string($packed) ? MatchingPayloadCodec::decode($packed) : null;
    }

    public function getFieldScoresAttribute(mixed $value): ?array
    {
        $packed = ($this->candidate_metadata ?? [])['_field_scores'] ?? null;
        if (is_string($packed)) return MatchingPayloadCodec::decode($packed);
        return $value === null ? null : (is_array($value) ? $value : MatchingPayloadCodec::decode($value));
    }
}
