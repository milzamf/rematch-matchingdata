<?php

namespace App\Services\Matching;

/** Disk-backed OOXML writer: one row at a time, no shared-string table in RAM. */
final class TabularWorkbook
{
    private array $files = [];
    private array $handles = [];
    private array $rowCounts = [];

    public function __construct(private readonly array $sheets)
    {
        foreach ($sheets as $index => $sheet) {
            $path = tempnam(sys_get_temp_dir(), 'rematch-sheet-');
            if ($path === false) throw new \RuntimeException('Temporary export storage unavailable.');
            $this->files[$index] = $path;
            $this->handles[$index] = fopen($path, 'wb');
            $this->rowCounts[$index] = 0;
            $this->write($index, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>');
            $this->row($index, $sheet['columns']);
        }
    }

    private function write(int $index, string $text): void
    {
        if (! is_resource($this->handles[$index]) || fwrite($this->handles[$index], $text) !== strlen($text)) throw new \RuntimeException('Export write failed.');
    }

    public function row(int $index, array $values): void
    {
        $number = ++$this->rowCounts[$index];
        if ($number > 1048576) throw new \RuntimeException('Excel row limit exceeded.');
        $this->write($index, '<row r="'.$number.'">');
        foreach (array_values($values) as $column => $value) {
            $letter = ''; $n = $column + 1;
            do { $letter = chr(65 + ($n - 1) % 26).$letter; $n = intdiv($n - 1, 26); } while ($n);
            $ref = $letter.$number;
            if (is_float($value) || is_int($value)) $xml = '<c r="'.$ref.'"><v>'.$value.'</v></c>';
            else {
                // Inline strings preserve leading-zero keys and cannot execute Excel formulas.
                $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', (string) ($value ?? ''));
                if (mb_strlen($text) > 32767) throw new \RuntimeException('Excel cell text limit exceeded; no truncated export was published.');
                $xml = '<c r="'.$ref.'" t="inlineStr"><is><t xml:space="preserve">'.htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8').'</t></is></c>';
            }
            $this->write($index, $xml);
        }
        $this->write($index, '</row>');
    }

    public function finish(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'rematch-xlsx-');
        if ($path === false) throw new \RuntimeException('Temporary export storage unavailable.');
        $zip = new \ZipArchive;
        try {
            if ($zip->open($path, \ZipArchive::OVERWRITE) !== true) throw new \RuntimeException('Cannot create Excel archive.');
            $types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
            $workbook = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
            $rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
            foreach ($this->sheets as $index => $sheet) {
                $n = $index + 1;
                $this->write($index, '</sheetData></worksheet>');
                fclose($this->handles[$index]); $this->handles[$index] = null;
                $zip->addFile($this->files[$index], 'xl/worksheets/sheet'.$n.'.xml');
                $types .= '<Override PartName="/xl/worksheets/sheet'.$n.'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
                $workbook .= '<sheet name="'.htmlspecialchars($sheet['name'], ENT_XML1 | ENT_QUOTES, 'UTF-8').'" sheetId="'.$n.'" r:id="rId'.$n.'"/>';
                $rels .= '<Relationship Id="rId'.$n.'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'.$n.'.xml"/>';
            }
            $zip->addFromString('[Content_Types].xml', $types.'</Types>');
            $zip->addFromString('xl/workbook.xml', $workbook.'</sheets></workbook>');
            $zip->addFromString('xl/_rels/workbook.xml.rels', $rels.'</Relationships>');
            $zip->addFromString('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
            if (! $zip->close()) throw new \RuntimeException('Cannot finish Excel archive.');
            return $path;
        } catch (\Throwable $e) { if (is_file($path)) unlink($path); throw $e; }
    }

    public function __destruct()
    {
        foreach ($this->handles as $handle) if (is_resource($handle)) fclose($handle);
        foreach ($this->files as $file) if (is_file($file)) unlink($file);
    }
}
