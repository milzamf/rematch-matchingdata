<?php

namespace App\Services\Datasets;

use App\Exceptions\UnsupportedDatasetFormatException;
use Illuminate\Http\UploadedFile;

class DatasetParserFactory
{
    public function make(UploadedFile $file): DatasetParserInterface
    {
        return match (strtolower($file->getClientOriginalExtension())) {
            'csv', 'tsv', 'txt' => new CsvDatasetParser(),
            'xlsx', 'xls' => new XlsxDatasetParser(),
            default => throw new UnsupportedDatasetFormatException('Only CSV, TSV, and XLSX files are supported for inspection in this milestone.'),
        };
    }
}
