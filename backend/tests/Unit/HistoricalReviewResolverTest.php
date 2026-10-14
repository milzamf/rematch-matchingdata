<?php

namespace Tests\Unit;

use App\Services\Matching\Reconciliation\HistoricalReviewResolver;
use PHPUnit\Framework\TestCase;

class HistoricalReviewResolverTest extends TestCase
{
    public function test_versioned_approval_actors_are_not_reinterpreted_as_legacy_reviewers(): void
    {
        $event = $this->decision();
        $event['reviewer_user_id'] = 4;
        $event['proposed_by_user_id'] = 7;
        $event['approved_by_user_id'] = 9;
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate('matched')], [$event]);
        $this->assertSame(['versioned_history_requires_reconciliation'], $result['issues']);
        $this->assertNull($result['effective_state']);
    }

    public function test_reviewed_snapshot_without_history_is_not_assumed_auto_matched(): void
    {
        $candidate = $this->candidate('matched');
        $candidate['review_decision'] = 'accept_match';
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$candidate], []);
        $this->assertSame(['decision_history_missing'], $result['issues']);
        $this->assertNull($result['effective_state']);
    }

    private function candidate(string $status = 'possible_match', string $key = '001'): array
    {
        return ['id' => 'candidate', 'matching_job_id' => 'job', 'input_record_key' => $key, 'candidate_rank' => 1,
            'result_type' => $status, 'reference_record_key' => 'ref'];
    }

    private function decision(string $action = 'accept_match', string $status = 'matched'): array
    {
        return ['id' => 'event', 'matching_job_id' => 'job', 'input_record_key' => '001', 'matching_result_id' => 'candidate',
            'decision' => $action, 'new_result_type' => $status, 'previous_result_type' => 'possible_match',
            'selected_reference_record_key' => 'ref', 'reviewer_user_id' => null,
            'created_at' => '2026-10-13 01:00:00', 'undone_at' => null, 'metadata' => []];
    }

    public function test_normal_auto_match_keeps_string_key_and_unknown_reviewer(): void
    {
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate('matched')], []);
        $this->assertFalse($result['requires_reconciliation']);
        $this->assertSame('001', $result['input_record_key']);
        $this->assertSame('matched', $result['effective_state']['status']);
        $this->assertNull($result['effective_state']['reviewer_user_id']);
    }

    public function test_single_accepted_history_preserves_null_actor_and_never_guesses_admin(): void
    {
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate('matched')], [$this->decision()]);
        $this->assertSame('accept_match', $result['effective_state']['decision']);
        $this->assertNull($result['effective_state']['reviewer_user_id']);
        $this->assertSame('legacy_unknown', $result['effective_state']['decision_protection']);
    }

    public function test_reject_and_mark_unmatched_have_different_effective_statuses(): void
    {
        foreach (['reject_match' => 'possible_match', 'mark_unmatched' => 'unmatched'] as $action => $status) {
            $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate($status)], [$this->decision($action, $status)]);
            $this->assertSame($status, $result['effective_state']['status']);
            $this->assertNull($result['effective_state']['selected_reference_record_key']);
        }
    }

    public function test_multiple_active_history_requires_reconciliation_regardless_of_score_or_order(): void
    {
        $events = [$this->decision(), array_replace($this->decision(), ['id' => 'second', 'created_at' => '2026-10-13 02:00:00'])];
        $resolver = new HistoricalReviewResolver;
        $a = $resolver->resolve('job', '001', [$this->candidate('matched')], $events);
        $b = $resolver->resolve('job', '001', [$this->candidate('matched')], array_reverse($events));
        $this->assertSame($a, $b);
        $this->assertNull($a['effective_state']);
        $this->assertSame(['multiple_active_decisions'], $a['issues']);
    }

    public function test_timestamp_tie_is_not_resolved_using_uuid_order(): void
    {
        $a = $this->decision();
        $b = array_replace($a, ['id' => 'second']);
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate('matched')], [$a, $b]);
        $this->assertSame(['history_timestamp_tie'], $result['issues']);
    }

    public function test_undo_restoration_and_actor_are_separate_from_original_reviewer(): void
    {
        $event = array_replace($this->decision(), ['reviewer_user_id' => 4, 'undone_at' => '2026-10-13 02:00:00', 'metadata' => ['undone_by_user_id' => 9]]);
        $result = (new HistoricalReviewResolver)->resolve('job', '001', [$this->candidate()], [$event]);
        $this->assertSame('possible_match', $result['effective_state']['status']);
        $this->assertNull($result['effective_state']['reviewer_user_id']);
        $this->assertSame(9, $result['effective_state']['last_modified_by_user_id']);
        $this->assertSame(4, $event['reviewer_user_id']);
    }

    public function test_invalid_undo_and_missing_candidate_are_held(): void
    {
        $event = array_replace($this->decision(), ['undone_at' => '2026-10-13 02:00:00']);
        $resolver = new HistoricalReviewResolver;
        $this->assertSame(['undo_restore_not_proven'], $resolver->resolve('job', '001', [$this->candidate('matched')], [$event])['issues']);
        $this->assertSame(['missing_primary_candidate'], $resolver->resolve('job', '001', [], [])['issues']);
    }

    public function test_001_and_1_cannot_be_used_as_each_others_evidence(): void
    {
        $result = (new HistoricalReviewResolver)->resolve('job', '1', [$this->candidate('matched', '1')], [$this->decision()]);
        $this->assertSame(['history_identity_mismatch'], $result['issues']);
    }

    public function test_wrong_reference_snapshot_and_unbounded_history_are_rejected(): void
    {
        $event = array_replace($this->decision(), ['selected_reference_record_key' => 'different']);
        $resolver = new HistoricalReviewResolver;
        $this->assertSame(['unproven_reference_assignment'], $resolver->resolve('job', '001', [$this->candidate('matched')], [$event])['issues']);
        $this->assertSame(['history_limit_exceeded'], $resolver->resolve('job', '001', [$this->candidate('matched')], [$this->decision()], 0)['issues']);
    }
}
