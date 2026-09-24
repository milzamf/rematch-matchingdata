<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Datasets\DatasetInspectionService;
use App\Services\Datasets\DatasetParserFactory;
use App\Services\Datasets\DatasetProfiler;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class UserLargeFileInspectionTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_inspects_user_actual_large_xlsx_file(): void
    {
        $realFile = 'D:/Ilzam/Code/Codex/Data/sf_konstruksi_all_mfd_2024_1_generate_kip_ipd_20250327_idsbr_kirim_sbr_20250630_pivot Mas Ade.xlsx';

        if (! file_exists($realFile)) {
            $this->markTestSkipped('User large XLSX file not found on host machine.');
        }

        Storage::fake('local');

        $uploaded = new UploadedFile(
            $realFile,
            basename($realFile),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            null,
            true
        );

        $user = User::factory()->create();

        $service = app(DatasetInspectionService::class);
        $result = $service->inspect($user, $uploaded, [
            'dataset_role' => 'reference',
            'sheet_name' => null,
            'header_row' => 1,
        ]);

        $this->assertNotEmpty($result);
        $this->assertEquals('reference', $result['dataset']['dataset_role']);
        $this->assertEquals(295374, $result['dataset']['row_count']);
        $this->assertEquals(58, $result['dataset']['column_count']);
        $this->assertCount(100, $result['preview_rows']);
        $this->assertCount(58, $result['columns']);

        echo "\nInspection succeeded! Total rows: " . $result['dataset']['row_count'] . ", Columns: " . $result['dataset']['column_count'] . "\n";
    }

    public function test_it_inspects_user_actual_large_csv_file(): void
    {
        $realFile = '/var/www/html/storage/temp_test.csv';
        if (! file_exists($realFile)) {
            $realFile = 'D:/Ilzam/Code/Codex/Data/20260717 - SBR Kategori F.csv';
        }

        if (! file_exists($realFile)) {
            $this->markTestSkipped('User large CSV file not found.');
        }

        Storage::fake('local');

        $uploaded = new UploadedFile(
            $realFile,
            '20260717 - SBR Kategori F.csv',
            'text/csv',
            null,
            true
        );

        $user = User::factory()->create();

        $service = app(DatasetInspectionService::class);
        $result = $service->inspect($user, $uploaded, [
            'dataset_role' => 'input',
            'header_row' => 1,
        ]);

        $this->assertNotEmpty($result);
        $this->assertEquals('input', $result['dataset']['dataset_role']);
        $this->assertEquals(618595, $result['dataset']['row_count']);
        $this->assertEquals(17, $result['dataset']['column_count']);
        $this->assertEquals(';', $result['dataset']['delimiter']);
        $this->assertCount(100, $result['preview_rows']);
        $this->assertCount(17, $result['columns']);

        echo "\nCSV Inspection succeeded! Total rows: " . $result['dataset']['row_count'] . ", Columns: " . $result['dataset']['column_count'] . ", Delimiter: " . $result['dataset']['delimiter'] . "\n";
    }
}
