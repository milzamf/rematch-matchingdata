<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;
use Generator;
use Illuminate\Http\UploadedFile;
use SimpleXMLElement;
use Throwable;
use XMLReader;
use ZipArchive;

class XlsxDatasetParser implements DatasetParserInterface
{
    /**
     * Parse an uploaded XLSX file.
     *
     * @param array<string, mixed> $options
     */
    public function parse(UploadedFile $file, array $options = []): ParsedDataset
    {
        $path = $file->getRealPath();

        if (! is_string($path) || ! is_readable($path)) {
            throw new DatasetParsingException('The uploaded XLSX file cannot be read.');
        }

        return $this->parsePath($path, $options);
    }

    /**
     * Parse an XLSX file from a filesystem path.
     *
     * @param array<string, mixed> $options
     */
    public function parsePath(string $path, array $options = []): ParsedDataset
    {
        $sheets = $this->readSheets($path);

        if ($sheets === []) {
            throw new DatasetParsingException('The XLSX file does not contain any readable sheets.');
        }

        $requestedSheet = $options['sheet_name'] ?? null;
        $selected = $this->selectSheet($sheets, is_string($requestedSheet) ? $requestedSheet : null);
        $sharedStrings = $this->readSharedStrings($path);

        $headerRow = max(1, (int) ($options['header_row'] ?? 1));
        $inspectMode = (bool) ($options['inspect_mode'] ?? true);
        $maxRows = isset($options['max_rows']) ? (int) $options['max_rows'] : null;

        $reader = $this->openReaderForEntry($path, $selected['path']);
        if ($reader === null) {
            throw new DatasetParsingException('The selected XLSX sheet cannot be read.');
        }

        $headers = [];
        $previewRows = [];
        $sampleRows = [];
        $allRows = [];
        $rowCounter = 0;
        $dataRowCounter = 0;

        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'row') {
                    $rowCounter++;

                    if ($rowCounter < $headerRow) {
                        continue;
                    }

                    if ($rowCounter === $headerRow) {
                        $rawRow = $this->readRowCells($reader, $sharedStrings);
                        $headers = $this->validateHeaders($rawRow);
                        continue;
                    }

                    $dataRowCounter++;

                    if ($inspectMode) {
                        // In inspect mode: collect first 100 for preview, first 5000 for profiling
                        if ($dataRowCounter <= 5000) {
                            $rawRow = $this->readRowCells($reader, $sharedStrings);
                            $combined = $this->combineRow($headers, $rawRow);
                            if ($dataRowCounter <= 100) {
                                $previewRows[] = $combined;
                            }
                            $sampleRows[] = $combined;
                        }
                    } else {
                        // Full parse mode
                        $rawRow = $this->readRowCells($reader, $sharedStrings);
                        $allRows[] = $this->combineRow($headers, $rawRow);

                        if ($maxRows !== null && $dataRowCounter >= $maxRows) {
                            break;
                        }
                    }
                }
            }
        } finally {
            $reader->close();
        }

        if ($headers === []) {
            throw new DatasetParsingException('The file must contain a non-empty header row.');
        }

        $sheetNames = array_column($sheets, 'name');

        if ($inspectMode) {
            return new ParsedDataset(
                $headers,
                $previewRows,
                $sheetNames,
                $selected['name'],
                null,
                $dataRowCounter,
                $sampleRows,
            );
        }

        return new ParsedDataset(
            $headers,
            $allRows,
            $sheetNames,
            $selected['name'],
            null,
            $dataRowCounter,
            array_slice($allRows, 0, 5000),
        );
    }

    /**
     * Stream rows from an XLSX file on disk one by one.
     *
     * @param array<string, mixed> $options
     * @return Generator<int, array<string, mixed>>
     */
    public function streamRows(string $path, array $options = []): Generator
    {
        $sheets = $this->readSheets($path);
        if ($sheets === []) {
            throw new DatasetParsingException('The XLSX file does not contain any readable sheets.');
        }

        $requestedSheet = $options['sheet_name'] ?? null;
        $selected = $this->selectSheet($sheets, is_string($requestedSheet) ? $requestedSheet : null);
        $sharedStrings = $this->readSharedStrings($path);
        $headerRow = max(1, (int) ($options['header_row'] ?? 1));

        $reader = $this->openReaderForEntry($path, $selected['path']);
        if ($reader === null) {
            throw new DatasetParsingException('The selected XLSX sheet cannot be read.');
        }

        $headers = [];
        $rowCounter = 0;

        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'row') {
                    $rowCounter++;

                    if ($rowCounter < $headerRow) {
                        continue;
                    }

                    if ($rowCounter === $headerRow) {
                        $rawRow = $this->readRowCells($reader, $sharedStrings);
                        $headers = $this->validateHeaders($rawRow);
                        continue;
                    }

                    $rawRow = $this->readRowCells($reader, $sharedStrings);
                    yield $this->combineRow($headers, $rawRow);
                }
            }
        } finally {
            $reader->close();
        }
    }

    /**
     * Read cell contents for the current row node.
     *
     * @param array<int, string> $sharedStrings
     * @return array<int, mixed>
     */
    private function readRowCells(XMLReader $reader, array $sharedStrings): array
    {
        $rowCells = [];

        if ($reader->isEmptyElement) {
            return $rowCells;
        }

        $rowDepth = $reader->depth;

        while ($reader->read() && $reader->depth > $rowDepth) {
            if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'c') {
                $ref = $reader->getAttribute('r') ?? '';
                $type = $reader->getAttribute('t') ?? '';
                $colIdx = $ref !== '' ? $this->columnIndex($ref) : count($rowCells);

                if ($reader->isEmptyElement) {
                    $rowCells[$colIdx] = null;
                    continue;
                }

                $cellDepth = $reader->depth;
                $val = null;

                while ($reader->read() && $reader->depth > $cellDepth) {
                    if ($reader->nodeType === XMLReader::ELEMENT) {
                        if ($reader->localName === 'v') {
                            $vText = $reader->readString();
                            if ($type === 's') {
                                $val = $sharedStrings[(int) $vText] ?? null;
                            } elseif ($type === 'b') {
                                $val = ($vText === '1' || strtolower($vText) === 'true');
                            } else {
                                $val = $vText;
                            }
                        } elseif ($reader->localName === 't') {
                            $val = $reader->readString();
                        }
                    }
                }

                $rowCells[$colIdx] = $val;
            }
        }

        return $rowCells;
    }

    /**
     * Extract shared strings from xl/sharedStrings.xml using streaming XMLReader.
     *
     * @return array<int, string>
     */
    private function readSharedStrings(string $path): array
    {
        $reader = $this->openReaderForEntry($path, 'xl/sharedStrings.xml');
        if ($reader === null) {
            return [];
        }

        $strings = [];
        $currentText = '';

        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT) {
                    if ($reader->localName === 'si') {
                        $currentText = '';
                    } elseif ($reader->localName === 't') {
                        $currentText .= $reader->readString();
                    }
                } elseif ($reader->nodeType === XMLReader::END_ELEMENT) {
                    if ($reader->localName === 'si') {
                        $strings[] = $currentText;
                    }
                }
            }
        } finally {
            $reader->close();
        }

        return $strings;
    }

    /**
     * @return array<int, array{name: string, path: string}>
     */
    private function readSheets(string $path): array
    {
        $workbookXml = null;
        $relsXml = null;

        if (class_exists(ZipArchive::class)) {
            $zip = new ZipArchive();
            $openRes = @$zip->open($path);
            if ($openRes === true) {
                $workbookXml = $zip->getFromName('xl/workbook.xml') ?: null;
                $relsXml = $zip->getFromName('xl/_rels/workbook.xml.rels') ?: null;
                $zip->close();
            }
        }

        if ($workbookXml === null || $relsXml === null) {
            try {
                $simpleZip = new SimpleZipReader($path);
                $workbookXml = $simpleZip->get('xl/workbook.xml');
                $relsXml = $simpleZip->get('xl/_rels/workbook.xml.rels');
            } catch (Throwable) {
                throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
            }
        }

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
                : (str_starts_with($target, 'worksheets/') ? 'xl/' . $target : 'xl/' . ltrim($target, '/'));
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
     * @param array<int, array{name: string, path: string}> $sheets
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
     * Open XMLReader for a specific entry in the zip file.
     */
    private function openReaderForEntry(string $path, string $entryName): ?XMLReader
    {
        $reader = new XMLReader();

        // 1. Try zip:// stream wrapper
        $realPath = realpath($path) ?: $path;
        $uri = 'zip://' . str_replace('\\', '/', $realPath) . '#' . ltrim($entryName, '/');
        if (@$reader->open($uri)) {
            return $reader;
        }

        // 2. Fallback: extract entry to temp file if ZipArchive available
        if (class_exists(ZipArchive::class)) {
            $zip = new ZipArchive();
            if (@$zip->open($path) === true) {
                $tempDir = sys_get_temp_dir() . '/bm_xlsx_' . getmypid();
                if (! is_dir($tempDir)) {
                    @mkdir($tempDir, 0777, true);
                }
                $tempFile = $tempDir . '/' . basename($entryName);
                $fp = @$zip->getStream($entryName);
                if ($fp !== false) {
                    $out = @fopen($tempFile, 'w');
                    if ($out !== false) {
                        stream_copy_to_stream($fp, $out);
                        fclose($out);
                        fclose($fp);
                        $zip->close();
                        if (@$reader->open($tempFile)) {
                            return $reader;
                        }
                    } else {
                        fclose($fp);
                    }
                }
                $zip->close();
            }
        }

        // 3. Fallback: SimpleZipReader for environments without zip extension (e.g. local host CLI)
        try {
            $simpleZip = new SimpleZipReader($path);
            $tempDir = sys_get_temp_dir() . '/bm_xlsx_' . getmypid();
            if (! is_dir($tempDir)) {
                @mkdir($tempDir, 0777, true);
            }
            $tempFile = $tempDir . '/' . basename($entryName);
            if ($simpleZip->extractEntry($entryName, $tempFile)) {
                if (@$reader->open($tempFile)) {
                    return $reader;
                }
            }

            $xml = $simpleZip->get($entryName);
            if ($xml !== null && @$reader->xml($xml)) {
                return $reader;
            }
        } catch (Throwable) {
            // ignore
        }

        return null;
    }

    /**
     * Convert cell reference like "A1", "Z10", "AA1", "BF295375" to 0-based column index.
     */
    private function columnIndex(string $cellReference): int
    {
        $letters = '';
        $len = strlen($cellReference);

        for ($i = 0; $i < $len; $i++) {
            $c = $cellReference[$i];
            if (($c >= 'A' && $c <= 'Z') || ($c >= 'a' && $c <= 'z')) {
                $letters .= strtoupper($c);
            } else {
                break;
            }
        }

        if ($letters === '') {
            return 0;
        }

        $index = 0;
        $lLen = strlen($letters);

        for ($i = 0; $i < $lLen; $i++) {
            $index = ($index * 26) + (ord($letters[$i]) - 64);
        }

        return $index - 1;
    }

    /**
     * @param array<int, mixed> $headers
     * @return array<int, string>
     */
    private function validateHeaders(array $headers): array
    {
        $maxKey = ! empty($headers) ? max(array_keys($headers)) : -1;
        $clean = [];

        for ($i = 0; $i <= $maxKey; $i++) {
            $clean[$i] = trim((string) ($headers[$i] ?? ''));
        }

        $nonEmpty = array_values(array_filter($clean, fn ($h) => $h !== ''));

        if ($nonEmpty === [] || count($nonEmpty) !== count($clean)) {
            throw new DatasetParsingException('The file must contain a non-empty header row.');
        }

        $normalized = array_map(fn ($header) => strtolower($header), $clean);

        if (count($normalized) !== count(array_unique($normalized))) {
            throw new DatasetParsingException('The file header contains duplicate column names.');
        }

        if (! collect($clean)->contains(fn ($header) => preg_match('/[A-Za-z_]/', $header) === 1)) {
            throw new DatasetParsingException('The file header does not look valid. Please provide a header row with column names.');
        }

        return array_values($clean);
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
            $row[$header] = ($value === '' || $value === null) ? null : $value;
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
