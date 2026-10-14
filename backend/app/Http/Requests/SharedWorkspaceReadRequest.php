<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class SharedWorkspaceReadRequest extends FormRequest
{
    public function authorize(): bool { return $this->user() !== null; }
    public function rules(): array
    {
        $page = ['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100']];
        return match ($this->route()->getActionMethod()) {
            'review' => $page + ['record_key' => ['sometimes', 'string', 'max:255'], 'status' => ['sometimes', Rule::in(['matched', 'possible_match', 'unmatched', 'duplicate_input', 'reference_conflict'])], 'search' => ['sometimes', 'string', 'max:100'],
                'sort' => ['sometimes', Rule::in(['record_order', 'similarity_desc', 'similarity_asc'])], 'similarity_min' => ['sometimes', 'numeric', 'min:0', 'max:100'], 'similarity_max' => ['sometimes', 'numeric', 'min:0', 'max:100'],
                'input_province_code' => ['sometimes', 'regex:/^[0-9]{2}$/'], 'input_regency_code' => ['sometimes', 'regex:/^[0-9]{4}$/']],
            'candidates' => $page + ['record_key' => ['required', 'string', 'max:255'], 'rank' => ['sometimes', 'integer', 'min:1']],
            'dataset' => $page + ['search' => ['sometimes', 'string', 'max:100']],
            default => [],
        };
    }
    public function withValidator($validator): void
    {
        $validator->after(function ($v) {
            if (array_diff(array_keys($this->all()), array_keys($this->rules()))) $v->errors()->add('request', 'Unknown fields are not accepted.');
            if ($this->has(['similarity_min', 'similarity_max']) && $this->input('similarity_min') > $this->input('similarity_max')) $v->errors()->add('similarity_max', 'Must be at least similarity_min.');
            if (is_string($this->input('input_province_code')) && is_string($this->input('input_regency_code')) && ! str_starts_with($this->input('input_regency_code'), $this->input('input_province_code'))) $v->errors()->add('input_regency_code', 'Regency must belong to province.');
        });
    }
}
