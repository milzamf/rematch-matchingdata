<?php

namespace Tests\Feature;

use App\Models\ColumnMapping;
use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\User;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DynamicAlgorithmBindingPipelineTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['role' => 'admin']);
    }

    public function test_dynamic_algorithm_selection_produces_token_set_ratio_in_pipeline(): void
    {
        $reference = Dataset::create([
            'user_id' => $this->user->id,
            'dataset_role' => 'reference',
            'name' => 'Reference Dataset',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 1,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Maju Bersama', 'address' => 'Jl. Jendral Sudirman No. 45 Jakarta Pusat'],
            ],
        ]);

        $input = Dataset::create([
            'user_id' => $this->user->id,
            'dataset_role' => 'input',
            'name' => 'Input Dataset',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 1,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Maju Bersama', 'address' => 'Jalan Jendral Sudirman No. 45'],
            ],
        ]);

        $refNameCol = $reference->columns()->create(['name' => 'name', 'normalized_name' => 'name', 'data_type' => 'text', 'position' => 1]);
        $inpNameCol = $input->columns()->create(['name' => 'name', 'normalized_name' => 'name', 'data_type' => 'text', 'position' => 1]);
        $refAddrCol = $reference->columns()->create(['name' => 'address', 'normalized_name' => 'address', 'data_type' => 'text', 'position' => 2]);
        $inpAddrCol = $input->columns()->create(['name' => 'address', 'normalized_name' => 'address', 'data_type' => 'text', 'position' => 2]);

        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Dynamic Algorithm Job',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-name',
                    'referenceColumnId' => $refNameCol->id,
                    'inputColumnId' => $inpNameCol->id,
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Exact',
                    'weight' => 50,
                ],
                [
                    'id' => 'map-addr',
                    'referenceColumnId' => $refAddrCol->id,
                    'inputColumnId' => $inpAddrCol->id,
                    'referenceColumnName' => 'address',
                    'inputColumnName' => 'address',
                    'algorithm' => 'Token Set',
                    'weight' => 50,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'fields' => [
                    ['mappingId' => 'map-name', 'algorithm' => 'Exact'],
                    ['mappingId' => 'map-addr', 'algorithm' => 'Token Set'],
                ],
                'rules' => [
                    'verificationEnabled' => false,
                    'verificationOrder' => [],
                ],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true);

        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // Name is 100%, and address containment can score 100%. The richer
        // reference address is evidence for review, not proof for auto-match.
        $this->assertEquals(100.0, (float) $result->overall_score);
        $this->assertSame('possible_match', $result->result_type);
        $addressEvidence = collect($result->field_scores)
            ->firstWhere('reference_column', 'address')['address_evidence'];
        $this->assertSame('reference', $addressEvidence['richer_side']);
        $this->assertSame('Partial address agreement needs review before enrichment', $result->decision_reason);
    }

    public function test_disabled_verification_rule_does_not_downgrade_auto_matches(): void
    {
        $reference = Dataset::create([
            'user_id' => $this->user->id,
            'dataset_role' => 'reference',
            'name' => 'Ref',
            'original_filename' => 'ref.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/ref.csv',
            'row_count' => 1,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Makmur Jaya', 'city' => 'Jakarta Selatan'],
            ],
        ]);

        $input = Dataset::create([
            'user_id' => $this->user->id,
            'dataset_role' => 'input',
            'name' => 'Inp',
            'original_filename' => 'inp.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/inp.csv',
            'row_count' => 1,
            'column_count' => 2,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Makmur Jaya', 'city' => 'Surabaya'],
            ],
        ]);

        $refNameCol = $reference->columns()->create(['name' => 'name', 'normalized_name' => 'name', 'data_type' => 'text', 'position' => 1]);
        $inpNameCol = $input->columns()->create(['name' => 'name', 'normalized_name' => 'name', 'data_type' => 'text', 'position' => 1]);
        $refCityCol = $reference->columns()->create(['name' => 'city', 'normalized_name' => 'city', 'data_type' => 'text', 'position' => 2]);
        $inpCityCol = $input->columns()->create(['name' => 'city', 'normalized_name' => 'city', 'data_type' => 'text', 'position' => 2]);

        // When verification is disabled:
        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Verification Disabled Job',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                [
                    'id' => 'map-name',
                    'referenceColumnId' => $refNameCol->id,
                    'inputColumnId' => $inpNameCol->id,
                    'referenceColumnName' => 'name',
                    'inputColumnName' => 'name',
                    'algorithm' => 'Exact',
                    'weight' => 90,
                ],
                [
                    'id' => 'map-city',
                    'referenceColumnId' => $refCityCol->id,
                    'inputColumnId' => $inpCityCol->id,
                    'referenceColumnName' => 'city',
                    'inputColumnName' => 'city',
                    'algorithm' => 'Exact',
                    'weight' => 10,
                ],
            ],
            'configuration' => [
                'preset' => 'Default',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 85, 'review' => 70, 'noMatch' => 50],
                'rules' => [
                    'verificationEnabled' => false,
                    'verificationOrder' => [],
                ],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // (100 * 0.9) + (0 * 0.1) = 90.0% >= 85% AutoMatch threshold
        // Since verification is FALSE, city 0% does NOT trigger a guardrail failure or downgrade
        $this->assertSame('matched', $result->result_type);
        $this->assertEquals(90.0, (float) $result->overall_score);
    }
}
