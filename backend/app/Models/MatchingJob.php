<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class MatchingJob extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'workspace_id',
        'reference_dataset_id',
        'input_dataset_id',
        'name',
        'status',
        'processed_count',
        'total_count',
        'record_counts',
        'error_message',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'processed_count' => 'integer',
            'total_count' => 'integer',
            'record_counts' => 'array',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function referenceDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'reference_dataset_id');
    }
    public function inputDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'input_dataset_id');
    }

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function mappings(): HasMany
    {
        return $this->hasMany(ColumnMapping::class);
    }

    public function configuration(): HasOne
    {
        return $this->hasOne(MatchingConfiguration::class);
    }

    public function results(): HasMany
    {
        return $this->hasMany(MatchingResult::class);
    }

    public function reviewDecisions(): HasMany
    {
        return $this->hasMany(ReviewDecision::class);
    }

    /**
     * Compute distinct summary statistics where 1 input row = 1 outcome.
     *
     * @return array<string, int>
     */
    public function calculateDistinctRecordCounts(): array
    {
        $results = $this->results()
            ->select('input_record_key', 'result_type')
            ->get()
            ->groupBy('input_record_key');

        $matched = 0;
        $possibleMatch = 0;
        $unmatched = 0;

        foreach ($results as $group) {
            if ($group->contains('result_type', 'matched')) {
                $matched++;
            } elseif ($group->contains('result_type', 'possible_match')) {
                $possibleMatch++;
            } else {
                $unmatched++;
            }
        }

        return [
            'matched' => $matched,
            'possible_match' => $possibleMatch,
            'unmatched' => $unmatched,
            'candidates_scored' => $this->results()->count(),
        ];
    }
}
