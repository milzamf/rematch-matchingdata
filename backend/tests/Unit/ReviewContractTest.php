<?php

namespace Tests\Unit;

use App\Models\ReviewDecision;
use App\Services\Matching\ReviewContract;
use PHPUnit\Framework\TestCase;

class ReviewContractTest extends TestCase
{
    public function test_mapping_preserves_rejected_candidate_as_pending(): void
    {
        foreach (['accept_match' => 'matched', 'select_candidate' => 'matched',
            'reject_match' => 'possible_match', 'mark_unmatched' => 'unmatched'] as $action => $status) {
            $this->assertSame($status, ReviewContract::resultType($action));
        }
        $this->expectException(\InvalidArgumentException::class);
        ReviewContract::resultType('duplicate');
    }

    public function test_missing_lineage_and_entity_counts_are_not_invented(): void
    {
        $unknown = ReviewContract::accounting([], 5);
        $this->assertNull($unknown['source_row_count']);
        $this->assertNull($unknown['unique_input_record_count']);
        $this->assertNull($unknown['deduplicated_input_row_count']);
        $known = ReviewContract::accounting(['total_raw_input' => 10, 'total_unique_input' => 8, 'total_duplicates' => 2], 5);
        $this->assertSame(10, $known['source_row_count']);
        $this->assertSame(8, $known['unique_input_record_count']);
        $this->assertSame(2, $known['deduplicated_input_row_count']);
        $this->assertSame(5, $known['matched_input_record_count']);
        $this->assertNull($known['matched_entity_count']);
        $this->assertNull($known['verified_duplicate_entity_count']);
        $this->assertSame('unverified', $known['lineage_status']);
    }

    public function test_legacy_actor_does_not_use_frontend_label_as_identity(): void
    {
        $decision = new ReviewDecision(['metadata' => ['reviewer' => 'local_frontend']]);
        $actors = ReviewContract::actors($decision);
        $this->assertNull($actors['reviewer_user_id']);
        $this->assertNull($actors['last_modified_by_user_id']);
        $this->assertNull($actors['proposed_by_user_id']);
        $this->assertNull($actors['approved_by_user_id']);
        $this->assertSame('unknown_legacy', $actors['attribution']);
    }
}
