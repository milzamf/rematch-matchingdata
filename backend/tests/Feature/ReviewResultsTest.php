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
