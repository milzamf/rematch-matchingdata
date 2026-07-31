<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DatasetColumn extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'dataset_id',
        'name',
        'normalized_name',
        'data_type',
        'position',
        'null_count',
        'null_percentage',
        'unique_count',
        'duplicate_percentage',
        'sample_values',
    ];

    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'null_count' => 'integer',
            'null_percentage' => 'float',
            'unique_count' => 'integer',
            'duplicate_percentage' => 'float',
            'sample_values' => 'array',
        ];
    }

    public function dataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class);
    }
}
