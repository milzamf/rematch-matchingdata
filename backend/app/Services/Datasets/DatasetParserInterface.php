<?php

namespace App\Services\Datasets;

use Illuminate\Http\UploadedFile;

interface DatasetParserInterface
{
    /**
     * @param array<string, mixed> $options
     */
    public function parse(UploadedFile $file, array $options = []): ParsedDataset;
}
