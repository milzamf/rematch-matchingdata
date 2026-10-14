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
