<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewDecision extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'matching_result_id',
        'reviewer_user_id',
        'input_record_key',
        'selected_reference_record_key',
        'decision',
        'previous_result_type',
        'new_result_type',
        'metadata',
        'undone_at',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'undone_at' => 'datetime',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }

    public function result(): BelongsTo
    {
        return $this->belongsTo(MatchingResult::class, 'matching_result_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_user_id');
    }
}
