<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

class WorkspaceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['nullable', 'string', 'max:160'],
            'status' => ['nullable', Rule::in([
                'draft',
                'configuring',
                'matching',
                'reviewing',
                'ready_to_sync',
                'completed',
                'failed',
            ])],
            'current_step' => ['nullable', 'integer', 'min:1', 'max:8'],
            'reference_dataset_id' => ['nullable', 'uuid', 'exists:datasets,id'],
            'input_dataset_id' => ['nullable', 'uuid', 'exists:datasets,id'],
            'matching_job_id' => ['nullable', 'uuid', 'exists:matching_jobs,id'],
            'workflow_state' => ['nullable', 'array'],
            'sync_state' => ['nullable', 'array'],
            'export_history' => ['nullable', 'array'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'success' => false,
            'message' => 'Workspace request is invalid.',
            'errors' => $validator->errors(),
        ], 422));
    }
}
