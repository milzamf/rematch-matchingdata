<?php

namespace Tests\Feature;

use App\Models\Dataset;
use App\Services\Matching\MatchingEngineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MatchingReferenceCacheTest extends TestCase
{
    use RefreshDatabase;

    public function test_normalized_reference_and_exact_lookup_are_reused_for_same_file_and_mapping(): void
    {
        $relative = 'matching-cache-test-'.uniqid().'.csv';
        $source = Storage::disk('local')->path($relative);
        if (!is_dir(dirname($source))) mkdir(dirname($source), 0775, true);
        file_put_contents($source, "name\nSinar Abadi\n");

        $dataset = new Dataset(['storage_path' => $relative, 'file_format' => 'csv']);
        $mappings = [[
            'reference_column_name' => 'name',
            'input_column_name' => 'name',
            'required_match' => true,
        ]];
        $engine = app(MatchingEngineService::class);
        $method = new \ReflectionMethod($engine, 'loadOrBuildReferenceRows');
        $method->setAccessible(true);
        $rows = [['name' => 'Sinar Abadi']];
        $cachePath = null;

        try {
            $first = $method->invoke($engine, $dataset, $rows, $mappings, [], static fn () => null);
            $this->assertFalse($first['cache_hit']);
            $this->assertCount(1, $first['rows']);
            $this->assertSame(1, count(iterator_to_array($first['rows']->exactMatches('mandatory', 'sinar abadi'))));
            $cachePath = storage_path('app/matching-cache/reference_'.$first['cache_key'].'.sqlite');
            unset($first['rows']);

            $second = $method->invoke($engine, $dataset, [['name' => 'This must not be read on a cache hit']], $mappings, [], static fn () => null);
            $this->assertTrue($second['cache_hit']);
            $this->assertSame('Sinar Abadi', $second['rows'][1]['row']['name']);
            unset($second['rows']);
        } finally {
            if (is_file($source)) @unlink($source);
            if ($cachePath !== null && is_file($cachePath)) @unlink($cachePath);
        }
    }
}
