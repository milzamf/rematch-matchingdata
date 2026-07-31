<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DatasetInspectTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
    }

    public function test_it_inspects_valid_csv_file(): void
    {
        $file = UploadedFile::fake()->createWithContent(
            'customers.csv',
            "customer_id,name,email\nC001,Ayu,ayu@example.test\nC002,Budi,\nC003,Ayu,ayu2@example.test\n",
        );

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'reference',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.dataset.original_filename', 'customers.csv')
            ->assertJsonPath('data.dataset.row_count', 3)
            ->assertJsonPath('data.dataset.column_count', 3)
            ->assertJsonPath('data.columns.0.name', 'customer_id')
            ->assertJsonPath('data.columns.1.data_type', 'text')
            ->assertJsonCount(3, 'data.preview_rows');

        $this->assertDatabaseHas('datasets', [
            'original_filename' => 'customers.csv',
            'dataset_role' => 'reference',
            'row_count' => 3,
            'column_count' => 3,
        ]);
    }

    public function test_it_inspects_valid_xlsx_file(): void
    {
        $file = $this->fakeXlsx('customers.xlsx');

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'input',
            'sheet_name' => 'Customers',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.dataset.original_filename', 'customers.xlsx')
            ->assertJsonPath('data.dataset.selected_sheet', 'Customers')
            ->assertJsonPath('data.dataset.row_count', 2)
            ->assertJsonPath('data.dataset.column_count', 3)
            ->assertJsonPath('data.columns.0.name', 'customer_id')
            ->assertJsonCount(2, 'data.preview_rows');
    }

    public function test_it_rejects_file_without_valid_header(): void
    {
        $file = UploadedFile::fake()->createWithContent(
            'missing-header.csv',
            "1,2,3\n4,5,6\n",
        );

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'reference',
        ])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonFragment([
                'message' => 'The file header does not look valid. Please provide a header row with column names.',
            ]);
    }

    public function test_it_rejects_unsupported_format(): void
    {
        $file = UploadedFile::fake()->createWithContent('customers.json', '{"name":"Ayu"}');

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'reference',
        ])
            ->assertStatus(415)
            ->assertJsonPath('success', false);
    }

    public function test_it_rejects_corrupted_file(): void
    {
        $file = UploadedFile::fake()->createWithContent('broken.xlsx', 'not a valid xlsx file');

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'reference',
        ])
            ->assertStatus(422)
            ->assertJsonPath('success', false);
    }

    public function test_it_rejects_file_over_size_limit(): void
    {
        $file = UploadedFile::fake()->create('large.csv', 51201, 'text/csv');

        $this->postJson('/api/datasets/inspect', [
            'file' => $file,
            'dataset_role' => 'reference',
        ])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonValidationErrors('file');
    }

    private function fakeXlsx(string $name): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'batchmatch-xlsx-');
        $this->writeZip($path, [
            '[Content_Types].xml' => <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
XML,
            '_rels/.rels' => <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
XML,
            'xl/workbook.xml' => <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Customers" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
XML,
            'xl/_rels/workbook.xml.rels' => <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>
XML,
            'xl/worksheets/sheet1.xml' => <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>customer_id</t></is></c>
      <c r="B1" t="inlineStr"><is><t>name</t></is></c>
      <c r="C1" t="inlineStr"><is><t>email</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>C001</t></is></c>
      <c r="B2" t="inlineStr"><is><t>Ayu</t></is></c>
      <c r="C2" t="inlineStr"><is><t>ayu@example.test</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>C002</t></is></c>
      <c r="B3" t="inlineStr"><is><t>Budi</t></is></c>
      <c r="C3" t="inlineStr"><is><t>budi@example.test</t></is></c>
    </row>
  </sheetData>
</worksheet>
XML,
        ]);

        return new UploadedFile(
            $path,
            $name,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            null,
            true,
        );
    }

    /**
     * @param  array<string, string>  $entries
     */
    private function writeZip(string $path, array $entries): void
    {
        $localRecords = '';
        $centralRecords = '';

        foreach ($entries as $name => $contents) {
            $offset = strlen($localRecords);
            $compressed = gzdeflate($contents);
            $crc = crc32($contents);
            $nameLength = strlen($name);
            $compressedSize = strlen($compressed);
            $uncompressedSize = strlen($contents);

            $localRecords .= pack(
                'VvvvvvVVVvv',
                0x04034B50,
                20,
                0,
                8,
                0,
                0,
                $crc,
                $compressedSize,
                $uncompressedSize,
                $nameLength,
                0,
            );
            $localRecords .= $name.$compressed;

            $centralRecords .= pack(
                'VvvvvvvVVVvvvvvVV',
                0x02014B50,
                20,
                20,
                0,
                8,
                0,
                0,
                $crc,
                $compressedSize,
                $uncompressedSize,
                $nameLength,
                0,
                0,
                0,
                0,
                0,
                $offset,
            );
            $centralRecords .= $name;
        }

        $centralDirectoryOffset = strlen($localRecords);
        $centralDirectorySize = strlen($centralRecords);
        $entryCount = count($entries);
        $endRecord = pack(
            'VvvvvVVv',
            0x06054B50,
            0,
            0,
            $entryCount,
            $entryCount,
            $centralDirectorySize,
            $centralDirectoryOffset,
            0,
        );

        file_put_contents($path, $localRecords.$centralRecords.$endRecord);
    }
}
