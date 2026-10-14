<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Derived read projection only; no historical data updates in migration.
        Schema::table('review_states', function (Blueprint $t) {
            $t->decimal('display_score', 5, 2)->nullable();
            $t->boolean('display_score_indexed')->default(false);
            $t->unsignedTinyInteger('display_score_null')->storedAs('display_score IS NULL');
            $t->index(['matching_job_id', 'display_score_indexed'], 'review_display_ready_idx');
        });
        if (DB::getDriverName() !== 'mysql') return;
        foreach (['asc' => 'ASC', 'desc' => 'DESC'] as $suffix => $direction) {
            foreach (['all' => '', 'status' => 'status, '] as $scope => $status) {
                DB::statement("CREATE INDEX review_display_{$scope}_{$suffix}_idx ON review_states (matching_job_id, {$status}display_score_null ASC, display_score {$direction}, input_record_key ASC)");
            }
        }
        // Completed-job candidates are immutable. Every state insert/update, including
        // Undo/approval/backfill, refreshes the projection in the same DB transaction.
        foreach (['insert' => 'INSERT', 'update' => 'UPDATE'] as $suffix => $event) {
            DB::unprepared("CREATE TRIGGER review_display_{$suffix} BEFORE {$event} ON review_states FOR EACH ROW BEGIN
                IF NEW.selected_matching_result_id IS NULL THEN
                    SET NEW.display_score = (SELECT overall_score FROM matching_results USE INDEX (matching_results_job_input_rank_unique) WHERE matching_job_id = NEW.matching_job_id AND input_record_key = CONVERT(NEW.input_record_key USING utf8mb4) COLLATE utf8mb4_unicode_ci AND BINARY input_record_key = BINARY NEW.input_record_key AND candidate_rank = 1 LIMIT 1);
                ELSE
                    SET NEW.display_score = (SELECT overall_score FROM matching_results WHERE id = NEW.selected_matching_result_id AND matching_job_id = NEW.matching_job_id AND BINARY input_record_key = BINARY NEW.input_record_key LIMIT 1);
                END IF;
                SET NEW.display_score_indexed = 1;
            END");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            foreach (['insert', 'update'] as $event) DB::unprepared("DROP TRIGGER IF EXISTS review_display_{$event}");
            foreach (['all', 'status'] as $scope) foreach (['asc', 'desc'] as $direction) DB::statement("DROP INDEX review_display_{$scope}_{$direction}_idx ON review_states");
        }
        Schema::table('review_states', function (Blueprint $t) {
            $t->dropIndex('review_display_ready_idx');
            $t->dropColumn(['display_score_null', 'display_score_indexed', 'display_score']);
        });
    }
};
