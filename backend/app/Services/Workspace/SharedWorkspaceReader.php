<?php

namespace App\Services\Workspace;

use App\Models\Dataset;
use App\Services\Datasets\DatasetInspectionService;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\Storage;

/** Isolated read model only. Never consults review_decisions for effective state. */
final class SharedWorkspaceReader
{
    private int $decodedBytes = 0;
    public function __construct(private readonly ConnectionInterface $db, private readonly WorkspaceAccessService $access)
    {
        $access->assertConnection($db);
    }

    public function workspace(int $actor, string $workspace): array
    {
        return $this->db->transaction(function () use ($actor, $workspace) {
            $a = $this->access->workspace($actor, $workspace, 'read', true);
            $w = $this->db->table('workspaces')->where('id', $workspace)->first(['id', 'name', 'user_id', 'status', 'matching_job_id', 'reference_dataset_id', 'input_dataset_id', 'configuration_version']);
            $owner = $this->db->table('users')->where('id', $w->user_id)->first(['id', 'name']);
            $datasets = [];
            foreach (['input_dataset_id', 'reference_dataset_id'] as $field) {
                if ($w->$field) {
                    $this->access->resource($actor, $workspace, 'dataset', $w->$field);
                    $datasets[$field] = $this->db->table('datasets')->where('id', $w->$field)->first(['id', 'name', 'dataset_role', 'row_count', 'column_count', 'parse_status', 'file_format']);
                }
            }
            $job = null;
            $configuration = null;
            if ($w->matching_job_id) {
                $scope = $this->scope($actor, $workspace, $w->matching_job_id);
                $job = $this->db->table('matching_jobs')->where('id', $w->matching_job_id)->first(['id', 'status', 'input_dataset_id', 'reference_dataset_id', 'processed_count', 'total_count', 'review_state_readiness', 'review_state_schema_version']);
                $job->datasets = [];
                foreach (['input_dataset_id', 'reference_dataset_id'] as $field) {
                    if (isset($datasets[$field]) && $datasets[$field]->id === $job->$field) {
                        $job->datasets[$field] = $datasets[$field];
                        continue;
                    }
                    $this->access->resource($actor, $workspace, 'dataset', $job->$field);
                    $job->datasets[$field] = $this->db->table('datasets')->where('id', $job->$field)->first(['id', 'name', 'dataset_role', 'row_count', 'column_count', 'parse_status', 'file_format']);
                }
                $job->ready = $this->ready($scope['job']);
                $job->region_filters_ready = ! $this->db->table('matching_results')->where('matching_job_id', $job->id)->where('candidate_rank', 1)->where('input_region_indexed', false)->exists();
                $job->review_counts = $job->ready ? $this->db->table('review_states')->where('matching_job_id', $job->id)->selectRaw('status, COUNT(*) as count')->groupBy('status')->pluck('count', 'status')->all() : null;
                if ($a['permissions']['configure']) $configuration = $this->db->table('matching_configurations')->where('matching_job_id', $job->id)->first(['preset', 'strategy', 'thresholds', 'normalization', 'candidate_generation']);
                if ($configuration) foreach (['thresholds', 'normalization', 'candidate_generation'] as $field) $configuration->$field = $configuration->$field === null ? null : json_decode($configuration->$field, true, 512, JSON_THROW_ON_ERROR);
            }
            return ['workspace' => $w, 'owner' => $owner, 'datasets' => $datasets, 'job' => $job, 'access' => $this->accessDto($a), 'configuration' => $configuration];
        });
    }

    private function accessDto(array $a): array
    {
        return ['role' => $a['role'], 'permissions' => $a['permissions'], 'membership_version' => $a['membership_version']];
    }

    private function scope(int $actor, string $workspace, string $job): array
    {
        $a = $this->access->job($actor, $job, 'read', true);
        if ($a['workspace']->id !== $workspace) throw new ReviewWriteConflict('workspace_resource_forbidden', [], 403);
        return $a;
    }

