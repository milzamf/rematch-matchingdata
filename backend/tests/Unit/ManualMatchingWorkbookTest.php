<?php

namespace Tests\Unit;

use App\Services\Datasets\XlsxDatasetParser;
use App\Services\Matching\ManualMatchingEvaluation;
use App\Services\Matching\TabularWorkbook;
use Tests\TestCase;

class ManualMatchingWorkbookTest extends TestCase
{
    public function test_default_and_prefixed_workbooks_with_sparse_rows_keep_empty_labels_and_string_keys(): void
    {
        foreach ([false, true] as $prefixed) {
            $writer = new TabularWorkbook([['name' => 'Review Manual', 'columns' => ['Key input', 'Key acuan', 'Status sistem', 'Label petugas', 'Similarity (%)']]]);
            $writer->row(0, ['001', '1', 'matched', null, 98]);
            $path = $writer->finish();
            try {
                $zip = new \ZipArchive; $zip->open($path);
                if ($prefixed) {
                    $xml = $zip->getFromName('xl/workbook.xml');
                    $xml = str_replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', $xml);
                    $xml = preg_replace('/(<\/?)(workbook|sheets|sheet)(?=[\s>\/])/', '$1x:$2', $xml);
                    $zip->addFromString('xl/workbook.xml', $xml);
                }
                // Excel can omit empty row elements entirely before a header at row 6.
                $xml = $zip->getFromName('xl/worksheets/sheet1.xml');
                $xml = str_replace(['r="2"', 'r="1"'], ['r="7"', 'r="6"'], $xml);
                $zip->addFromString('xl/worksheets/sheet1.xml', $xml); $zip->close();
                $rows = iterator_to_array((new XlsxDatasetParser)->streamRows($path, ['header_row' => 6, 'sheet_name' => 'Review Manual']));
                $this->assertCount(1, $rows);
                $this->assertSame('001', $rows[0]['Key input']);
                $this->assertNull($rows[0]['Label petugas']);
                $this->assertSame(0, (new ManualMatchingEvaluation)->evaluate($rows)['counts']['labelled']);
                $parsed = (new XlsxDatasetParser)->parsePath($path, ['header_row' => 6, 'sheet_name' => 'Review Manual']);
                $this->assertSame(1, $parsed->totalRowCount);
            } finally { unlink($path); }
        }
    }
}
