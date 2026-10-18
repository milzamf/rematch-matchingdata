<?php

namespace Tests\Unit;

use App\Services\Matching\TabularWorkbook;
use Tests\TestCase;

class TabularWorkbookTest extends TestCase
{
    public function test_reference_headers_and_raw_string_values_are_preserved(): void
    {
        $writer = new TabularWorkbook([['name' => 'Data Acuan', 'columns' => ['nama_perusahaan', 'kode']], ['name' => 'Audit Matching', 'columns' => ['Key Input', 'WLS (%)', 'Label Petugas']]]);
        $writer->row(0, ['=SUM(1,2)', '001']);
        $writer->row(1, ['001', 98.25, null]);
        $path = $writer->finish();
        try {
            $zip = new \ZipArchive; $this->assertTrue($zip->open($path));
            $first = $zip->getFromName('xl/worksheets/sheet1.xml');
            $this->assertStringContainsString('nama_perusahaan', $first);
            $this->assertStringContainsString('<t xml:space="preserve">001</t>', $first);
            $this->assertStringContainsString('=SUM(1,2)', $first);
            $this->assertStringNotContainsString('<f>', $first);
            $second = $zip->getFromName('xl/worksheets/sheet2.xml');
            $this->assertStringContainsString('<v>98.25</v>', $second);
            $this->assertNotFalse(simplexml_load_string($first));
            $this->assertNotFalse(simplexml_load_string($second));
            $zip->close();
        } finally { unlink($path); }
    }
}
