<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MatchingResult extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'input_record_key',
        'reference_record_key',
        'result_type',
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
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }
}
