<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\WorkspaceRequest;
use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\Workspace;
use App\Support\Auth\ResourceOwnership;
use App\Services\Workspace\DraftWorkspaceService;
use App\Services\Matching\Transactions\ReviewDeploymentFence;
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
            ->scopeWorkspaces(
                Workspace::with([
                    'user',
                    'referenceDataset:id,name,row_count',
                    'inputDataset:id,name,row_count',
                    'matchingJob:id,status,processed_count,total_count,record_counts,error_message,started_at,finished_at',
                ]),
                $request->user()
            )
            ->latest('updated_at')
            ->get()
            ->map(fn (Workspace $workspace) => $this->summaryPayload($workspace));

        return response()->json([
            'success' => true,
            'data' => $workspaces,
        ]);
    }

    public function store(WorkspaceRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (ReviewDeploymentFence::legacyBlocked()) {
            $workspace = app(DraftWorkspaceService::class)->save($request->user(), $data);
            return response()->json(['success' => true, 'data' => $this->payload($workspace->load(['user', 'referenceDataset.columns', 'inputDataset.columns', 'matchingJob']))], 201);
        }
        unset($data['expected_version']);
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
            'data' => $this->payload($workspace->load(['referenceDataset.columns', 'inputDataset.columns', 'matchingJob'])),
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
                'matchingJobs',
            ])),
        ]);
    }

    public function update(WorkspaceRequest $request, string $workspace): JsonResponse
    {
        if (ReviewDeploymentFence::legacyBlocked()) {
            $model = app(DraftWorkspaceService::class)->save($request->user(), $request->validated(), $workspace);
            return response()->json(['success' => true, 'data' => $this->payload($model->load(['user', 'referenceDataset.columns', 'inputDataset.columns', 'matchingJob', 'matchingJobs']))]);
        }
        $model = $this->ownership->findWorkspace($request->user(), $workspace);
        $data = $request->validated();
        unset($data['expected_version']);
        $this->assertLinkedResources($request, $data);

        // Safety: If workspace already has a completed matching job, prevent stale client autosave from reverting matching_job_id or overwriting completed runResult
        if ($model->matchingJob && $model->matchingJob->status === 'completed') {
            if (isset($data['matching_job_id']) && $data['matching_job_id'] !== $model->matching_job_id) {
                $requestedJob = MatchingJob::find($data['matching_job_id']);
                if (! $requestedJob || $requestedJob->status !== 'completed') {
                    $data['matching_job_id'] = $model->matching_job_id;
                }
            }
            if (isset($data['workflow_state']['runResult'])) {
                $incomingCounts = $data['workflow_state']['runResult']['summary'] ?? [];
                $incomingTotal = ($incomingCounts['matched'] ?? 0) + ($incomingCounts['possible_match'] ?? 0) + ($incomingCounts['unmatched'] ?? 0);
                if ($incomingTotal === 0 && ! empty($model->workflow_state['runResult'])) {
                    $data['workflow_state']['runResult'] = $model->workflow_state['runResult'];
                    $data['workflow_state']['runState'] = 'success';
                    $data['workflow_state']['progress'] = 100;
                }
            }
        }

        $model->update($data);

        return response()->json([
            'success' => true,
            'data' => $this->payload($model->load(['user', 'referenceDataset.columns', 'inputDataset.columns', 'matchingJob', 'matchingJobs'])),
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
        $activeJob = $workspace->matchingJob;
        if ($workspace->relationLoaded('matchingJobs') && $workspace->matchingJobs->isNotEmpty()) {
            $latestJob = $workspace->matchingJobs->sortByDesc('created_at')->first();
            if (! $activeJob || ($latestJob && $latestJob->created_at > $activeJob->created_at)) {
                $activeJob = $latestJob;
            }
        }

        return [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'status' => $workspace->status,
            'current_step' => $workspace->current_step,
            'configuration_version' => $workspace->configuration_version === null ? null : (int) $workspace->configuration_version,
            'reference_dataset_id' => $workspace->reference_dataset_id,
            'input_dataset_id' => $workspace->input_dataset_id,
            'matching_job_id' => $activeJob?->id ?? $workspace->matching_job_id,
            'record_count' => $workspace->inputDataset?->row_count ?? $activeJob?->total_count,
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
            'matching_job' => $this->jobPayload($activeJob),
            'matching_jobs' => $workspace->relationLoaded('matchingJobs')
                ? $workspace->matchingJobs->sortByDesc('created_at')->values()->map(fn ($j) => $this->jobPayload($j))->all()
                : [],
            'created_at' => optional($workspace->created_at)->toISOString(),
            'updated_at' => optional($workspace->updated_at)->toISOString(),
        ];
    }

    /**
     * Lean workspace summary for dashboard and workspace listing.
     * Excludes heavy serialized workflow_state and dataset preview rows to ensure sub-50ms responses.
     *
     * @return array<string, mixed>
     */
    private function summaryPayload(Workspace $workspace): array
    {
        $activeJob = $workspace->matchingJob;
        if ($workspace->relationLoaded('matchingJobs') && $workspace->matchingJobs->isNotEmpty()) {
            $latestJob = $workspace->matchingJobs->sortByDesc('created_at')->first();
            if (! $activeJob || ($latestJob && $latestJob->created_at > $activeJob->created_at)) {
                $activeJob = $latestJob;
            }
        }

        return [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'status' => $workspace->status,
            'current_step' => $workspace->current_step,
            'configuration_version' => $workspace->configuration_version === null ? null : (int) $workspace->configuration_version,
            'reference_dataset_id' => $workspace->reference_dataset_id,
            'input_dataset_id' => $workspace->input_dataset_id,
            'matching_job_id' => $activeJob?->id ?? $workspace->matching_job_id,
            'record_count' => $workspace->inputDataset?->row_count ?? $activeJob?->total_count,
            'owner' => $workspace->user ? [
                'id' => $workspace->user->getKey(),
                'name' => $workspace->user->name,
                'email' => $workspace->user->email,
                'role' => $workspace->user->roleEnum()->value,
            ] : null,
            'matching_job' => $activeJob ? [
                ...$this->jobPayload($activeJob),
                'record_counts' => array_diff_key($activeJob->record_counts ?? [], ['duplicate_details' => true]),
            ] : null,
            'reference_dataset' => $workspace->referenceDataset ? [
                'dataset' => [
                    'id' => $workspace->referenceDataset->id,
                    'name' => $workspace->referenceDataset->name,
                    'row_count' => $workspace->referenceDataset->row_count,
                ],
            ] : null,
            'input_dataset' => $workspace->inputDataset ? [
                'dataset' => [
                    'id' => $workspace->inputDataset->id,
                    'name' => $workspace->inputDataset->name,
                    'row_count' => $workspace->inputDataset->row_count,
                ],
            ] : null,
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

    public function previewStandardized(Request $request, string $workspace, \App\Services\Datasets\DatasetInspectionService $inspectionService): JsonResponse
    {
        $model = $this->ownership->findWorkspace($request->user(), $workspace);
        $role = $request->query('role', 'input');
        $datasetId = $role === 'reference' ? $model->reference_dataset_id : $model->input_dataset_id;

        if (! $datasetId) {
            return response()->json([
                'success' => false,
                'message' => "Dataset for role '{$role}' not found in this workspace.",
            ], 404);
        }

        $dataset = Dataset::findOrFail($datasetId);
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(250, max(1, (int) $request->query('per_page', 50)));
        $search = $request->query('search');

        $result = $inspectionService->getPaginatedStandardizedRows(
            $dataset,
            $page,
            $perPage,
            is_string($search) ? $search : null,
        );

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }

    public function standardizedPreview(Request $request, string $workspace, \App\Services\Datasets\DatasetInspectionService $inspectionService): JsonResponse
    {
        return $this->previewStandardized($request, $workspace, $inspectionService);
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
