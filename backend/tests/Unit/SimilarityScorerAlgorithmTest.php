<?php

namespace Tests\Unit;

use App\Services\Matching\SimilarityScorer;
use App\Services\Matching\ValueNormalizer;
use PHPUnit\Framework\TestCase;

class SimilarityScorerAlgorithmTest extends TestCase
{
    private SimilarityScorer $scorer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scorer = new SimilarityScorer(new ValueNormalizer());
    }

    public function test_token_set_ratio_handles_subset_addresses(): void
    {
        $left = 'Jl. Jendral Sudirman No. 45 Jakarta Pusat';
        $right = 'Jalan Jendral Sudirman No. 45';

        $tokenSetScore = $this->scorer->score('Token Set', $left, $right);
        $levenshteinScore = $this->scorer->score('Levenshtein', $left, $right);
        $jaroScore = $this->scorer->score('Jaro-Winkler', $left, $right);

        $this->assertGreaterThan($levenshteinScore, $tokenSetScore);
        $this->assertEquals(80.0, $tokenSetScore);
    }

    public function test_token_set_ratio_scores_100_percent_when_short_address_is_contained_in_long_detailed_address(): void
    {
        $normalizer = new ValueNormalizer();
        $rawDetailed = 'Jl. Trans TV. RT 12. RW 06 Kelurahan Jati Kota Ternate';
        $rawShort = 'JL TRANS TV';

        $detailed = $normalizer->normalizeByType($rawDetailed, 'text', 'alamat');
        $short = $normalizer->normalizeByType($rawShort, 'text', 'alamat_perusahaan');

        $tokenSetScore = $this->scorer->score('Token Set', $short, $detailed);
        $partialScore = $this->scorer->score('Partial Ratio', $short, $detailed);

        $this->assertEquals(100.0, $tokenSetScore);
        $this->assertEquals(100.0, $partialScore);
    }

    public function test_token_sort_and_token_set_handle_word_order_permutations(): void
    {
        $left = 'PT Maju Jaya Abadi';
        $right = 'Abadi Jaya Maju PT';

        $tokenSortScore = $this->scorer->score('Token Sort', $left, $right);
        $tokenSetScore = $this->scorer->score('Token Set Ratio', $left, $right);
        $levenshteinScore = $this->scorer->score('Levenshtein', $left, $right);

        $this->assertEquals(100.0, $tokenSortScore);
        $this->assertEquals(100.0, $tokenSetScore);
        $this->assertLessThan(50.0, $levenshteinScore);
    }

    public function test_algorithm_name_aliases_and_casing_are_normalized_correctly(): void
    {
        $left = 'PT Indofood Sukses Makmur';
        $right = 'PT Indofood Makmur Sukses';

        // snake_case, camelCase, lowercase, display names
        $score1 = $this->scorer->score('token_sort', $left, $right);
        $score2 = $this->scorer->score('Token Sort', $left, $right);
        $score3 = $this->scorer->score('tokensort', $left, $right);
        $score4 = $this->scorer->score('Token Sort Ratio', $left, $right);

        $this->assertEquals(100.0, $score1);
        $this->assertEquals(100.0, $score2);
        $this->assertEquals(100.0, $score3);
        $this->assertEquals(100.0, $score4);

        $jaro1 = $this->scorer->score('jaro_winkler', $left, $right);
        $jaro2 = $this->scorer->score('Jaro-Winkler', $left, $right);
        $this->assertEquals($jaro1, $jaro2);
    }

    public function test_different_algorithms_produce_distinct_calculated_scores(): void
    {
        $left = 'PT Maju Makmur Bersama';
        $right = 'PT Maju Makmur Bersama Sejahtera';

        $exact = $this->scorer->score('Exact', $left, $right);
        $levenshtein = $this->scorer->score('Levenshtein', $left, $right);
        $jaroWinkler = $this->scorer->score('Jaro-Winkler', $left, $right);
        $tokenSet = $this->scorer->score('Token Set', $left, $right);
        $tokenSort = $this->scorer->score('Token Sort', $left, $right);

        $this->assertEquals(0.0, $exact);
        $this->assertNotEquals($exact, $levenshtein);
        $this->assertNotEquals($levenshtein, $jaroWinkler);
        $this->assertNotEquals($jaroWinkler, $tokenSet);
        $this->assertNotEquals($tokenSort, $tokenSet);
    }
}
