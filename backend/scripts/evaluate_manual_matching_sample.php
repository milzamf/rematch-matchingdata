<?php

/** Offline only: autoload parsers without bootstrapping Laravel, sessions, queues or a database. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Datasets\CsvDatasetParser;
use App\Services\Datasets\XlsxDatasetParser;
use App\Services\Matching\ManualMatchingEvaluation;

$options = getopt('', ['file:', 'header-row:', 'sheet:']);
$path = $options['file'] ?? '';
try {
    if (! is_file($path) || ! is_readable($path) || filesize($path) > 10 * 1024 * 1024) throw new RuntimeException('File lokal diperlukan, maksimal 10 MiB.');
    $format = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if ($format === 'xlsx') {
        $zip = new ZipArchive;
        if ($zip->open($path) !== true) throw new RuntimeException('Workbook tidak dapat dibaca.');
        try {
            $expanded = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $expanded += $zip->statIndex($i)['size'];
                if ($expanded > 16 * 1024 * 1024) throw new RuntimeException('Isi workbook melewati batas sampel 16 MiB.');
            }
        } finally { $zip->close(); }
    }
    $parser = match ($format) { 'csv' => new CsvDatasetParser, 'xlsx' => new XlsxDatasetParser, default => throw new RuntimeException('Gunakan CSV atau XLSX.') };
    $header = filter_var($options['header-row'] ?? ($format === 'xlsx' ? 6 : 1), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
    if ($header === false) throw new RuntimeException('Baris header tidak valid.');
    $report = (new ManualMatchingEvaluation)->evaluate($parser->streamRows($path, ['header_row' => $header, 'sheet_name' => $options['sheet'] ?? 'Review Manual']));
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, 'Evaluasi dibatalkan: '.$error->getMessage().PHP_EOL);
    exit(1);
}
