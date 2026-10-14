<?php

namespace Tests\Unit;

use App\Services\Matching\MatchingEngineService;
use App\Services\Matching\WilayahDictionaryService;
use Tests\TestCase;

class WilayahContextTest extends TestCase
{
    public function test_separate_codes_disambiguate_bandung_and_kupang(): void
    {
        $dictionary = app(WilayahDictionaryService::class);
        $this->assertCount(514, $dictionary->getRegencies());
        $this->assertNull($dictionary->findRegencyByName('Bandung', '32'));
        $this->assertSame('3204', $dictionary->resolve('BANDUNG', ['kd_prov' => '32', 'kd_kab' => '04'])['id_kab']);
        $this->assertSame('3204', $dictionary->resolve('BANDUNG', ['prov' => '32', 'kab' => '04'])['id_kab']);
        $this->assertSame('3273', $dictionary->resolve('BANDUNG', ['kdprov' => '32', 'kdkab' => '73'])['id_kab']);
        $this->assertSame('5371', $dictionary->resolve('KUPANG', ['nm_prov' => 'NUSA TENGGARA TIMUR', 'kd_kab' => '71'])['id_kab']);
        $this->assertSame('5303', $dictionary->resolve('KUPANG', ['kd_prov' => '53', 'kd_kab' => '03'])['id_kab']);
        $this->assertTrue($dictionary->compareRegencies('[04] BANDUNG', 'BANDUNG', ['provinsi' => '[32] JAWA BARAT'], ['kd_prov' => '32', 'kd_kab' => '04']));
        $this->assertFalse($dictionary->compareRegencies('[04] BANDUNG', 'BANDUNG', ['provinsi' => '[32] JAWA BARAT'], ['kd_prov' => '32', 'kd_kab' => '73']));
        $this->assertSame('3273', $dictionary->findRegencyByName('Kota Bandung', '32')['id_kab']);
        $this->assertSame('3204', $dictionary->findRegencyByName('Kabupaten Bandung', '32')['id_kab']);
        foreach ($dictionary->getRegencies() as $record) {
            if (str_starts_with($record['kd_kab'], '7')) $this->assertStringStartsWith('KOTA ', $record['nm_kab']);
        }
    }

    public function test_engine_normalizes_mapped_name_using_unmapped_code_context(): void
    {
        $engine = app(MatchingEngineService::class);
        $method = new \ReflectionMethod($engine, 'normalizeRecord');
        $record = $method->invoke($engine, ['nm_kab' => 'BANDUNG', 'kd_prov' => '32', 'kd_kab' => '04'], 1,
            [['reference_column_name' => 'nm_kab']], 'reference_column_name', []);
        $this->assertSame('3204', $record['normalized']['nm_kab']);
    }
}
