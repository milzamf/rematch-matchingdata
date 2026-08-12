<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\WorkspaceRequest;
use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\Workspace;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    public function __construct(private readonly ResourceOwnership $ownership)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $workspaces = $this->ownership
            ->scopeWorkspaces(Workspace::with(['user', 'referenceDataset', 'inputDataset', 'matchingJob']), $request->user())
            ->latest('updated_at')
            ->get()
            ->map(fn (Workspace $workspace) => $this->payload($workspace));

        return response()->json([
            'success' => true,
            'data' => $workspaces,
        ]);
    }

    public function store(WorkspaceRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertLinkedResources($request, $data);

        $workspace = Workspace::create([
            'user_id' => $request->user()->getKey(),
            'name' => $data['name'] ?? 'Untitled Workspace',
            'status' => $data['status'] ?? 'draft',
            'current_step' => $data['current_step'] ?? 1,
            'reference_dataset_id' => $data['reference_dataset_id'] ?? null,
            'input_dataset_id' => $data['input_dataset_id'] ?? null,
            'matching_job_id' => $data['matching_job_id'] ?? null,
            'workflow_state' => $data['workflow_state'] ?? null,
            'sync_state' => $data['sync_state'] ?? null,
            'export_history' => $data['export_history'] ?? null,
        ]);

        return response()->json([
            'success' => true,
            'data' => $this->payload($workspace->load(['referenceDataset', 'inputDataset', 'matchingJob'])),
        ], 201);
    }

    public function show(Request $request, string $workspace): JsonResponse
    {
        $model = $this->ownership->findWorkspace($request->user(), $workspace);

        return response()->json([
            'success' => true,
            'data' => $this->payload($model->load([
                'user',
                'referenceDataset.columns',
                'inputDataset.columns',
                'matchingJob',
            ])),
        ]);
    }

    public function update(WorkspaceRequest $request, string $workspace): JsonResponse
    {
        $model = $this->ownership->findWorkspace($request->user(), $workspace);
        $data = $request->validated();
        $this->assertLinkedResources($request, $data);

        $model->update($data);

        return response()->json([
            'success' => true,
            'data' => $this->payload($model->load(['user', 'referenceDataset', 'inputDataset', 'matchingJob'])),
        ]);
    }

    public function destroy(Request $request, string $workspace): JsonResponse
    {
        $model = $this->ownership->findWorkspace($request->user(), $workspace);
        $deletedId = $model->id;
        $model->delete();

        return response()->json([
            'success' => true,
            'data' => ['id' => $deletedId],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Workspace $workspace): array
    {
        return [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'status' => $workspace->status,
            'current_step' => $workspace->current_step,
            'reference_dataset_id' => $workspace->reference_dataset_id,
            'input_dataset_id' => $workspace->input_dataset_id,
            'matching_job_id' => $workspace->matching_job_id,
            'record_count' => $workspace->inputDataset?->row_count ?? $workspace->matchingJob?->total_count,
            'owner' => $workspace->user ? [
                'id' => $workspace->user->getKey(),
                'name' => $workspace->user->name,
                'email' => $workspace->user->email,
                'role' => $workspace->user->roleEnum()->value,
            ] : null,
            'workflow_state' => $workspace->workflow_state,
            'sync_state' => $workspace->sync_state,
            'export_history' => $workspace->export_history,
            'reference_dataset' => $this->datasetPayload($workspace->referenceDataset),
            'input_dataset' => $this->datasetPayload($workspace->inputDataset),
            'matching_job' => $this->jobPayload($workspace->matchingJob),
            'created_at' => optional($workspace->created_at)->toISOString(),
            'updated_at' => optional($workspace->updated_at)->toISOString(),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function datasetPayload(?Dataset $dataset): ?array
    {
        if (! $dataset) {
            return null;
        }

        return [
            'dataset' => [
                'id' => $dataset->id,
                'dataset_role' => $dataset->dataset_role,
                'name' => $dataset->name,
                'original_filename' => $dataset->original_filename,
                'file_format' => $dataset->file_format,
                'file_size' => $dataset->file_size,
                'selected_sheet' => $dataset->selected_sheet,
                'sheet_names' => $dataset->sheet_names ?? [],
                'delimiter' => $dataset->delimiter,
                'header_row' => $dataset->header_row,
                'row_count' => $dataset->row_count,
                'column_count' => $dataset->column_count,
                'parse_status' => $dataset->parse_status,
            ],
            'columns' => $dataset->relationLoaded('columns')
                ? $dataset->columns->map(fn ($column) => [
                    'id' => $column->id,
                    'name' => $column->name,
                    'normalized_name' => $column->normalized_name,
                    'data_type' => $column->data_type,
                    'position' => $column->position,
                    'null_count' => $column->null_count,
                    'null_percentage' => $column->null_percentage,
                    'unique_count' => $column->unique_count,
                    'duplicate_percentage' => $column->duplicate_percentage,
                    'sample_values' => $column->sample_values ?? [],
                ])->all()
                : [],
            'preview_rows' => $dataset->preview_rows ?? [],
            'profiling_summary' => $dataset->profiling_summary ?? [
                'columns' => $dataset->column_count,
                'rows' => $dataset->row_count,
                'high_missing_columns' => [],
                'duplicate_prone_columns' => [],
            ],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function jobPayload(?MatchingJob $job): ?array
    {
        if (! $job) {
            return null;
        }

        return [
            'id' => $job->id,
            'name' => $job->name,
            'status' => $job->status,
            'processed_count' => $job->processed_count,
            'total_count' => $job->total_count,
            'record_counts' => $job->record_counts ?? [],
            'error_message' => $job->error_message,
            'started_at' => optional($job->started_at)->toISOString(),
            'finished_at' => optional($job->finished_at)->toISOString(),
        ];
    }

    /**
     * @param array<string, mixed> $data
     */
    private function assertLinkedResources(Request $request, array $data): void
    {
        if (! empty($data['reference_dataset_id'])) {
            $this->ownership->findDataset($request->user(), (string) $data['reference_dataset_id']);
        }

        if (! empty($data['input_dataset_id'])) {
            $this->ownership->findDataset($request->user(), (string) $data['input_dataset_id']);
        }

        if (! empty($data['matching_job_id'])) {
            $this->ownership->findMatchingJob($request->user(), (string) $data['matching_job_id']);
        }
    }
}
