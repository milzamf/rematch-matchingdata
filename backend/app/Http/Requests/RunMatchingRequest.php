<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class RunMatchingRequest extends FormRequest
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
            'name' => ['nullable', 'string', 'max:255'],
            'reference_dataset_id' => ['required', 'uuid', 'exists:datasets,id'],
            'input_dataset_id' => ['required', 'uuid', 'exists:datasets,id', 'different:reference_dataset_id'],
            'mappings' => ['required', 'array', 'min:1'],
            'mappings.*.id' => ['nullable', 'string', 'max:100'],
            'mappings.*.referenceColumnId' => ['nullable', 'uuid', 'exists:dataset_columns,id'],
            'mappings.*.inputColumnId' => ['nullable', 'uuid', 'exists:dataset_columns,id'],
            'mappings.*.referenceColumnName' => ['required', 'string', 'max:255'],
            'mappings.*.inputColumnName' => ['required', 'string', 'max:255'],
            'mappings.*.algorithm' => ['nullable', 'string', 'max:64'],
            'mappings.*.suggested' => ['nullable', 'boolean'],
            'mappings.*.suggestionSource' => ['nullable', 'string', 'max:64'],
            'mappings.*.suggestionScore' => ['nullable', 'numeric'],
            'configuration' => ['required', 'array'],
            'configuration.preset' => ['nullable', 'string', 'max:32'],
            'configuration.strategy' => ['nullable', 'string', 'max:32'],
            'configuration.fields' => ['nullable', 'array'],
            'configuration.thresholds' => ['nullable', 'array'],
            'configuration.candidateGeneration' => ['nullable', 'array'],
            'configuration.searchOptimization' => ['nullable', 'array'],
            'configuration.normalization' => ['nullable', 'array'],
            'configuration.weighting' => ['nullable', 'array'],
            'configuration.rules' => ['nullable', 'array'],
            'configuration.output' => ['nullable', 'array'],
            'configuration.runOptions' => ['nullable', 'array'],
            'configuration.runOptions.chunkSize' => ['nullable', 'integer', 'min:10', 'max:1000'],
            'configuration.runOptions.workerCount' => ['nullable', 'integer', 'min:1', 'max:8'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'success' => false,
            'message' => 'Matching run request is invalid.',
            'errors' => $validator->errors(),
        ], 422));
    }
}
