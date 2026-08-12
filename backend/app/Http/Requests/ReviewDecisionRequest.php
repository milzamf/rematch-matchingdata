<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class ReviewDecisionRequest extends FormRequest
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
            'input_record_key' => ['required_without:input_record_keys', 'string', 'max:100'],
            'input_record_keys' => ['nullable', 'array', 'max:250'],
            'input_record_keys.*' => ['string', 'max:100'],
            'matching_result_id' => ['nullable', 'uuid', 'exists:matching_results,id'],
            'decision' => ['required', 'string', 'in:accept_match,reject_match,select_candidate,mark_unmatched'],
            'scope' => ['nullable', 'string', 'in:one,selected,group'],
            'case_group_id' => ['nullable', 'string', 'max:160'],
            'note' => ['nullable', 'string', 'max:1000'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'success' => false,
            'message' => 'Review decision request is invalid.',
            'errors' => $validator->errors(),
        ], 422));
    }
}
