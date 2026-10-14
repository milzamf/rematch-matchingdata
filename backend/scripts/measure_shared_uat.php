<?php
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
use App\Services\Workspace\SharedWorkspaceReader;
use App\Services\Workspace\WorkspaceAccessService;
if (getenv('DB_DATABASE')!=='rematch_stage4_test'||getenv('REMATCH_REVIEW_TEST')!=='isolated-stage4')throw new RuntimeException('Isolated UAT only');
$c=new Capsule; $c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage4_test','username'=>'root','password'=>'','charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci']); $db=$c->getConnection();
$f=json_decode(file_get_contents('/tmp/shared-uat.json'),true);
// Complete only this generated fixture, including builds started before the
// final fixture corrections. No user/history/candidate scores are modified.
if($db->table('review_operations')->where('matching_job_id',$f['job'])->exists())throw new RuntimeException('Measure baseline before reviewer writes');
$db->table('matching_results')->where('matching_job_id',$f['job'])->where('candidate_rank','>',1)->where('result_type','matched')->update(['result_type'=>'possible_match']);
$db->update("UPDATE matching_results r JOIN review_states s ON s.matching_job_id=r.matching_job_id AND r.input_record_key=CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci AND BINARY r.input_record_key=BINARY s.input_record_key SET r.result_type='unmatched' WHERE r.matching_job_id=? AND r.candidate_rank=1 AND s.status='unmatched'",[$f['job']]);
if(!$db->table('reference_entity_groups')->where('reference_dataset_id',$f['reference'])->exists()) {
 $group=\App\Services\Matching\Reconciliation\ReviewStateBackfill::stableId('uat-group:'.$f['job']);
 $db->table('reference_entity_groups')->insert(['id'=>$group,'reference_dataset_id'=>$f['reference'],'verified_by_user_id'=>$f['owner'],'verified_at'=>'2026-10-14 00:00:00','verification_note'=>'Explicit UAT evidence, not similarity inference']);
 foreach(['299997','299998']as$key)$db->table('reference_entity_members')->insert(['id'=>\App\Services\Matching\Reconciliation\ReviewStateBackfill::stableId('uat-member:'.$f['job'].':'.$key),'reference_dataset_id'=>$f['reference'],'reference_entity_group_id'=>$group,'reference_record_key'=>$key,'verified_by_user_id'=>$f['owner'],'verified_at'=>'2026-10-14 00:00:00']);
}
$db->table('review_states')->where('matching_job_id',$f['job'])->where('input_record_key','299998')->update(['decision_origin'=>'manual','decision_protection'=>'reviewer_owned','reviewer_user_id'=>$f['owner'],'last_modified_by_user_id'=>$f['owner']]);
// Optional offline-fixture acceleration only. Actual API tests run after the
// exact trigger definitions and every derived score have been restored.
if(is_file('/tmp/uat-triggers.json')) {
 for($n=0;$n<300000;$n+=1000)$db->update('UPDATE review_states s JOIN matching_results p USE INDEX(matching_results_job_input_rank_unique) ON p.matching_job_id=s.matching_job_id AND p.input_record_key=CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci AND BINARY p.input_record_key=BINARY s.input_record_key AND p.candidate_rank=1 SET s.display_score=p.overall_score,s.display_score_indexed=1 WHERE s.matching_job_id=? AND s.input_record_key BETWEEN ? AND ? AND s.display_score_indexed=0',[$f['job'],sprintf('%06d',$n),sprintf('%06d',$n+999)]);
 foreach(json_decode(file_get_contents('/tmp/uat-triggers.json'),true)as$name=>$definition)$db->unprepared($definition);
 unlink('/tmp/uat-triggers.json');
 if($db->table('review_states')->where('matching_job_id',$f['job'])->where('display_score_indexed',false)->exists())throw new RuntimeException('Fixture projection incomplete');
 $db->table('matching_jobs')->where('id',$f['job'])->update(['review_state_readiness'=>'ready','review_state_schema_version'=>1]);
}
$f['history_fingerprint']=$db->selectOne("SELECT COUNT(*) AS n,SUM(CRC32(CONCAT_WS('|',id,input_record_key,decision,COALESCE(reviewer_user_id,'')))) AS checksum FROM review_decisions WHERE matching_job_id=? AND created_at='2026-10-01 12:00:00'",[$f['job']]);
file_put_contents('/tmp/shared-uat.json',json_encode($f,JSON_PRETTY_PRINT));
$r=new SharedWorkspaceReader($db,new WorkspaceAccessService($db,true));
$metrics=[];
foreach(['similarity_desc'=>['sort'=>'similarity_desc'],'deep_page'=>['sort'=>'similarity_asc','page'=>10000],'region'=>['input_province_code'=>'32','sort'=>'similarity_desc'],'name_search'=>['search'=>'PT UAT 15000','sort'=>'similarity_desc'],'score_range'=>['similarity_min'=>90,'similarity_max'=>100,'sort'=>'similarity_desc']]as$name=>$filter){
 $samples=[]; $cold=null;
 for($i=0;$i<11;$i++){ $t=microtime(true); $result=$r->review($f['owner'],$f['workspace'],$f['job'],$filter+['per_page'=>25]); $ms=(microtime(true)-$t)*1000; if($i===0)$cold=$ms;else$samples[]=$ms; }
 sort($samples);$metrics[$name]=['first_ms'=>$cold,'p50_ms'=>$samples[4],'p95_ms'=>$samples[9],'total'=>$result['pagination']['total'],'payload_bytes'=>strlen(json_encode($result))]; echo $name.' '.json_encode($metrics[$name])."\n";
}
$j=$f['job'];
$out=['server'=>$db->selectOne('SELECT VERSION() AS v')->v,'rows'=>$f['rows'],'candidates'=>$f['candidates'],'history'=>$f['history'],'reader'=>$metrics,'php_peak_mib'=>memory_get_peak_usage(true)/1048576,'storage'=>$db->select('SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)',['review_states','matching_results','review_decisions']),'explain'=>$db->select('EXPLAIN ANALYZE SELECT input_record_key FROM review_states USE INDEX(review_display_all_desc_idx) WHERE matching_job_id=? ORDER BY display_score_null ASC,display_score DESC,input_record_key ASC LIMIT 25',[$j]),'counts'=>$db->table('review_states')->where('matching_job_id',$j)->selectRaw('status,count(*) AS n')->groupBy('status')->get()];
file_put_contents('/tmp/uat-reader.json',json_encode($out,JSON_PRETTY_PRINT));
