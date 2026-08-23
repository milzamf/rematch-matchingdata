<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

class CleanTempDatasetsCommandTest extends TestCase
{
    private string $tempDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tempDir = storage_path('app/private/datasets/temp');
        File::ensureDirectoryExists($this->tempDir);
    }

    protected function tearDown(): void
    {
        if (File::isDirectory($this->tempDir)) {
            File::deleteDirectory($this->tempDir);
        }
        parent::tearDown();
    }

    public function test_it_executes_successfully(): void
    {
        $this->artisan('app:clean-temp-datasets')
            ->assertSuccessful()
            ->expectsOutputToContain('Cleaned');
    }

    public function test_it_deletes_expired_temp_files_and_keeps_recent_files(): void
    {
        $oldFile = $this->tempDir . '/old_inspect.csv';
        $newFile = $this->tempDir . '/recent_inspect.csv';

        File::put($oldFile, "id,name\n1,Alpha");
        File::put($newFile, "id,name\n2,Beta");

        // Set modification time for old file to 48 hours ago
        touch($oldFile, time() - (48 * 3600));
        // Set modification time for new file to current time
        touch($newFile, time());

        $this->artisan('app:clean-temp-datasets', ['--hours' => 24])
            ->assertSuccessful()
            ->expectsOutputToContain('Cleaned 1 temporary file');

        $this->assertFileDoesNotExist($oldFile);
        $this->assertFileExists($newFile);
    }
}
