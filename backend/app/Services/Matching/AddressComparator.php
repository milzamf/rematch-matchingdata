<?php

namespace App\Services\Matching;

/** Partial address agreement is evidence, not proof of the same business. */
class AddressComparator
{
    public function __construct(private readonly ValueNormalizer $normalizer) {}

    public function isAddress(string $column): bool
    {
        return (bool) preg_match('/alamat|address|street|jalan/i', $column);
    }

    /** Apply proposals only after the caller has verified a final accepted match. */
    public function enrich(array $reference, array $input, array $scores): array
    {
        $values = $reference;
        $changes = [];
        $wilayah = new WilayahDictionaryService();
        foreach ($scores as $score) {
            $role = $wilayah->detectWilayahColumnRole((string) ($score['reference_column'] ?? ''))
                ?? $wilayah->detectWilayahColumnRole((string) ($score['input_column'] ?? ''));
            if (!empty($score['identity_conflict']) || !empty($score['numeric_mismatch'])
                || ($role !== null && (str_starts_with($role, 'KAB_') || str_starts_with($role, 'PROV_')) && ($score['score'] ?? 0) < 100)) {
                return ['values' => $values, 'changes' => []];
            }
        }
        foreach ($scores as $score) {
            $refCol = $score['reference_column'] ?? '';
            $inpCol = $score['input_column'] ?? '';
            if (!$this->isAddress($refCol) && !$this->isAddress($inpCol)) continue;
            $evidence = $score['address_evidence'] ?? null;
            if (($evidence['compatible'] ?? false) && !($evidence['conflict'] ?? true)
                && ($evidence['richer_side'] ?? null) === 'input') {
                $proposed = $input[$inpCol] ?? null;
                if ($proposed === null || trim((string) $proposed) === '') continue;
                $changes[] = ['field' => $refCol, 'original' => $reference[$refCol] ?? null,
                    'proposed' => $proposed, 'source' => 'input', 'source_field' => $inpCol];
                $values[$refCol] = $proposed;
            }
        }
        return ['values' => $values, 'changes' => $changes];
    }

    public function compare(string $reference, string $input): array
    {
        $canonicalize = function (string $value): string {
            $value = $this->normalizer->normalizeByType($value, 'text', 'alamat');
            // Common Indonesian address abbreviations must not make an otherwise
            // identical partial/full address look like a different location.
            $value = preg_replace('/\b(?:jl|jln)\b/u', 'jalan', $value) ?? $value;
            $value = preg_replace('/\bno\b/u', 'nomor', $value) ?? $value;
            return trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
        };
        $left = $canonicalize($reference);
        $right = $canonicalize($input);
        $result = ['compatible' => false, 'conflict' => false, 'richer_side' => null];
        if ($left === '' || $right === '') return $result;
        if ($left === $right) return [...$result, 'compatible' => true];

        // Compare typed components only when present on both sides. Missing detail
        // is not a conflict; a different number/direction is not enrichment.
        foreach (['nomor', 'rt', 'rw', 'blok', 'km'] as $component) {
            $pattern = '/\\b'.$component.'\\s*([0-9]+[a-z]?)\\b/u';
            if (preg_match($pattern, $left, $a) && preg_match($pattern, $right, $b)
                && (ltrim($a[1], '0') ?: '0') !== (ltrim($b[1], '0') ?: '0')) {
                return [...$result, 'conflict' => true];
            }
        }
        preg_match_all('/\\b(?:utara|selatan|timur|barat)\\b/u', $left, $a);
        preg_match_all('/\\b(?:utara|selatan|timur|barat)\\b/u', $right, $b);
        if ($a[0] && $b[0] && array_diff($a[0], $b[0]) && array_diff($b[0], $a[0])) {
            return [...$result, 'conflict' => true];
        }
        $tokens = static function (string $text): array {
            $parts = preg_split('/\\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            return array_values(array_unique(array_filter($parts, static fn ($t) =>
                !in_array($t, ['jalan','nomor','rt','rw','blok','kelurahan','kecamatan','kabupaten','kota','provinsi'], true))));
        };
        $a = $tokens($left); $b = $tokens($right);
        $short = count($a) <= count($b) ? $a : $b;
        $long = count($a) <= count($b) ? $b : $a;
        $distinctive = array_filter($short, static fn ($t) => !ctype_digit($t) && mb_strlen($t) >= 3);
        if (count($distinctive) < 2 || array_diff($short, $long)) return $result;
        return [
            'compatible' => true,
            'conflict' => false,
            'richer_side' => count($a) === count($b) ? null : (count($a) > count($b) ? 'reference' : 'input'),
        ];
    }
}
