<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;
use Illuminate\Http\UploadedFile;
use SimpleXMLElement;

class XlsxDatasetParser implements DatasetParserInterface
{
    public function parse(UploadedFile $file, array $options = []): ParsedDataset
    {
        $path = $file->getRealPath();

        if (! is_string($path) || ! is_readable($path)) {
            throw new DatasetParsingException('The uploaded XLSX file cannot be read.');
        }

        $zip = new SimpleZipReader($path);
        $sharedStrings = $this->readSharedStrings($zip);
        $sheets = $this->readSheets($zip);

        if ($sheets === []) {
            throw new DatasetParsingException('The XLSX file does not contain any readable sheets.');
        }

        $requestedSheet = $options['sheet_name'] ?? null;
        $selected = $this->selectSheet($sheets, is_string($requestedSheet) ? $requestedSheet : null);
        $rows = $this->readWorksheetRows($zip, $selected['path'], $sharedStrings);
        $headerRow = max(1, (int) ($options['header_row'] ?? 1));
        $headers = $this->validateHeaders($rows[$headerRow - 1] ?? []);
        $dataRows = [];

        foreach (array_slice($rows, $headerRow) as $row) {
            $dataRows[] = $this->combineRow($headers, $row);
        }

        return new ParsedDataset(
            $headers,
            $dataRows,
            array_column($sheets, 'name'),
            $selected['name'],
        );
    }

    /**
     * @return array<int, string>
     */
    private function readSharedStrings(SimpleZipReader $zip): array
    {
        $xml = $zip->get('xl/sharedStrings.xml');

        if ($xml === null) {
            return [];
        }

        $shared = [];
        $doc = $this->loadXml($xml, 'The XLSX shared strings could not be parsed.');

        foreach ($doc->si as $item) {
            $parts = [];

            if (isset($item->t)) {
                $parts[] = (string) $item->t;
            }

            foreach ($item->r ?? [] as $run) {
                if (isset($run->t)) {
                    $parts[] = (string) $run->t;
                }
            }

            $shared[] = implode('', $parts);
        }

        return $shared;
    }

    /**
     * @return array<int, array{name: string, path: string}>
     */
    private function readSheets(SimpleZipReader $zip): array
    {
        $workbookXml = $zip->get('xl/workbook.xml');
        $relsXml = $zip->get('xl/_rels/workbook.xml.rels');

        if ($workbookXml === null || $relsXml === null) {
            throw new DatasetParsingException('The XLSX workbook metadata is missing.');
        }

        $workbook = $this->loadXml($workbookXml, 'The XLSX workbook metadata could not be parsed.');
        $rels = $this->loadXml($relsXml, 'The XLSX workbook relationships could not be parsed.');
        $relationshipMap = [];

        foreach ($rels->Relationship as $relationship) {
            $attributes = $relationship->attributes();
            $target = (string) $attributes['Target'];
            $relationshipMap[(string) $attributes['Id']] = str_starts_with($target, '/')
                ? ltrim($target, '/')
                : 'xl/'.ltrim($target, '/');
        }

        $workbook->registerXPathNamespace('rel', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
        $sheets = [];

        foreach ($workbook->sheets->sheet as $sheet) {
            $attributes = $sheet->attributes();
            $relAttributes = $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
            $relationshipId = (string) $relAttributes['id'];

            if (isset($relationshipMap[$relationshipId])) {
                $sheets[] = [
                    'name' => (string) $attributes['name'],
                    'path' => $relationshipMap[$relationshipId],
                ];
            }
        }

        return $sheets;
    }

    /**
     * @param  array<int, array{name: string, path: string}>  $sheets
     * @return array{name: string, path: string}
     */
    private function selectSheet(array $sheets, ?string $requestedSheet): array
    {
        if ($requestedSheet === null || $requestedSheet === '') {
            return $sheets[0];
        }

        foreach ($sheets as $sheet) {
            if ($sheet['name'] === $requestedSheet) {
                return $sheet;
            }
        }

        throw new DatasetParsingException("Sheet '{$requestedSheet}' was not found in the XLSX file.");
    }

    /**
     * @param  array<int, string>  $sharedStrings
     * @return array<int, array<int, mixed>>
     */
    private function readWorksheetRows(SimpleZipReader $zip, string $path, array $sharedStrings): array
    {
        $sheetXml = $zip->get($path);

        if ($sheetXml === null) {
            throw new DatasetParsingException('The selected XLSX sheet cannot be read.');
        }

        $sheet = $this->loadXml($sheetXml, 'The selected XLSX sheet could not be parsed.');
        $rows = [];

        foreach ($sheet->sheetData->row as $rowNode) {
            $row = [];

            foreach ($rowNode->c as $cell) {
                $attributes = $cell->attributes();
                $index = $this->columnIndex((string) $attributes['r']);
                $row[$index] = $this->cellValue($cell, (string) $attributes['t'], $sharedStrings);
            }

            if ($row !== []) {
                ksort($row);
                $rows[] = $this->densifyRow($row);
            }
        }

        return $rows;
    }

    private function cellValue(SimpleXMLElement $cell, string $type, array $sharedStrings): mixed
    {
        if ($type === 's') {
            return $sharedStrings[(int) $cell->v] ?? null;
        }

        if ($type === 'inlineStr') {
            return isset($cell->is->t) ? (string) $cell->is->t : null;
        }

        if ($type === 'b') {
            return (string) $cell->v === '1';
        }

        return isset($cell->v) ? (string) $cell->v : null;
    }

    private function columnIndex(string $cellReference): int
    {
        preg_match('/^[A-Z]+/i', $cellReference, $matches);
        $letters = strtoupper($matches[0] ?? 'A');
        $index = 0;

        foreach (str_split($letters) as $letter) {
            $index = ($index * 26) + (ord($letter) - 64);
        }

        return $index - 1;
    }

    /**
     * @param  array<int, mixed>  $row
     * @return array<int, mixed>
     */
    private function densifyRow(array $row): array
    {
        $max = max(array_keys($row));
        $dense = [];

        for ($i = 0; $i <= $max; $i++) {
            $dense[] = $row[$i] ?? null;
        }

        return $dense;
    }

    /**
     * @param  array<int, mixed>  $headers
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
     * @param  array<int, string>  $headers
     * @param  array<int, mixed>  $record
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

    private function loadXml(string $xml, string $errorMessage): SimpleXMLElement
    {
        libxml_use_internal_errors(true);
        $doc = simplexml_load_string($xml);
        libxml_clear_errors();

        if (! $doc instanceof SimpleXMLElement) {
            throw new DatasetParsingException($errorMessage);
        }

        return $doc;
    }
}
