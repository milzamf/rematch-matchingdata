<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\User;
use App\Services\Matching\SimilarityScorer;
use App\Services\Matching\ValueNormalizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NumericGuardrailTest extends TestCase
{
    use RefreshDatabase;

    private SimilarityScorer $scorer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scorer = new SimilarityScorer(new ValueNormalizer());
    }

    public function test_it_extracts_and_detects_numeric_mismatch(): void
    {
        // Conflicting numbers
        $this->assertTrue($this->scorer->hasNumericMismatch('PT Makmur Sejahtera 1', 'PT Makmur Sejahtera 2'));
        $this->assertTrue($this->scorer->hasNumericMismatch('Jl Merdeka No 10', 'Jl Merdeka No 12'));
        $this->assertTrue($this->scorer->hasNumericMismatch('Blok A1', 'Blok A2'));

        // Matching / normalized numbers
        $this->assertFalse($this->scorer->hasNumericMismatch('RT 01', 'RT 1'));
        $this->assertFalse($this->scorer->hasNumericMismatch('PT Makmur Sejahtera 1', 'PT Makmur Sejahtera 01'));
        $this->assertFalse($this->scorer->hasNumericMismatch('PT Makmur Sejahtera', 'PT Makmur Sejahtera'));

        // One side has number, one side has no numbers
        $this->assertFalse($this->scorer->hasNumericMismatch('PT Makmur Sejahtera', 'PT Makmur Sejahtera 1'));
    }

    public function test_it_penalizes_fuzzy_score_on_numeric_mismatch(): void
    {
        $scoreWithoutGuardrail = $this->scorer->score('Levenshtein', 'PT Makmur Sejahtera 1', 'PT Makmur Sejahtera 2', false);
        $scoreWithGuardrail = $this->scorer->score('Levenshtein', 'PT Makmur Sejahtera 1', 'PT Makmur Sejahtera 2', true);

        $this->assertGreaterThan(90.0, $scoreWithoutGuardrail);
        $this->assertLessThan(70.0, $scoreWithGuardrail);
    }

    public function test_matching_engine_downgrades_numeric_mismatch_from_auto_match(): void
    {
        $user = User::factory()->create(['role' => 'user']);
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 1,
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Makmur Jaya Sentosa 1'],
            ],
        ]);

        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 1,
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Makmur Jaya Sentosa 2'],
            ],
        ]);

        $reference->columns()->create([
            'name' => 'name',
            'normalized_name' => 'name',
            'data_type' => 'text',
            'position' => 1,
        ]);

        $input->columns()->create([
            'name' => 'name',
            'normalized_name' => 'name',
            'data_type' => 'text',
            'position' => 1,
        ]);

        $workspace = \App\Models\Workspace::create([
            'user_id' => $user->id,
            'name' => 'Numeric Test Workspace',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
        ]);
        $reference->update(['workspace_id' => $workspace->id]);
        $input->update(['workspace_id' => $workspace->id]);

        $response = $this->actingAs($user)->postJson('/api/matching-jobs/run', [
            'workspace_id' => $workspace->id,
            'name' => 'Numeric Guardrail Run',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Levenshtein',
                    'weight' => 100,
                ],
            ],
            'configuration' => [
                'thresholds' => [
                    'autoMatch' => 60,
                    'review' => 40,
                    'noMatch' => 20,
                ],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true);

        // Result should be downgraded from auto-match to possible_match due to numeric conflict
        $this->assertDatabaseHas('matching_results', [
            'result_type' => 'possible_match',
            'decision_reason' => 'Numeric sequence mismatch requires review',
        ]);
    }
}
