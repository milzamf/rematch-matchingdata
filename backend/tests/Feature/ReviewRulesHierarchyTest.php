<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReviewRulesHierarchyTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_ordered_review_presets_and_custom_rules_hierarchy(): void
    {
        $reference = $this->dataset('reference');
        $input = $this->dataset('input');
        $job = MatchingJob::create([
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => 'Preset Hierarchy Job',
            'status' => 'completed',
            'processed_count' => 6,
            'total_count' => 6,
        ]);

        // 1. Preset 1: NIB / Identifier conflict
        $job->results()->create([
            'input_record_key' => 'rec_1',
            'reference_record_key' => 'ref_1',
            'result_type' => 'possible_match',
            'overall_score' => 88,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 90],
                ['reference_column' => 'nib', 'input_column' => 'nib', 'score' => 0, 'comparison' => 'different'],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'PT Mandiri Jaya', 'nib' => '1234567890'],
                'reference_record' => ['name' => 'PT Mandiri Jaya', 'nib' => '9876543210'],
            ],
            'decision_reason' => 'NIB conflict',
        ]);

        // 2. Preset 2: Legal Form conflict (PT vs CV)
        $job->results()->create([
            'input_record_key' => 'rec_2',
            'reference_record_key' => 'ref_2',
            'result_type' => 'possible_match',
            'overall_score' => 89,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 100, 'identity_conflict' => true],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'CV Sumber Makmur', 'bentuk_usaha' => 'CV'],
                'reference_record' => ['name' => 'PT Sumber Makmur', 'badan_usaha' => 'PT'],
            ],
            'decision_reason' => 'Legal form conflict',
        ]);

        // 3. Preset 3: Multi Candidate ambiguity
        $job->results()->create([
            'input_record_key' => 'rec_3',
            'reference_record_key' => 'ref_3a',
            'result_type' => 'possible_match',
            'overall_score' => 86,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 86],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Karya Utama'],
                'reference_record' => ['name' => 'Karya Utama Prima'],
            ],
        ]);
        $job->results()->create([
            'input_record_key' => 'rec_3',
            'reference_record_key' => 'ref_3b',
            'result_type' => 'possible_match',
            'overall_score' => 84,
            'candidate_rank' => 2,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 84],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Karya Utama'],
                'reference_record' => ['name' => 'Karya Utama Sentosa'],
            ],
        ]);

        // 4. Preset 4: Regency / Location conflict
        $job->results()->create([
            'input_record_key' => 'rec_4',
            'reference_record_key' => 'ref_4',
            'result_type' => 'possible_match',
            'overall_score' => 85,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 95],
                ['reference_column' => 'kab', 'input_column' => 'kd_kab', 'score' => 0, 'comparison' => 'different'],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Bintang Terang', 'kd_kab' => '01'],
                'reference_record' => ['name' => 'Bintang Terang', 'kab' => '71'],
            ],
        ]);

        // 5. Preset 5: Address conflict
        $job->results()->create([
            'input_record_key' => 'rec_5',
            'reference_record_key' => 'ref_5',
            'result_type' => 'possible_match',
            'overall_score' => 82,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'nama inti', 'input_column' => 'nama inti', 'score' => 95],
                ['reference_column' => 'kab', 'input_column' => 'kd_kab', 'score' => 100, 'comparison' => 'same'],
                ['reference_column' => 'alamat_perusahaan', 'input_column' => 'alamat', 'score' => 40, 'comparison' => 'different'],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Delta Sejahtera', 'alamat' => 'Jl Mawar No 1', 'kd_kab' => '01'],
                'reference_record' => ['name' => 'Delta Sejahtera', 'alamat' => 'Desa Melati RT 5', 'kab' => '01'],
            ],
        ]);

        // 6. Preset 6: Same Name & Address, Different Regency/City
        $job->results()->create([
            'input_record_key' => 'rec_6',
            'reference_record_key' => 'ref_6',
            'result_type' => 'possible_match',
            'overall_score' => 88,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'nama inti', 'input_column' => 'nama inti', 'score' => 95, 'comparison' => 'same'],
                ['reference_column' => 'alamat_perusahaan', 'input_column' => 'alamat', 'score' => 95, 'comparison' => 'same'],
                ['reference_column' => 'kab', 'input_column' => 'kd_kab', 'score' => 0, 'comparison' => 'different'],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Gemilang Abadi', 'alamat' => 'Jl Mawar No 10', 'kd_kab' => '3171'],
                'reference_record' => ['name' => 'Gemilang Abadi', 'alamat' => 'Jl Mawar No 10', 'kab' => '3273'],
            ],
        ]);

        // 7. Residual record for Dynamic Fallback
        $job->results()->create([
            'input_record_key' => 'rec_7',
            'reference_record_key' => 'ref_7',
            'result_type' => 'possible_match',
            'overall_score' => 81,
            'candidate_rank' => 1,
            'field_scores' => [
                ['reference_column' => 'name', 'input_column' => 'name', 'score' => 81, 'comparison' => 'similar'],
            ],
            'candidate_metadata' => [
                'input_record' => ['name' => 'Cahaya Timur'],
                'reference_record' => ['name' => 'Cahaya Timur Nusantara', 'status_perusahaan' => '1'],
            ],
        ]);

        // Fetch review results
        $res = $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk()
            ->assertJsonPath('success', true);

        // Check system presets exist
        $systemPresets = $res->json('data.system_presets');
        $this->assertCount(6, $systemPresets);
        $this->assertSame(1, $systemPresets[0]['preset_number']);
        $this->assertSame(1, $systemPresets[0]['item_count']); // rec_1
        $this->assertSame(1, $systemPresets[1]['item_count']); // rec_2
        $this->assertSame(1, $systemPresets[2]['item_count']); // rec_3
        $this->assertSame(1, $systemPresets[3]['item_count']); // rec_4
        $this->assertSame(1, $systemPresets[4]['item_count']); // rec_5
        $this->assertSame(1, $systemPresets[5]['item_count']); // rec_6

        // Check dynamic pattern caught rec_7
        $dynamicPatterns = $res->json('data.dynamic_patterns');
        $this->assertNotEmpty($dynamicPatterns);
        $this->assertContains('rec_7', $dynamicPatterns[0]['item_keys']);

        // Now test custom rule creation
        $customRuleRes = $this->postJson("/api/matching-jobs/{$job->id}/review-rules", [
            'name' => 'Beda Sektor KBLI',
            'description' => 'KBLI jasa vs barang',
            'action_recommendation' => 'reject',
            'conditions' => [
                ['source' => 'input', 'field' => 'name', 'operator' => 'contains', 'value' => 'Cahaya'],
            ],
        ])
            ->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.name', 'Beda Sektor KBLI');

        $ruleId = $customRuleRes->json('data.id');

        // Fetch again, rec_7 should now be in custom rule group!
        $resAfterCustom = $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk();
        $customRuleGroups = $resAfterCustom->json('data.custom_rules');
        $this->assertCount(1, $customRuleGroups);
        $this->assertSame(1, $customRuleGroups[0]['item_count']);
        $this->assertContains('rec_7', $customRuleGroups[0]['item_keys']);

        // Test delete custom rule
        $this->deleteJson("/api/matching-jobs/{$job->id}/review-rules/{$ruleId}")
            ->assertOk()
            ->assertJsonPath('success', true);

        // Fetch again, rec_7 falls back to dynamic patterns
        $resAfterDelete = $this->getJson("/api/matching-jobs/{$job->id}/review-results")
            ->assertOk();
        $this->assertEmpty($resAfterDelete->json('data.custom_rules'));
        $this->assertContains('rec_7', $resAfterDelete->json('data.dynamic_patterns.0.item_keys'));
    }
}
