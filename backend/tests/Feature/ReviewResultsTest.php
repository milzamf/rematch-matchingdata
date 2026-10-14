<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReviewResultsTest extends TestCase
{
    use RefreshDatabase;

    public function test_sharing_mode_fences_legacy_decision_and_undo_without_changing_history(): void
    {
        $job = MatchingJob::create(['reference_dataset_id' => $this->dataset('reference')->id, 'input_dataset_id' => $this->dataset('input')->id, 'status' => 'completed']);
        $result = $job->results()->create(['input_record_key' => '001', 'reference_record_key' => '1', 'candidate_rank' => 1, 'overall_score' => 95, 'result_type' => 'possible_match']);
        $url = "/api/matching-jobs/{$job->id}/review-decisions";
        $this->postJson($url, ['input_record_key' => '001', 'decision' => 'mark_unmatched'])->assertOk();
        $decision = \App\Models\ReviewDecision::where('matching_job_id', $job->id)->firstOrFail();
        $history = $decision->getAttributes();
        foreach ([[true, false], [false, true], [true, true]] as [$access, $transactions]) {
            config(['workspace_access.enabled' => $access, 'review_transactions.enabled' => $transactions]);
            $this->postJson($url, ['input_record_key' => '001', 'decision' => 'mark_unmatched'])->assertStatus(409)->assertJsonPath('code', 'legacy_review_write_disabled');
            $this->postJson($url."/{$decision->id}/undo")->assertStatus(409)->assertJsonPath('code', 'legacy_review_write_disabled');
            $this->assertSame('unmatched', $result->fresh()->result_type);
            $this->assertSame($history, $decision->fresh()->getAttributes());
            $this->assertSame(1, \App\Models\ReviewDecision::where('matching_job_id', $job->id)->count());
        }
        config(['workspace_access.enabled' => false, 'review_transactions.enabled' => false]);
        $this->postJson($url."/{$decision->id}/undo")->assertOk();
        $this->assertSame('possible_match', $result->fresh()->result_type);
    }

    public function test_busy_case_group_build_returns_retryable_preparation_response(): void
    {
        $this->mock(\App\Services\Matching\ReviewResultService::class, function ($mock) {
            $mock->shouldReceive('list')->once()->andThrow(new \Illuminate\Contracts\Cache\LockTimeoutException());
        });
        $this->getJson('/api/matching-jobs/test-job/review-results?include_groups=true&include_quality=false')
            ->assertStatus(503)->assertHeader('Retry-After', '5')
            ->assertJsonPath('code', 'case_groups_preparing');
    }

    public function test_record_search_does_not_match_private_packed_explanations(): void
    {
        $job = MatchingJob::create([
            'reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id,
            'status' => 'completed', 'processed_count' => 1, 'total_count' => 1,
        ]);
        $job->results()->create([
            'input_record_key' => '1', 'reference_record_key' => 'r1',
            'result_type' => 'possible_match', 'candidate_rank' => 1, 'overall_score' => 92,
            'field_scores' => [['reference_column' => 'name', 'input_column' => 'company', 'score' => 92]],
            'candidate_metadata' => ['input_record' => ['company' => 'SANJAYA'], 'reference_record' => ['name' => 'SANJAYA MULTI'],
                '_field_scores' => json_encode([['reference_column' => 'name', 'input_column' => 'company',
                    'score' => 92, 'explanation' => 'PRIVATE_ONLY_NEEDLE']])],
        ]);
        $url = "/api/matching-jobs/{$job->id}/review-results?include_groups=false&include_quality=false";
        $this->getJson($url.'&search=PRIVATE_ONLY_NEEDLE')->assertOk()->assertJsonCount(0, 'data.items');
        $this->getJson($url.'&search=sanjaya')->assertOk()->assertJsonCount(1, 'data.items');
    }

    public function test_field_quality_counts_all_primary_scores_without_sampling_or_page_dependence(): void
    {
        $job = MatchingJob::create([
            'reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id,
            'status' => 'completed', 'processed_count' => 2102, 'total_count' => 2102,
        ]);
        $rows = [];
        for ($i = 0; $i < 2102; $i++) {
            $rows[] = [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'matching_job_id' => $job->id, 'input_record_key' => (string) $i,
                'result_type' => 'unmatched', 'candidate_rank' => 1, 'overall_score' => 0,
                'field_scores' => $i === 2101 ? null : json_encode([[
                    'reference_column' => 'name', 'input_column' => 'company',
                    'score' => $i < 2000 ? 100 : 50,
                ]]),
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) \App\Models\MatchingResult::insert($chunk);
        $job->results()->create([
            'input_record_key' => '0', 'reference_record_key' => 'secondary',
            'result_type' => 'unmatched', 'candidate_rank' => 2, 'overall_score' => 0,
            'field_scores' => [[
                'reference_column' => 'name', 'input_column' => 'company', 'score' => 0,
            ]],
        ]);
        $url = "/api/matching-jobs/{$job->id}/review-results?include_groups=false&include_quality=true";
        $first = $this->getJson($url.'&page=1&per_page=25')->assertOk();
        $stats = $first->json('data.field_quality_summary.name:::company');
        $this->assertSame(2101, $stats['totalEvaluated']);
        $this->assertSame(2000, $stats['highCount']);
        $this->assertSame(101, $stats['lowCount']);
        $this->assertSame(1, $stats['unscoredCount']);
        $second = $this->getJson($url.'&page=2&per_page=100')->assertOk();
        $this->assertSame($stats, $second->json('data.field_quality_summary.name:::company'));
    }

    public function test_individual_decision_returns_only_target_outside_first_review_page(): void
    {
        $job = MatchingJob::create([
            'reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id,
            'status' => 'completed', 'processed_count' => 30, 'total_count' => 30,
        ]);
        for ($i = 1; $i <= 30; $i++) {
            $result = $job->results()->create([
                'input_record_key' => (string) $i, 'reference_record_key' => (string) $i,
                'result_type' => 'possible_match', 'candidate_rank' => 1, 'overall_score' => 82,
            ]);
        }
        $response = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '30', 'matching_result_id' => $result->id, 'decision' => 'accept_match',
        ])->assertOk()->assertJsonCount(1, 'data.review.items')
            ->assertJsonPath('data.review.items.0.input_record_key', '30')
            ->assertJsonPath('data.review.summary.matched', 1)
            ->assertJsonPath('data.review.summary.possible_match', 29)
            ->assertJsonCount(0, 'data.review.case_groups');
        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions/".$response->json('data.decision.id').'/undo')
            ->assertOk()->assertJsonPath('data.review.summary.possible_match', 30);
    }

    public function test_committed_review_results_are_visible_while_matching_job_is_processing(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'In-progress Review Results',
            'status' => 'processing',
            'processed_count' => 2,
            'total_count' => 4,
        ]);

        foreach (['1', '2'] as $key) {
            $job->results()->create([
                'input_record_key' => $key,
                'reference_record_key' => $key,
                'result_type' => 'possible_match',
                'overall_score' => 82.5,
                'candidate_rank' => 1,
                'field_scores' => [[
                    'reference_column' => 'name',
                    'input_column' => 'name',
                    'score' => 82.5,
                    'identity_conflict' => true,
                ]],
                'candidate_metadata' => [
                    'input_record' => ['name' => "CV Satu Data {$key}"],
                    'reference_record' => ['name' => "PT Satu Data {$key}"],
                ],
                'decision_reason' => 'Identity conflict requires review',
            ]);
        }

        $this->getJson("/api/matching-jobs/{$job->id}/review-results?status=possible_match")
            ->assertOk()
            ->assertJsonPath('data.job.status', 'processing')
            ->assertJsonPath('data.is_processing', true)
            ->assertJsonPath('data.summary.possible_match', 2)
            ->assertJsonPath('data.pagination.total_items', 2)
            ->assertJsonPath('data.items.0.input_record_key', '1')
            ->assertJsonPath('data.case_groups.0.item_count', 2);
    }

    public function test_review_results_can_be_loaded_decided_and_undone(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Review Smoke',
            'status' => 'completed',
            'processed_count' => 1,
            'total_count' => 1,
        ]);
        $result = $job->results()->create([
            'input_record_key' => '1',
            'reference_record_key' => '1',
            'result_type' => 'possible_match',
            'overall_score' => 82.5,
            'candidate_rank' => 1,
            'field_scores' => [[
                'reference_column' => 'name',
                'input_column' => 'name',
                'score' => 82.5,
            ]],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Satu Data'],
                'reference_record' => ['name' => 'PT Satu Data'],
            ],
            'decision_reason' => 'Fuzzy candidate scored',
        ]);

        $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.possible_match', 1)
            ->assertJsonPath('data.items.0.candidates.0.field_scores.0.comparison', 'similar');

        $decisionResponse = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '1',
            'matching_result_id' => $result->id,
            'decision' => 'accept_match',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.decision.new_result_type', 'matched');

        $decisionId = $decisionResponse->json('data.decision.id');
        $this->assertDatabaseHas('matching_results', [
            'id' => $result->id,
            'result_type' => 'matched',
            'review_status' => 'reviewed',
        ]);

        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions/{$decisionId}/undo")
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.undone_decision_id', $decisionId);

        $this->assertDatabaseHas('matching_results', [
            'id' => $result->id,
            'result_type' => 'possible_match',
            'review_status' => 'pending',
        ]);
    }

    public function test_review_results_group_similar_cases_and_store_review_knowledge(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Case Group Smoke',
            'status' => 'completed',
            'processed_count' => 2,
            'total_count' => 2,
        ]);

        foreach (['1', '2'] as $key) {
            $job->results()->create([
                'input_record_key' => $key,
                'reference_record_key' => $key,
                'result_type' => 'possible_match',
                'overall_score' => 89,
                'candidate_rank' => 1,
                'field_scores' => [[
                    'reference_column' => 'name',
                    'input_column' => 'name',
                    'score' => 100,
                    'identity_conflict' => true,
                ]],
                'candidate_metadata' => [
                    'input_record' => ['name' => "CV Satu Data {$key}"],
                    'reference_record' => ['name' => "PT Satu Data {$key}"],
                ],
                'decision_reason' => 'Identity metadata conflict requires review',
            ]);
        }

        $groupId = $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk()
            ->assertJsonPath('data.case_groups.0.pattern', 'LEGAL_FORM_CONFLICT')
            ->assertJsonPath('data.case_groups.0.confidence', 'High')
            ->assertJsonPath('data.case_groups.0.eligible_for_bulk', true)
            ->json('data.case_groups.0.id');

        $decisionId = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '1',
            'decision' => 'reject_match',
            'scope' => 'group',
            'case_group_id' => $groupId,
        ])
            ->assertOk()
            ->assertJsonPath('data.decision.affected_records', 2)
            ->assertJsonPath('data.review.case_groups.0.status', 'resolved')
            ->json('data.decision.id');

        $this->assertDatabaseHas('review_decisions', [
            'matching_job_id' => $job->id,
            'decision' => 'reject_match',
            'new_result_type' => 'possible_match',
        ]);
        $this->assertSame(
            'LEGAL_FORM_CONFLICT',
            $job->reviewDecisions()->firstOrFail()->metadata['review_knowledge']['pattern'],
        );

        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions/{$decisionId}/undo")
            ->assertOk()
            ->assertJsonPath('data.affected_records', 2)
            ->assertJsonPath('data.review.case_groups.0.status', 'open');
    }

    public function test_bulk_accept_skips_records_that_fail_safety_validation(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Bulk Safety Smoke',
            'status' => 'completed',
            'processed_count' => 3,
            'total_count' => 3,
        ]);

        foreach ([['1', 'A'], ['2', 'B'], ['3', 'B']] as [$inputKey, $referenceKey]) {
            $job->results()->create([
                'input_record_key' => $inputKey,
                'reference_record_key' => $referenceKey,
                'result_type' => 'possible_match',
                'overall_score' => 88,
                'candidate_rank' => 1,
                'field_scores' => [[
                    'reference_column' => 'name',
                    'input_column' => 'name',
                    'score' => 88,
                ]],
                'candidate_metadata' => [
                    'input_record' => ['name' => "Satu Data {$inputKey}"],
                    'reference_record' => ['name' => "PT Satu Data {$referenceKey}"],
                ],
                'decision_reason' => 'Similar entity candidate',
            ]);
        }

        $groupId = $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk()
            ->assertJsonPath('data.case_groups.0.eligible_for_bulk', true)
            ->assertJsonPath('data.case_groups.0.knowledge_level', 'NEW_PATTERN')
            ->json('data.case_groups.0.id');

        $response = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '1',
            'decision' => 'accept_match',
            'scope' => 'group',
            'case_group_id' => $groupId,
        ])
            ->assertOk()
            ->assertJsonPath('data.decision.affected_records', 1)
            ->assertJsonPath('data.decision.skipped_count', 2);

        $items = collect($response->json('data.review.items'))->keyBy('input_record_key');
        $this->assertSame('MANUAL_ACCEPTED', $items->get('1')['status_code']);
        $this->assertSame('NEED_REVIEW', $items->get('2')['status_code']);
        $this->assertSame('NEED_REVIEW', $items->get('3')['status_code']);

        $this->assertDatabaseHas('matching_results', [
            'matching_job_id' => $job->id,
            'input_record_key' => '1',
            'result_type' => 'matched',
            'review_status' => 'reviewed',
        ]);
        $this->assertDatabaseHas('matching_results', [
            'matching_job_id' => $job->id,
            'input_record_key' => '2',
            'result_type' => 'possible_match',
            'review_status' => 'pending',
        ]);
    }

    public function test_case_group_filtering_and_robust_identifier_matching(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Robust Review Test',
            'status' => 'completed',
            'processed_count' => 3,
            'total_count' => 3,
        ]);

        // Item 1: Auto-matched with pending review_status (should NOT pollute case groups)
        $job->results()->create([
            'input_record_key' => 'auto-1',
            'reference_record_key' => 'ref-1',
            'result_type' => 'matched',
            'review_status' => 'pending',
            'overall_score' => 100,
            'candidate_rank' => 1,
            'candidate_metadata' => [
                'input_record' => ['name' => 'PT Mandiri Jaya', 'idsbr' => '12345'],
                'reference_record' => ['name' => 'PT Mandiri Jaya', 'idsbr' => '99999'],
            ],
        ]);

        // Item 2: Has idsbr & kode_kab but NO nib/npwp conflict. Should NOT be Preset 1.
        $job->results()->create([
            'input_record_key' => 'rev-1',
            'reference_record_key' => 'ref-2',
            'result_type' => 'possible_match',
            'review_status' => 'pending',
            'overall_score' => 84,
            'candidate_rank' => 1,
            'field_scores' => [[
                'reference_column' => 'nama',
                'input_column' => 'nama',
                'score' => 84,
                'comparison' => 'similar',
            ]],
            'candidate_metadata' => [
                'input_record' => ['nama' => 'PT Maju Bersama', 'idsbr' => '98765', 'kode_kab' => '3201'],
                'reference_record' => ['nama' => 'PT Maju Bersama Abadi', 'idsbr' => '54321', 'kode_kab' => '3201'],
            ],
            'decision_reason' => 'Fuzzy score in review range',
        ]);

        // Item 3: Has real NIB conflict. SHOULD be Preset 1.
        $job->results()->create([
            'input_record_key' => 'rev-2',
            'reference_record_key' => 'ref-3',
            'result_type' => 'possible_match',
            'review_status' => 'pending',
            'overall_score' => 88,
            'candidate_rank' => 1,
            'field_scores' => [[
                'reference_column' => 'nama',
                'input_column' => 'nama',
                'score' => 88,
                'comparison' => 'similar',
            ]],
            'candidate_metadata' => [
                'input_record' => ['nama' => 'CV Sumber Makmur', 'nib' => '0123456789012'],
                'reference_record' => ['nama' => 'CV Sumber Makmur', 'nib' => '9876543210987'],
            ],
            'decision_reason' => 'Identifier conflict on NIB',
        ]);

        $response = $this->getJson("/api/matching-jobs/{$job->id}/review-results")->assertOk();

        // Ensure auto-matched item is not included in review items or case group keys
        $items = collect($response->json('data.items'))->keyBy('input_record_key');
        $presets = collect($response->json('data.system_presets'))->keyBy('id');

        $nibPreset = $presets->get('system_preset_1_nib_conflict');
        $this->assertNotNull($nibPreset);
        // Only rev-2 has real NIB conflict; rev-1 must NOT be in Preset 1 because idsbr is not NIB/NPWP!
        $this->assertContains('rev-2', $nibPreset['item_keys']);
        $this->assertNotContains('rev-1', $nibPreset['item_keys']);
        $this->assertNotContains('auto-1', $nibPreset['item_keys']);

        // Now test server-side pagination with case_group_id filter
        $filterResponse = $this->getJson("/api/matching-jobs/{$job->id}/review-results?case_group_id=system_preset_1_nib_conflict")
            ->assertOk();

        $filteredItems = $filterResponse->json('data.items');
        $this->assertCount(1, $filteredItems);
        $this->assertSame('rev-2', $filteredItems[0]['input_record_key']);
    }

    public function test_case_members_load_without_group_payload_and_search_record_contents(): void
    {
        $job = MatchingJob::create(['reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id, 'status' => 'completed', 'total_count' => 12, 'processed_count' => 12]);
        for ($i = 1; $i <= 12; $i++) {
            $job->results()->create(['input_record_key' => (string) $i, 'reference_record_key' => 'reference-'.$i,
                'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 85,
                'candidate_metadata' => ['input_record' => ['nama' => 'PT Fixture Search '.$i], 'reference_record' => ['nama' => 'PT Fixture Search']],
                'field_scores' => [['reference_column' => 'nama', 'input_column' => 'nama', 'score' => 85]]]);
        }
        $base = "/api/matching-jobs/{$job->id}/review-results";
        $group = $this->getJson($base)->assertOk()->json('data.case_groups.0.id');
        $query = $base.'?case_group_id='.urlencode($group).'&include_groups=false&include_quality=false&per_page=10';
        $this->getJson($query)->assertOk()->assertJsonPath('data.pagination.total_items', 12)->assertJsonCount(10, 'data.items')->assertJsonCount(0, 'data.case_groups');
        $this->getJson($query.'&page=2')->assertOk()->assertJsonCount(2, 'data.items');
        $this->getJson($query.'&search=Fixture')->assertOk()->assertJsonPath('data.pagination.total_items', 12);
        $this->getJson($query.'&search=does-not-exist')->assertOk()->assertJsonPath('data.pagination.total_items', 0);
        $decision = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '1', 'decision' => 'mark_unmatched',
        ])->assertOk()->json('data.decision.id');
        $this->getJson($query.'&status=unmatched')->assertOk()->assertJsonPath('data.pagination.total_items', 1)
            ->assertJsonPath('data.items.0.input_record_key', '1');
        $this->getJson($query.'&status=possible_match')->assertOk()->assertJsonPath('data.pagination.total_items', 11);
        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions/{$decision}/undo")->assertOk();
        $this->getJson($query.'&status=possible_match')->assertOk()->assertJsonPath('data.pagination.total_items', 12);
        $this->getJson($base.'?case_group_id=invalid&include_groups=false')->assertNotFound();
    }

    public function test_similarity_order_range_and_selected_candidate_apply_before_pagination(): void
    {
        $job = MatchingJob::create(['reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id, 'status' => 'completed', 'total_count' => 12, 'processed_count' => 12]);
        for ($i = 1; $i <= 12; $i++) {
            $job->results()->create(['input_record_key' => (string) $i, 'reference_record_key' => 'ref-'.$i,
                'candidate_rank' => 1, 'result_type' => 'possible_match', 'overall_score' => 60 + $i * 2]);
        }
        $candidate = $job->results()->create(['input_record_key' => '1', 'reference_record_key' => 'selected', 'candidate_rank' => 2,
            'result_type' => 'possible_match', 'overall_score' => 99]);
        $base = "/api/matching-jobs/{$job->id}/review-results?include_groups=false&include_quality=false&per_page=10";
        $this->getJson($base.'&sort=similarity_desc')->assertOk()->assertJsonPath('data.items.0.input_record_key', '12');
        $this->getJson($base.'&sort=similarity_desc&page=2')->assertOk()->assertJsonPath('data.items.0.input_record_key', '2');
        $this->getJson($base.'&sort=similarity_asc')->assertOk()->assertJsonPath('data.items.0.input_record_key', '1');
        $this->getJson($base.'&similarity_min=80&similarity_max=84')->assertOk()->assertJsonPath('data.pagination.total_items', 3);
        $decision = $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", ['input_record_key' => '1',
            'matching_result_id' => $candidate->id, 'decision' => 'select_candidate'])->assertOk()->json('data.decision.id');
        $this->getJson($base.'&sort=similarity_desc')->assertOk()->assertJsonPath('data.items.0.input_record_key', '1')->assertJsonPath('data.items.0.candidates.0.score', 99);
        $this->getJson($base.'&status=matched&similarity_min=95')->assertOk()->assertJsonPath('data.pagination.total_items', 1);
        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions/{$decision}/undo")->assertOk();
        $this->getJson($base.'&sort=similarity_desc')->assertOk()->assertJsonPath('data.items.0.input_record_key', '12');
        $this->getJson($base.'&similarity_min=90&similarity_max=80')->assertUnprocessable();
        $this->getJson($base.'&sort=bad')->assertUnprocessable();
        // Ties use text record keys, making page boundaries stable on repeat reads.
        $job->results()->where('candidate_rank', 1)->update(['overall_score' => 80]);
        $first = $this->getJson($base.'&sort=similarity_desc')->assertOk()->json('data.items');
        $second = $this->getJson($base.'&sort=similarity_asc&page=2')->assertOk()->json('data.items');
        $this->assertSame(['1', '10', '11', '12', '2', '3', '4', '5', '6', '7'], array_column($first, 'input_record_key'));
        $this->assertSame(['8', '9'], array_column($second, 'input_record_key'));
    }

    public function test_input_region_backfill_resolves_mfd_aliases_and_filter_combinations(): void
    {
        \Illuminate\Support\Facades\Queue::fake();
        $job = MatchingJob::create(['reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id, 'status' => 'completed', 'total_count' => 3, 'processed_count' => 3]);
        foreach (['[74] JAKARTA BARAT', 'JAKARTA BARAT', 'JAKARTA SELATAN'] as $i => $name) {
            $job->results()->create(['input_record_key' => (string) $i, 'candidate_rank' => 1, 'result_type' => 'unmatched',
                'overall_score' => 85, 'candidate_metadata' => ['input_record' => ['provinsi' => '[31] DKI JAKARTA', 'kabupaten' => $name]]]);
        }
        $options = "/api/matching-jobs/{$job->id}/review-region-options";
        $this->getJson($options)->assertOk()->assertJsonPath('data.ready', false);
        $this->getJson("/api/matching-jobs/{$job->id}/review-results?include_groups=false&input_province_code=31")->assertStatus(409);
        \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\BuildReviewRegionIndex::class);
        $regions = app(\App\Services\Matching\ReviewRegionIndexService::class);
        $regions->backfill($job->id);
        $code = $job->results()->where('input_record_key', '0')->value('input_regency_code');
        $this->assertNotNull($code);
        $this->assertSame($code, $job->results()->where('input_record_key', '1')->value('input_regency_code'));
        $this->getJson($options)->assertOk()->assertJsonPath('data.ready', true)->assertJsonCount(2, 'data.regencies');
        $base = "/api/matching-jobs/{$job->id}/review-results?include_groups=false&input_province_code=31&input_regency_code={$code}";
        $this->getJson($base.'&status=unmatched&similarity_min=80&sort=similarity_desc')->assertOk()->assertJsonPath('data.pagination.total_items', 2);
        $this->getJson(str_replace('input_province_code=31', 'input_province_code=11', $base))->assertUnprocessable();
    }

    public function test_contract_preserves_opaque_keys_and_reviewer_when_another_actor_undoes(): void
    {
        $reviewerId = auth()->id();
        $job = MatchingJob::create([
            'reference_dataset_id' => $this->dataset('reference')->id,
            'input_dataset_id' => $this->dataset('input')->id,
            'status' => 'completed', 'processed_count' => 2, 'total_count' => 2,
            'record_counts' => ['total_raw_input' => 3, 'total_unique_input' => 2, 'total_duplicates' => 1],
        ]);
        foreach (['001', '1'] as $key) {
            $job->results()->create([
                'input_record_key' => $key, 'reference_record_key' => 'ref-'.$key,
                'result_type' => 'possible_match', 'candidate_rank' => 1, 'overall_score' => 92,
                'candidate_metadata' => ['input_record' => ['name' => $key]],
            ]);
        }
        $result = $job->results()->where('input_record_key', '001')->firstOrFail();
        $url = "/api/matching-jobs/{$job->id}";
        $response = $this->postJson($url.'/review-decisions', [
            'input_record_key' => '001', 'matching_result_id' => $result->id,
            'decision' => 'reject_match', 'scope' => 'one',
        ])->assertOk();
        $id = $response->json('data.decision.id');
        $this->assertDatabaseHas('review_decisions', [
            'id' => $id, 'input_record_key' => '001', 'reviewer_user_id' => $reviewerId,
            'new_result_type' => 'possible_match',
        ]);
        $read = $this->getJson($url.'/review-results?include_groups=false&include_quality=false')->assertOk();
        $read->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.summary.possible_match', 2)
            ->assertJsonPath('data.summary.unmatched', 0)
            ->assertJsonPath('data.summary.accounting.source_row_count', 3)
            ->assertJsonPath('data.summary.accounting.unique_input_record_count', 2)
            ->assertJsonPath('data.summary.accounting.deduplicated_input_row_count', 1)
            ->assertJsonPath('data.summary.accounting.matched_entity_count', null);
        $this->assertEqualsCanonicalizing(['001', '1'], array_column($read->json('data.items'), 'input_record_key'));
        $reviewedItem = collect($read->json('data.items'))->firstWhere('input_record_key', '001');
        $this->assertSame($reviewerId, $reviewedItem['decision']['actors']['reviewer_user_id']);
        $this->assertSame($reviewerId, $reviewedItem['decision']['actors']['last_modified_by_user_id']);
        $this->assertNull($reviewedItem['decision']['actors']['approved_by_user_id']);

        $other = \App\Models\User::factory()->create(['role' => 'admin']);
        $this->actingAs($other);
        $this->postJson($url.'/review-decisions/'.$id.'/undo')->assertOk();
        $audit = \App\Models\ReviewDecision::findOrFail($id);
        $this->assertSame($reviewerId, $audit->reviewer_user_id);
        $this->assertSame($other->id, $audit->metadata['undone_by_user_id']);
        $actors = \App\Services\Matching\ReviewContract::actors($audit);
        $this->assertSame($reviewerId, $actors['reviewer_user_id']);
        $this->assertSame($other->id, $actors['last_modified_by_user_id']);
        $this->assertSame('possible_match', $result->fresh()->result_type);
        $this->assertNull($job->results()->where('input_record_key', '1')->firstOrFail()->review_decision);
    }

    private function dataset(string $role): Dataset
    {
        return Dataset::create([
            'dataset_role' => $role,
            'name' => $role,
            'original_filename' => "{$role}.csv",
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => "datasets/{$role}.csv",
            'row_count' => 1,
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [['name' => 'Satu Data']],
        ]);
    }
}
