<?php

namespace App\Services\Matching;

use InvalidArgumentException;

/** Input eligibility only; never narrows the reference candidate pool. */
class MatchingInputScope
{
    public function __construct(private readonly WilayahDictionaryService $dictionary) {}

    public function normalize(array $scope): array
    {
        $result = [];
        foreach (['provinceCodes' => $this->dictionary->getProvinces(), 'regencyCodes' => $this->dictionary->getRegencies()] as $key => $allowed) {
            $codes = $scope[$key] ?? [];
            if (!is_array($codes)) throw new InvalidArgumentException('Pilihan wilayah harus berupa daftar kode MFD.');
            foreach ($codes as $code) {
                if (!is_string($code) || !isset($allowed[$code])) throw new InvalidArgumentException('Kode wilayah input tidak dikenal dalam MFD.');
            }
            $result[$key] = array_values(array_unique($codes));
            sort($result[$key], SORT_STRING);
        }
        foreach ($result['regencyCodes'] as $code) {
            if ($result['provinceCodes'] && !in_array(substr($code, 0, 2), $result['provinceCodes'], true)) {
                throw new InvalidArgumentException('Kabupaten/kota input harus berada di provinsi yang dipilih.');
            }
        }
        foreach (['provinceColumn', 'regencyColumn'] as $key) {
            $column = $scope[$key] ?? null;
            if ($column !== null && (!is_string($column) || strlen($column) > 255)) throw new InvalidArgumentException('Kolom wilayah input tidak valid.');
            $result[$key] = $column ?: null;
        }
        return $result;
    }

    public function predicate(array $scope, array $columns): \Closure
    {
        $scope = $this->normalize($scope);
        if (!$scope['provinceCodes'] && !$scope['regencyCodes']) return static fn (array $row): bool => true;
        foreach (['provinceColumn', 'regencyColumn'] as $key) {
            if ($scope[$key] && !in_array($scope[$key], $columns, true)) throw new InvalidArgumentException('Kolom wilayah input tidak tersedia pada dataset.');
        }
        $roles = array_filter(array_map(fn ($column) => $this->dictionary->detectWilayahColumnRole($column), $columns));
        if (!$scope['provinceColumn'] && !$scope['regencyColumn'] && !array_filter($roles, fn ($role) => str_starts_with($role, 'PROV_') || str_starts_with($role, 'KAB_'))) {
            throw new InvalidArgumentException('Pilih kolom provinsi atau kabupaten/kota input sebelum membatasi wilayah matching.');
        }
        if ($scope['regencyCodes'] && !$scope['regencyColumn'] && !array_filter($roles, fn ($role) => str_starts_with($role, 'KAB_'))) {
            throw new InvalidArgumentException('Pilih kolom kabupaten/kota input sebelum membatasi kabupaten/kota matching.');
        }
        $provinces = array_fill_keys($scope['provinceCodes'], true);
        $regencies = array_fill_keys($scope['regencyCodes'], true);
        $dictionary = $this->dictionary;
        $index = new ReviewRegionIndexService($dictionary);
        return static function (array $row) use ($scope, $provinces, $regencies, $index, $dictionary): bool {
            if ($scope['provinceColumn']) {
                $value = $row[$scope['provinceColumn']] ?? null;
                foreach (array_keys($row) as $column) {
                    // Explicit columns take precedence over inferred columns.
                    if (str_starts_with((string) $dictionary->detectWilayahColumnRole((string) $column), 'PROV_')) unset($row[$column]);
                }
                $row['provinsi'] = $value;
            }
            if ($scope['regencyColumn']) {
                $value = $row[$scope['regencyColumn']] ?? null;
                foreach (array_keys($row) as $column) {
                    if (str_starts_with((string) $dictionary->detectWilayahColumnRole((string) $column), 'KAB_')) unset($row[$column]);
                }
                $row['kabupaten'] = $value;
            }
            $codes = $index->codes($row);
            return (!$provinces || isset($provinces[$codes['input_province_code'] ?? '']))
                && (!$regencies || isset($regencies[$codes['input_regency_code'] ?? '']));
        };
    }
}
