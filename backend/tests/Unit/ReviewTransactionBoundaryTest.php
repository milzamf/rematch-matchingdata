<?php

namespace Tests\Unit;

use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReviewTransactionBoundaryTest extends TestCase
{
    public function test_feature_default_does_not_activate_new_writer(): void
    {
        $this->assertFalse((bool) config('review_transactions.enabled'));
        try {
            (new ReviewTransactionService(DB::connection()))->decide(1, 'job', 'key', []);
        } catch (ReviewWriteConflict $error) {
            $this->assertSame(503, $error->getStatusCode());
            $this->assertSame('review_transactions_disabled', $error->reason);

            return;
        }
        $this->fail('Default writer was activated');
    }

    public function test_flag_override_cannot_write_outside_isolated_mysql(): void
    {
        try {
            (new ReviewTransactionService(DB::connection(), true))->decide(1, 'job', 'key', []);
        } catch (ReviewWriteConflict $error) {
            $this->assertSame('review_transactions_disabled', $error->reason);

            return;
        }
        $this->fail('Isolation guard bypassed');
    }

    public function test_conflict_renders_structured_http_409(): void
    {
        $response = (new ReviewWriteConflict('stale_review_version', ['current_version' => 2]))->render();
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame(['success' => false, 'code' => 'stale_review_version', 'details' => ['current_version' => 2]], json_decode($response->getContent(), true));
    }
}
