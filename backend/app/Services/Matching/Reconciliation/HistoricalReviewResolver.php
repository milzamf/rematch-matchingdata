<?php

namespace App\Services\Matching\Reconciliation;

use App\Services\Matching\ReviewContract;
use DateTimeImmutable;
use Throwable;

/** Read-only reconstruction proposal. Never selects a winner for ambiguous history. */
final class HistoricalReviewResolver
{
    public function resolve(string $jobId, string $inputKey, array $candidates, iterable $history, int $historyLimit = 2000): array
    {
        $events = [];
        foreach ($history as $event) {
            // This milestone reconstructs the legacy source, never mixes it with a versioned workflow.
            foreach (['review_state_id', 'review_operation_id', 'change_request_id', 'state_version_before', 'state_version_after', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'] as $field) {
                if (($event[$field] ?? null) !== null) {
                    return $this->held($inputKey, 'versioned_history_requires_reconciliation');
                }
            }
            if (count($events) >= $historyLimit) {
                return $this->held($inputKey, 'history_limit_exceeded');
            }
            if (! empty($event['metadata']['audit_truncated'])) {
                return $this->held($inputKey, 'history_payload_limit_exceeded');
            }
            if (($event['matching_job_id'] ?? null) !== $jobId || ($event['input_record_key'] ?? null) !== $inputKey) {
                return $this->held($inputKey, 'history_identity_mismatch');
            }
            try {
                if (empty($event['created_at'])) {
                    return $this->held($inputKey, 'missing_history_timestamp');
                }
                $created = new DateTimeImmutable($event['created_at']);
                $event['_time'] = [$created->getTimestamp(), $created->format('u')];
                if (! empty($event['undone_at']) && new DateTimeImmutable($event['undone_at']) < $created) {
                    return $this->held($inputKey, 'invalid_undo_timestamp');
                }
                if (ReviewContract::resultType($event['decision']) !== ($event['new_result_type'] ?? null)) {
                    return $this->held($inputKey, 'decision_status_mismatch');
                }
            } catch (Throwable) {
                return $this->held($inputKey, 'unsupported_or_invalid_history');
            }
            $events[] = $event;
        }
        usort($events, fn ($a, $b) => ($a['_time'] <=> $b['_time']) ?: strcmp($a['id'], $b['id']));
        // UUID ordering is deterministic for reports, but cannot prove causal order within a second.
        for ($i = 1; $i < count($events); $i++) {
            if ($events[$i]['_time'] === $events[$i - 1]['_time']) {
                return $this->held($inputKey, 'history_timestamp_tie');
            }
        }
        $primary = null;
        $byId = [];
        foreach ($candidates as $candidate) {
            if (($candidate['matching_job_id'] ?? null) !== $jobId || ($candidate['input_record_key'] ?? null) !== $inputKey) {
                return $this->held($inputKey, 'candidate_identity_mismatch');
            }
            $byId[$candidate['id']] = $candidate;
            if ($candidate['candidate_rank'] === 1) {
                if ($primary !== null) {
                    return $this->held($inputKey, 'multiple_primary_candidates');
                }
                $primary = $candidate;
            }
        }
        if ($primary === null) {
            return $this->held($inputKey, 'missing_primary_candidate');
        }
        $active = array_values(array_filter($events, fn ($event) => empty($event['undone_at'])));
        if (count($active) > 1) {
            return $this->held($inputKey, 'multiple_active_decisions');
        }
        if ($active === []) {
            if (count($events) > 1) {
                return $this->held($inputKey, 'complex_undo_history');
            }
            $undo = $events[0] ?? null;
            if ($undo === null && ! empty($primary['review_decision'])) {
                return $this->held($inputKey, 'decision_history_missing');
            }
            if ($undo !== null) {
                $target = $byId[$undo['matching_result_id'] ?? ''] ?? null;
                if ($target === null || ! isset($undo['previous_result_type']) || $target['result_type'] !== $undo['previous_result_type']) {
                    return $this->held($inputKey, 'undo_restore_not_proven');
                }
            }
            $status = $primary['result_type'];
            if (! in_array($status, ['matched', 'possible_match', 'unmatched'], true)) {
                return $this->held($inputKey, 'unsupported_base_status');
            }
            if ($status === 'matched' && $primary['reference_record_key'] === null) {
                return $this->held($inputKey, 'missing_reference_assignment');
            }

            return $this->proposal($inputKey, $status, null, $status === 'matched' ? $primary : null, null,
                $undo['metadata']['undone_by_user_id'] ?? null, $undo === null ? 'auto' : 'legacy');
        }
        $decision = $active[0];
        $target = $byId[$decision['matching_result_id'] ?? ''] ?? null;
        if ($target === null && $decision['decision'] !== 'mark_unmatched') {
            return $this->held($inputKey, 'missing_selected_candidate');
        }
        if ($target !== null && $target['result_type'] !== $decision['new_result_type']) {
            return $this->held($inputKey, 'candidate_snapshot_conflict');
        }
        if ($target === null && array_filter($candidates, fn ($candidate) => $candidate['result_type'] !== 'unmatched')) {
            return $this->held($inputKey, 'unmatched_snapshot_conflict');
        }
        if ($decision['new_result_type'] === 'matched'
            && ($target['reference_record_key'] === null || $target['reference_record_key'] !== $decision['selected_reference_record_key'])) {
            return $this->held($inputKey, 'unproven_reference_assignment');
        }

        return $this->proposal($inputKey, $decision['new_result_type'], $decision['decision'],
            $decision['new_result_type'] === 'matched' ? $target : null,
            $decision['reviewer_user_id'] ?? null, $decision['reviewer_user_id'] ?? null, 'legacy');
    }

    private function held(string $key, string $reason): array
    {
        return ['input_record_key' => $key, 'effective_state' => null, 'requires_reconciliation' => true, 'issues' => [$reason]];
    }

    private function proposal(string $key, string $status, ?string $decision, ?array $candidate, ?int $reviewer, ?int $modifier, string $origin): array
    {
        return ['input_record_key' => $key, 'requires_reconciliation' => false, 'issues' => [], 'effective_state' => [
            'status' => $status, 'decision' => $decision,
            'selected_reference_record_key' => $candidate['reference_record_key'] ?? null,
            'selected_matching_result_id' => $candidate['id'] ?? null,
            'reviewer_user_id' => $reviewer, 'last_modified_by_user_id' => $modifier,
            'proposed_by_user_id' => null, 'approved_by_user_id' => null,
            'decision_origin' => $origin, 'decision_protection' => $reviewer === null ? 'legacy_unknown' : 'reviewer_owned',
        ]];
    }
}
