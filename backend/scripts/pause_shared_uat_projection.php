<?php
// Offline fixture build only, guarded; saved definitions must be restored before UAT.
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
if(getenv('DB_DATABASE')!=='rematch_stage4_test'||getenv('REMATCH_REVIEW_TEST')!=='isolated-stage4')throw new RuntimeException('Disposable fixture only');
$c=new Capsule;$c->addConnection(['driver'=>'mysql','host'=>'127.0.0.1','database'=>'rematch_stage4_test','username'=>'root','password'=>'']);$db=$c->getConnection();
$job=$db->table('workspaces')->where('name','UAT Representative 300k')->value('matching_job_id');
if(!$job||$db->table('review_operations')->where('matching_job_id',$job)->exists())throw new RuntimeException('Fixture already used');
$definitions=[];
foreach(['insert'=>'INSERT','update'=>'UPDATE']as$suffix=>$event){$name='review_display_'.$suffix;$t=$db->selectOne('SHOW CREATE TRIGGER '.$name);$definitions[$name]=$t->{'SQL Original Statement'};}
file_put_contents('/tmp/uat-triggers.json',json_encode($definitions,JSON_THROW_ON_ERROR));
$db->table('matching_jobs')->where('id',$job)->update(['review_state_readiness'=>'pending']);
foreach(array_keys($definitions)as$name)$db->unprepared('DROP TRIGGER '.$name);
echo "Offline fixture projection paused; measure script restores before any UAT writes\n";
