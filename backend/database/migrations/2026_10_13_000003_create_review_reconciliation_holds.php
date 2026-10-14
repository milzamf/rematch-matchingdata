<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('review_states')->where('integrity_status', 'held')->exists()) {
            throw new RuntimeException('Existing holds must be reconciled before changing hold representation.');
        }
        Schema::create('review_reconciliation_issues', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->constrained('matching_jobs')->restrictOnDelete();
            $table->string('input_record_key')->nullable()->collation($this->collation());
            $table->string('reason_code', 64);
            $table->char('evidence_fingerprint', 64);
            $table->string('status', 16)->default('open');
            $table->foreignId('resolved_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('resolved_at', 6)->nullable();
            $table->timestamps(6);
            $table->unique(['matching_job_id', 'input_record_key', 'reason_code'], 'review_issues_identity_uq');
            $table->index(['matching_job_id', 'status', 'input_record_key'], 'review_issues_inbox_idx');
        });
        Schema::create('review_reference_holds', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->uuid('id')->primary();
            $table->uuid('matching_job_id');
            $table->uuid('reference_dataset_id');
            $table->string('reference_record_key')->nullable()->collation($this->collation());
            $table->uuid('reference_entity_group_id')->nullable();
            $table->char('evidence_fingerprint', 64);
            $table->string('status', 16)->default('active');
            $table->foreignId('resolved_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('resolved_at', 6)->nullable();
            $table->timestamps(6);
            $table->string('active_reference_record_key')->nullable()->collation($this->collation())
                ->storedAs("CASE WHEN status = 'active' THEN reference_record_key ELSE NULL END");
            $table->uuid('active_reference_entity_group_id')->nullable()
                ->storedAs("CASE WHEN status = 'active' THEN reference_entity_group_id ELSE NULL END");
            $table->unique(['matching_job_id', 'active_reference_record_key'], 'review_holds_reference_uq');
            $table->unique(['matching_job_id', 'active_reference_entity_group_id'], 'review_holds_entity_uq');
            $table->foreign(['matching_job_id', 'reference_dataset_id'], 'review_holds_job_dataset_fk')
                ->references(['id', 'reference_dataset_id'])->on('matching_jobs')->restrictOnDelete();
            $table->foreign(['reference_dataset_id', 'reference_entity_group_id'], 'review_holds_entity_fk')
                ->references(['reference_dataset_id', 'id'])->on('reference_entity_groups')->restrictOnDelete();
        });
        $this->assignmentColumns(false);
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE review_states DROP CHECK review_states_integrity_ck, DROP CHECK review_states_match_ck');
            DB::statement("ALTER TABLE review_states ADD CONSTRAINT review_states_integrity_ck CHECK (integrity_status IN ('consistent','held')), ADD CONSTRAINT review_states_match_ck CHECK (status <> 'matched' OR selected_reference_record_key IS NOT NULL OR integrity_status = 'held')");
            DB::statement("ALTER TABLE review_reference_holds ADD CONSTRAINT review_holds_resource_ck CHECK (reference_record_key IS NOT NULL OR reference_entity_group_id IS NOT NULL), ADD CONSTRAINT review_holds_status_ck CHECK (status IN ('active','resolved'))");
            DB::statement("ALTER TABLE review_reconciliation_issues ADD CONSTRAINT review_issues_status_ck CHECK (status IN ('open','resolved'))");
        }
    }

    private function collation(): string
    {
        return DB::getDriverName() === 'mysql' ? 'utf8mb4_0900_bin' : 'BINARY';
    }

    private function assignmentColumns(bool $legacy): void
    {
        Schema::table('review_states', function (Blueprint $table) {
            $table->dropUnique('review_states_active_reference_uq');
            $table->dropUnique('review_states_active_entity_uq');
        });
        Schema::table('review_states', fn (Blueprint $table) => $table->dropColumn(['active_reference_record_key', 'active_reference_entity_group_id']));
        $condition = $legacy ? "status = 'matched' OR integrity_status = 'held'" : "status = 'matched' AND integrity_status = 'consistent'";
        Schema::table('review_states', function (Blueprint $table) use ($condition) {
            $table->string('active_reference_record_key')->nullable()->collation($this->collation())
                ->storedAs("CASE WHEN $condition THEN selected_reference_record_key ELSE NULL END");
            $table->uuid('active_reference_entity_group_id')->nullable()
                ->storedAs("CASE WHEN $condition THEN selected_reference_entity_group_id ELSE NULL END");
            $table->unique(['matching_job_id', 'active_reference_record_key'], 'review_states_active_reference_uq');
            $table->unique(['matching_job_id', 'active_reference_entity_group_id'], 'review_states_active_entity_uq');
        });
    }

    public function down(): void
    {
        if (DB::table('review_reconciliation_issues')->exists() || DB::table('review_reference_holds')->exists()
            || DB::table('review_states')->where('integrity_status', 'held')->exists()) {
            throw new RuntimeException('Rollback refused: reconciliation/hold data must first be archived or reconciled.');
        }
        $this->assignmentColumns(true);
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE review_states DROP CHECK review_states_integrity_ck, DROP CHECK review_states_match_ck');
            DB::statement("ALTER TABLE review_states ADD CONSTRAINT review_states_integrity_ck CHECK (integrity_status IN ('consistent','held') AND (integrity_status <> 'held' OR status IN ('matched','reference_conflict'))), ADD CONSTRAINT review_states_match_ck CHECK (status <> 'matched' OR selected_reference_record_key IS NOT NULL)");
        }
        Schema::dropIfExists('review_reference_holds');
        Schema::dropIfExists('review_reconciliation_issues');
    }
};
