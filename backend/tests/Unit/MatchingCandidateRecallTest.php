<?php

namespace Tests\Unit;

use App\Services\Matching\MatchingEngineService;
use Tests\TestCase;

class MatchingCandidateRecallTest extends TestCase
{
    private function score(array $candidates, bool $prune = true): array
    {
        $engine = app(MatchingEngineService::class);
        $method = new \ReflectionMethod($engine, 'evaluateCandidates');
        $row = ['key' => 'input', 'row' => ['title' => 'SANJAYA MULTI SOLUSI'], 'normalized' => ['title' => 'sanjaya multi solusi'], 'identity' => []];
        return $method->invoke($engine, $row, $candidates,
            [['input_column_name' => 'title', 'reference_column_name' => 'title', 'algorithm' => 'Levenshtein', 'weight' => 100]],
            ['thresholds' => ['autoMatch' => 90, 'review' => 75], 'candidateGeneration' => ['topN' => 3], 'searchOptimization' => ['candidatePruning' => $prune]]);
    }

    public function test_late_true_candidate_is_not_pruned_by_earlier_low_scores(): void
    {
        $candidates = [];
        for ($n = 1; $n <= 20; $n++) $candidates[] = ['key' => (string) $n, 'row' => ['title' => 'ZZZZZZZZZ'], 'normalized' => ['title' => 'zzzzzzzzz'], 'identity' => []];
        $candidates[] = ['key' => '001', 'row' => ['title' => 'SANJAYA MULTI SOLUSI'], 'normalized' => ['title' => 'sanjaya multi solusi'], 'identity' => []];
        $result = $this->score($candidates);
        $this->assertCount(3, $result);
        $this->assertSame('001', $result[0]['record']['key']);
        $this->assertSame(100.0, $result[0]['score']);
    }

    public function test_tied_distinct_references_are_stable_and_require_review(): void
    {
        $rows = array_map(fn ($key) => ['key' => $key, 'row' => ['title' => 'SANJAYA MULTI SOLUSI'], 'normalized' => ['title' => 'sanjaya multi solusi'], 'identity' => []], ['1', '001']);
        $result = $this->score($rows);
        $this->assertSame(['001', '1'], array_column(array_column($result, 'record'), 'key'));
        $this->assertSame(['possible_match', 'possible_match'], array_column($result, 'classification'));
    }

    public function test_valid_identifiers_add_retrieval_evidence_but_placeholders_do_not(): void
    {
        $engine = app(MatchingEngineService::class);
        $mappings = [['input_column_name' => 'nib'], ['input_column_name' => 'nama_perusahaan']];
        $this->assertContains('9120108392872', $engine->buildCandidateBlockingQueries(['normalized' => ['nib' => '9120108392872', 'nama_perusahaan' => 'Sanjaya Multi Solusi']], $mappings));
        $this->assertNotContains('9999999999', $engine->buildCandidateBlockingQueries(['normalized' => ['nib' => '9999999999', 'nama_perusahaan' => 'Sanjaya Multi Solusi']], $mappings));
    }

    public function test_generated_names_cannot_share_a_raw_empty_cache_key(): void
    {
        $engine = app(MatchingEngineService::class);
        $key = new \ReflectionMethod($engine, 'memoizationKey');
        $mappings = [['input_column_name' => '[Generated] Nama Inti']];
        $a = ['row' => ['nama' => 'Perusahaan Satu'], 'normalized' => ['[Generated] Nama Inti' => 'satu']];
        $b = ['row' => ['nama' => 'Perusahaan Dua'], 'normalized' => ['[Generated] Nama Inti' => 'dua']];
        $this->assertNotSame($key->invoke($engine, $a, $mappings), $key->invoke($engine, $b, $mappings));
        $this->assertSame($key->invoke($engine, $a, $mappings), $key->invoke($engine, $a, $mappings));
    }

    public function test_proven_bound_preserves_the_same_candidates_scores_and_explanations(): void
    {
        $rows = array_map(fn ($value, $key) => ['key' => (string) $key, 'row' => ['title' => $value], 'normalized' => ['title' => strtolower($value)], 'identity' => []],
            ['SANJAYA MULTI SOLUSI', 'SANJAYA MULTI SOLUSX', 'SANJAYA MULTI SOLUXX', 'ZZZZZZZ', 'YYYYYY', 'SANJAYA MULTI SOLUSI'], [1, 2, 3, 4, 5, 6]);
        $this->assertSame($this->score($rows, false), $this->score($rows, true));
    }
}
