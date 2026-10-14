<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'mysql') {
            $version = DB::selectOne('SELECT VERSION() AS version')->version;
            if (str_contains($version, 'MariaDB') || version_compare($version, '8.0.22', '<')) {
                throw new RuntimeException('Review foundation requires MySQL >= 8.0.22.');
            }
        }
        // No historical inserts, updates, reconciliation, or application cutover.
        Schema::table('workspaces', function (Blueprint $table) {
            $table->unsignedBigInteger('configuration_version')->default(1);
        });
        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->string('review_state_readiness', 24)->default('pending');
            $table->unsignedTinyInteger('review_state_schema_version')->default(0);
            $table->unique(['id', 'reference_dataset_id'], 'jobs_id_reference_dataset_uq');
        });

        Schema::create('reference_entity_groups', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->foreignUuid('reference_dataset_id')->constrained('datasets')->restrictOnDelete();
            $table->foreignId('verified_by_user_id')->constrained('users')->restrictOnDelete();
            $table->dateTime('verified_at', 6);
            $table->string('verification_note', 1000);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps(6);
            $table->unique(['reference_dataset_id', 'id'], 'entity_groups_dataset_id_uq');
        });

        Schema::create('reference_entity_members', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->uuid('reference_dataset_id');
            $table->uuid('reference_entity_group_id');
            $this->recordKey($table, 'reference_record_key');
            $table->foreignId('verified_by_user_id')->constrained('users')->restrictOnDelete();
            $table->dateTime('verified_at', 6);
            $table->timestamps(6);
            $table->foreign(['reference_dataset_id', 'reference_entity_group_id'], 'entity_members_group_fk')
                ->references(['reference_dataset_id', 'id'])->on('reference_entity_groups')->restrictOnDelete();
            $table->unique(['reference_dataset_id', 'reference_record_key'], 'entity_members_dataset_key_uq');
            $table->unique(['reference_dataset_id', 'reference_entity_group_id', 'reference_record_key'], 'entity_members_assignment_uq');
        });

        Schema::create('review_operations', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->constrained('matching_jobs')->restrictOnDelete();
            $table->foreignId('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->string('operation_type', 32);
            $this->recordKey($table, 'idempotency_key', false, 128);
            $table->char('request_hash', 64);
            $table->string('status', 16)->default('processing');
            // Small acknowledgement only; never duplicate rows, scores, or full history here.
            $table->json('response_summary')->nullable();
            $table->dateTime('completed_at', 6)->nullable();
            $table->timestamps(6);
            $table->unique(['matching_job_id', 'actor_user_id', 'idempotency_key'], 'review_ops_idempotency_uq');
            $table->unique(['id', 'matching_job_id'], 'review_ops_id_job_uq');
            $table->index(['matching_job_id', 'status', 'created_at'], 'review_ops_job_status_idx');
        });

        Schema::create('review_states', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->uuid('matching_job_id');
            $table->uuid('reference_dataset_id');
            $this->recordKey($table, 'input_record_key');
            $table->string('status', 24)->default('possible_match');
            $table->string('decision', 32)->nullable();
            $table->string('decision_origin', 16)->default('legacy');
            $table->string('decision_protection', 24)->default('legacy_unknown');
            $table->string('integrity_status', 16)->default('consistent');
            $table->unsignedBigInteger('version')->default(1);
            $this->recordKey($table, 'selected_reference_record_key', true);
            $table->uuid('selected_reference_entity_group_id')->nullable();
            $table->foreignUuid('selected_matching_result_id')->nullable()->constrained('matching_results')->restrictOnDelete();
            $this->recordKey($table, 'duplicate_of_input_record_key', true);
            foreach (['reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'] as $actor) {
                $table->foreignId($actor)->nullable()->constrained('users')->restrictOnDelete();
            }
            $table->uuid('last_operation_id')->nullable();
            $table->unsignedInteger('source_occurrence_count')->nullable();
            $table->string('lineage_status', 16)->default('unverified');
            $table->timestamps(6);

            $this->recordKey($table, 'active_reference_record_key', true)->storedAs(
                "CASE WHEN status = 'matched' OR integrity_status = 'held' THEN selected_reference_record_key ELSE NULL END"
            );
            $table->uuid('active_reference_entity_group_id')->nullable()->storedAs(
                "CASE WHEN status = 'matched' OR integrity_status = 'held' THEN selected_reference_entity_group_id ELSE NULL END"
            );
            // A duplicate may point only to a non-duplicate in its own job (a star, never a chain/cycle).
            $table->unsignedTinyInteger('canonical_guard')->storedAs('CASE WHEN duplicate_of_input_record_key IS NULL THEN 1 ELSE 0 END');
            $table->unsignedTinyInteger('duplicate_target_guard')->nullable()->storedAs('CASE WHEN duplicate_of_input_record_key IS NOT NULL THEN 1 ELSE NULL END');
            $table->unique(['matching_job_id', 'input_record_key'], 'review_states_job_input_uq');
            $table->unique(['id', 'matching_job_id'], 'review_states_id_job_uq');
            $table->unique(['matching_job_id', 'input_record_key', 'canonical_guard'], 'review_states_canonical_uq');
            $table->unique(['matching_job_id', 'active_reference_record_key'], 'review_states_active_reference_uq');
            $table->unique(['matching_job_id', 'active_reference_entity_group_id'], 'review_states_active_entity_uq');
            $table->index(['matching_job_id', 'status', 'input_record_key'], 'review_states_job_status_idx');
            $table->foreign(['matching_job_id', 'reference_dataset_id'], 'review_states_job_dataset_fk')
                ->references(['id', 'reference_dataset_id'])->on('matching_jobs')->restrictOnDelete();
            $table->foreign(['reference_dataset_id', 'selected_reference_entity_group_id', 'selected_reference_record_key'], 'review_states_entity_member_fk')
                ->references(['reference_dataset_id', 'reference_entity_group_id', 'reference_record_key'])->on('reference_entity_members')->restrictOnDelete();
            $table->foreign(['matching_job_id', 'duplicate_of_input_record_key', 'duplicate_target_guard'], 'review_states_canonical_fk')
                ->references(['matching_job_id', 'input_record_key', 'canonical_guard'])->on('review_states')->restrictOnDelete();
            $table->foreign(['last_operation_id', 'matching_job_id'], 'review_states_operation_fk')
                ->references(['id', 'matching_job_id'])->on('review_operations')->restrictOnDelete();
        });

        Schema::create('review_change_requests', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->uuid('matching_job_id');
            $table->uuid('review_state_id');
            $table->uuid('reference_dataset_id');
            $table->unsignedBigInteger('expected_version');
            $table->unsignedBigInteger('version')->default(1);
            $table->foreignId('previous_reviewer_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('proposed_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('last_modified_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('before_status', 24);
            $this->recordKey($table, 'before_reference_record_key', true);
            $this->recordKey($table, 'before_duplicate_of_input_record_key', true);
            $table->string('proposed_decision', 32);
            $table->string('proposed_status', 24);
            $this->recordKey($table, 'proposed_reference_record_key', true);
            $table->uuid('proposed_reference_entity_group_id')->nullable();
            $table->foreignUuid('proposed_matching_result_id')->nullable()->constrained('matching_results')->restrictOnDelete();
            $this->recordKey($table, 'proposed_duplicate_of_input_record_key', true);
            $table->string('reason', 1000);
            $table->string('resolution_reason', 1000)->nullable();
            $table->string('status', 16)->default('pending');
            $table->dateTime('resolved_at', 6)->nullable();
            $table->uuid('applied_operation_id')->nullable();
            $table->unsignedTinyInteger('pending_guard')->nullable()->storedAs("CASE WHEN status = 'pending' THEN 1 ELSE NULL END");
            $table->timestamps(6);
            $table->unique(['id', 'matching_job_id'], 'review_requests_id_job_uq');
            $table->unique(['review_state_id', 'pending_guard'], 'review_requests_pending_uq');
            $table->index(['matching_job_id', 'status', 'created_at'], 'review_requests_inbox_idx');
            $table->index(['proposed_by_user_id', 'status', 'created_at'], 'review_requests_proposer_idx');
            $table->foreign(['review_state_id', 'matching_job_id'], 'review_requests_state_fk')
                ->references(['id', 'matching_job_id'])->on('review_states')->restrictOnDelete();
            $table->foreign(['matching_job_id', 'proposed_duplicate_of_input_record_key'], 'review_requests_duplicate_fk')
                ->references(['matching_job_id', 'input_record_key'])->on('review_states')->restrictOnDelete();
            $table->foreign(['matching_job_id', 'reference_dataset_id'], 'review_requests_job_dataset_fk')
                ->references(['id', 'reference_dataset_id'])->on('matching_jobs')->restrictOnDelete();
            $table->foreign(['reference_dataset_id', 'proposed_reference_entity_group_id', 'proposed_reference_record_key'], 'review_requests_entity_fk')
                ->references(['reference_dataset_id', 'reference_entity_group_id', 'reference_record_key'])->on('reference_entity_members')->restrictOnDelete();
            $table->foreign(['applied_operation_id', 'matching_job_id'], 'review_requests_operation_fk')
                ->references(['id', 'matching_job_id'])->on('review_operations')->restrictOnDelete();
        });

        Schema::create('workspace_members', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->foreignUuid('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // Owner remains workspaces.user_id; no second source of ownership.
            $table->string('role', 16)->default('viewer');
            $table->string('status', 16)->default('active');
            $table->unsignedBigInteger('version')->default(1);
            $table->foreignId('granted_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('revoked_at', 6)->nullable();
            $table->timestamps(6);
            $table->unique(['workspace_id', 'user_id'], 'workspace_members_workspace_user_uq');
            $table->index(['user_id', 'status', 'workspace_id'], 'workspace_members_access_idx');
        });

        // MySQL CHECK support is not emulated by SQLite tests: verify on real MySQL 8.
        if (DB::getDriverName() === 'mysql') {
            foreach ($this->checks() as $table => $checks) {
                foreach ($checks as $name => $expression) {
                    DB::statement("ALTER TABLE `$table` ADD CONSTRAINT `$name` CHECK ($expression)");
                }
            }
        }
    }

    private function recordKey(Blueprint $table, string $name, bool $nullable = false, int $length = 255)
    {
        $column = $table->string($name, $length)->collation(DB::getDriverName() === 'mysql' ? 'utf8mb4_0900_bin' : 'BINARY');
        return $nullable ? $column->nullable() : $column;
    }

    private function checks(): array
    {
        $statuses = "('matched','possible_match','unmatched','duplicate_input','reference_conflict')";
        return [
            'workspaces' => ['workspace_configuration_version_ck' => 'configuration_version > 0'],
            'matching_jobs' => ['jobs_review_readiness_ck' => "review_state_readiness IN ('pending','reconciling','ready','blocked')"],
            'reference_entity_groups' => ['entity_groups_version_ck' => 'version > 0'],
            'review_operations' => ['review_ops_status_ck' => "status IN ('processing','completed','failed')"],
            'review_states' => [
                'review_states_status_ck' => "status IN $statuses",
                'review_states_version_ck' => 'version > 0',
                'review_states_integrity_ck' => "integrity_status IN ('consistent','held') AND (integrity_status <> 'held' OR status IN ('matched','reference_conflict'))",
                'review_states_match_ck' => "status <> 'matched' OR selected_reference_record_key IS NOT NULL",
                'review_states_entity_ck' => 'selected_reference_entity_group_id IS NULL OR selected_reference_record_key IS NOT NULL',
                'review_states_duplicate_ck' => "(status = 'duplicate_input' AND duplicate_of_input_record_key IS NOT NULL AND selected_reference_record_key IS NULL AND selected_reference_entity_group_id IS NULL) OR (status <> 'duplicate_input' AND duplicate_of_input_record_key IS NULL)",
                'review_states_self_ck' => 'duplicate_of_input_record_key IS NULL OR duplicate_of_input_record_key <> input_record_key',
                'review_states_lineage_ck' => "lineage_status IN ('unverified','partial','verified') AND (source_occurrence_count IS NULL OR source_occurrence_count > 0)",
                'review_states_origin_ck' => "decision_origin IN ('auto','manual','approval','legacy')",
                'review_states_protection_ck' => "decision_protection IN ('open','reviewer_owned','approved','legacy_unknown')",
            ],
            'review_change_requests' => [
                'review_requests_version_ck' => 'version > 0 AND expected_version > 0',
                'review_requests_status_ck' => "status IN ('pending','approved','rejected','stale','conflicted','cancelled')",
                'review_requests_proposal_ck' => "before_status IN $statuses AND proposed_status IN $statuses",
                'review_requests_entity_ck' => 'proposed_reference_entity_group_id IS NULL OR proposed_reference_record_key IS NOT NULL',
            ],
            'workspace_members' => [
                'workspace_members_role_ck' => "role IN ('viewer','editor')",
                'workspace_members_status_ck' => "status IN ('active','revoked') AND version > 0",
            ],
        ];
    }

    public function down(): void
    {
        foreach (['workspace_members', 'review_change_requests', 'review_states', 'review_operations', 'reference_entity_members', 'reference_entity_groups'] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException('Rollback refused: new review tables contain data. Archive/reconcile before rollback.');
            }
        }
        if (DB::table('workspaces')->where('configuration_version', '<>', 1)->exists()
            || DB::table('matching_jobs')->where('review_state_readiness', '<>', 'pending')->orWhere('review_state_schema_version', '<>', 0)->exists()) {
            throw new RuntimeException('Rollback refused: review/configuration versioning has been used.');
        }
        if (Schema::hasColumn('review_decisions', 'review_state_id')) {
            throw new RuntimeException('Rollback refused: roll back dependent review audit migration first.');
        }
        // Reverse dependency order. Never disable foreign-key checks to force a rollback.
        Schema::dropIfExists('workspace_members');
        Schema::dropIfExists('review_change_requests');
        Schema::dropIfExists('review_states');
        Schema::dropIfExists('review_operations');
        Schema::dropIfExists('reference_entity_members');
        Schema::dropIfExists('reference_entity_groups');
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE matching_jobs DROP CHECK jobs_review_readiness_ck');
            DB::statement('ALTER TABLE workspaces DROP CHECK workspace_configuration_version_ck');
        }
        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->dropUnique('jobs_id_reference_dataset_uq');
            $table->dropColumn(['review_state_readiness', 'review_state_schema_version']);
        });
        Schema::table('workspaces', fn (Blueprint $table) => $table->dropColumn('configuration_version'));
    }
};
