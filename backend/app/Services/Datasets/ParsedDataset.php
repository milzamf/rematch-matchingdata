<?php

namespace App\Services\Datasets;

class ParsedDataset
{
    /**
     * @param array<int, string> $headers
     * @param array<int, array<string, mixed>> $rows
     * @param array<int, string> $sheetNames
     * @param array<int, array<string, mixed>> $sampleRows
     */
    public function __construct(
        public readonly array $headers,
        public readonly array $rows,
        public readonly array $sheetNames = [],
        public readonly ?string $selectedSheet = null,
        public readonly ?string $delimiter = null,
        public readonly ?int $totalRowCount = null,
        public readonly array $sampleRows = [],
    ) {
    }
}
