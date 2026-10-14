<?php

namespace Tests\Unit;

use App\Services\Matching\Reconciliation\ReviewStateBackfill;
use Illuminate\Database\Capsule\Manager;
use PDO;
use PHPUnit\Framework\TestCase;

class BackfillRecoveryCheckpointTest extends TestCase
{
    private $db;
    private PDO $stage;
    private ReviewStateBackfill $service;

    protected function setUp(): void
    {
        $capsule = new Manager;
        $capsule->addConnection(['driver'=>'sqlite','database'=>':memory:','prefix'=>'']);
        $this->db = $capsule->getConnection();
        $this->db->statement('CREATE TABLE review_states(id TEXT PRIMARY KEY,matching_job_id TEXT,version INTEGER,last_operation_id TEXT)');
        $this->db->table('review_states')->insert(['id'=>'original','matching_job_id'=>'job','version'=>7,'last_operation_id'=>'prior-operation']);
        $this->stage = new PDO('sqlite::memory:');
        $this->stage->exec("CREATE TABLE preexisting(t TEXT,id TEXT); CREATE TABLE preexisting_state_versions(id TEXT,version INTEGER,last_operation_id TEXT); INSERT INTO preexisting VALUES('review_states','original'); INSERT INTO preexisting_state_versions VALUES('original',7,'prior-operation')");
        $this->service = new ReviewStateBackfill($this->db);
        (new \ReflectionProperty($this->service,'stage'))->setValue($this->service,$this->stage);
    }

    private function check(): void
    {
        (new \ReflectionMethod($this->service,'assertPreexistingStatesUnchanged'))->invoke($this->service,'job');
    }

    public function test_preexisting_historical_version_is_preserved_without_requiring_version_one(): void
    {
        $this->check();
        $this->assertSame(7,$this->db->table('review_states')->value('version'));
    }

    public function test_changed_preexisting_version_is_refused_without_deletion(): void
    {
        $this->db->table('review_states')->update(['version'=>8]);
        try { $this->check(); $this->fail('Changed state accepted'); }
        catch (\RuntimeException $error) { $this->assertSame('Preexisting state changed; recovery refused.',$error->getMessage()); }
        $this->assertSame(1,$this->db->table('review_states')->count());
    }

    public function test_changed_operation_with_same_version_is_refused(): void
    {
        $this->db->table('review_states')->update(['last_operation_id'=>'new-operation']);
        $this->expectExceptionMessage('Preexisting state changed; recovery refused.');
        $this->check();
    }

    public function test_missing_preexisting_state_is_refused(): void
    {
        $this->db->table('review_states')->delete();
        $this->expectExceptionMessage('Preexisting state changed; recovery refused.');
        $this->check();
    }

    public function test_old_checkpoint_without_version_evidence_fails_closed(): void
    {
        $this->stage->exec('DELETE FROM preexisting_state_versions');
        $this->expectExceptionMessage('Preexisting state checkpoint is incomplete; re-audit required.');
        $this->check();
    }

    public function test_processing_job_cannot_be_marked_ready(): void
    {
        $this->db->statement('CREATE TABLE matching_jobs(id TEXT,status TEXT,review_state_readiness TEXT)');
        $this->db->table('matching_jobs')->insert(['id'=>'job','status'=>'processing','review_state_readiness'=>'reconciling']);
        try { (new \ReflectionMethod($this->service,'validate'))->invoke($this->service,'job'); $this->fail('Processing job marked ready'); }
        catch (\RuntimeException $error) { $this->assertSame('Only a completed job can become ready.',$error->getMessage()); }
        $this->assertSame('reconciling',$this->db->table('matching_jobs')->value('review_state_readiness'));
    }

    public function test_rollback_rechecks_resolved_evidence_after_successful_preflight(): void
    {
        $this->stage->exec("CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT); INSERT INTO meta VALUES('digest','proof')");
        $this->db->statement('CREATE TABLE review_reconciliation_issues(id TEXT PRIMARY KEY,evidence_fingerprint TEXT,resolved_at TEXT,resolved_by_user_id INTEGER,status TEXT)');
        $this->db->table('review_reconciliation_issues')->insert(['id'=>'issue','evidence_fingerprint'=>'proof','status'=>'open']);
        $delete = new \ReflectionMethod($this->service,'deleteOwned');
        $delete->invoke($this->service,'review_reconciliation_issues','issue',false);
        $this->db->table('review_reconciliation_issues')->update(['status'=>'resolved','resolved_by_user_id'=>1]);
        try { $delete->invoke($this->service,'review_reconciliation_issues','issue'); $this->fail('Resolved evidence deleted'); }
        catch (\RuntimeException $error) { $this->assertSame('Reconciliation evidence has been used; rollback refused.',$error->getMessage()); }
        $this->assertSame(1,$this->db->table('review_reconciliation_issues')->count());
    }
}
