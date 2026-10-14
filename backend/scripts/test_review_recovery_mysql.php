<?php

/** One-input recovery fixture only. No Laravel boot, host .env, production DB, or benchmark. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Matching\Reconciliation\ReviewStateBackfill;
use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Workspace\WorkspaceAccessService;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Database\Capsule\Manager;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Str;

if (getenv('REMATCH_BACKFILL_TEST') !== 'isolated-stage3') throw new RuntimeException('Isolated fixture required.');
$c = new Manager;
$c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage3_test','username'=>'root','password'=>'',
    'charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci']);
$c->setAsGlobal(); $c->bootEloquent(); $db=$c->getConnection();
if ($db->selectOne('SELECT DATABASE() AS name')->name !== 'rematch_stage3_test' || count($db->select('SHOW TABLES')) !== 0) throw new RuntimeException('Empty isolated DB required.');
$container=$c->getContainer(); $container->instance('db',$c->getDatabaseManager());
$container->bind('db.schema',fn()=>$db->getSchemaBuilder());
$config=new Repository(['database'=>['default'=>'default','connections'=>['default'=>$db->getConfig()]],
    'review_deployment'=>['mode'=>'isolated','write_frozen'=>false,'freeze_file'=>null]]);
$container->instance('config',$config); Container::setInstance($container); Facade::setFacadeApplication($container);
$paths=glob(__DIR__.'/../database/migrations/*.php'); sort($paths); foreach($paths as $path) (require $path)->up();
$root='/tmp/rematch-recovery-'.Str::uuid(); mkdir($root);
$actor=$db->table('users')->insertGetId(['name'=>'Recovery admin','email'=>'recovery@isolated.invalid','role'=>'admin','password'=>'not-a-login']);
$dataset=function(string $role,string $name) use($db,$actor,$root): string {
    $file=$role.'.csv'; file_put_contents($root.'/'.$file,"name\n$name\n"); $id=(string)Str::uuid();
    $db->table('datasets')->insert(['id'=>$id,'user_id'=>$actor,'dataset_role'=>$role,'name'=>$file,'original_filename'=>$file,
        'file_format'=>'csv','mime_type'=>'text/csv','file_size'=>filesize($root.'/'.$file),'storage_path'=>$file,
        'row_count'=>1,'column_count'=>1,'header_row'=>1,'delimiter'=>',','parse_status'=>'inspected',
        'profiling_summary'=>json_encode(['source_sha256_at_match'=>hash_file('sha256',$root.'/'.$file),'lineage_parser'=>'rematch-stream-v1'])]);
    return $id;
};
$input=$dataset('input','Input'); $reference=$dataset('reference','Reference'); $job=(string)Str::uuid(); $workspace=(string)Str::uuid(); $candidate=(string)Str::uuid();
$db->table('matching_jobs')->insert(['id'=>$job,'input_dataset_id'=>$input,'reference_dataset_id'=>$reference,'status'=>'completed','total_count'=>1]);
$db->table('workspaces')->insert(['id'=>$workspace,'user_id'=>$actor,'name'=>'Recovery fixture','matching_job_id'=>$job,'input_dataset_id'=>$input,'reference_dataset_id'=>$reference]);
$db->table('matching_jobs')->where('id',$job)->update(['workspace_id'=>$workspace]);
$db->table('matching_results')->insert(['id'=>$candidate,'matching_job_id'=>$job,'input_record_key'=>'001','reference_record_key'=>'1',
    'candidate_rank'=>1,'result_type'=>'possible_match','overall_score'=>99,'candidate_metadata'=>json_encode(['input_record'=>['name'=>'Input']])]);
$backfill=new ReviewStateBackfill($db); $artifact=$root.'/checkpoint.sqlite'; $backfill->prepare($job,$artifact,$root,1); $backfill->apply($job,$artifact);
$before=(array)$db->table('review_states')->where('matching_job_id',$job)->first();
$onlyNew=in_array('--admission-only',$argv,true);
function verifyRecovery(bool $ok,string $label): void { if($GLOBALS['onlyNew']) return; if(!$ok) throw new RuntimeException($label); echo "PASS $label\n"; }
verifyRecovery($before['integrity_status']==='consistent','one input backfilled consistently');
// Exercise the production guard against a non-stage4 database, with fixture-only approval evidence.
$proof=['database'=>'rematch_stage3_test','release'=>'fixture-only','contract_version'=>1,'schema_version'=>1,
    'backup_restore_verified'=>true,'post_write_recovery_verified'=>true,'writer_drain_verified'=>true,
    'recovery_policy'=>'forward_only','backup_sha256'=>str_repeat('a',64)];
$approval=$root.'/approval.json'; file_put_contents($approval,json_encode($proof));
$admission=$root.'/admission.lock'; touch($admission);
$config->set('review_deployment',['mode'=>'production','database'=>'rematch_stage3_test','release'=>'fixture-only',
    'approval_file'=>$approval,'approval_sha256'=>hash_file('sha256',$approval),'admission_lock_file'=>$admission,'write_frozen'=>false,'freeze_file'=>null]);
$config->set('workspace_access.enabled',true); $config->set('review_transactions.enabled',true);
$service=new ReviewTransactionService($db,true,null,new WorkspaceAccessService($db,true));
$saved=$service->decide($actor,$job,'recovery-accept',[['input_record_key'=>'001','expected_version'=>1,'decision'=>'accept_match','candidate_id'=>$candidate]]);
verifyRecovery($saved['applied']===1,'new decision saved through production guard and concurrency service');
$history=json_encode($db->table('review_decisions')->orderBy('id')->get());
$states=json_encode($db->table('review_states')->orderBy('id')->get());
$config->set('review_deployment.write_frozen',true); $config->set('workspace_access.enabled',false); $config->set('review_transactions.enabled',false);
try { $backfill->rollback($job,$artifact); throw new RuntimeException('Unsafe rollback accepted'); }
catch(RuntimeException $e) { verifyRecovery(str_contains($e->getMessage(),'rollback refused'),'shadow rollback after new decision refused'); }
$config->set('review_deployment.write_frozen',false); $config->set('workspace_access.enabled',true); $config->set('review_transactions.enabled',true);
verifyRecovery(json_encode($db->table('review_states')->orderBy('id')->get())===$states && json_encode($db->table('review_decisions')->orderBy('id')->get())===$history,'refused recovery preserves state and history');
// Safe recovery is a new versioned operation, never a restore over decisions made after cutover.
$undone=$service->undo($actor,$job,'recovery-undo',$saved['operation_id'],[['input_record_key'=>'001','expected_version'=>2]]);
$current=$db->table('review_states')->where('matching_job_id',$job)->first();
verifyRecovery($undone['applied']===1 && (int)$current->version===3 && $current->status===$before['status'] && $current->selected_reference_record_key===null,'forward Undo recovers state with monotonic version and releases claim');
verifyRecovery(json_encode($db->table('review_decisions')->where('review_operation_id',$saved['operation_id'])->orderBy('id')->get())===$history,'original decision remains append-only after recovery');
verifyRecovery($db->table('review_operations')->count()===2 && $db->table('review_decisions')->count()===2 && $db->table('matching_jobs')->where('id',$job)->value('review_state_readiness')==='ready','recovery operations durable and job remains ready');
if($onlyNew) {
    $retry=$service->undo($actor,$job,'recovery-undo',$saved['operation_id'],[['input_record_key'=>'001','expected_version'=>2]]);
    if($retry!==$undone || $db->table('review_operations')->count()!==2 || $db->table('review_decisions')->count()!==2) throw new RuntimeException('Recovery retry duplicated history');
    echo "PASS recovery retry idempotent; no duplicate history\n";
    $service->decide($actor,$job,'later-decision',[['input_record_key'=>'001','expected_version'=>3,'decision'=>'mark_unmatched']]);
    $state=json_encode($db->table('review_states')->get()); $audits=json_encode($db->table('review_decisions')->orderBy('id')->get());
    try { $service->undo($actor,$job,'stale-recovery',$saved['operation_id'],[['input_record_key'=>'001','expected_version'=>4]]); throw new RuntimeException('Superseded recovery accepted'); }
    catch(\App\Services\Matching\Transactions\ReviewWriteConflict $e) { if($e->reason!=='undo_superseded' || $e->getStatusCode()!==409) throw $e; }
    if(json_encode($db->table('review_states')->get())!==$state || json_encode($db->table('review_decisions')->orderBy('id')->get())!==$audits) throw new RuntimeException('Later decision lost');
    echo "PASS superseded recovery HTTP 409 preserves later decision and history\n";
    $secondJob=(string)Str::uuid(); $secondCandidate=(string)Str::uuid();
    $db->table('matching_jobs')->insert(['id'=>$secondJob,'input_dataset_id'=>$input,'reference_dataset_id'=>$reference,'status'=>'completed','total_count'=>1]);
    $db->table('matching_results')->insert(['id'=>$secondCandidate,'matching_job_id'=>$secondJob,'input_record_key'=>'001','reference_record_key'=>'1',
        'candidate_rank'=>1,'result_type'=>'possible_match','overall_score'=>99,'candidate_metadata'=>json_encode(['input_record'=>['name'=>'Input']])]);
    $secondArtifact=$root.'/maintenance.sqlite'; $backfill->prepare($secondJob,$secondArtifact,$root,1);
    $config->set('review_deployment.write_frozen',true); $config->set('workspace_access.enabled',false); $config->set('review_transactions.enabled',false);
    $backfill->apply($secondJob,$secondArtifact);
    if($db->table('matching_jobs')->where('id',$secondJob)->value('review_state_readiness')!=='ready') throw new RuntimeException('Maintenance backfill not ready');
    $backfill->rollback($secondJob,$secondArtifact);
    if($db->table('review_states')->where('matching_job_id',$secondJob)->count()!==0) throw new RuntimeException('Maintenance rollback incomplete');
    echo "PASS production maintenance admission supports shadow backfill and pre-write rollback\nSUCCESS 3 new targeted checks; two one-input jobs\n";
} else echo "SUCCESS 7 recovery assertions; one input, no benchmark\n";
