<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingResult;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PresetKonstruksiDecisionTreeTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['role' => 'admin']);
    }

    /**
     * Case 1: Total WLS >= 90% and City == 100% -> Early Exit -> MATCH (DROP duplicate)
     */
    public function test_preset_konstruksi_stops_early_and_matches_when_city_is_100_percent(): void
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya Abadi', // slightly different name
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171', // 100% city match
                ],
            ],
        ]);

        $rName = $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $iName = $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $rAddr = $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $iAddr = $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $rBu = $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $iBu = $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $rKab = $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $iKab = $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi City Match Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Token Set', 'weight' => 55],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Token Set', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 5],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk()->assertJsonPath('success', true);
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // WLS is >= 90% (Name Token Set is 100%, Addr is 100%, BU is 100%, City is 100% -> 100%)
        // City is 100% -> Early exit terminal MATCH
        $this->assertSame('matched', $result->result_type);
        $this->assertStringContainsString('Kemiripan Kota 100%', $result->decision_reason);
    }

    /**
     * Case 2: Total WLS >= 90%, City != 100%, Name >= 90%, Address >= 90% -> NEED REVIEW (possible_match)
     * (Routes to review when name and address have high similarity despite different city)
     */
    public function test_preset_konstruksi_needs_review_when_city_differs_but_name_and_addr_high(): void
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
            'column_count' => 5,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                    'is_active' => '1',
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3273', // Different city! (0% city match)
                ],
            ],
        ]);

        $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi Different City Active Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Exact', 'weight' => 55],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Exact', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 5],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // City != 100%, but Name >= 90% AND Addr >= 90% -> possible_match (Perlu Reviu Manual)
        $this->assertSame('possible_match', $result->result_type);
        $this->assertEquals(95.0, (float) $result->overall_score);
        $this->assertStringContainsString('Perlu Reviu Manual', $result->decision_reason);
    }

    /**
     * Case 3: Reference active status check is bypassed; Name >= 90% & Addr >= 90% with different city routes to review
     */
    public function test_preset_konstruksi_skips_reference_active_status_and_needs_review(): void
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
            'column_count' => 5,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                    'status_perusahaan' => '0', // Inactive reference status should be ignored
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3273', // Different city
                ],
            ],
        ]);

        $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi Inactive Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Exact', 'weight' => 55],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Exact', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 5],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // Reference status is skipped; Name >= 90% and Addr >= 90% with different city -> possible_match
        $this->assertSame('possible_match', $result->result_type);
        $this->assertStringContainsString('Perlu Reviu Manual', $result->decision_reason);
    }

    /**
     * Case 4: Total WLS between 80% - 89% -> MANUAL CHECK (possible_match)
     */
    public function test_preset_konstruksi_manual_check_between_80_and_89_percent(): void
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10 Jakarta',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya', // 100% * 55 = 55
                    'alamat' => 'Jl. Thamrin No. 99 Surabaya', // 0% * 30 = 0
                    'badan_usaha' => 'PT', // 100% * 10 = 10
                    'kdkab' => '3171', // 100% * 5 = 5
                ],
            ],
        ]);

        $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        // Total WLS = 55 + 0 + 10 + 5 = 70% (< 80% -> UNMATCH)
        // Let's make WLS = 85%: Name 55% + Addr 50%*30 (15) + BU 10% + Kab 5% = 85%
        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi Review Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Exact', 'weight' => 55],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Token Set', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 5],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        $this->assertSame('possible_match', $result->result_type);
        $this->assertStringContainsString('Reviu Manual', $result->decision_reason);
    }

    /**
     * Case 5: Total WLS >= 90%, City != 100%, Name 100% but Address < 90% -> UNMATCH (INSERT record)
     */
    public function test_preset_konstruksi_unmatches_when_city_differs_and_address_is_below_90_percent(): void
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10 Jakarta',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jalan Jendral Sudirman No. 10', // Token Set is ~81.25%, not >= 90%
                    'badan_usaha' => 'PT',
                    'kdkab' => '3273', // Different city
                ],
            ],
        ]);

        $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        // Name is 100% (60%), Addr Token Set is ~81.25% (24.375%), BU is 100% (10%), City is 0% (0%)
        // Total WLS = 60 + 24.375 + 10 = 94.375% >= 90%
        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi Not 100% Addr Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Exact', 'weight' => 60],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Token Set', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 0],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // City != 100%, and Dual condition fails because Addr < 90% -> UNMATCH
        $this->assertSame('unmatched', $result->result_type);
        $this->assertStringContainsString('tidak memenuhi batas >= 90%', $result->decision_reason);
    }

    /**
     * Case 6: Total WLS < 80% -> UNMATCH (INSERT record)
     */
    public function test_preset_konstruksi_unmatches_when_total_wls_is_below_80_percent(): void
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Maju Jaya',
                    'alamat' => 'Jl. Sudirman No. 10 Jakarta',
                    'badan_usaha' => 'PT',
                    'kdkab' => '3171',
                ],
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
            'column_count' => 4,
            'parse_status' => 'inspected',
            'preview_rows' => [
                [
                    'nama_inti' => 'Sumber Rejeki', // Completely different
                    'alamat' => 'Jl. Pahlawan No. 99 Surabaya',
                    'badan_usaha' => 'CV',
                    'kdkab' => '3578',
                ],
            ],
        ]);

        $reference->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $input->columns()->create(['name' => 'nama_inti', 'normalized_name' => 'nama_inti', 'data_type' => 'text', 'position' => 1]);
        $reference->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $input->columns()->create(['name' => 'alamat', 'normalized_name' => 'alamat', 'data_type' => 'text', 'position' => 2]);
        $reference->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $input->columns()->create(['name' => 'badan_usaha', 'normalized_name' => 'badan_usaha', 'data_type' => 'text', 'position' => 3]);
        $reference->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);
        $input->columns()->create(['name' => 'kdkab', 'normalized_name' => 'kdkab', 'data_type' => 'text', 'position' => 4]);

        $response = $this->actingAs($this->user)->postJson('/api/matching-jobs/run', [
            'name' => 'Konstruksi Low Score Test',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [
                ['id' => 'm1', 'referenceColumnName' => 'nama_inti', 'inputColumnName' => 'nama_inti', 'algorithm' => 'Exact', 'weight' => 55],
                ['id' => 'm2', 'referenceColumnName' => 'alamat', 'inputColumnName' => 'alamat', 'algorithm' => 'Exact', 'weight' => 30],
                ['id' => 'm3', 'referenceColumnName' => 'badan_usaha', 'inputColumnName' => 'badan_usaha', 'algorithm' => 'Exact', 'weight' => 10],
                ['id' => 'm4', 'referenceColumnName' => 'kdkab', 'inputColumnName' => 'kdkab', 'algorithm' => 'Exact', 'weight' => 5],
            ],
            'configuration' => [
                'preset' => 'Konstruksi',
                'mode' => 'construction',
                'strategy' => 'Hybrid',
                'thresholds' => ['autoMatch' => 90, 'review' => 80, 'noMatch' => 80],
            ],
        ]);

        $response->assertOk();
        $result = MatchingResult::where('input_record_key', '1')->firstOrFail();

        // Total WLS = 0% < 80% -> UNMATCH
        $this->assertSame('unmatched', $result->result_type);
        $this->assertStringContainsString('< 80%', $result->decision_reason);
    }
}
