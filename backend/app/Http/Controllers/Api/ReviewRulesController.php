<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchingConfiguration;
use App\Support\Auth\ResourceOwnership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ReviewRulesController extends Controller
{
    public function __construct(private readonly ResourceOwnership $ownership)
    {
    }

    public function index(Request $request, string $job): JsonResponse
    {
        $jobModel = $this->ownership->findMatchingJob($request->user(), $job);
        $config = $jobModel->configuration;
        $rules = data_get($config?->advanced_settings, 'custom_review_rules', []);

        if (empty($rules) && $jobModel->workspace) {
            $rules = data_get($jobModel->workspace->workflow_state, 'custom_review_rules', []);
        }

        return response()->json([
            'success' => true,
            'data' => $rules,
        ]);
    }

    public function store(Request $request, string $job): JsonResponse
    {
        $jobModel = $this->ownership->findMatchingJob($request->user(), $job);

        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'description' => 'nullable|string|max:500',
            'action_recommendation' => 'nullable|string|in:accept,reject,manual',
            'conditions' => 'required|array|min:1',
            'conditions.*.source' => 'nullable|string|in:input,reference,comparison',
            'conditions.*.field' => 'required|string|max:100',
            'conditions.*.operator' => 'required|string|in:equals,not_equals,contains,does_not_contain,greater_than,less_than,is_empty,is_not_empty',
            'conditions.*.value' => 'nullable',
        ]);

        $newRule = [
            'id' => (string) Str::uuid(),
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'type' => 'custom_rule',
            'action_recommendation' => $validated['action_recommendation'] ?? 'manual',
            'conditions' => $validated['conditions'],
            'created_at' => now()->toISOString(),
        ];

        $config = $jobModel->configuration ?? MatchingConfiguration::firstOrNew(['matching_job_id' => $jobModel->id]);
        if (! $config->exists) {
            $config->preset = 'custom';
            $config->strategy = 'hybrid';
            $config->config_hash = sha1((string) $jobModel->id);
        }
        $advanced = $config->advanced_settings ?? [];
        $rules = $advanced['custom_review_rules'] ?? [];
        $rules[] = $newRule;
        $advanced['custom_review_rules'] = $rules;
        $config->advanced_settings = $advanced;
        $config->save();

        if ($jobModel->workspace) {
            $ws = $jobModel->workspace;
            $wf = $ws->workflow_state ?? [];
            $wf['custom_review_rules'] = $rules;
            $ws->workflow_state = $wf;
            $ws->save();
        }

        return response()->json([
            'success' => true,
            'data' => $newRule,
            'rules' => $rules,
        ], 201);
    }

    public function destroy(Request $request, string $job, string $ruleId): JsonResponse
    {
        $jobModel = $this->ownership->findMatchingJob($request->user(), $job);
        $config = $jobModel->configuration;

        if ($config) {
            $advanced = $config->advanced_settings ?? [];
            $rules = $advanced['custom_review_rules'] ?? [];
            $rules = array_values(array_filter($rules, fn ($r) => ($r['id'] ?? '') !== $ruleId));
            $advanced['custom_review_rules'] = $rules;
            $config->advanced_settings = $advanced;
            $config->save();

            if ($jobModel->workspace) {
                $ws = $jobModel->workspace;
                $wf = $ws->workflow_state ?? [];
                $wf['custom_review_rules'] = $rules;
                $ws->workflow_state = $wf;
                $ws->save();
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Custom review rule deleted.',
        ]);
    }
}
