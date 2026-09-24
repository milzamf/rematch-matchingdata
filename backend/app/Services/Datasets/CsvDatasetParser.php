<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;
use Generator;
use Illuminate\Http\UploadedFile;

class CsvDatasetParser implements DatasetParserInterface
{
    /**
     * Parse an uploaded CSV file.
     *
     * @param array<string, mixed> $options
     */
    public function parse(UploadedFile $file, array $options = []): ParsedDataset
    {
        $path = $file->getRealPath();

        if (! is_string($path) || ! is_readable($path)) {
            throw new DatasetParsingException('The uploaded CSV file cannot be read.');
        }

        return $this->parsePath($path, $options);
    }

    /**
     * Parse a CSV file from a filesystem path.
     *
     * @param array<string, mixed> $options
     */
    public function parsePath(string $path, array $options = []): ParsedDataset
    {
        if (! file_exists($path) || ! is_readable($path)) {
            throw new DatasetParsingException('The CSV file cannot be read.');
        }

        $delimiter = $this->resolveDelimiter($path, $options['delimiter'] ?? null);
        $headerRow = max(1, (int) ($options['header_row'] ?? 1));
        $inspectMode = (bool) ($options['inspect_mode'] ?? true);
        $maxRows = isset($options['max_rows']) ? (int) $options['max_rows'] : null;

        $handle = fopen($path, 'r');
        if ($handle === false) {
            throw new DatasetParsingException('Failed to open CSV file stream.');
        }

        // Strip UTF-8 BOM if present at the beginning of the file
        $bom = fread($handle, 3);
        if ($bom !== "\xEF\xBB\xBF") {
            fseek($handle, 0);
        }

        $headers = [];
        $previewRows = [];
        $sampleRows = [];
        $allRows = [];
        $lineNumber = 0;
        $dataRowCounter = 0;

        while (($record = fgetcsv($handle, 0, $delimiter)) !== false) {
            if ($record === [null] || empty($record)) {
                continue;
            }

            // Skip Excel sep= directive on first line if present
            if ($lineNumber === 0 && count($record) === 1 && is_string($record[0]) && str_starts_with(strtolower($record[0]), 'sep=')) {
                continue;
            }

            $lineNumber++;

            if ($lineNumber < $headerRow) {
                continue;
            }

            if ($lineNumber === $headerRow) {
                $headers = $this->validateHeaders($record);
                continue;
            }

            $dataRowCounter++;

            if ($inspectMode) {
                if ($dataRowCounter <= 5000) {
                    $combined = $this->combineRow($headers, $record);
                    if ($dataRowCounter <= 100) {
                        $previewRows[] = $combined;
                    }
                    $sampleRows[] = $combined;
                }
            } else {
                $allRows[] = $this->combineRow($headers, $record);
                if ($maxRows !== null && $dataRowCounter >= $maxRows) {
                    break;
                }
            }
        }

        fclose($handle);

        if ($headers === []) {
            throw new DatasetParsingException('The CSV file does not contain a valid header row.');
        }

        return new ParsedDataset(
            $headers,
            $inspectMode ? $previewRows : $allRows,
            [],
            null,
            $delimiter,
            $dataRowCounter,
            $sampleRows
        );
    }

    /**
     * Stream rows from a CSV file on disk one by one using a generator.
     *
     * @param array<string, mixed> $options
     * @return Generator<int, array<string, mixed>>
     */
    public function streamRows(string $path, array $options = []): Generator
    {
        if (! file_exists($path) || ! is_readable($path)) {
            throw new DatasetParsingException("The CSV file [{$path}] cannot be read.");
        }

        $delimiter = $this->resolveDelimiter($path, $options['delimiter'] ?? null);
        $headerRow = max(1, (int) ($options['header_row'] ?? 1));

        $handle = fopen($path, 'r');
        if ($handle === false) {
            throw new DatasetParsingException("Failed to open CSV stream for [{$path}].");
        }

        // Strip UTF-8 BOM
        $bom = fread($handle, 3);
        if ($bom !== "\xEF\xBB\xBF") {
            fseek($handle, 0);
        }

        $headers = [];
        $lineNumber = 0;

        try {
            while (($record = fgetcsv($handle, 0, $delimiter)) !== false) {
                if ($record === [null] || empty($record)) {
                    continue;
                }

                if ($lineNumber === 0 && count($record) === 1 && is_string($record[0]) && str_starts_with(strtolower($record[0]), 'sep=')) {
                    continue;
                }

                $lineNumber++;

                if ($lineNumber < $headerRow) {
                    continue;
                }

                if ($lineNumber === $headerRow) {
                    $headers = $this->validateHeaders($record);
                    continue;
                }

                yield $this->combineRow($headers, $record);
            }
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
        }
    }

