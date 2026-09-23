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
        $this->assertTrue($parsed['is_legal_entity']);
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
        $this->assertSame('CV', $parser->normalizeLegalForm('Commanditaire Vennootschap'));
        $this->assertSame('CV', $parser->normalizeLegalForm('Persekutuan Komanditer'));
        $this->assertSame('CV', $parser->normalizeLegalForm('C.V.'));
        $this->assertSame('CV', $parser->normalizeLegalForm('3'));
        $this->assertSame('CV', $parser->normalizeLegalForm('03'));
        $this->assertSame('CV', $parser->normalizeLegalForm('cv'));

        $this->assertSame('PT', $parser->normalizeLegalForm('Perseroan Terbatas (PT)'));
        $this->assertSame('PT', $parser->normalizeLegalForm('Perseroan Terbatas'));
        $this->assertSame('PT', $parser->normalizeLegalForm('P.T.'));
        $this->assertSame('PT', $parser->normalizeLegalForm('1'));
        $this->assertSame('PT', $parser->normalizeLegalForm('01'));
        $this->assertSame('PT', $parser->normalizeLegalForm('PT'));

        $this->assertSame('Firma', $parser->normalizeLegalForm('Persekutuan Firma'));
        $this->assertSame('Firma', $parser->normalizeLegalForm('Fa.'));
        $this->assertSame('Firma', $parser->normalizeLegalForm('4'));

        $this->assertSame('UD', $parser->normalizeLegalForm('Usaha Dagang'));
        $this->assertSame('UD', $parser->normalizeLegalForm('U.D.'));
        $this->assertSame('UD', $parser->normalizeLegalForm('UD'));

        $this->assertSame('PD', $parser->normalizeLegalForm('Perusahaan Dagang'));
        $this->assertSame('PD', $parser->normalizeLegalForm('PD'));

        $this->assertSame('Koperasi', $parser->normalizeLegalForm('Koperasi Simpan Pinjam'));
        $this->assertSame('Koperasi', $parser->normalizeLegalForm('KSP'));
        $this->assertSame('Koperasi', $parser->normalizeLegalForm('5'));

        $this->assertSame('Yayasan', $parser->normalizeLegalForm('Yayasan'));
        $this->assertSame('Yayasan', $parser->normalizeLegalForm('Yys.'));
        $this->assertSame('Yayasan', $parser->normalizeLegalForm('6'));

        $this->assertSame('BUMN', $parser->normalizeLegalForm('7'));
        $this->assertSame('Perorangan', $parser->normalizeLegalForm('8'));

        $this->assertSame('Perum', $parser->normalizeLegalForm('Perusahaan Umum'));
        $this->assertSame('Perumda', $parser->normalizeLegalForm('Perumda'));
        $this->assertSame('PDAM', $parser->normalizeLegalForm('Perusahaan Daerah Air Minum'));
        $this->assertSame('BUMDes', $parser->normalizeLegalForm('BUMDesa'));

        $this->assertSame('Pte Ltd', $parser->normalizeLegalForm('Private Limited'));
        $this->assertSame('Pte Ltd', $parser->normalizeLegalForm('Pte. Ltd.'));
        $this->assertSame('Co Ltd', $parser->normalizeLegalForm('Company Limited'));
        $this->assertSame('Co Ltd', $parser->normalizeLegalForm('Co., Ltd.'));
        $this->assertSame('Ltd', $parser->normalizeLegalForm('Limited'));

        $this->assertNull($parser->normalizeLegalForm(''));
        $this->assertNull($parser->normalizeLegalForm(null));
        $this->assertNull($parser->normalizeLegalForm('Unknown Random String'));
    }

    public function test_cv_and_commanditaire_vennootschap_and_persekutuan_komanditer_are_treated_the_same(): void
    {
        $parser = new EntityNameParser();

        $fromCV = $parser->parse('CV. Berkah Mandiri');
        $fromFullDutch = $parser->parse('Commanditaire Vennootschap Berkah Mandiri');
        $fromIndonesian = $parser->parse('Persekutuan Komanditer Berkah Mandiri');

        // All should identify canonical 'CV'
        $this->assertSame('CV', $fromCV['legal_form']);
        $this->assertSame('CV', $fromFullDutch['legal_form']);
        $this->assertSame('CV', $fromIndonesian['legal_form']);

        // All should extract the identical core name
        $this->assertSame('berkah mandiri', $fromCV['core_name']);
        $this->assertSame('berkah mandiri', $fromFullDutch['core_name']);
        $this->assertSame('berkah mandiri', $fromIndonesian['core_name']);

        // None of CVs are Badan Hukum
        $this->assertFalse($fromCV['is_legal_entity']);
        $this->assertFalse($fromFullDutch['is_legal_entity']);

        // Crucial test: They should NOT have strict legal conflict with each other
        $this->assertFalse($parser->hasStrictLegalConflict($fromCV, $fromFullDutch));
        $this->assertFalse($parser->hasStrictLegalConflict($fromFullDutch, $fromIndonesian));
        $this->assertFalse($parser->hasStrictLegalConflict($fromCV, $fromIndonesian));

        // But they DO conflict with PT (even if PT is written in full 'Perseroan Terbatas')
        $fromPT = $parser->parse('Perseroan Terbatas Berkah Mandiri');
        $this->assertSame('PT', $fromPT['legal_form']);
        $this->assertSame('berkah mandiri', $fromPT['core_name']);
        $this->assertTrue($fromPT['is_legal_entity']);

        $this->assertTrue($parser->hasStrictLegalConflict($fromCV, $fromPT));
        $this->assertTrue($parser->hasStrictLegalConflict($fromFullDutch, $fromPT));
    }

    public function test_dictionary_samples_from_kamus_badan_usaha(): void
    {
        $parser = new EntityNameParser();

        $samples = [
            'PT. Sumber Makmur Abadi Tbk.' => [
                'legal_form' => 'PT',
                'core_name' => 'sumber makmur abadi',
                'public_status' => 'Tbk',
                'is_legal_entity' => true,
            ],
            'Perseroan Terbatas Sumber Makmur Abadi' => [
                'legal_form' => 'PT',
                'core_name' => 'sumber makmur abadi',
                'is_legal_entity' => true,
            ],
            'Sumber Makmur Abadi, PT' => [
                'legal_form' => 'PT',
                'core_name' => 'sumber makmur abadi',
                'is_legal_entity' => true,
            ],
            'Usaha Dagang Sinar Terang' => [
                'legal_form' => 'UD',
                'core_name' => 'sinar terang',
                'is_legal_entity' => false,
            ],
            'UD. Sinar Terang' => [
                'legal_form' => 'UD',
                'core_name' => 'sinar terang',
                'is_legal_entity' => false,
            ],
            'PT Telekomunikasi Indonesia (Persero) Tbk' => [
                'legal_form' => 'PT',
                'core_name' => 'telekomunikasi indonesia',
                'ownership_status_qualifier' => 'Persero',
                'public_status' => 'Tbk',
                'is_legal_entity' => true,
            ],
            'Koperasi Simpan Pinjam Sejahtera Bersama' => [
                'legal_form' => 'Koperasi',
                'core_name' => 'sejahtera bersama',
                'is_legal_entity' => true,
            ],
            'Yayasan Pendidikan Harapan Bangsa' => [
                'legal_form' => 'Yayasan',
                'core_name' => 'pendidikan harapan bangsa',
                'is_legal_entity' => true,
            ],
            'Google Asia Pacific Pte. Ltd.' => [
                'legal_form' => 'Pte Ltd',
                'core_name' => 'google asia pacific',
                'is_legal_entity' => true,
            ],
            'Mitsui & Co., Ltd.' => [
                'legal_form' => 'Co Ltd',
                'core_name' => 'mitsui',
                'is_legal_entity' => true,
            ],
        ];

        foreach ($samples as $input => $expected) {
            $parsed = $parser->parse($input);
            $this->assertSame($expected['legal_form'], $parsed['legal_form'], "Failed legal_form for: {$input}");
            $this->assertSame($expected['core_name'], $parsed['core_name'], "Failed core_name for: {$input}");
            $this->assertSame($expected['is_legal_entity'], $parsed['is_legal_entity'], "Failed is_legal_entity for: {$input}");
            if (isset($expected['public_status'])) {
                $this->assertSame($expected['public_status'], $parsed['public_status'], "Failed public_status for: {$input}");
            }
            if (isset($expected['ownership_status_qualifier'])) {
                $this->assertSame($expected['ownership_status_qualifier'], $parsed['ownership_status_qualifier'], "Failed ownership_status_qualifier for: {$input}");
            }
        }
    }
}
