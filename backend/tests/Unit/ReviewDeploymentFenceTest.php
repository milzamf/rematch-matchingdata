<?php

namespace Tests\Unit;

use App\Http\Middleware\ReviewDeploymentFence as Middleware;
use App\Services\Matching\Transactions\ReviewDeploymentFence as Fence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Http\Request;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Response;

class ReviewDeploymentFenceTest extends TestCase
{
    private string $marker;

    protected function setUp(): void
    {
        $this->marker = sys_get_temp_dir().'/rematch-fence-'.bin2hex(random_bytes(8));
        $container = new Container;
        $container->instance('config', new Repository(['review_deployment'=>['write_frozen'=>false,'freeze_file'=>$this->marker], 'workspace_access'=>['enabled'=>false], 'review_transactions'=>['enabled'=>false]]));
        Container::setInstance($container);
    }

    protected function tearDown(): void
    {
        if (is_file($this->marker)) unlink($this->marker);
        Container::setInstance(null);
    }

    public function test_default_off_preserves_legacy_mutations(): void
    {
        $result = (new Middleware)->handle(Request::create('/api/workspaces/w', 'PATCH'), fn()=>new Response('legacy'));
        $this->assertSame('legacy', $result->getContent());
        $this->assertFalse(Fence::legacyBlocked());
    }

    public function test_new_mode_fences_config_matching_and_legacy_review_but_keeps_versioned_writes(): void
    {
        config(['workspace_access.enabled'=>true]);
        foreach (['/api/workspaces/w'=>'legacy_workspace_write_disabled', '/api/matching-jobs/run'=>'legacy_workspace_write_disabled', '/api/matching-jobs/j/review-decisions/d/undo'=>'legacy_review_write_disabled'] as $url=>$reason) {
            try { (new Middleware)->handle(Request::create($url, 'POST'), fn()=>throw new \RuntimeException('Handler must not run')); $this->fail('Legacy bypass'); }
            catch (ReviewWriteConflict $error) { $this->assertSame($reason, $error->reason); $this->assertSame(409, $error->getStatusCode()); }
        }
        $result = (new Middleware)->handle(Request::create('/api/stage5a/jobs/j/decisions', 'POST'), fn()=>new Response('versioned'));
        $this->assertSame('versioned', $result->getContent());
    }

    public function test_dynamic_shared_marker_blocks_business_reads_and_writes_but_allows_auth(): void
    {
        $this->assertFalse(Fence::frozen());
        touch($this->marker);
        foreach ([['GET','/api/matching-jobs/j/review-results'], ['POST','/api/stage5a/jobs/j/decisions']] as [$verb,$url]) {
            try { (new Middleware)->handle(Request::create($url,$verb),fn()=>throw new \RuntimeException('Handler must not run')); $this->fail('Freeze bypass'); }
            catch (ReviewWriteConflict $error) { $this->assertSame('review_deployment_frozen',$error->reason); $this->assertSame(503,$error->getStatusCode()); }
        }
        foreach (['/api/login','/api/logout','/api/me'] as $url) $this->assertSame(200,(new Middleware)->handle(Request::create($url,'POST'),fn()=>new Response)->getStatusCode());
        unlink($this->marker);
        $this->assertFalse(Fence::frozen());
    }

    public function test_queue_admission_does_not_call_engine_while_frozen(): void
    {
        config(['review_deployment.write_frozen'=>true]);
        $engine = $this->createMock(\App\Services\Matching\MatchingEngineService::class);
        $engine->expects($this->never())->method('runJob');
        $this->expectException(ReviewWriteConflict::class);
        (new \App\Jobs\RunMatchingJob('fixture'))->handle($engine);
    }

    public function test_region_queue_admission_does_not_call_backfill_in_new_mode(): void
    {
        config(['review_transactions.enabled'=>true]);
        $regions = $this->createMock(\App\Services\Matching\ReviewRegionIndexService::class);
        $regions->expects($this->never())->method('backfill');
        $this->expectException(ReviewWriteConflict::class);
        (new \App\Jobs\BuildReviewRegionIndex('fixture'))->handle($regions);
    }
}
