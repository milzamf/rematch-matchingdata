<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;
use Illuminate\Http\UploadedFile;
use SplFileObject;

class CsvDatasetParser implements DatasetParserInterface
{
    public function parse(UploadedFile $file, array $options = []): ParsedDataset
    {
        $path = $file->getRealPath();

        if (! is_string($path) || ! is_readable($path)) {
            throw new DatasetParsingException('The uploaded CSV file cannot be read.');
        }

        $delimiter = $this->resolveDelimiter($path, $options['delimiter'] ?? null);
        $headerRow = max(1, (int) ($options['header_row'] ?? 1));
        $csv = new SplFileObject($path);
        $csv->setFlags(SplFileObject::READ_CSV | SplFileObject::SKIP_EMPTY);
        $csv->setCsvControl($delimiter);

        $headers = [];
        $rows = [];
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
                $headers = $this->validateHeaders($record);
                continue;
            }

            $rows[] = $this->combineRow($headers, $record);
        }

        if ($headers === []) {
            throw new DatasetParsingException('The CSV file does not contain a valid header row.');
        }

        return new ParsedDataset($headers, $rows, [], null, $delimiter);
    }

    private function resolveDelimiter(string $path, ?string $requested): string
    {
        if (is_string($requested) && $requested !== '') {
            return $requested === '\t' ? "\t" : $requested;
        }

        $sample = '';
        $handle = fopen($path, 'r');

        if ($handle !== false) {
            $sample = (string) fgets($handle);
            fclose($handle);
        }

        $candidates = [',' => ',', ';' => ';', "\t" => "\t", '|' => '|'];
        $scores = [];

        foreach ($candidates as $delimiter) {
            $scores[$delimiter] = substr_count($sample, $delimiter);
        }

        arsort($scores);

        return (string) array_key_first($scores);
    }

    /**
     * @param array<int, mixed> $headers
     * @return array<int, string>
     */
    private function validateHeaders(array $headers): array
    {
        $clean = array_map(fn ($header) => trim((string) $header), $headers);
        $clean = array_values(array_filter($clean, fn ($header) => $header !== ''));

        if ($clean === [] || count($clean) !== count($headers)) {
            throw new DatasetParsingException('The file must contain a non-empty header row.');
        }

        $normalized = array_map(fn ($header) => strtolower($header), $clean);

        if (count($normalized) !== count(array_unique($normalized))) {
            throw new DatasetParsingException('The file header contains duplicate column names.');
        }

        if (! collect($clean)->contains(fn ($header) => preg_match('/[A-Za-z_]/', $header) === 1)) {
            throw new DatasetParsingException('The file header does not look valid. Please provide a header row with column names.');
        }

        return $clean;
    }

    /**
     * @param array<int, string> $headers
     * @param array<int, mixed> $record
     * @return array<string, mixed>
     */
    private function combineRow(array $headers, array $record): array
    {
        $row = [];

        foreach ($headers as $index => $header) {
            $value = $record[$index] ?? null;
            $row[$header] = $value === '' ? null : $value;
        }

        return $row;
    }
}
