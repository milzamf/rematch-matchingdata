<?php

namespace App\Services\Matching;

use App\Jobs\BuildReviewRegionIndex;
use App\Models\MatchingJob;
use Illuminate\Support\Facades\DB;

class ReviewRegionIndexService
{
    public function __construct(private readonly WilayahDictionaryService $dictionary) {}

    public function codes(array $row): array
    {
        $province = null;
        $regency = null;
        foreach ($row as $column => $value) {
            $role = $this->dictionary->detectWilayahColumnRole((string) $column);
            if ($role && str_starts_with($role, 'PROV_')) {
                $province ??= $this->dictionary->resolveProvince($value);
            }
        }
        foreach ($row as $column => $value) {
            $role = $this->dictionary->detectWilayahColumnRole((string) $column);
            if ($role && str_starts_with($role, 'KAB_')) {
                $regency ??= $this->dictionary->resolve($value, $row);
            }
        }
        return [
            'input_province_code' => isset($province['kd_prov']) ? (string) $province['kd_prov'] : (isset($regency['kd_prov']) ? (string) $regency['kd_prov'] : null),
            'input_regency_code' => isset($regency['id_kab']) ? (string) $regency['id_kab'] : null,
            'input_region_indexed' => true,
        ];
    }

    public function remaining(string $jobId): int
    {
        return DB::table('matching_results')->where('matching_job_id', $jobId)
            ->where('candidate_rank', 1)->where('input_region_indexed', false)->count();
    }

    public function options(MatchingJob $job): array
    {
        $remaining = $this->remaining($job->id);
        if ($remaining > 0) {
            if (cache()->add("review_regions_queued_{$job->id}", true, 300)) {
                BuildReviewRegionIndex::dispatch($job->id);
            }
            return ['ready' => false, 'remaining' => $remaining, 'provinces' => [], 'regencies' => []];
        }
        return cache()->remember("review_regions_options_v2_{$job->id}_{$job->processed_count}", 3600, function () use ($job) {
            $pairs = DB::table('matching_results')->where('matching_job_id', $job->id)->where('candidate_rank', 1)
                ->whereNotNull('input_province_code')->select('input_province_code', 'input_regency_code')->distinct()->get();
            $provinces = $this->dictionary->getProvinces();
            $regencies = $this->dictionary->getRegencies();
            $prov = [];
            $kab = [];
            foreach ($pairs as $pair) {
                $code = (string) $pair->input_province_code;
                if (isset($provinces[$code])) $prov[$code] = ['code' => $code, 'label' => $provinces[$code]['nm_prov']];
                $id = (string) ($pair->input_regency_code ?? '');
                if (isset($regencies[$id])) $kab[$id] = ['code' => $id, 'province_code' => $code, 'label' => $regencies[$id]['full_name'] ?? $regencies[$id]['nm_kab']];
            }
            usort($prov, fn ($a, $b) => strcasecmp($a['label'], $b['label']));
            usort($kab, fn ($a, $b) => strcasecmp($a['label'], $b['label']));
            return ['ready' => true, 'remaining' => 0, 'provinces' => array_values($prov), 'regencies' => array_values($kab)];
        });
    }

    public function backfill(string $jobId): void
    {
        $query = DB::table('matching_results')->where('matching_job_id', $jobId)->where('candidate_rank', 1)
            ->where('input_region_indexed', false)->select('id');
        if (DB::getDriverName() === 'mysql') {
            $query->selectRaw("JSON_EXTRACT(candidate_metadata, '$.input_record') AS input_row");
        } else {
            $query->addSelect('candidate_metadata');
        }
        $query->chunkById(500, function ($rows) {
            $provinceBindings = [];
            $regencyBindings = [];
            $ids = [];
            foreach ($rows as $row) {
                $input = isset($row->input_row) ? json_decode($row->input_row, true) : data_get(json_decode($row->candidate_metadata ?? '{}', true), 'input_record', []);
                $codes = $this->codes(is_array($input) ? $input : []);
                array_push($provinceBindings, $row->id, $codes['input_province_code']);
                array_push($regencyBindings, $row->id, $codes['input_regency_code']);
                $ids[] = $row->id;
            }
            $cases = implode(' ', array_fill(0, count($ids), 'WHEN ? THEN ?'));
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            DB::update("UPDATE matching_results SET input_province_code = CASE id {$cases} END, input_regency_code = CASE id {$cases} END, input_region_indexed = 1 WHERE id IN ({$placeholders})", [...$provinceBindings, ...$regencyBindings, ...$ids]);
        });
    }
}
