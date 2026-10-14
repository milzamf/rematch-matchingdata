<?php
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
if (getenv('DB_DATABASE') !== 'rematch_stage4_test' || getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') throw new RuntimeException('Isolated UAT only');
$c = new Capsule;
$c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage4_test','username'=>'root','password'=>'','charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci']);
$db = $c->getConnection();
$f = json_decode(file_get_contents('/tmp/shared-uat.json'), true);
$reader = new SharedWorkspaceReader($db, new WorkspaceAccessService($db, true));
$metrics = [];
$cases = ['similarity_desc'=>['sort'=>'similarity_desc'], 'deep_page'=>['sort'=>'similarity_asc','page'=>10000], 'region'=>['input_province_code'=>'32','sort'=>'similarity_desc'], 'name_search'=>['search'=>'PT UAT 15000','sort'=>'similarity_desc'], 'score_range'=>['similarity_min'=>90,'similarity_max'=>100,'sort'=>'similarity_desc']];
if (getenv('UAT_READER_CASES')) $cases = array_intersect_key($cases, array_flip(explode(',', getenv('UAT_READER_CASES'))));
foreach ($cases as $name=>$filter) {
    $samples = [];
    for ($i=0; $i<11; $i++) {
        $start = microtime(true);
        $result = $reader->review($f['owner'], $f['workspace'], $f['job'], $filter + ['per_page'=>25]);
        $ms = (microtime(true)-$start)*1000;
        if ($i === 0) $first = $ms; else $samples[] = $ms;
    }
    sort($samples);
    $metrics[$name] = ['first_ms'=>$first,'p50_ms'=>$samples[4],'p95_ms'=>$samples[9],'total'=>$result['pagination']['total'],'payload_bytes'=>strlen(json_encode($result))];
    echo $name.' '.json_encode($metrics[$name])."\n";
}
file_put_contents('/tmp/uat-reader-final.json', json_encode(['reader'=>$metrics,'php_peak_mib'=>memory_get_peak_usage(true)/1048576], JSON_PRETTY_PRINT));
