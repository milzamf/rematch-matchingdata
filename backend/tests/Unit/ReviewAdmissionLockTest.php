<?php
namespace Tests\Unit;

use App\Services\Matching\Transactions\ReviewDeploymentFence as Fence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;

class ReviewAdmissionLockTest extends TestCase
{
    private string $lock;
    private string $proof;
    private $db;

    protected function setUp(): void
    {
        $this->lock=tempnam(sys_get_temp_dir(),'rematch-lock-');
        $this->proof=tempnam(sys_get_temp_dir(),'rematch-proof-');
        file_put_contents($this->proof,json_encode(['database'=>'fixture','release'=>'fixture','contract_version'=>1,'schema_version'=>1,
            'backup_restore_verified'=>true,'post_write_recovery_verified'=>true,'writer_drain_verified'=>true,'recovery_policy'=>'forward_only','backup_sha256'=>str_repeat('a',64)]));
        $c=new Container;
        $c->instance('config',new Repository(['review_deployment'=>['mode'=>'production','write_frozen'=>true,'freeze_file'=>null,
            'database'=>'fixture','release'=>'fixture','approval_file'=>$this->proof,'approval_sha256'=>hash_file('sha256',$this->proof),'admission_lock_file'=>$this->lock],
            'workspace_access'=>['enabled'=>false],'review_transactions'=>['enabled'=>false]]));
        Container::setInstance($c);
        $this->db=$this->createMock(\Illuminate\Database\MySqlConnection::class);
        $this->db->method('getDriverName')->willReturn('mysql'); $this->db->method('getDatabaseName')->willReturn('fixture');
        $this->db->expects($this->never())->method('table');
    }
    protected function tearDown(): void { unlink($this->lock); unlink($this->proof); Container::setInstance(null); }

    public function test_existing_writer_prevents_maintenance_without_any_database_write(): void
    {
        $reader=fopen($this->lock,'r+b'); flock($reader,LOCK_SH);
        try { Fence::withMaintenance($this->db,fn()=>$this->fail('Maintenance started')); $this->fail('Drain bypassed'); }
        catch(ReviewWriteConflict $e) { $this->assertSame('review_deployment_busy',$e->reason); }
        finally { fclose($reader); }
        $this->assertSame('drained',Fence::withMaintenance($this->db,fn()=>'drained'));
    }
    public function test_isolated_mode_cannot_admit_non_fixture_database(): void
    {
        config(['review_deployment.mode'=>'isolated']);
        $this->expectException(ReviewWriteConflict::class);
        Fence::withMaintenance($this->db,fn()=>$this->fail('Database non-fixture admitted'));
    }
    public function test_exclusive_maintenance_blocks_http_matching_and_region_queue(): void
    {
        Fence::withMaintenance($this->db,function() {
            $engine=$this->createMock(\App\Services\Matching\MatchingEngineService::class); $engine->expects($this->never())->method('runJob');
            $regions=$this->createMock(\App\Services\Matching\ReviewRegionIndexService::class); $regions->expects($this->never())->method('backfill');
            $calls=[fn()=>(new \App\Jobs\RunMatchingJob('fixture'))->handle($engine),
                fn()=>(new \App\Jobs\RunMatchingJob('fixture'))->failed(new \RuntimeException('fixture')),
                fn()=>(new \App\Jobs\BuildReviewRegionIndex('fixture'))->handle($regions),
                fn()=>(new \App\Http\Middleware\ReviewDeploymentFence)->handle(\Illuminate\Http\Request::create('/api/workspaces','POST'),fn()=>$this->fail('Writer called'))];
            foreach($calls as $call) {
                try { $call(); $this->fail('Admission bypassed'); }
                catch(ReviewWriteConflict $e) { $this->assertSame('review_deployment_busy',$e->reason); }
            }
        });
    }
    public function test_normal_admission_remains_parallel_and_releases_after_exception(): void
    {
        $this->assertSame(2,Fence::withAdmission(fn()=>Fence::withAdmission(fn()=>2)));
        try { Fence::withMaintenance($this->db,fn()=>throw new \RuntimeException('fixture')); }
        catch(\RuntimeException $e) { $this->assertSame('fixture',$e->getMessage()); }
        $this->assertSame('released',Fence::withMaintenance($this->db,fn()=>'released'));
    }
    public function test_missing_lock_freeze_or_enabled_sharing_prevents_maintenance(): void
    {
        foreach(['review_deployment.write_frozen','workspace_access.enabled'] as $key) {
            config([$key=>$key==='workspace_access.enabled']);
            try { Fence::withMaintenance($this->db,fn()=>$this->fail('Unsafe maintenance')); $this->fail('Guard bypassed'); }
            catch(ReviewWriteConflict $e) { $this->assertSame('review_maintenance_not_approved',$e->reason); }
            config([$key=>$key==='review_deployment.write_frozen']);
        }
        config(['review_deployment.admission_lock_file'=>'missing']);
        $this->expectException(ReviewWriteConflict::class); Fence::withMaintenance($this->db,fn()=>$this->fail('Missing lock accepted'));
    }
}
