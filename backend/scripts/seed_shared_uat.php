<?php

// Representative, generated UAT data; no production data or similarity execution.
require __DIR__.'/../vendor/autoload.php';
use App\Services\Matching\Reconciliation\ReviewStateBackfill;
use App\Services\Workspace\WorkspaceAccessService;
use App\Services\Workspace\WorkspaceMembershipService;
use Illuminate\Database\Capsule\Manager as Capsule;

if (getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4' || getenv('DB_DATABASE') !== 'rematch_stage4_test') throw new RuntimeException('Disposable UAT only');
$c = new Capsule;
$c->addConnection(['driver'=>'mysql','host'=>getenv('DB_HOST') ?: '127.0.0.1','database'=>'rematch_stage4_test','username'=>'root','password'=>'','charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci']);
$db = $c->getConnection();
$small = json_decode(file_get_contents('/tmp/shared-e2e.json'), true, 512, JSON_THROW_ON_ERROR);
$prefix=bin2hex(random_bytes(8));
$id = fn ($s) => ReviewStateBackfill::stableId('uat-large:'.$prefix.':'.$s);
$job=$id('job'); $w=$id('workspace'); $input=$id('input'); $ref=$id('reference');
if ($db->table('matching_jobs')->where('id',$job)->exists()) throw new RuntimeException('Fresh UAT fixture required');
$root=__DIR__.'/../storage/app/private';
$files=[];
foreach ([$input=>'input',$ref=>'reference'] as $dataset=>$role) {
    $files[$role]=fopen("$root/uat-$role.csv",'w');
    fputcsv($files[$role], ['nama','alamat','provinsi','kabupaten'], ',', '"', '');
    $row=(array)$db->table('datasets')->where('id',$small[$role])->first();
    $row['id']=$dataset; $row['name']='UAT 300k '.$role; $row['storage_path']='uat-'.$role.'.csv'; $row['row_count']=300000; $row['column_count']=4; $row['header_row']=1; $row['delimiter']=','; $row['file_format']='csv';
    $db->table('datasets')->insert($row);
}
$db->table('matching_jobs')->insert(['id'=>$job,'input_dataset_id'=>$input,'reference_dataset_id'=>$ref,'status'=>'completed','processed_count'=>300000,'total_count'=>300000,'review_state_readiness'=>'ready','review_state_schema_version'=>1]);
$db->table('workspaces')->insert(['id'=>$w,'name'=>'UAT Representative 300k','user_id'=>$small['actors']['owner'],'input_dataset_id'=>$input,'reference_dataset_id'=>$ref,'matching_job_id'=>$job,'status'=>'review']);
$db->table('matching_jobs')->where('id',$job)->update(['workspace_id'=>$w]);
$beg=microtime(true); $counts=[];
for ($base=0;$base<300000;$base+=250) {
    $rs=[]; $ss=[]; $hs=[];
    for ($n=$base;$n<$base+250;$n++) {
        $key=sprintf('%06d',$n); $reference=(string)($n+1);
        $province=$n%2===0?'32':'33'; $regency=$province==='32'?'3204':'3374';
        $raw=['nama'=>'PT UAT '.$key,'alamat'=>'JALAN MERDEKA NO '.($n%150+1),'provinsi'=>$province==='32'?'JAWA BARAT':'JAWA TENGAH','kabupaten'=>$province==='32'?'BANDUNG':'KOTA SEMARANG'];
        foreach($files as $f) fputcsv($f,array_values($raw),',','"','');
        $matched=$n%5===0; $manual=$n%10===0; $duplicate=$n===299998; $held=$n===299999;
        $status=$duplicate?'duplicate_input':($matched?'matched':($n%5===1?'unmatched':'possible_match'));
        $counts[$status]=($counts[$status]??0)+1;
        for($rank=1;$rank<=3;$rank++) {
            $candidate=$id("candidate:$key:$rank");
            $rs[]=['id'=>$candidate,'matching_job_id'=>$job,'input_record_key'=>$key,'reference_record_key'=>$rank===1?$reference:'alt-'.$rank.'-'.$key,'candidate_rank'=>$rank,'overall_score'=>round(60+($n%4000)/100-($rank-1)*12,2),'result_type'=>$rank===1&&in_array($status,['matched','unmatched'])?$status:'possible_match','input_region_indexed'=>true,'input_province_code'=>$province,'input_regency_code'=>$regency,'candidate_metadata'=>json_encode(['input_record'=>$raw,'reference_record'=>array_replace($raw,['alamat'=>'JL MERDEKA NO '.($n%150+1)])]),'field_scores'=>json_encode(['nama'=>100,'alamat'=>92,'provinsi'=>100,'kabupaten'=>100])];
        }
        $ss[]=['id'=>$id('state:'.$key),'matching_job_id'=>$job,'reference_dataset_id'=>$ref,'input_record_key'=>$key,'status'=>$status,'decision'=>$manual?'accept_match':null,'decision_origin'=>$manual?'manual':'auto','decision_protection'=>$manual?'reviewer_owned':'open','reviewer_user_id'=>$manual?$small['actors']['owner']:null,'last_modified_by_user_id'=>$manual?$small['actors']['owner']:null,'selected_matching_result_id'=>$matched?$id("candidate:$key:1"):null,'selected_reference_record_key'=>$matched?$reference:null,'duplicate_of_input_record_key'=>$duplicate?'000000':null,'integrity_status'=>$held?'held':'consistent','lineage_status'=>'verified','source_occurrence_count'=>1];
        if($manual) $hs[]=['id'=>$id('history:'.$key),'matching_job_id'=>$job,'matching_result_id'=>$id("candidate:$key:1"),'input_record_key'=>$key,'decision'=>'accept_match','new_result_type'=>'matched','previous_result_type'=>'possible_match','selected_reference_record_key'=>$reference,'reviewer_user_id'=>$n%20===0?null:$small['actors']['owner'],'created_at'=>'2026-10-01 12:00:00','metadata'=>'{}'];
    }
    $db->transaction(function()use($db,$rs,$ss,$hs){$db->table('matching_results')->insert($rs); $db->table('review_states')->insert($ss); if($hs)$db->table('review_decisions')->insert($hs);});
    if($base%25000===0)echo 'seed '.($base+250)."\n";
}
foreach($files as $role=>$f){fclose($f); $path="$root/uat-$role.csv"; $db->table('datasets')->where('id',$role==='input'?$input:$ref)->update(['file_size'=>filesize($path),'profiling_summary'=>json_encode(['source_sha256_at_match'=>hash_file('sha256',$path),'lineage_parser'=>'rematch-stream-v1'])]);}
$members=new WorkspaceMembershipService($db,new WorkspaceAccessService($db,true));
$actors=[];
for($n=0;$n<10;$n++){
    $actors[]=$user=$db->table('users')->insertGetId(['name'=>'UAT reviewer '.$n,'username'=>'uat-reviewer-'.$n,'email'=>'uat-'.$n.'@isolated.invalid','role'=>'user','password'=>password_hash('e2e-test-password',PASSWORD_BCRYPT)]);
    $members->set($small['actors']['owner'],$w,$user,'editor',0);
}
foreach(['viewer','editor','other']as$role)$members->set($small['actors']['owner'],$w,$small['actors'][$role],$role==='viewer'?'viewer':'editor',0);
$group=$id('verified-entity');
$db->table('reference_entity_groups')->insert(['id'=>$group,'reference_dataset_id'=>$ref,'verified_by_user_id'=>$small['actors']['owner'],'verified_at'=>'2026-10-14 00:00:00','verification_note'=>'Explicit UAT verified entity evidence; never inferred from names.']);
foreach(['299997','299998']as$referenceKey)$db->table('reference_entity_members')->insert(['id'=>$id('member:'.$referenceKey),'reference_dataset_id'=>$ref,'reference_entity_group_id'=>$group,'reference_record_key'=>$referenceKey,'verified_by_user_id'=>$small['actors']['owner'],'verified_at'=>'2026-10-14 00:00:00']);
$db->table('review_states')->where('matching_job_id',$job)->where('input_record_key','299998')->update(['decision_origin'=>'manual','decision_protection'=>'reviewer_owned','reviewer_user_id'=>$small['actors']['owner'],'last_modified_by_user_id'=>$small['actors']['owner']]);
$out=['workspace'=>$w,'job'=>$job,'input'=>$input,'reference'=>$ref,'actors'=>$actors,'owner'=>$small['actors']['owner'],'counts'=>$counts,'rows'=>300000,'candidates'=>900000,'history'=>30000,'seed_seconds'=>microtime(true)-$beg,'php_peak_mib'=>memory_get_peak_usage(true)/1048576];
file_put_contents('/tmp/shared-uat.json',json_encode($out,JSON_PRETTY_PRINT)); echo json_encode($out)."\n";
