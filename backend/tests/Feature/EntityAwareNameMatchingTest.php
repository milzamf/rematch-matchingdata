<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Models\MatchingResult;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EntityAwareNameMatchingTest extends TestCase
{
    use RefreshDatabase;

    public function test_entity_name_metadata_constraints_prevent_conflicting_auto_match(): void
    {
        $reference = Dataset::create([
            'dataset_role' => 'reference',
            'name' => 'reference',
            'original_filename' => 'reference.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/reference.csv',
            'row_count' => 1,
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'PT Satu Data Tbk'],
            ],
        ]);
        $input = Dataset::create([
            'dataset_role' => 'input',
            'name' => 'input',
            'original_filename' => 'input.csv',
            'file_format' => 'csv',
            'mime_type' => 'text/csv',
            'file_size' => 100,
            'storage_path' => 'datasets/input.csv',
            'row_count' => 2,
            'column_count' => 1,
            'parse_status' => 'inspected',
            'preview_rows' => [
                ['name' => 'CV Satu Data'],
                ['name' => 'Satu Data'],
            ],
        ]);

        $referenceColumn = $reference->columns()->create([
            'name' => 'name',
            'normalized_name' => 'name',
            'data_type' => 'text',
            'position' => 1,
        ]);
        $inputColumn = $input->columns()->create([
            'name' => 'name',
            'normalized_name' => 'name',
            'data_type' => 'text',
            'position' => 1,
        ]);

        $this->postJson('/api/matching-jobs/run', [
            'name' => 'Entity Match',
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'mappings' => [[
                'id' => 'map-name',
                'referenceColumnId' => $referenceColumn->id,
                'inputColumnId' => $inputColumn->id,
                'referenceColumnName' => 'name',
                'inputColumnName' => 'name',
                'algorithm' => 'Jaro-Winkler',
            ]],
            'configuration' => [
                'preset' => 'Balanced',
                'strategy' => 'Fuzzy',
                'thresholds' => ['autoMatch' => 90, 'review' => 75, 'noMatch' => 60],
                'candidateGeneration' => ['topN' => 1],
                'normalization' => ['mode' => 'auto', 'preset' => 'Entity Name'],
                'runOptions' => ['chunkSize' => 10, 'workerCount' => 2],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.summary.matched', 1)
            ->assertJsonPath('data.summary.possible_match', 1);

        $conflictResult = MatchingResult::where('input_record_key', '1')->firstOrFail();
        $missingLegalFormResult = MatchingResult::where('input_record_key', '2')->firstOrFail();

        $this->assertSame('possible_match', $conflictResult->result_type);
        $this->assertSame('matched', $missingLegalFormResult->result_type);
        $this->assertSame('Identity metadata conflict requires review', $conflictResult->decision_reason);
        $this->assertTrue($conflictResult->field_scores[0]['identity_conflict']);
        $this->assertSame('PT', $conflictResult->field_scores[0]['identity_metadata']['reference']['legal_form']);
        $this->assertSame('CV', $conflictResult->field_scores[0]['identity_metadata']['input']['legal_form']);
    }
}
