<?php

namespace App\Services\Datasets;

use App\Models\Dataset;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

class DatasetInspectionService
{
    public function __construct(
        private readonly DatasetParserFactory $parserFactory,
        private readonly DatasetProfiler $profiler,
    ) {
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function inspect(UploadedFile $file, array $input): array
    {
        $parser = $this->parserFactory->make($file);
        $parsed = $parser->parse($file, [
            'sheet_name' => $input['sheet_name'] ?? null,
            'delimiter' => $input['delimiter'] ?? null,
            'header_row' => $input['header_row'] ?? 1,
        ]);
        $columns = $this->profiler->profile($parsed);
        $path = $file->store('datasets');

        return DB::transaction(function () use ($file, $input, $parsed, $columns, $path) {
            $dataset = Dataset::create([
                'dataset_role' => $input['dataset_role'],
                'name' => pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME),
                'original_filename' => $file->getClientOriginalName(),
                'file_format' => strtolower($file->getClientOriginalExtension()),
                'mime_type' => $file->getClientMimeType(),
                'file_size' => $file->getSize(),
                'storage_path' => $path,
                'selected_sheet' => $parsed->selectedSheet,
                'delimiter' => $parsed->delimiter,
                'header_row' => (int) ($input['header_row'] ?? 1),
                'row_count' => count($parsed->rows),
                'column_count' => count($parsed->headers),
                'parse_status' => 'inspected',
                'sheet_names' => $parsed->sheetNames,
                'preview_rows' => array_slice($parsed->rows, 0, 100),
                'profiling_summary' => [
                    'columns' => count($parsed->headers),
                    'rows' => count($parsed->rows),
                    'high_missing_columns' => collect($columns)->where('null_percentage', '>=', 30)->pluck('name')->values()->all(),
                    'duplicate_prone_columns' => collect($columns)->where('duplicate_percentage', '>=', 30)->pluck('name')->values()->all(),
                ],
            ]);

            foreach ($columns as $column) {
                $dataset->columns()->create($column);
            }

            $dataset->load('columns');

            return [
                'dataset' => [
                    'id' => $dataset->id,
                    'dataset_role' => $dataset->dataset_role,
                    'name' => $dataset->name,
                    'original_filename' => $dataset->original_filename,
                    'file_format' => $dataset->file_format,
                    'file_size' => $dataset->file_size,
                    'selected_sheet' => $dataset->selected_sheet,
                    'sheet_names' => $dataset->sheet_names,
                    'delimiter' => $dataset->delimiter,
                    'header_row' => $dataset->header_row,
                    'row_count' => $dataset->row_count,
                    'column_count' => $dataset->column_count,
                    'parse_status' => $dataset->parse_status,
                ],
                'columns' => $dataset->columns->map(fn ($column) => [
                    'id' => $column->id,
                    'name' => $column->name,
                    'normalized_name' => $column->normalized_name,
                    'data_type' => $column->data_type,
                    'position' => $column->position,
                    'null_count' => $column->null_count,
                    'null_percentage' => $column->null_percentage,
                    'unique_count' => $column->unique_count,
                    'duplicate_percentage' => $column->duplicate_percentage,
                    'sample_values' => $column->sample_values,
                ])->values()->all(),
                'preview_rows' => $dataset->preview_rows,
                'profiling_summary' => $dataset->profiling_summary,
            ];
        });
    }
}
