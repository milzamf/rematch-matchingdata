import re

with open('tests/Feature/MatchingEngineTest.php', 'r') as f:
    code = f.read()

# Duplicate the postJson call in test_matching_engine_executes_entire_large_dataset_without_row_capping
code = re.sub(
    r'(\$response = \$this->postJson\(\'/api/matching-jobs/run\', \[\s*\'reference_dataset_id\' => \$reference->id,[\s\S]*?\]\);\s*\$response->assertStatus\(200\);)',
    r'''\1
        $response2 = $this->postJson('/api/matching-jobs/run', [
            'reference_dataset_id' => $reference->id,
            'input_dataset_id' => $input->id,
            'name' => '500 Rows Matching Job 2',
            'mappings' => [
                [
                    'referenceColumnName' => 'nama_perusahaan',
                    'inputColumnName' => 'nama_vendor',
                    'algorithm' => 'Normalized Exact',
                    'weight' => 100,
                ],
            ],
            'options' => [
                'candidate_limit' => 30,
            ],
        ]);
        $response2->assertStatus(200);''', code)

with open('tests/Feature/MatchingEngineTest.php', 'w') as f:
    f.write(code)
print("PATCHED TEST PROPERLY")
