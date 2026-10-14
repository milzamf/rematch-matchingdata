<?php
// Run only against a restored disposable copy, never the source database.
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;
use App\Services\Matching\Reconciliation\ReviewStateBackfill;
if(getenv('REMATCH_BACKFILL_TEST')!=='isolated-stage3')throw new RuntimeException('Isolated restore only');
$c=new Capsule; $c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage3_test','username'=>'root','password'=>'','charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci']); $c->setAsGlobal();$c->bootEloquent();$db=$c->getConnection();$container=$c->getContainer();$container->instance('db',$c->getDatabaseManager());$container->bind('db.schema',fn()=>$db->getSchemaBuilder());Facade::setFacadeApplication($container);
if($db->getDatabaseName()!=='rematch_stage3_test')throw new RuntimeException('Wrong restore DB');
$f=json_decode(file_get_contents('/tmp/shared-uat.json'),true);$j=$f['job'];
$fingerprint=fn($table)=>$db->selectOne("SELECT COUNT(*) AS n, SUM(CRC32(CONCAT_WS('|',id,input_record_key,COALESCE(decision,''),COALESCE(reviewer_user_id,'')))) AS checksum FROM $table WHERE matching_job_id=?",[$j]);
$history=$fingerprint('review_decisions');
$out=['restore_state_count'=>$db->table('review_states')->where('matching_job_id',$j)->count(),'historical_fingerprint'=>$history];
$out['restore_candidate_count']=$db->table('matching_results')->where('matching_job_id',$j)->count();
if($out['restore_state_count']!==300000||$out['restore_candidate_count']!==900000||(int)$history->n!==30000||(string)$history->checksum!==(string)$f['history_fingerprint']['checksum'])throw new RuntimeException('Restore cardinality/history mismatch');
$out['restore_orphan_states']=$db->selectOne('SELECT COUNT(*) AS n FROM review_states s LEFT JOIN matching_jobs j ON j.id=s.matching_job_id WHERE j.id IS NULL')->n;
$out['restore_orphan_selected']=$db->selectOne('SELECT COUNT(*) AS n FROM review_states s LEFT JOIN matching_results r ON r.id=s.selected_matching_result_id WHERE s.selected_matching_result_id IS NOT NULL AND r.id IS NULL')->n;
if($out['restore_orphan_states']||$out['restore_orphan_selected'])throw new RuntimeException('Restore referential integrity failed');
// Metadata-lock rehearsal: a reader transaction must cause a bounded DDL refusal.
$other=new PDO('mysql:host=127.0.0.1;dbname=rematch_stage3_test','root','');$other->beginTransaction();$other->query('SELECT id FROM review_states LIMIT 1')->fetch();
$db->statement('SET SESSION lock_wait_timeout=1'); $t=microtime(true);
try{$db->statement('ALTER TABLE review_states ADD COLUMN uat_mdl_probe INT NULL');throw new RuntimeException('DDL unexpectedly bypassed reader');}catch(\Illuminate\Database\QueryException $e){if(($e->errorInfo[1]??0)!==1205)throw$e;$out['metadata_lock_timeout_seconds']=microtime(true)-$t;}finally{$other->rollBack();}
$db->statement('SET SESSION lock_wait_timeout=30');
$m=require __DIR__.'/../database/migrations/2026_10_13_000004_add_review_display_score_indexes.php';
$t=microtime(true);$m->down();$out['projection_schema_down_seconds']=microtime(true)-$t;
$t=microtime(true);$m->up();$out['projection_schema_up_seconds']=microtime(true)-$t;
if($fingerprint('review_decisions')!=$history)throw new RuntimeException('DDL changed history');
$regionMigration=require __DIR__.'/../database/migrations/2026_10_14_000001_add_shared_region_count_index.php';
$t=microtime(true);$regionMigration->down();$regionMigration->up();$out['region_index_down_up_seconds']=microtime(true)-$t;
echo 'DDL '.json_encode($out)."\n";
// Test copy only: simulate pre-backfill legacy state; preserve verified Duplicate Input.
$db->table('review_states')->where('matching_job_id',$j)->whereNotIn('input_record_key',['000000','299998'])->delete();
// The retained canonical fixture mirrors its original NULL-author legacy event;
// this is fixture preparation on the restore, not an edit of source/history.
$db->table('review_states')->where('matching_job_id',$j)->where('input_record_key','000000')->update(['reviewer_user_id'=>null,'last_modified_by_user_id'=>null,'decision_origin'=>'legacy','decision_protection'=>'legacy_unknown']);
$db->table('matching_jobs')->where('id',$j)->update(['review_state_readiness'=>'pending','review_state_schema_version'=>0]);
// Deliberately inconsistent legacy Auto Matches on the restored fixture only.
// Every participant must be held; no similarity-based winner may be selected.
$db->table('matching_results')->where('matching_job_id',$j)->where('input_record_key','250015')->where('candidate_rank',1)->update(['reference_record_key'=>'250006']);
$group=ReviewStateBackfill::stableId('uat-historical-entity:'.$j);
$db->table('reference_entity_groups')->insert(['id'=>$group,'reference_dataset_id'=>$f['reference'],'verified_by_user_id'=>$f['owner'],'verified_at'=>gmdate('Y-m-d H:i:s'),'verification_note'=>'Explicit restored UAT verified alias evidence']);
foreach(['250026','250036']as$key)$db->table('reference_entity_members')->insert(['id'=>ReviewStateBackfill::stableId('uat-historical-member:'.$j.':'.$key),'reference_dataset_id'=>$f['reference'],'reference_entity_group_id'=>$group,'reference_record_key'=>$key,'verified_by_user_id'=>$f['owner'],'verified_at'=>gmdate('Y-m-d H:i:s')]);
$svc=new ReviewStateBackfill($db);$artifact='/tmp/uat-300k.sqlite';
$t=microtime(true);$out['plan']=$svc->prepare($j,$artifact,__DIR__.'/../storage/app/private',256);$out['prepare_seconds']=microtime(true)-$t;echo 'PLAN '.json_encode($out['plan'])."\n";
$paused=$svc->apply($j,$artifact,2);if($paused['finished'])throw new RuntimeException('Expected pause');
try{$svc->apply($j,$artifact,null,fn()=>throw new RuntimeException('UAT crash after commit'));}catch(RuntimeException$e){if($e->getMessage()!=='UAT crash after commit')throw$e;}
$t=microtime(true);$out['applied']=$svc->apply($j,$artifact);$out['resume_apply_seconds']=microtime(true)-$t;
if(!$out['applied']['finished']||$db->table('review_states')->where('matching_job_id',$j)->count()!==300000)throw new RuntimeException('Incomplete 300k backfill');
$t=microtime(true);$svc->apply($j,$artifact);$out['idempotent_seconds']=microtime(true)-$t;
if($fingerprint('review_decisions')!=$history)throw new RuntimeException('Backfill changed history');
$out['ready']=$db->table('matching_jobs')->where('id',$j)->value('review_state_readiness');
// Refresh the retained preexisting rows' derived projection without actor/history/version writes.
$db->table('review_states')->where('matching_job_id',$j)->where('display_score_indexed',false)->update(['display_score_indexed'=>false]);
$out['projection_unprepared']=$db->table('review_states')->where('matching_job_id',$j)->where('display_score_indexed',false)->count();
if($out['ready']!=='ready'||$out['projection_unprepared']!==0)throw new RuntimeException('Not ready for simulated cutover');
foreach(['250005','250015','250025','250035']as$key)if($db->table('review_states')->where('matching_job_id',$j)->where('input_record_key',$key)->value('integrity_status')!=='held')throw new RuntimeException('Collision participant not held');
$out['duplicate_active_claims']=$db->selectOne('SELECT COUNT(*) AS n FROM (SELECT active_reference_record_key FROM review_states WHERE matching_job_id=? AND active_reference_record_key IS NOT NULL GROUP BY active_reference_record_key HAVING COUNT(*)>1) t',[$j])->n;
$out['states']=$db->table('review_states')->where('matching_job_id',$j)->selectRaw('status,integrity_status,count(*) AS n')->groupBy('status','integrity_status')->get();
// A used version must refuse rollback before any other state is deleted.
$db->table('review_states')->where('matching_job_id',$j)->where('input_record_key','100002')->update(['version'=>2]);
try{$svc->rollback($j,$artifact);throw new RuntimeException('Used rollback was accepted');}catch(RuntimeException$e){if($e->getMessage()!=='A state has been used; rollback refused.')throw$e;}
if($db->table('review_states')->where('matching_job_id',$j)->count()!==300000)throw new RuntimeException('Refused rollback deleted states');
$out['used_state_rollback_refused']=true;
// Restore only the simulated test mutation, not a user decision/history.
$db->table('review_states')->where('matching_job_id',$j)->where('input_record_key','100002')->update(['version'=>1]);
$t=microtime(true);$svc->rollback($j,$artifact);$out['ledger_rollback_seconds']=microtime(true)-$t;
if($db->table('review_states')->where('matching_job_id',$j)->count()!==2||$fingerprint('review_decisions')!=$history)throw new RuntimeException('Ledger rollback changed preexisting state/history');
$out['php_peak_mib']=memory_get_peak_usage(true)/1048576;
file_put_contents('/tmp/uat-cutover.json',json_encode($out,JSON_PRETTY_PRINT));echo 'SUCCESS UAT restored copy migration/backfill/ledger rollback '.json_encode($out)."\n";
