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
}
