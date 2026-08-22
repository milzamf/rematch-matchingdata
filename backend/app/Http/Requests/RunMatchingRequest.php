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
            'workspace_id' => ['nullable', 'uuid', 'exists:workspaces,id'],
            'reference_dataset_id' => ['required', 'uuid', 'exists:datasets,id'],
            'input_dataset_id' => ['required', 'uuid', 'exists:datasets,id', 'different:reference_dataset_id'],
            'mappings' => ['required', 'array', 'min:1'],
            'mappings.*.id' => ['nullable', 'string', 'max:100'],
            'mappings.*.referenceColumnId' => ['nullable', 'uuid', 'exists:dataset_columns,id'],
            'mappings.*.inputColumnId' => ['nullable', 'uuid', 'exists:dataset_columns,id'],
            'mappings.*.referenceColumnName' => ['required', 'string', 'max:255'],
            'mappings.*.inputColumnName' => ['required', 'string', 'max:255'],
            'mappings.*.algorithm' => ['nullable', 'string', 'max:64'],
            'mappings.*.required_match' => ['nullable', 'boolean'],
            'mappings.*.suggested' => ['nullable', 'boolean'],
            'mappings.*.suggestionSource' => ['nullable', 'string', 'max:64'],
            'mappings.*.suggestionScore' => ['nullable', 'numeric'],
            'configuration' => ['required', 'array'],
            'configuration.preset' => ['nullable', 'string', 'max:32'],
            'configuration.mode' => ['nullable', 'string', 'in:default,custom,preset'],
            'configuration.strategy' => ['nullable', 'string', 'max:32'],
            'configuration.fields' => ['nullable', 'array'],
            'configuration.fields.*.mappingId' => ['required_with:configuration.fields', 'string', 'max:100'],
            'configuration.fields.*.strict' => ['nullable', 'boolean'],
            'configuration.fields.*.comparisonFamily' => [
                'nullable',
                'string',
                'in:Exact,Character Similarity,Token Similarity,Vector / Statistical,Numeric / Date',
            ],
            'configuration.fields.*.algorithm' => ['nullable', 'string', 'max:64'],
            'configuration.fields.*.weight' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'configuration.thresholds' => ['nullable', 'array'],
            'configuration.candidateGeneration' => ['nullable', 'array'],
            'configuration.searchOptimization' => ['nullable', 'array'],
            'configuration.normalization' => ['nullable', 'array'],
            'configuration.weighting' => ['nullable', 'array'],
            'configuration.weighting.fields' => ['nullable', 'array'],
            'configuration.weighting.fields.*.mappingId' => ['required_with:configuration.weighting.fields', 'string', 'max:100'],
            'configuration.weighting.fields.*.weight' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'configuration.rules' => ['nullable', 'array'],
            'configuration.rules.verificationOrder' => ['nullable', 'array'],
            'configuration.rules.verificationOrder.*.order' => ['nullable', 'integer', 'min:1'],
            'configuration.rules.verificationOrder.*.mappingId' => ['required_with:configuration.rules.verificationOrder', 'string', 'max:100'],
            'configuration.rules.verificationOrder.*.field' => ['required_with:configuration.rules.verificationOrder', 'string', 'max:255'],
            'configuration.rules.verificationOrder.*.method' => ['required_with:configuration.rules.verificationOrder', 'string', 'max:64'],
            'configuration.rules.verificationOrder.*.threshold' => ['nullable', 'numeric', 'min:0', 'max:100'],
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
