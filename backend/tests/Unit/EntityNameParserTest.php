<?php

namespace Tests\Unit;

use App\Services\Matching\EntityNameParser;
use PHPUnit\Framework\TestCase;

class EntityNameParserTest extends TestCase
{
    public function test_it_splits_entity_identity_metadata_from_core_name(): void
    {
        $parsed = (new EntityNameParser())->parse('PT Satu Data Tbk Cabang Bandung');

        $this->assertSame('PT Satu Data Tbk Cabang Bandung', $parsed['raw_name']);
        $this->assertSame('satu data', $parsed['core_name']);
        $this->assertSame('PT', $parsed['legal_form']);
        $this->assertNull($parsed['ownership_status_qualifier']);
        $this->assertSame('Tbk', $parsed['public_status']);
        $this->assertSame('Cabang', $parsed['unit_type']);
        $this->assertSame('bandung', $parsed['unit_name']);
    }

    public function test_pt_and_cv_are_strict_legal_conflicts_only_when_both_are_explicit(): void
    {
        $parser = new EntityNameParser();

        $this->assertTrue($parser->hasStrictLegalConflict(
            $parser->parse('PT Satu Data'),
            $parser->parse('CV Satu Data'),
        ));
        $this->assertFalse($parser->hasStrictLegalConflict(
            $parser->parse('PT Satu Data'),
            $parser->parse('Satu Data'),
        ));
    }

    public function test_it_normalizes_various_legal_forms(): void
    {
        $parser = new EntityNameParser();

        $this->assertSame('CV', $parser->normalizeLegalForm('Persekutuan Komanditer (CV / Commanditer Venoschaap )'));
        $this->assertSame('CV', $parser->normalizeLegalForm('3'));
        $this->assertSame('CV', $parser->normalizeLegalForm('03'));
        $this->assertSame('CV', $parser->normalizeLegalForm('cv'));

        $this->assertSame('PT', $parser->normalizeLegalForm('Perseroan Terbatas (PT)'));
        $this->assertSame('PT', $parser->normalizeLegalForm('1'));
        $this->assertSame('PT', $parser->normalizeLegalForm('01'));
        $this->assertSame('PT', $parser->normalizeLegalForm('PT'));

        $this->assertSame('Firma', $parser->normalizeLegalForm('4'));
        $this->assertSame('Koperasi', $parser->normalizeLegalForm('5'));
        $this->assertSame('Yayasan', $parser->normalizeLegalForm('6'));
        $this->assertSame('BUMN', $parser->normalizeLegalForm('7'));
        $this->assertSame('Perorangan', $parser->normalizeLegalForm('8'));

        $this->assertNull($parser->normalizeLegalForm(''));
        $this->assertNull($parser->normalizeLegalForm(null));
        $this->assertNull($parser->normalizeLegalForm('Unknown Random String'));
    }
}
