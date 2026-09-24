<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class InspectDatasetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:512000'],
            'dataset_role' => ['required', 'string', 'in:reference,input'],
            'sheet_name' => ['nullable', 'string', 'max:255'],
            'delimiter' => ['nullable', 'string', 'max:5'],
            'header_row' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'success' => false,
            'message' => 'Dataset inspect request is invalid.',
            'errors' => $validator->errors(),
        ], 422));
    }
}
