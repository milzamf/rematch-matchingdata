<?php

namespace App\Services\Datasets;

use App\Exceptions\UnsupportedDatasetFormatException;
use Illuminate\Http\UploadedFile;

class DatasetParserFactory
{
    public function make(UploadedFile $file): DatasetParserInterface
    {
        return match (strtolower($file->getClientOriginalExtension())) {
            'csv' => new CsvDatasetParser(),
            'xlsx' => new XlsxDatasetParser(),
            default => throw new UnsupportedDatasetFormatException('Only CSV and XLSX files are supported for inspection in this milestone.'),
        };
    }
}
