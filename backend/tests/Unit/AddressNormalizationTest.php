<?php

namespace Tests\Unit;

use App\Services\Matching\AddressComparator;
use App\Services\Matching\SimilarityScorer;
use App\Services\Matching\ValueNormalizer;
use Tests\TestCase;

class AddressNormalizationTest extends TestCase
{
    public function test_house_suffix_spacing_and_street_abbreviations_are_equivalent(): void
    {
        $normalizer = app(ValueNormalizer::class);
        $comparator = app(AddressComparator::class);
        $canonical = $normalizer->normalizeByType('JALAN JROBANG RAYA No. 14A', 'text', 'alamat');
        foreach (['JL JROBANG RAYA NO 14 A', 'Jl. Jrobang Raya No. 14A', 'JLN JROBANG RAYA NOMOR 014 A'] as $address) {
            $actual = $normalizer->normalizeByType($address, 'text', 'alamat');
            $this->assertSame($canonical, $actual);
            $this->assertSame($canonical, $normalizer->normalize($address, 'Address'));
            $this->assertSame(100.0, app(SimilarityScorer::class)->score('Levenshtein', $canonical, $actual));
            $this->assertSame(['compatible' => true, 'conflict' => false, 'richer_side' => null], $comparator->compare($address, 'JALAN JROBANG RAYA No. 14A'));
        }
        foreach (['JL JROBANG RAYA NO 14 B', 'JL JROBANG RAYA NO 15', 'JL JROBANG RAYA NO 14'] as $address) {
            $this->assertTrue($comparator->compare($address, 'JALAN JROBANG RAYA No. 14A')['conflict']);
        }
        $this->assertSame('jalan mawar nomor 45 jakarta pusat', $normalizer->normalizeByType('JL MAWAR NO 45 JAKARTA PUSAT', 'text', 'alamat'));
        $this->assertSame('jalan mawar nomor 9 rt 015', $normalizer->normalizeByType('JL MAWAR NO 9 RT 015', 'text', 'alamat'));
    }
}
