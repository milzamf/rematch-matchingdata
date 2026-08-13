<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
    ];

    protected function casts(): array
    {
        return [
            'overall_score' => 'float',
            'candidate_rank' => 'integer',
            'field_scores' => 'array',
            'candidate_metadata' => 'array',
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
}
