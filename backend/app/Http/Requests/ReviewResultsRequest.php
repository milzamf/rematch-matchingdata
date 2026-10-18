<?php

namespace App\Http\Requests;

use App\Services\Matching\WilayahDictionaryService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ReviewResultsRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'input_keys' => 'sometimes|array|max:100',
            'input_keys.*' => 'required|string|max:255',
            'sort' => 'sometimes|in:record_order,similarity_desc,similarity_asc',
            'similarity_min' => 'nullable|numeric|between:0,100',
            'similarity_max' => 'nullable|numeric|between:0,100',
            'input_province_code' => 'nullable|string|max:16',
            'input_regency_code' => 'nullable|string|max:16',
            'status' => 'sometimes|in:all,matched,possible_match,unmatched',
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:10|max:100',
            'search' => 'nullable|string|max:500',
            'case_group_id' => 'nullable|string|max:255',
            'include_groups' => 'sometimes|in:true,false,1,0',
            'include_quality' => 'sometimes|in:true,false,1,0',
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($this->filled('similarity_min') && $this->filled('similarity_max') && (float) $this->input('similarity_min') > (float) $this->input('similarity_max')) {
                $validator->errors()->add('similarity_min', 'Minimum similarity must not exceed maximum.');
            }
            $dictionary = app(WilayahDictionaryService::class);
            $province = $this->input('input_province_code');
            $regency = $this->input('input_regency_code');
            if ($province && !isset($dictionary->getProvinces()[$province])) $validator->errors()->add('input_province_code', 'Unknown province code.');
            if ($regency) {
                $record = $dictionary->getRegencies()[$regency] ?? null;
                if (!$record || ($province && (string) $record['kd_prov'] !== $province)) $validator->errors()->add('input_regency_code', 'Regency does not belong to the selected province.');
            }
        }];
    }
}
