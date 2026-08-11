<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MatchingConfiguration extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'preset',
        'strategy',
        'thresholds',
        'normalization',
        'search_optimization',
        'candidate_generation',
        'output_config',
        'advanced_settings',
        'config_hash',
    ];

    protected function casts(): array
    {
        return [
            'thresholds' => 'array',
            'normalization' => 'array',
            'search_optimization' => 'array',
            'candidate_generation' => 'array',
            'output_config' => 'array',
            'advanced_settings' => 'array',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }
}
