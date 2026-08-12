<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReviewResultsTest extends TestCase
{
    use RefreshDatabase;

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

        $this->postJson("/api/matching-jobs/{$job->id}/review-decisions", [
            'input_record_key' => '1',
            'decision' => 'reject_match',
            'scope' => 'group',
            'case_group_id' => $groupId,
        ])
            ->assertOk()
            ->assertJsonPath('data.decision.affected_records', 2);

        $this->assertDatabaseHas('review_decisions', [
            'matching_job_id' => $job->id,
            'decision' => 'reject_match',
            'new_result_type' => 'possible_match',
        ]);
        $this->assertSame(
            'LEGAL_FORM_CONFLICT',
            $job->reviewDecisions()->firstOrFail()->metadata['review_knowledge']['pattern'],
        );
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
