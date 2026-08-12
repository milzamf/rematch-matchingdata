<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Workspace extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'user_id',
        'name',
        'status',
        'current_step',
        'reference_dataset_id',
        'input_dataset_id',
        'matching_job_id',
        'workflow_state',
        'sync_state',
        'export_history',
    ];

    protected function casts(): array
    {
        return [
            'current_step' => 'integer',
            'workflow_state' => 'array',
            'sync_state' => 'array',
            'export_history' => 'array',
        ];
    }

    public function referenceDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'reference_dataset_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function inputDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'input_dataset_id');
    }

    public function matchingJob(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }
}
