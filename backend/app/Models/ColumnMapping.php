<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ColumnMapping extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'reference_column_id',
        'input_column_id',
        'reference_column_name',
        'input_column_name',
        'algorithm',
        'weight',
        'required_match',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'weight' => 'float',
            'required_match' => 'boolean',
            'metadata' => 'array',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }
}