    /**
     * Automatically detect the most likely delimiter from sample lines or explicit request.
     */
    public function resolveDelimiter(string $path, ?string $requested): string
    {
        if (is_string($requested) && $requested !== '') {
            return $requested === '\t' ? "\t" : $requested;
        }

        $handle = fopen($path, 'r');
        if ($handle === false) {
            return ',';
        }

        $sampleLines = [];
        $lineCount = 0;
        while (! feof($handle) && $lineCount < 50) {
            $line = fgets($handle);
            if ($line === false) {
                break;
            }
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            // Check Excel sep= directive
            if ($lineCount === 0 && preg_match('/^sep=([,;\t|])/i', $line, $m)) {
                fclose($handle);
                return $m[1];
            }
            $sampleLines[] = $line;
            $lineCount++;
        }
        fclose($handle);

        if (empty($sampleLines)) {
            return ',';
        }

        $candidates = [',' => ',', ';' => ';', "\t" => "\t", '|' => '|'];
        $scores = [];

        foreach ($candidates as $cand) {
            $colCounts = [];
            foreach ($sampleLines as $line) {
                $cols = count(str_getcsv($line, $cand));
                if ($cols > 1) {
                    $colCounts[] = $cols;
                }
            }
            if (empty($colCounts)) {
                $scores[$cand] = 0;
                continue;
            }
            $avg = array_sum($colCounts) / count($colCounts);
            $variance = array_sum(array_map(fn ($c) => pow($c - $avg, 2), $colCounts)) / count($colCounts);
            $scores[$cand] = (count($colCounts) * $avg) / (1 + $variance);
        }

        arsort($scores);
        $best = array_key_first($scores);

        return ($scores[$best] > 0) ? $best : ',';
    }

    /**
     * Validate, sanitize, and auto-disambiguate header column names.
     *
     * @param array<int, mixed> $headers
     * @return array<int, string>
     */
    public function validateHeaders(array $headers): array
    {
        $clean = [];
        $seen = [];
        $nonEmptyCount = 0;

        foreach ($headers as $index => $header) {
            $name = trim((string) $header);
            // Strip leading BOM and zero-width spaces
            $name = preg_replace('/^(\xEF\xBB\xBF|\xFF\xFE|\xFE\xFF)/', '', $name) ?? $name;
            $name = preg_replace('/^[\x{FEFF}\x{200B}]+/u', '', $name) ?? $name;
            $name = trim($name);

            if ($name === '') {
                $name = 'column_' . ($index + 1);
            } else {
                $nonEmptyCount++;
            }

            $normalized = strtolower($name);
            if (isset($seen[$normalized])) {
                $seen[$normalized]++;
                $name = $name . '_' . $seen[$normalized];
            } else {
                $seen[$normalized] = 1;
            }

            $clean[] = $name;
        }

        if ($nonEmptyCount === 0 && empty($headers)) {
            throw new DatasetParsingException('The CSV file does not contain a valid header row.');
        }

        if (! collect($clean)->contains(fn ($header) => preg_match('/[A-Za-z_]/u', $header) === 1)) {
            throw new DatasetParsingException('The file header does not look valid. Please provide a header row with column names.');
        }

        return $clean;
    }

    /**
     * Combine headers and a record into a clean associative array.
     *
     * @param array<int, string> $headers
     * @param array<int, mixed> $record
     * @return array<string, mixed>
     */
    public function combineRow(array $headers, array $record): array
    {
        $row = [];

        foreach ($headers as $index => $header) {
            $value = $record[$index] ?? null;
            if (is_string($value)) {
                $value = trim($value);
                if ($value === '' || $value === '\N') {
                    $value = null;
                }
            }
            $row[$header] = $value;
        }

        return $row;
    }
}
