<?php

namespace App\Services\Datasets;

use App\Models\Dataset;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use SplFileObject;
use Throwable;

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
    public function inspect(User $user, UploadedFile $file, array $input): array
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

    /**
     * Get paginated dataset rows streamed from physical file on disk (or preview fallback).
     *
     * @return array{data: array<int, array<string, mixed>>, total: int, current_page: int, per_page: int, last_page: int}
     */
    public function getPaginatedRows(Dataset $dataset, int $page = 1, int $perPage = 50, ?string $search = null): array
    {
        $storagePath = $dataset->storage_path;
        $filePath = null;

        if (! empty($storagePath)) {
            $candidates = [
                Storage::disk('local')->path($storagePath),
                storage_path('app/' . $storagePath),
                storage_path('app/private/' . $storagePath),
                $storagePath,
            ];

            foreach ($candidates as $candidate) {
                if (is_string($candidate) && $candidate !== '' && file_exists($candidate) && is_readable($candidate)) {
                    $filePath = $candidate;
                    break;
                }
            }
        }

        $format = strtolower((string) ($dataset->file_format ?: ($filePath ? pathinfo($filePath, PATHINFO_EXTENSION) : '')));
        $searchLower = is_string($search) && trim($search) !== '' ? mb_strtolower(trim($search)) : null;

        if ($filePath !== null) {
            try {
                if ($format === 'csv') {
                    $delimiter = $dataset->delimiter ?? ',';
                    $headerRow = max(1, (int) ($dataset->header_row ?? 1));

                    $csv = new SplFileObject($filePath);
                    $csv->setFlags(SplFileObject::READ_CSV | SplFileObject::SKIP_EMPTY);
                    $csv->setCsvControl($delimiter);

                    $headers = [];
                    $pageRows = [];
                    $matchingCount = 0;
                    $start = ($page - 1) * $perPage;
                    $end = $start + $perPage;
                    $lineNumber = 0;

                    foreach ($csv as $record) {
                        if ($record === [null] || $record === false) {
                            continue;
                        }
                        $lineNumber++;
                        $record = array_map(fn ($value) => is_string($value) ? trim($value) : $value, $record);

                        if ($lineNumber < $headerRow) {
                            continue;
                        }
                        if ($lineNumber === $headerRow) {
                            $headers = array_map(fn ($h) => trim((string) $h), $record);
                            continue;
                        }

                        $row = [];
                        $matchesSearch = $searchLower === null;

                        foreach ($headers as $idx => $h) {
                            $val = $record[$idx] ?? null;
                            $row[$h] = $val === '' ? null : $val;

                            if ($searchLower !== null && ! $matchesSearch && $val !== null && $val !== '') {
                                if (str_contains(mb_strtolower((string) $val), $searchLower)) {
                                    $matchesSearch = true;
                                }
                            }
                        }

                        if (! $matchesSearch) {
                            continue;
                        }

                        if ($matchingCount >= $start && $matchingCount < $end) {
                            $pageRows[] = $row;
                        }
                        $matchingCount++;
                    }

                    $total = $matchingCount;

                    return [
                        'data' => $pageRows,
                        'total' => $total,
                        'current_page' => $page,
                        'per_page' => $perPage,
                        'last_page' => max(1, (int) ceil($total / $perPage)),
                    ];
                }

                if ($format === 'xlsx' || $format === 'xls') {
                    $parser = new XlsxDatasetParser();
                    $uploaded = new UploadedFile(
                        $filePath,
                        $dataset->original_filename ?: basename($filePath),
                        $dataset->mime_type ?: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        null,
                        true
                    );

                    $parsed = $parser->parse($uploaded, [
                        'sheet_name' => $dataset->selected_sheet,
                        'header_row' => (int) ($dataset->header_row ?? 1),
                    ]);

                    $allRows = $parsed->rows;
                    if ($searchLower !== null) {
                        $allRows = array_values(array_filter($allRows, function ($row) use ($searchLower) {
                            foreach ($row as $val) {
                                if ($val !== null && $val !== '' && str_contains(mb_strtolower((string) $val), $searchLower)) {
                                    return true;
                                }
                            }
                            return false;
                        }));
                    }

                    $total = count($allRows);
                    $pageRows = array_slice($allRows, ($page - 1) * $perPage, $perPage);

                    return [
                        'data' => $pageRows,
                        'total' => $total,
                        'current_page' => $page,
                        'per_page' => $perPage,
                        'last_page' => max(1, (int) ceil($total / $perPage)),
                    ];
                }
            } catch (Throwable $e) {
                Log::warning("Failed to stream paginated dataset [{$filePath}]: " . $e->getMessage());
            }
        }

        // Fallback for in-memory / fixture datasets
        $allRows = $dataset->preview_rows ?? [];
        if ($searchLower !== null) {
            $allRows = array_values(array_filter($allRows, function ($row) use ($searchLower) {
                foreach ($row as $val) {
                    if ($val !== null && $val !== '' && str_contains(mb_strtolower((string) $val), $searchLower)) {
                        return true;
                    }
                }
                return false;
            }));
        }

        $total = $dataset->row_count > 0 && $searchLower === null ? (int) $dataset->row_count : count($allRows);
        $pageRows = array_slice($allRows, ($page - 1) * $perPage, $perPage);

        return [
            'data' => $pageRows,
            'total' => $total,
            'current_page' => $page,
            'per_page' => $perPage,
            'last_page' => max(1, (int) ceil($total / $perPage)),
        ];
    }
}
