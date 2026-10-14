<?php
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
if(getenv('DB_DATABASE')!=='rematch_stage4_test'||getenv('REMATCH_REVIEW_TEST')!=='isolated-stage4')throw new RuntimeException('UAT only');
$c=new Capsule;$c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage4_test','username'=>'root','password'=>'']);$db=$c->getConnection();$f=json_decode(file_get_contents('/tmp/shared-uat.json'),true);$j=$f['job'];
$history=(array)$db->selectOne("SELECT COUNT(*) AS n,SUM(CRC32(CONCAT_WS('|',id,input_record_key,decision,COALESCE(reviewer_user_id,'')))) AS checksum FROM review_decisions WHERE matching_job_id=? AND created_at='2026-10-01 12:00:00'",[$j]);
if($history!=$f['history_fingerprint'])throw new RuntimeException('Historical decisions changed');
$counts=$db->table('review_states')->where('matching_job_id',$j)->selectRaw('status,count(*) AS n')->groupBy('status')->pluck('n','status')->all();
if(array_sum($counts)!==300000||(int)$counts['matched']!==60162||(int)$counts['duplicate_input']!==1)throw new RuntimeException('Effective statistics mismatch');
$duplicates=$db->selectOne('SELECT COUNT(*) AS n FROM (SELECT active_reference_record_key FROM review_states WHERE matching_job_id=? AND active_reference_record_key IS NOT NULL GROUP BY active_reference_record_key HAVING COUNT(*)>1) t',[$j])->n;
$mismatches=$db->selectOne('SELECT COUNT(*) AS n FROM review_states s JOIN matching_results p USE INDEX(matching_results_job_input_rank_unique) ON p.matching_job_id=s.matching_job_id AND p.input_record_key=CONVERT(s.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci AND BINARY p.input_record_key=BINARY s.input_record_key AND p.candidate_rank=1 LEFT JOIN matching_results c ON c.id=s.selected_matching_result_id WHERE s.matching_job_id=? AND NOT(s.display_score <=> CASE WHEN s.selected_matching_result_id IS NULL THEN p.overall_score ELSE c.overall_score END)',[$j])->n;
if($duplicates||$mismatches||$db->table('review_operations')->where('matching_job_id',$j)->where('status','processing')->exists())throw new RuntimeException('Assignment/projection/operation integrity failed');
$held=$db->table('review_states')->where('matching_job_id',$j)->where('input_record_key','299999')->first();
if($held->version!==1||$held->integrity_status!=='held')throw new RuntimeException('Held state mutated');
$out=['counts'=>$counts,'historical_fingerprint'=>$history,'duplicate_active_claims'=>$duplicates,'score_projection_mismatches'=>$mismatches,'history_rows_after'=>$db->table('review_decisions')->where('matching_job_id',$j)->count(),'all_source_occurrences'=>$db->table('review_states')->where('matching_job_id',$j)->sum('source_occurrence_count'),'php_peak_mib'=>memory_get_peak_usage(true)/1048576];
file_put_contents('/tmp/uat-integrity.json',json_encode($out,JSON_PRETTY_PRINT));echo 'SUCCESS '.json_encode($out)."\n";
