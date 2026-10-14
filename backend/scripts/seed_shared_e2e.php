<?php

// Disposable test DB only; never use this fixture as runtime application data.
require __DIR__.'/../vendor/autoload.php';
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Str;

if (getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4' || getenv('DB_DATABASE') !== 'rematch_stage4_test') throw new RuntimeException('Isolated E2E only');
$c = new Capsule;
$c->addConnection(['driver' => 'mysql', 'host' => getenv('DB_HOST') ?: '127.0.0.1', 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci']);
$db = $c->getConnection();
$id = fn () => (string) Str::uuid();
$actors = [];
foreach (['owner', 'editor', 'viewer', 'other', 'admin', 'pimpinan'] as $role) {
    $actors[$role] = $db->table('users')->where('username', 'e2e-'.$role)->value('id') ?? $db->table('users')->insertGetId(['name' => 'E2E '.$role, 'username' => 'e2e-'.$role, 'email' => 'e2e-'.$role.'@isolated.invalid', 'role' => in_array($role, ['admin', 'pimpinan']) ? $role : 'user', 'password' => password_hash('e2e-test-password', PASSWORD_BCRYPT)]);
}
$template = (array) $db->table('datasets')->first();
$input = $id(); $reference = $id(); $job = $id(); $workspace = $id();
foreach ([$input => 'input', $reference => 'reference'] as $dataset => $role) {
    $row = $template; $row['id'] = $dataset; $row['workspace_id'] = null; $row['name'] = 'E2E '.$role; $row['storage_path'] = 'missing-e2e.csv';
    $row['row_count'] = 3; $row['column_count'] = 2; $row['dataset_role'] = $role; $row['preview_rows'] = json_encode([['nama' => 'PT E2E SATU', 'alamat' => 'JL MERDEKA 1'], ['nama' => 'PT E2E DUA', 'alamat' => 'JL MERDEKA 2'], ['nama' => 'PT E2E TIGA', 'alamat' => 'JL MERDEKA 3']]);
    $db->table('datasets')->insert($row);
}
$db->table('matching_jobs')->insert(['id' => $job, 'input_dataset_id' => $input, 'reference_dataset_id' => $reference, 'status' => 'completed', 'processed_count' => 6, 'total_count' => 6, 'review_state_readiness' => 'ready', 'review_state_schema_version' => 1]);
$name = 'E2E Shared Workspace '.substr($workspace, 0, 8);
$db->table('workspaces')->insert(['id' => $workspace, 'name' => $name, 'user_id' => $actors['owner'], 'matching_job_id' => $job, 'input_dataset_id' => $input, 'reference_dataset_id' => $reference, 'status' => 'review']);
$db->table('matching_jobs')->where('id', $job)->update(['workspace_id' => $workspace]);
$candidates = [];
foreach (['001', '1', '002', '003', '004', '005'] as $i => $key) {
    $ref = $key === '005' ? 'ref-004' : 'ref-'.$key;
    $candidate = $id(); $candidates[$key] = $candidate;
    $db->table('matching_results')->insert(['id' => $candidate, 'matching_job_id' => $job, 'input_record_key' => $key, 'reference_record_key' => $ref, 'candidate_rank' => 1, 'overall_score' => 99 - $i, 'result_type' => 'possible_match', 'input_region_indexed' => true, 'input_province_code' => '32', 'input_regency_code' => '3204', 'candidate_metadata' => json_encode(['input_record' => ['nama' => 'PT E2E '.$key, 'alamat' => 'JL MERDEKA 1'], 'reference_record' => ['nama' => 'PT E2E '.$key, 'alamat' => 'JALAN MERDEKA 1']]), 'field_scores' => json_encode(['nama' => 100, 'alamat' => 100])]);
    $protected = $key === '002';
    $db->table('review_states')->insert(['id' => $id(), 'matching_job_id' => $job, 'reference_dataset_id' => $reference, 'input_record_key' => $key, 'status' => $protected ? 'matched' : 'possible_match', 'decision' => $protected ? 'accept_match' : null, 'decision_origin' => $protected ? 'manual' : 'auto', 'decision_protection' => $protected ? 'reviewer_owned' : 'open', 'reviewer_user_id' => $protected ? $actors['owner'] : null, 'selected_matching_result_id' => $protected ? $candidate : null, 'selected_reference_record_key' => $protected ? $ref : null]);
}
$second = $id();
$db->table('matching_results')->insert(['id' => $second, 'matching_job_id' => $job, 'input_record_key' => '001', 'reference_record_key' => 'ref-alternative', 'candidate_rank' => 2, 'overall_score' => 63, 'result_type' => 'possible_match', 'candidate_metadata' => json_encode(['input_record' => ['nama' => 'PT E2E 001'], 'reference_record' => ['nama' => 'PT ALTERNATIF']]), 'field_scores' => '[]']);
file_put_contents('/tmp/shared-e2e.json', json_encode(['workspace' => $workspace, 'name' => $name, 'job' => $job, 'input' => $input, 'reference' => $reference, 'actors' => $actors, 'candidates' => $candidates, 'alternative' => $second], JSON_PRETTY_PRINT));
echo "SUCCESS isolated E2E fixture\n";
