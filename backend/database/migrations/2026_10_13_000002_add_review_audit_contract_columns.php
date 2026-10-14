<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_decisions', function (Blueprint $table) {
            $table->uuid('review_state_id')->nullable();
            $table->uuid('review_operation_id')->nullable();
            $table->uuid('change_request_id')->nullable();
            $table->unsignedBigInteger('state_version_before')->nullable();
            $table->unsignedBigInteger('state_version_after')->nullable();
            foreach (['proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'] as $actor) {
                $table->foreignId($actor)->nullable()->constrained('users')->restrictOnDelete();
            }
            $table->foreign(['review_state_id', 'matching_job_id'], 'review_decisions_state_fk')
                ->references(['id', 'matching_job_id'])->on('review_states')->restrictOnDelete();
            $table->foreign(['review_operation_id', 'matching_job_id'], 'review_decisions_operation_fk')
                ->references(['id', 'matching_job_id'])->on('review_operations')->restrictOnDelete();
            $table->foreign(['change_request_id', 'matching_job_id'], 'review_decisions_request_fk')
                ->references(['id', 'matching_job_id'])->on('review_change_requests')->restrictOnDelete();
            $table->unique(['review_state_id', 'state_version_after'], 'review_decisions_state_version_uq');
        });
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_versions_ck CHECK ((review_state_id IS NULL AND state_version_before IS NULL AND state_version_after IS NULL) OR (review_state_id IS NOT NULL AND review_operation_id IS NOT NULL AND state_version_before IS NOT NULL AND state_version_after IS NOT NULL AND state_version_before >= 0 AND state_version_after = state_version_before + 1))');
        }
    }

    public function down(): void
    {
        if (DB::table('review_decisions')->where(function ($query) {
            foreach (['review_state_id', 'review_operation_id', 'change_request_id', 'state_version_before', 'state_version_after',
                'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'] as $column) {
                $query->orWhereNotNull($column);
            }
        })->exists()) {
            throw new RuntimeException('Rollback refused: new review audit fields contain data. Archive/reconcile before rollback.');
        }
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE review_decisions DROP CHECK review_decisions_versions_ck');
        }
        Schema::table('review_decisions', function (Blueprint $table) {
            $table->dropForeign('review_decisions_request_fk');
            $table->dropForeign('review_decisions_operation_fk');
            $table->dropForeign('review_decisions_state_fk');
            $table->dropUnique('review_decisions_state_version_uq');
            foreach (['proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id'] as $actor) {
                $table->dropConstrainedForeignId($actor);
            }
            $table->dropColumn(['review_state_id', 'review_operation_id', 'change_request_id', 'state_version_before', 'state_version_after']);
        });
    }
};
