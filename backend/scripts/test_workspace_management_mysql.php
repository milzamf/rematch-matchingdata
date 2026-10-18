<?php

/** Small fixture on a disposable MySQL server, never the application database. */
require __DIR__.'/../vendor/autoload.php';

use App\Services\Matching\Transactions\ReviewWriteConflict;
use App\Services\Workspace\WorkspaceAccessService;
use App\Services\Workspace\WorkspaceManagementService;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;

if (getenv('REMATCH_WORKSPACE_TEST_HOST') !== 'rematch-workspace-ui-test' || getenv('REMATCH_REVIEW_TEST') !== 'isolated-stage4') {
    throw new RuntimeException('Disposable workspace test host required.');
}
$capsule = new Capsule;
$capsule->addConnection(['driver' => 'mysql', 'host' => getenv('REMATCH_WORKSPACE_TEST_HOST'), 'database' => 'rematch_stage4_test', 'username' => 'root', 'password' => '', 'charset' => 'utf8mb4']);
$capsule->setAsGlobal();
$container = $capsule->getContainer();
$config = $container['config'];
$config['review_deployment'] = ['mode' => 'isolated', 'write_frozen' => false];
$container->instance('date', new Illuminate\Support\DateFactory);
Illuminate\Container\Container::setInstance($container);
Facade::setFacadeApplication($container);
$db = $capsule->getConnection();
foreach ([
    'CREATE TABLE users (id BIGINT PRIMARY KEY, name VARCHAR(255), role VARCHAR(32)) ENGINE=InnoDB',
    'CREATE TABLE workspaces (id CHAR(36) PRIMARY KEY, name VARCHAR(255), user_id BIGINT, matching_job_id CHAR(36), reference_dataset_id CHAR(36), input_dataset_id CHAR(36), configuration_version BIGINT UNSIGNED DEFAULT 1, current_step INT DEFAULT 3, status VARCHAR(32), updated_at DATETIME) ENGINE=InnoDB',
    'CREATE TABLE datasets (id CHAR(36) PRIMARY KEY, workspace_id CHAR(36), row_count INT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL) ENGINE=InnoDB',
    'CREATE TABLE matching_jobs (id CHAR(36) PRIMARY KEY, workspace_id CHAR(36), status VARCHAR(32), total_count INT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL) ENGINE=InnoDB',
    'CREATE TABLE workspace_members (id BIGINT PRIMARY KEY, workspace_id CHAR(36), user_id BIGINT, status VARCHAR(32), role VARCHAR(32), version INT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE) ENGINE=InnoDB',
    'CREATE TABLE review_decisions (id INT PRIMARY KEY, matching_job_id CHAR(36), decision VARCHAR(32), FOREIGN KEY (matching_job_id) REFERENCES matching_jobs(id) ON DELETE RESTRICT) ENGINE=InnoDB',
    'CREATE TABLE review_states (id INT PRIMARY KEY, matching_job_id CHAR(36), version INT, FOREIGN KEY (matching_job_id) REFERENCES matching_jobs(id) ON DELETE RESTRICT) ENGINE=InnoDB',
] as $sql) $db->statement($sql);
$db->table('users')->insert([
    ['id' => 1, 'name' => 'owner', 'role' => 'user'], ['id' => 2, 'name' => 'editor', 'role' => 'user'],
    ['id' => 3, 'name' => 'viewer', 'role' => 'user'], ['id' => 4, 'name' => 'admin', 'role' => 'admin'],
    ['id' => 5, 'name' => 'outsider', 'role' => 'user'],
]);
$db->table('workspaces')->insert(['id' => 'workspace', 'name' => 'Original', 'user_id' => 1, 'matching_job_id' => 'job', 'input_dataset_id' => 'input', 'configuration_version' => 1, 'status' => 'reviewing', 'updated_at' => '2026-10-15 01:00:00']);
$db->table('datasets')->insert(['id' => 'input', 'workspace_id' => 'workspace', 'row_count' => 3]);
$db->table('matching_jobs')->insert(['id' => 'job', 'workspace_id' => 'workspace', 'status' => 'completed', 'total_count' => 3]);
$db->table('workspace_members')->insert([
    ['id' => 1, 'workspace_id' => 'workspace', 'user_id' => 2, 'role' => 'editor', 'status' => 'active', 'version' => 1],
    ['id' => 2, 'workspace_id' => 'workspace', 'user_id' => 3, 'role' => 'viewer', 'status' => 'active', 'version' => 1],
]);
$db->table('review_decisions')->insert(['id' => 1, 'matching_job_id' => 'job', 'decision' => 'accept_match']);
$db->table('review_states')->insert(['id' => 1, 'matching_job_id' => 'job', 'version' => 7]);
$history = $db->table('review_decisions')->get()->toJson();
$states = $db->table('review_states')->get()->toJson();
$access = new WorkspaceAccessService($db, true);
$service = new WorkspaceManagementService($db, $access);
$assertions = 0;
$check = function (bool $ok, string $message) use (&$assertions) {
    if (! $ok) throw new RuntimeException($message);
    $assertions++; echo "PASS $message\n";
};
$refuses = function (callable $call, string $code) use ($check) {
    try { $call(); } catch (ReviewWriteConflict $error) { $check($error->reason === $code, $code); return; }
    throw new RuntimeException('Expected '.$code);
};
$list = $access->workspaces(2, 1, 25);
$check($list['total'] === 1 && $list['data'][0]['record_count'] === 3 && $list['per_page'] === 25, 'shared list keeps old table metadata and bounded pagination');
foreach ([2, 3, 5] as $actor) {
    $refuses(fn () => $service->rename($actor, 'workspace', 1, 'Forbidden'), 'workspace_forbidden');
    $refuses(fn () => $service->delete($actor, 'workspace', 1), 'workspace_forbidden');
}
$ack = $service->rename(1, 'workspace', 1, 'Renamed');
$check($ack['configuration_version'] === 2 && $db->table('workspaces')->value('name') === 'Renamed', 'owner rename increments workspace version');
$refuses(fn () => $service->rename(1, 'workspace', 1, 'Stale'), 'stale_workspace_version');
$refuses(fn () => $service->delete(1, 'workspace', 1), 'stale_workspace_version');
$db->table('matching_jobs')->update(['status' => 'processing']);
$refuses(fn () => $service->delete(1, 'workspace', 2), 'workspace_busy');
$db->table('matching_jobs')->update(['status' => 'completed']);
$config['review_deployment'] = ['mode' => 'isolated', 'write_frozen' => true];
$refuses(fn () => $service->delete(1, 'workspace', 2), 'review_deployment_frozen');
$config['review_deployment'] = ['mode' => 'isolated', 'write_frozen' => false];
$ack = $service->rename(4, 'workspace', 2, 'Admin renamed');
$check($ack['configuration_version'] === 3, 'admin rename uses actual version');
$service->delete(1, 'workspace', 3);
$check($db->table('workspaces')->count() === 0 && $db->table('workspace_members')->count() === 0, 'confirmed removal deletes workspace and membership access');
$check($db->table('matching_jobs')->count() === 1 && $db->table('datasets')->count() === 1
    && $db->table('matching_jobs')->value('workspace_id') === null && $db->table('datasets')->value('workspace_id') === null, 'datasets and matching job retained by SET NULL');
$check($history === $db->table('review_decisions')->get()->toJson() && $states === $db->table('review_states')->get()->toJson(), 'review history and state versions preserved');
echo "$assertions assertions passed on disposable MySQL InnoDB\n";
