<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class WorkspaceAccessRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $version = ['required', 'integer', 'min:1'];
        $item = ['input_record_key' => ['required', 'string', 'max:255'], 'expected_version' => $version,
            'decision' => ['required', Rule::in(['accept_match', 'select_candidate', 'reject_match', 'mark_unmatched'])], 'candidate_id' => ['nullable', 'uuid']];

        return match ($this->route()->getActionMethod()) {
            'setMember' => ['user_id' => ['required', 'integer', 'min:1'], 'role' => ['required', Rule::in(['editor', 'viewer'])], 'expected_version' => ['required', 'integer', 'min:0']],
            'revokeMember' => ['expected_version' => $version],
            'propose' => $item + ['reason' => ['required', 'string', 'max:1000'], 'idempotency_key' => ['required', 'string', 'max:128']],
            'resolve' => ['expected_request_version' => $version, 'approve' => ['required', 'boolean'], 'reason' => ['nullable', 'string', 'max:1000'], 'idempotency_key' => ['required', 'string', 'max:128']],
            'decide' => ['idempotency_key' => ['required', 'string', 'max:128'], 'items' => ['required', 'array', 'min:1', 'max:50'],
                'items.*' => ['array:input_record_key,expected_version,decision,candidate_id'],
                'items.*.input_record_key' => $item['input_record_key'], 'items.*.expected_version' => $version, 'items.*.decision' => $item['decision'], 'items.*.candidate_id' => $item['candidate_id']],
            'undo' => ['idempotency_key' => ['required', 'string', 'max:128'], 'operation_id' => ['required', 'uuid'], 'items' => ['required', 'array', 'min:1', 'max:50'],
                'items.*' => ['array:input_record_key,expected_version'], 'items.*.input_record_key' => $item['input_record_key'], 'items.*.expected_version' => $version],
            'searchUsers' => ['search' => ['required', 'string', 'min:2', 'max:100']],
            'proposals' => ['page' => ['sometimes', 'integer', 'min:1'], 'status' => ['sometimes', Rule::in(['pending', 'approved', 'rejected', 'stale', 'conflicted', 'cancelled'])]],
            default => ['page' => ['sometimes', 'integer', 'min:1']],
        };
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $allowed = array_filter(array_keys($this->rules()), fn ($key) => ! str_contains($key, '.'));
            if (array_diff(array_keys($this->all()), $allowed)) {
                $validator->errors()->add('request', 'Unknown fields are not accepted.');
            }
        });
    }
}
