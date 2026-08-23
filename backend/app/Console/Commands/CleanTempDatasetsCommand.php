<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;

class CleanTempDatasetsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'app:clean-temp-datasets {--hours=24 : Delete files older than this many hours}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Clean temporary dataset and export files older than specified hours.';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $hours = max(1, (int) $this->option('hours'));
        $cutoff = Carbon::now()->subHours($hours)->getTimestamp();

        $directories = [
            storage_path('app/private/datasets/temp'),
            storage_path('app/private/exports/temp'),
            storage_path('app/private/temp'),
        ];

        $deletedCount = 0;
        $freedBytes = 0;

        foreach ($directories as $dir) {
            if (! File::isDirectory($dir)) {
                continue;
            }

            $files = File::allFiles($dir);
            foreach ($files as $file) {
                if ($file->getMTime() < $cutoff) {
                    $size = $file->getSize();
                    File::delete($file->getRealPath());
                    $deletedCount++;
                    $freedBytes += $size;
                }
            }

            // Remove empty subdirectories
            $subdirs = File::directories($dir);
            foreach ($subdirs as $subdir) {
                if (File::isEmptyDirectory($subdir)) {
                    File::deleteDirectory($subdir);
                }
            }
        }

        $formattedFreed = $this->formatBytes($freedBytes);
        $message = "Cleaned {$deletedCount} temporary file(s) ({$formattedFreed} freed) older than {$hours} hour(s).";

        $this->info($message);
        Log::info("CleanTempDatasetsCommand: {$message}");

        return Command::SUCCESS;
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes < 1024) {
            return "{$bytes} B";
        }
        if ($bytes < 1048576) {
            return round($bytes / 1024, 2).' KB';
        }

        return round($bytes / 1048576, 2).' MB';
    }
}
