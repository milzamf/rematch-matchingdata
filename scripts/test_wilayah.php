<?php

require __DIR__ . '/../backend/vendor/autoload.php';
$app = require __DIR__ . '/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$service = new App\Services\Matching\WilayahDictionaryService();
echo "Provinces count: " . count($service->getProvinces()) . PHP_EOL;
echo "Regencies count: " . count($service->getRegencies()) . PHP_EOL;

// Test 1: Code 3515
$res1 = $service->resolve('3515');
echo "Test 3515: " . ($res1['full_name'] ?? 'null') . " (" . ($res1['nm_prov'] ?? 'null') . ")" . PHP_EOL;

// Test 2: Name 'Sidoarjo'
$res2 = $service->resolve('Sidoarjo');
echo "Test Sidoarjo: id_kab=" . ($res2['id_kab'] ?? 'null') . " full=" . ($res2['full_name'] ?? 'null') . PHP_EOL;

// Test 3: Composite prov='35', kab='15'
$res3 = $service->resolve('15', ['kdprov' => '35']);
echo "Test kab=15 with prov=35: id_kab=" . ($res3['id_kab'] ?? 'null') . " full=" . ($res3['full_name'] ?? 'null') . PHP_EOL;

// Test 4: Compare '3515' vs 'KAB. SIDOARJO'
$cmp1 = $service->compareRegencies('3515', 'KAB. SIDOARJO');
echo "Compare 3515 vs KAB. SIDOARJO: " . ($cmp1 ? 'MATCH' : 'MISMATCH') . PHP_EOL;

// Test 5: Compare '3515' vs 'KOTA SURABAYA'
$cmp2 = $service->compareRegencies('3515', 'KOTA SURABAYA');
echo "Compare 3515 vs KOTA SURABAYA: " . ($cmp2 ? 'MATCH' : 'MISMATCH') . PHP_EOL;
