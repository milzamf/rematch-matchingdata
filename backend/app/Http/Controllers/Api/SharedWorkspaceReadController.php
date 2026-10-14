<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\SharedWorkspaceReadRequest;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Support\Facades\DB;

final class SharedWorkspaceReadController extends Controller
{
    private function reader(): SharedWorkspaceReader
    {
        $db = DB::connection();
        return new SharedWorkspaceReader($db, new WorkspaceAccessService($db, (bool) config('workspace_access.enabled')));
    }
    private function output(array $data)
    {
        if (strlen(json_encode($data, JSON_THROW_ON_ERROR)) > 2097152) throw new ReviewWriteConflict('reader_payload_too_large', ['max_bytes' => 2097152], 413);
        return response()->json(['success' => true, 'data' => $data]);
    }
    public function workspace(SharedWorkspaceReadRequest $r, string $workspace) { return $this->output($this->reader()->workspace((int) $r->user()->getKey(), $workspace)); }
    public function review(SharedWorkspaceReadRequest $r, string $workspace, string $job) { return $this->output($this->reader()->review((int) $r->user()->getKey(), $workspace, $job, $r->validated())); }
    public function candidates(SharedWorkspaceReadRequest $r, string $workspace, string $job) { return $this->output($this->reader()->candidates((int) $r->user()->getKey(), $workspace, $job, $r->validated('record_key'), $r->validated())); }
    public function dataset(SharedWorkspaceReadRequest $r, string $workspace, string $dataset) { return $this->output($this->reader()->dataset((int) $r->user()->getKey(), $workspace, $dataset, $r->validated())); }
    public function export(SharedWorkspaceReadRequest $r, string $workspace, string $job)
    {
        $actor = (int) $r->user()->getKey();
        $reader = $this->reader();
        DB::transaction(fn () => $reader->assertExport($actor, $workspace, $job));
        // A revoked/failed reader must never publish a successful partial CSV.
        // Prepare on disk with bounded reader chunks before sending any headers.
        $path = tempnam(sys_get_temp_dir(), 'rematch-export-');
        if ($path === false) throw new \RuntimeException('Export temporary storage unavailable.');
        $file = null;
        try {
            $file = fopen($path, 'wb');
            if ($file === false) throw new \RuntimeException('Export temporary storage unavailable.');
            if (fputcsv($file, ['input_record_key', 'status', 'decision', 'reference_record_key', 'version', 'reviewer_user_id', 'similarity'], ',', '"', '') === false) throw new \RuntimeException('Export temporary storage write failed.');
            foreach ($reader->exportRows($actor, $workspace, $job) as $row) {
                if (fputcsv($file, array_values($row), ',', '"', '') === false) throw new \RuntimeException('Export temporary storage write failed.');
            }
            fclose($file);
            $file = null;
            DB::transaction(fn () => $reader->assertExport($actor, $workspace, $job));
            return response()->download($path, 'review-results.csv', ['Content-Type' => 'text/csv; charset=UTF-8'])->deleteFileAfterSend(true);
        } catch (\Throwable $error) {
            if (is_resource($file)) fclose($file);
            if (is_file($path)) unlink($path);
            throw $error;
        }
    }
}
