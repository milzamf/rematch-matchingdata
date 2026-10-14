<?php

namespace Tests\Unit;

use App\Services\Matching\Transactions\ReviewDeploymentFence;
use App\Services\Matching\Transactions\ReviewWriteConflict;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Database\ConnectionInterface;
use PHPUnit\Framework\TestCase;

class ReviewProductionGuardTest extends TestCase
{
    private string $file;
    private Repository $config;
    private ConnectionInterface $db;

    protected function setUp(): void
    {
        $this->file = tempnam(sys_get_temp_dir(), 'rematch-approval-');
        file_put_contents($this->file, json_encode(['database'=>'deployment_fixture', 'release'=>'fixture-release', 'contract_version'=>1,
            'schema_version'=>1, 'backup_restore_verified'=>true, 'post_write_recovery_verified'=>true,
            'writer_drain_verified'=>true, 'recovery_policy'=>'forward_only', 'backup_sha256'=>str_repeat('a',64)]));
        $this->config = new Repository(['workspace_access'=>['enabled'=>true], 'review_transactions'=>['enabled'=>true],
            'review_deployment'=>['mode'=>'production','database'=>'deployment_fixture','release'=>'fixture-release',
                'approval_file'=>$this->file,'approval_sha256'=>hash_file('sha256',$this->file)]]);
        $container = new Container;
        $container->instance('config',$this->config);
        Container::setInstance($container);
        $this->db = $this->createMock(\Illuminate\Database\MySqlConnection::class);
        $this->db->method('getDriverName')->willReturn('mysql');
        $this->db->method('getDatabaseName')->willReturn('deployment_fixture');
    }

    protected function tearDown(): void
    {
        unlink($this->file);
        Container::setInstance(null);
    }

    public function test_exact_production_deployment_is_admitted_without_test_database_or_marker(): void
    {
        ReviewDeploymentFence::assertConnection($this->db,true,'disabled');
        $this->assertTrue(true);
    }

    public function test_flag_alone_does_not_authorize_production(): void
    {
        $this->config->set('review_deployment.mode','isolated');
        $this->expectException(ReviewWriteConflict::class);
        ReviewDeploymentFence::assertConnection($this->db,true,'disabled');
    }

    public function test_wrong_database_or_release_or_missing_proof_is_denied(): void
    {
        foreach (['database'=>'other','release'=>'other','approval_file'=>'missing','approval_sha256'=>str_repeat('b',64)] as $field=>$bad) {
            $old=$this->config->get('review_deployment.'.$field);
            $this->config->set('review_deployment.'.$field,$bad);
            try { ReviewDeploymentFence::assertConnection($this->db,true,'disabled'); $this->fail('Unapproved deployment admitted'); }
            catch (ReviewWriteConflict $e) { $this->assertSame('review_deployment_not_approved',$e->reason); }
            $this->config->set('review_deployment.'.$field,$old);
        }
    }

    public function test_changed_evidence_or_split_flags_fail_closed(): void
    {
        $this->config->set('review_transactions.enabled',false);
        try { ReviewDeploymentFence::assertConnection($this->db,true,'disabled'); $this->fail('Split flags admitted'); }
        catch (ReviewWriteConflict $e) { $this->assertSame(503,$e->getStatusCode()); }
        $this->config->set('review_transactions.enabled',true);
        file_put_contents($this->file,'{}');
        $this->expectException(ReviewWriteConflict::class);
        ReviewDeploymentFence::assertConnection($this->db,true,'disabled');
    }

    public function test_unproven_restore_or_recovery_is_denied_even_with_pinned_hash(): void
    {
        $original=file_get_contents($this->file);
        foreach (['backup_restore_verified','post_write_recovery_verified','writer_drain_verified'] as $field) {
            $proof=json_decode($original,true); $proof[$field]=false;
            file_put_contents($this->file,json_encode($proof));
            $this->config->set('review_deployment.approval_sha256',hash_file('sha256',$this->file));
            try { ReviewDeploymentFence::assertConnection($this->db,true,'disabled'); $this->fail('Missing evidence admitted'); }
            catch (ReviewWriteConflict $e) { $this->assertSame(503,$e->getStatusCode()); }
        }
    }
}
