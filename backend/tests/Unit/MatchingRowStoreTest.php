<?php

namespace Tests\Unit;

use App\Services\Matching\MatchingRowStore;
use PHPUnit\Framework\TestCase;
use Illuminate\Support\Str;

class MatchingRowStoreTest extends TestCase
{
    public function test_payloads_can_be_normalized_in_place_in_bounded_store(): void
    {
        $store = new MatchingRowStore();
        $store->append(['name' => '  SINAR  '], hash('sha256', 'raw'), 1);
        $store->mapPayloads(static fn (array $row, int $id) => [
            'key' => (string) $id,
            'row' => ['name' => trim($row['name'])],
            'normalized' => ['name' => mb_strtolower(trim($row['name']))],
            'identity' => [],
        ]);

        $this->assertCount(1, $store);
        $this->assertSame('sinar', $store[1]['normalized']['name']);
    }

    public function test_persistent_reference_cache_survives_reopen_and_checks_signature(): void
    {
        $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'rematch-cache-test-'.Str::uuid().'.sqlite';
        $buildingPath = $path.'.building';
        $signature = hash('sha256', 'dataset+mapping');

        try {
            $store = new MatchingRowStore($buildingPath);
            $store->append(['key' => '1', 'row' => ['name' => 'Sinar'], 'normalized' => ['name' => 'sinar'], 'identity' => []]);
            $store->setExactKeys(1, 'id-1', 'name-1');
            $store->buildLookupIndexes();
            $store->markCacheReady($signature);
            $store->promoteCache($path);
            unset($store);

            $this->assertTrue(MatchingRowStore::isValidCache($path, $signature));
            $this->assertFalse(MatchingRowStore::isValidCache($path, hash('sha256', 'different mapping')));

            $cached = new MatchingRowStore($path, false);
            $this->assertCount(1, $cached);
            $this->assertSame('sinar', iterator_to_array($cached->exactMatches('mandatory', 'id-1'))[0]['normalized']['name']);
            unset($cached);
        } finally {
            if (is_file($buildingPath)) @unlink($buildingPath);
            if (is_file($path)) @unlink($path);
        }
    }
}
