<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use App\Models\User;
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Support\Facades\DB;

/** Keep the established review DTO/layout; effective outcomes come only from review_states. */
trait VersionedReviewPresentation
{
    private function versionedList(User $user, string $jobId, array $params): array
    {
        $db = DB::connection();
        $access = new WorkspaceAccessService($db, (bool) config('workspace_access.enabled'));
        $access->guard();
        return $db->transaction(function () use ($db, $access, $user, $jobId, $params) {
            $actor = (int) $user->getKey();
            $scope = $access->job($actor, $jobId, 'read', true);
            $job = MatchingJob::findOrFail($jobId);
            if ($job->status !== 'completed' || $job->review_state_readiness !== 'ready' || (int) $job->review_state_schema_version !== 1) {
                throw new Transactions\ReviewWriteConflict('review_state_not_ready');
            }
            $workspace = $scope['workspace']->id;
            $reader = new SharedWorkspaceReader($db, $access);
            // Readiness and permissions are checked before any legacy diagnostic cache is used.
            $filters = array_filter(array_intersect_key($params, array_flip([
                'page', 'per_page', 'sort', 'search', 'similarity_min', 'similarity_max',
                'input_province_code', 'input_regency_code',
            ])), fn ($v) => $v !== null && $v !== '');
            $filters['page'] = max(1, (int) ($filters['page'] ?? 1));
            $filters['per_page'] = min(100, max(10, (int) ($filters['per_page'] ?? 25)));
            $status = $params['status'] ?? $params['filter'] ?? 'all';
            if ($status === 'possible_match') $filters['statuses'] = ['possible_match', 'reference_conflict'];
            elseif ($status !== 'all') $filters['status'] = $status;
            if (isset($params['input_keys'])) $filters['record_keys'] = array_map('strval', $params['input_keys']);

            $rules = data_get($job->configuration?->advanced_settings, 'custom_review_rules', [])
                ?: data_get($job->workspace?->workflow_state, 'custom_review_rules', []);
            $includeGroups = filter_var($params['include_groups'] ?? true, FILTER_VALIDATE_BOOLEAN);
            $groupId = trim((string) ($params['case_group_id'] ?? ''));
            $groups = ['system_presets' => [], 'custom_rules' => [], 'dynamic_patterns' => [], 'case_groups' => []];
            if ($includeGroups || $groupId !== '') {
                // Only current state projects a decision. Audit rows are explanations, never winners.
                $current = collect();
                foreach ($db->table('review_states')->where('matching_job_id', $jobId)->whereNotNull('decision')->orderBy('id')->lazyById(500) as $state) {
                    $current->put((string) $state->input_record_key, $this->stateDecision($state));
                }
                $groups = $this->aggregateJobReviewGroups($job, $current, collect(), $rules, $current->count(), ! $includeGroups);
                if ($groupId !== '') {
                    $group = collect($groups['case_groups'])->firstWhere('id', $groupId);
                    if (! $group) throw (new \Illuminate\Database\Eloquent\ModelNotFoundException())->setModel('ReviewCaseGroup', [$groupId]);
                    $filters['record_keys'] = array_map('strval', $group['item_keys']);
                }
            }
            $page = $reader->review($actor, $workspace, $jobId, $filters);
            $keys = array_column($page['data'], 'input_record_key');
            $states = $db->table('review_states')->where('matching_job_id', $jobId)->whereIn('input_record_key', $keys)->get()->keyBy('input_record_key');
            $current = $states->filter(fn ($s) => $s->decision !== null)->map(fn ($s) => $this->stateDecision($s));
            $history = ReviewDecision::where('matching_job_id', $jobId)->whereIn('input_record_key', $keys)->orderByDesc('created_at')->orderByDesc('id')->get()->groupBy('input_record_key');
            $undoOperations = $db->table('review_states')->where('matching_job_id', $jobId)
                ->whereIn('last_operation_id', $states->pluck('last_operation_id')->filter()->unique()->all())
                ->limit(5001)->get(['input_record_key', 'version', 'last_operation_id'])->groupBy('last_operation_id');
            $results = MatchingResult::where('matching_job_id', $jobId)->whereIn('input_record_key', $keys)->orderBy('candidate_rank')->get();
            $items = $this->transformResultsToItems($results, $current, $history, $rules)->keyBy('input_record_key');
            $items = collect($page['data'])->map(function ($row) use ($items, $states, $history, $undoOperations) {
                $key = $row['input_record_key'];
                $item = $items->get($key);
                if (! $item) return null;
                $state = $states->get($key);
                $audit = $history->get($key, collect())->first(fn ($a) => $a->review_state_id === $state->id && (int) $a->state_version_after === (int) $state->version);
                if ($item['decision'] && $audit && $audit->decision !== 'undo') $item['decision'] = $this->decisionPayload($audit);
                if ($item['decision'] && $audit?->decision === 'undo') $item['decision']['operation_id'] = null;
                if ($item['decision'] && $state->last_operation_id && $audit?->decision !== 'undo') {
                    $item['decision']['undo_items'] = $undoOperations->get($state->last_operation_id, collect())->map(fn ($s) => ['input_record_key' => $s->input_record_key, 'expected_version' => (int) $s->version])->all();
                }
                $item['status'] = $row['status'] === 'reference_conflict' ? 'possible_match' : $row['status'];
                if ($row['status'] === 'reference_conflict') $item['display_status'] = 'need_review';
                return [...$item, 'version' => $row['version'], 'operation_id' => $state->last_operation_id,
                    'review_status' => $state->decision === null ? 'pending' : 'reviewed',
                    'decision_origin' => $row['decision_origin'], 'decision_protection' => $row['decision_protection'],
                    'reviewer_user_id' => $state->reviewer_user_id,
                    'integrity_status' => $row['integrity_status'], 'actions' => $row['actions']];
            })->filter()->values()->all();

            if ($includeGroups) {
                // Capture CAS tokens when showing a group, not when its decision is submitted.
                $decorated = [];
                foreach ($groups['case_groups'] as &$group) {
                        $group['review_versions'] = [];
                        $group['review_candidates'] = [];
                        $pending = 0; $found = 0;
                        foreach (array_chunk(array_map('strval', $group['item_keys']), 500) as $chunk) {
                            foreach ($db->table('review_states')->where('matching_job_id', $jobId)->whereIn('input_record_key', $chunk)->get(['input_record_key', 'version', 'selected_matching_result_id', 'status', 'integrity_status']) as $s) {
                                $found++;
                                if (in_array($s->status, ['possible_match', 'reference_conflict'], true) || $s->integrity_status === 'held') $pending++;
                                $group['review_versions']['key:'.$s->input_record_key] = (int) $s->version;
                                if ($s->selected_matching_result_id) $group['review_candidates']['key:'.$s->input_record_key] = $s->selected_matching_result_id;
                            }
                            foreach ($db->table('matching_results')->where('matching_job_id', $jobId)->whereIn('input_record_key', $chunk)->where('candidate_rank', 1)->get(['input_record_key', 'id']) as $r) {
                                $group['review_candidates']['key:'.$r->input_record_key] ??= $r->id;
                            }
                        }
                        $pending += max(0, $group['item_count'] - $found);
                        $group['decision_summary']['pending'] = $pending;
                        $group['status'] = $pending ? 'open' : 'resolved';
                        $group['eligible_for_bulk'] = $group['eligible_for_bulk'] && $pending > 0;
                        $decorated[$group['id']] = $group;
                    }
                unset($group);
                foreach (['system_presets', 'custom_rules', 'dynamic_patterns'] as $section) {
                    $groups[$section] = array_map(fn ($group) => $decorated[$group['id']] ?? $group, $groups[$section]);
                }
            }
            $counts = $page['summary'];
            $decisions = $db->table('review_states')->where('matching_job_id', $jobId)->whereNotNull('decision')->selectRaw('decision, COUNT(*) AS n')->groupBy('decision')->pluck('n', 'decision');
            $matched = (int) ($counts['matched'] ?? 0);
            $accepted = (int) ($decisions['accept_match'] ?? 0) + (int) ($decisions['select_candidate'] ?? 0);
            $raw = $job->record_counts ?? [];
            $total = (int) array_sum($counts);
            $p = $page['pagination'];
            return ['contract_version' => ReviewContract::VERSION, 'source' => 'review_states', 'workspace_id' => $workspace,
                'access' => ['workspace_id' => $workspace, ...$page['access']],
                'comparison_columns' => ['input' => $job->inputDataset?->columns()->pluck('name')->all() ?? [], 'reference' => $job->referenceDataset?->columns()->pluck('name')->all() ?? []],
                'job' => ['id' => $jobId, 'name' => $job->name, 'status' => $job->status, 'thresholds' => $job->configuration?->thresholds],
                'summary' => ['matched' => $matched, 'possible_match' => (int) ($counts['possible_match'] ?? 0) + (int) ($counts['reference_conflict'] ?? 0),
                    'unmatched' => (int) ($counts['unmatched'] ?? 0), 'duplicate_input' => (int) ($counts['duplicate_input'] ?? 0),
                    'auto_matched' => max(0, $matched - $accepted), 'manual_accepted' => $accepted,
                    'manual_rejected' => (int) ($decisions['reject_match'] ?? 0), 'reviewed' => (int) $decisions->sum(),
                    'total_raw_input' => $raw['total_raw_input'] ?? $job->inputDataset?->row_count ?? $total,
                    'total_unique_input' => $raw['total_unique_input'] ?? $total, 'total_duplicates' => $raw['total_duplicates'] ?? 0,
                    'duplicate_details' => $raw['duplicate_details'] ?? [], 'processed_count' => $job->processed_count,
                    'is_completed' => true, 'unprocessed_count' => 0, 'accounting' => ReviewContract::accounting($raw, $matched)],
                'pagination' => ['current_page' => $p['current_page'], 'per_page' => $p['per_page'], 'total_items' => $p['total'], 'total_pages' => $p['last_page'],
                    'from' => $p['total'] ? ($p['current_page'] - 1) * $p['per_page'] + 1 : 0, 'to' => min($p['total'], $p['current_page'] * $p['per_page'])],
                'items' => $items, ...($includeGroups ? $groups : ['system_presets' => [], 'custom_rules' => [], 'dynamic_patterns' => [], 'case_groups' => []]),
                'field_quality_summary' => filter_var($params['include_quality'] ?? $includeGroups, FILTER_VALIDATE_BOOLEAN) ? $this->aggregateFieldQuality($job, $total) : [],
                'is_processing' => false];
        });
    }

    private function stateDecision(object $state): ReviewDecision
    {
        return (new ReviewDecision)->forceFill([
            'id' => $state->id, 'input_record_key' => $state->input_record_key, 'decision' => $state->decision,
            'new_result_type' => $state->status, 'matching_result_id' => $state->selected_matching_result_id,
            'selected_reference_record_key' => $state->selected_reference_record_key,
            'reviewer_user_id' => $state->reviewer_user_id, 'proposed_by_user_id' => $state->proposed_by_user_id,
            'approved_by_user_id' => $state->approved_by_user_id, 'last_modified_by_user_id' => $state->last_modified_by_user_id,
            'review_state_id' => $state->id, 'review_operation_id' => $state->last_operation_id,
            'created_at' => $state->updated_at, 'metadata' => [],
        ]);
    }
}