    private function ready(object $job): bool
    {
        return $job->status === 'completed' && $job->review_state_readiness === 'ready' && (int) $job->review_state_schema_version === 1;
    }

    private function requireReady(object $job): void
    {
        if (! $this->ready($job)) throw new ReviewWriteConflict('review_state_not_ready', ['readiness' => $job->review_state_readiness, 'schema_version' => $job->review_state_schema_version, 'job_status' => $job->status]);
    }

    public function review(int $actor, string $workspace, string $job, array $filters): array
    {
        $this->decodedBytes = 0;
        return $this->db->transaction(function () use ($actor, $workspace, $job, $filters) {
            $a = $this->scope($actor, $workspace, $job);
            $this->requireReady($a['job']);
            $summary = $this->db->table('review_states')->where('matching_job_id', $job)->selectRaw('status, COUNT(*) as count')->groupBy('status')->pluck('count', 'status')->all();
            $sort = $filters['sort'] ?? 'record_order';
            $scoreQuery = $sort !== 'record_order' || isset($filters['similarity_min']) || isset($filters['similarity_max']);
            $projected = $scoreQuery && ! $this->db->table('review_states')->where('matching_job_id', $job)->where('display_score_indexed', false)->exists();
            $candidateFilter = isset($filters['search']) || isset($filters['similarity_min']) || isset($filters['similarity_max']) || isset($filters['input_province_code']) || isset($filters['input_regency_code']);
            $joined = isset($filters['search']) || isset($filters['input_province_code']) || isset($filters['input_regency_code']) || ($scoreQuery && ! $projected);
            $q = $this->db->table('review_states as s')->where('s.matching_job_id', $job);
            if ($projected && $sort !== 'record_order') $q->useIndex('review_display_'.(isset($filters['status']) ? 'status' : 'all').'_'.($sort === 'similarity_desc' ? 'desc' : 'asc').'_idx');
            elseif (isset($filters['status']) && ! isset($filters['record_key'])) $q->useIndex('review_states_job_status_idx');
            if ($joined) $q->leftJoin('matching_results as p', fn ($j) => $j->on('p.matching_job_id', '=', 's.matching_job_id')->whereRaw('p.input_record_key = CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci')->whereRaw('s.input_record_key = CONVERT(p.input_record_key USING utf8mb4) COLLATE utf8mb4_0900_bin')->whereRaw('BINARY p.input_record_key = BINARY s.input_record_key')->where('p.candidate_rank', 1));
            if ($scoreQuery && ! $projected) $q->leftJoin('matching_results as c', fn ($j) => $j->on('c.id', '=', 's.selected_matching_result_id')->on('c.matching_job_id', '=', 's.matching_job_id')->on('c.input_record_key', '=', 's.input_record_key')->whereRaw('BINARY c.input_record_key = BINARY s.input_record_key'));
            $score = $projected ? 's.display_score' : 'CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END';
            if (isset($filters['record_key'])) $q->where('s.input_record_key', $filters['record_key']);
            if (isset($filters['record_keys'])) $q->whereIn('s.input_record_key', array_map('strval', $filters['record_keys']));
            if (isset($filters['statuses'])) $q->whereIn('s.status', $filters['statuses']);
            if (isset($filters['status'])) $q->where('s.status', $filters['status']);
            if (isset($filters['search'])) {
                $search = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $filters['search']).'%';
                $q->where(fn ($sub) => $sub->whereRaw("s.input_record_key LIKE ? ESCAPE '!'", [$search])->orWhereRaw("LOWER(JSON_EXTRACT(p.candidate_metadata, '$.input_record')) LIKE LOWER(?) ESCAPE '!'", [$search]));
            }
            foreach (['similarity_min' => '>=', 'similarity_max' => '<='] as $field => $op) if (isset($filters[$field])) $q->whereRaw("($score) $op ?", [$filters[$field]]);
            if (isset($filters['input_province_code']) || isset($filters['input_regency_code'])) {
                if ($this->db->table('matching_results')->where('matching_job_id', $job)->where('candidate_rank', 1)->where('input_region_indexed', false)->exists()) throw new ReviewWriteConflict('review_regions_not_ready');
            }
            foreach (['input_province_code', 'input_regency_code'] as $field) if (isset($filters[$field])) $q->where('p.'.$field, $filters[$field]);
            if ($candidateFilter || isset($filters['record_keys']) || isset($filters['statuses'])) {
                $countQuery = clone $q;
                // Counting a region need not traverse the score ordering. Allow
                // a covered region scan followed by exact state-key lookups.
                if (isset($filters['input_province_code']) || isset($filters['input_regency_code'])) {
                    $countQuery->from('matching_results as p')->useIndex('shared_region_count_idx');
                    $primaryJoin = clone $countQuery->joins[0];
                    $primaryJoin->table = 'review_states as s';
                    $primaryJoin->type = 'inner';
                    $countQuery->joins[0] = $primaryJoin;
                    $total = (int) $countQuery->selectRaw('STRAIGHT_JOIN COUNT(*) AS aggregate')->first()->aggregate;
                } else $total = $countQuery->count();
            }
            else {
                // The cumulative summary already counts the same snapshot.
                // Avoid a second full index scan on every unfiltered page.
                if (isset($filters['record_key'])) {
                    $countQuery = $this->db->table('review_states')->where('matching_job_id', $job)->where('input_record_key', $filters['record_key']);
                    if (isset($filters['status'])) $countQuery->where('status', $filters['status']);
                    $total = $countQuery->count();
                } else $total = isset($filters['status']) ? (int) ($summary[$filters['status']] ?? 0) : (int) array_sum($summary);
            }
            if (isset($filters['record_key']) && $total === 0) throw new ReviewWriteConflict('review_record_not_found', [], 404);
            if ($sort !== 'record_order') $q->orderByRaw($projected ? 's.display_score_null ASC' : "($score) IS NULL ASC")->orderByRaw("($score) ".($sort === 'similarity_desc' ? 'DESC' : 'ASC'));
            $limit = (int) ($filters['per_page'] ?? 25);
            $page = (int) ($filters['page'] ?? 1);
            // Page through the covering sort index before fetching wide states.
            // Deep offsets otherwise read every skipped clustered row.
            $pageIds = $q->orderBy('s.input_record_key')->offset(($page - 1) * $limit)->limit($limit)->select('s.id')->get()->pluck('id');
            $pageStates = $this->db->table('review_states')->whereIn('id', $pageIds)->get()->keyBy('id');
            $rows = $pageIds->map(fn ($id) => $pageStates->get($id));
            $ids = $rows->pluck('selected_matching_result_id')->filter()->all();
            $keys = $rows->pluck('input_record_key')->all();
            $candidateQuery = $this->db->table('matching_results')->where('matching_job_id', $job)->whereIn('input_record_key', $keys)
                ->where(fn ($f) => $f->where('candidate_rank', 1)->orWhereIn('id', $ids));
            $candidates = $this->boundedCandidates($candidateQuery);
            $candidateMap = $candidates->keyBy('id');
            $primary = $candidates->where('candidate_rank', 1)->keyBy('input_record_key');
            $actorIds = $rows->flatMap(fn ($s) => [$s->reviewer_user_id, $s->proposed_by_user_id, $s->approved_by_user_id, $s->last_modified_by_user_id])->filter()->unique()->all();
            $actors = $this->db->table('users')->whereIn('id', $actorIds)->pluck('name', 'id');
            $canonical = $this->db->table('review_states')->where('matching_job_id', $job)->whereIn('input_record_key', $rows->pluck('duplicate_of_input_record_key')->filter()->all())->get(['input_record_key', 'selected_reference_record_key', 'version', 'status'])->keyBy('input_record_key');
            $items = $rows->map(function ($s) use ($candidateMap, $primary, $actors, $a, $actor, $canonical) {
                $chosen = $s->selected_matching_result_id ? $candidateMap->get($s->selected_matching_result_id) : $primary->get($s->input_record_key);
                $proven = ! $s->selected_matching_result_id || ($chosen && $chosen->input_record_key === $s->input_record_key);
                if (! $proven) $chosen = null;
                $held = $s->integrity_status === 'held';
                $proposal = $s->decision_protection === 'approved' || ($s->decision_protection === 'reviewer_owned' && ($s->reviewer_user_id === null || (int) $s->reviewer_user_id !== $actor));
                return ['matching_job_id' => $s->matching_job_id, 'input_record_key' => $s->input_record_key, 'status' => $s->status, 'decision' => $s->decision, 'version' => (int) $s->version,
                    'decision_origin' => $s->decision_origin, 'decision_protection' => $s->decision_protection, 'integrity_status' => $s->integrity_status,
                    'selected_matching_result_id' => $s->selected_matching_result_id, 'selected_reference_record_key' => $s->selected_reference_record_key, 'selected_reference_entity_group_id' => $s->selected_reference_entity_group_id,
                    'duplicate_of_input_record_key' => $s->duplicate_of_input_record_key, 'source_occurrence_count' => $s->source_occurrence_count, 'lineage_status' => $s->lineage_status,
                    'canonical' => $s->duplicate_of_input_record_key ? $canonical->get($s->duplicate_of_input_record_key) : null, 'selected_candidate_valid' => $proven,
                    'actors' => array_combine(['reviewer', 'proposer', 'approver', 'last_modifier'], array_map(fn ($id) => ['id' => $id, 'name' => $id ? $actors->get($id) : null], [$s->reviewer_user_id, $s->proposed_by_user_id, $s->approved_by_user_id, $s->last_modified_by_user_id])),
                    'similarity_score' => $chosen?->overall_score === null ? null : (float) $chosen->overall_score, 'displayed_candidate' => $chosen ? $this->candidate($chosen) : null,
                    'actions' => ['requires_proposal' => $proposal, 'review' => $a['permissions']['review'] && ! $held && $proven && ! $proposal && $s->status !== 'duplicate_input', 'propose' => $a['permissions']['propose'] && ! $held && $proven && $proposal && $s->status !== 'duplicate_input']];
            })->all();
            return ['source' => 'review_states', 'ready' => true, 'access' => $this->accessDto($a), 'summary' => $summary, 'data' => $items, 'pagination' => $this->pagination($total, $page, $limit)];
        });
    }

    public function candidates(int $actor, string $workspace, string $job, string $key, array $filters): array
    {
        $this->decodedBytes = 0;
        return $this->db->transaction(function () use ($actor, $workspace, $job, $key, $filters) {
            $a = $this->scope($actor, $workspace, $job);
            $this->requireReady($a['job']);
            $state = $this->db->table('review_states')->where('matching_job_id', $job)->where('input_record_key', $key)->first();
            if (! $state) throw new ReviewWriteConflict('review_record_not_found', [], 404);
            $q = $this->db->table('matching_results')->where('matching_job_id', $job)->where('input_record_key', $key)->whereRaw('BINARY input_record_key = BINARY ?', [$key]);
            if (isset($filters['rank'])) $q->where('candidate_rank', $filters['rank']);
            $count = (clone $q)->count();
            $page = (int) ($filters['page'] ?? 1); $limit = (int) ($filters['per_page'] ?? 25);
            $rows = $this->boundedCandidates($q->orderBy('candidate_rank')->orderBy('id')->offset(($page - 1) * $limit)->limit($limit));
            $refs = $rows->pluck('reference_record_key')->all();
            $groups = $this->db->table('reference_entity_members')->where('reference_dataset_id', $a['job']->reference_dataset_id)->whereIn('reference_record_key', $refs)->pluck('reference_entity_group_id', 'reference_record_key');
            $holds = $this->db->table('review_reference_holds')->where('matching_job_id', $job)->where('status', 'active')->where(fn ($h) => $h->whereIn('reference_record_key', $refs)->orWhereIn('reference_entity_group_id', $groups->values()->all()))->get();
            $claims = $this->db->table('review_states')->where('matching_job_id', $job)->where(fn ($h) => $h->whereIn('active_reference_record_key', $refs)->orWhereIn('active_reference_entity_group_id', $groups->values()->all()))->get(['input_record_key', 'active_reference_record_key', 'active_reference_entity_group_id']);
            // Verified groups can be added after an assignment; the writer also checks
            // member references when a historical state's group projection is still NULL.
            $groupClaims = $this->db->table('reference_entity_members as m')->join('review_states as s', fn ($j) => $j->on('s.active_reference_record_key', '=', 'm.reference_record_key')->where('s.matching_job_id', $job))
                ->where('m.reference_dataset_id', $a['job']->reference_dataset_id)->whereIn('m.reference_entity_group_id', $groups->values()->all())->where('s.input_record_key', '<>', $key)
                ->distinct()->pluck('m.reference_entity_group_id')->all();
            $items = $rows->map(function ($r) use ($holds, $claims, $groups, $key, $groupClaims) {
                $group = $groups->get($r->reference_record_key);
                $held = $holds->contains(fn ($h) => $h->reference_record_key === $r->reference_record_key || ($group && $h->reference_entity_group_id === $group));
                $occupied = ($group && in_array($group, $groupClaims, true)) || $claims->contains(fn ($c) => $c->input_record_key !== $key && ($c->active_reference_record_key === $r->reference_record_key || ($group && $c->active_reference_entity_group_id === $group)));
                return $this->candidate($r) + ['reference_entity_group_id' => $group, 'integrity_hold' => $held, 'reference_occupied' => $occupied];
            })->all();
            return ['input_record_key' => $key, 'version' => (int) $state->version, 'status' => $state->status, 'data' => $items, 'pagination' => $this->pagination($count, $page, $limit)];
        });
    }

    private function candidate(object $row): array
    {
        $metadata = $this->decode($row->candidate_metadata) ?? [];
        if (isset($metadata['_reference_snapshot']) || isset($metadata['_input_primary'])) {
            $model = new \App\Models\MatchingResult;
            $model->setRawAttributes((array) $row);
            $metadata = $model->candidate_metadata;
            $this->decodedBytes += strlen(json_encode([$metadata['input_record'] ?? [], $metadata['reference_record'] ?? []], JSON_THROW_ON_ERROR));
            if ($this->decodedBytes > 2097152) throw new ReviewWriteConflict('reader_payload_too_large', [], 413);
        }
        return ['id' => $row->id, 'input_record_key' => $row->input_record_key, 'reference_record_key' => $row->reference_record_key,
            'rank' => (int) $row->candidate_rank, 'score' => $row->overall_score === null ? null : (float) $row->overall_score,
            'input_record' => $metadata['input_record'] ?? [], 'reference_record' => $metadata['reference_record'] ?? [],
            'initial_result_type' => $row->result_type,
            'input_snapshot_available' => isset($metadata['input_record']), 'reference_snapshot_available' => isset($metadata['reference_record']),
            'field_scores' => $this->decode(is_string($metadata['_field_scores'] ?? null) ? $metadata['_field_scores'] : $row->field_scores) ?? [], 'verification_evidence' => $this->decode($row->verification_evidence ?? (is_string($metadata['_verification_evidence'] ?? null) ? $metadata['_verification_evidence'] : null)), 'decision_reason' => $row->decision_reason];
    }

    private function boundedCandidates($query)
    {
        $sizes = (clone $query)->select('id')->selectRaw('COALESCE(OCTET_LENGTH(candidate_metadata),0)+COALESCE(OCTET_LENGTH(field_scores),0)+COALESCE(OCTET_LENGTH(verification_evidence),0) AS bytes')->get();
        if ($sizes->sum('bytes') > 2097152) throw new ReviewWriteConflict('reader_payload_too_large', ['max_bytes' => 2097152], 413);
        return $this->db->table('matching_results')->whereIn('id', $sizes->pluck('id')->all())->orderBy('candidate_rank')->orderBy('id')->get();
    }

    private function decode(?string $json): ?array
    {
        if ($json === null) return null;
        if (str_starts_with($json, 'gz1:')) {
            $bytes = base64_decode(substr($json, 4), true);
            $json = $bytes === false ? false : @gzdecode($bytes, 2097152);
            if ($json === false) throw new ReviewWriteConflict('reader_payload_too_large', [], 413);
        }
        $this->decodedBytes += strlen($json);
        if ($this->decodedBytes > 2097152) throw new ReviewWriteConflict('reader_payload_too_large', [], 413);
        $value = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($value)) throw new ReviewWriteConflict('reader_payload_invalid');
        return $value;
    }

    public function dataset(int $actor, string $workspace, string $dataset, array $filters): array
    {
        $this->access->resource($actor, $workspace, 'dataset', $dataset);
        $row = $this->db->table('datasets')->where('id', $dataset)->first();
        $model = new Dataset; $model->setRawAttributes((array) $row);
        $file = false;
        foreach (['local', 'public'] as $disk) if ($model->storage_path && is_file(Storage::disk($disk)->path($model->storage_path))) $file = true;
        $sourceCount = (int) $model->row_count;
        if (! $file) $model->row_count = count($model->preview_rows ?? []); // Unsaved copy; never pretend snapshot is full dataset.
        $result = app(DatasetInspectionService::class)->getPaginatedRows($model, (int) ($filters['page'] ?? 1), (int) ($filters['per_page'] ?? 25), $filters['search'] ?? null);
        $this->access->resource($actor, $workspace, 'dataset', $dataset); // Reauthorize after file I/O.
        return $result + ['dataset_id' => $dataset, 'source' => $file ? 'source_file' : 'preview_snapshot', 'source_row_count' => $sourceCount, 'partial' => ! $file];
    }

    public function assertExport(int $actor, string $workspace, string $job): void
    {
        $a = $this->scope($actor, $workspace, $job);
        $this->requireReady($a['job']);
        if (! $a['permissions']['export_read']) throw new ReviewWriteConflict('workspace_forbidden', [], 403);
    }

    /** Keyset export; every bounded chunk is reauthorized, no legacy decisions. */
    public function exportRows(int $actor, string $workspace, string $job): \Generator
    {
        $last = null;
        do {
            $rows = $this->db->transaction(function () use ($actor, $workspace, $job, $last) {
                $this->assertExport($actor, $workspace, $job);
                $q = $this->db->table('review_states as s')->where('s.matching_job_id', $job);
                if ($last !== null) $q->where('s.input_record_key', '>', $last);
                return $q->leftJoin('matching_results as p', fn ($j) => $j->on('p.matching_job_id', '=', 's.matching_job_id')->whereRaw('p.input_record_key = CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci')->whereRaw('BINARY p.input_record_key = BINARY s.input_record_key')->where('p.candidate_rank', 1))
                    ->leftJoin('matching_results as c', fn ($j) => $j->on('c.id', '=', 's.selected_matching_result_id')->on('c.matching_job_id', '=', 's.matching_job_id')->whereRaw('BINARY c.input_record_key = BINARY s.input_record_key'))
                    ->orderBy('s.input_record_key')->limit(500)->get(['s.input_record_key', 's.status', 's.decision', 's.selected_reference_record_key', 's.version', 's.reviewer_user_id', $this->db->raw('CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END AS score')]);
            });
            foreach ($rows as $row) { $last = $row->input_record_key; yield (array) $row; }
        } while ($rows->count() === 500);
    }

    private function pagination(int $count, int $page, int $limit): array
    {
        return ['total' => $count, 'current_page' => $page, 'per_page' => $limit, 'last_page' => max(1, (int) ceil($count / $limit))];
    }
}
