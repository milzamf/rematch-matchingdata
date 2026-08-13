<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Dataset extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'workspace_id',
        'dataset_role',
        'name',
        'original_filename',
        'file_format',
        'mime_type',
        'file_size',
        'storage_path',
        'selected_sheet',
        'delimiter',
        'header_row',
        'row_count',
        'column_count',
        'parse_status',
        'sheet_names',
        'preview_rows',
        'profiling_summary',
    ];

    protected function casts(): array
    {
        return [
            'file_size' => 'integer',
            'header_row' => 'integer',
            'row_count' => 'integer',
            'column_count' => 'integer',
            'sheet_names' => 'array',
            'preview_rows' => 'array',
            'profiling_summary' => 'array',
        ];
    }

    public function columns(): HasMany
    {
        return $this->hasMany(DatasetColumn::class)->orderBy('position');
    }

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }
}
