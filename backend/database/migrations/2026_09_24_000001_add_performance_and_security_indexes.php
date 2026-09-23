<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Datasets user ownership and index
        if (! Schema::hasColumn('datasets', 'user_id')) {
            Schema::table('datasets', function (Blueprint $table) {
                $table->foreignId('user_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
                $table->index('user_id');
            });

            // Backfill user_id from associated workspace if available
            DB::statement('
                UPDATE datasets d
                INNER JOIN workspaces w ON d.workspace_id = w.id
                SET d.user_id = w.user_id
                WHERE d.user_id IS NULL AND w.user_id IS NOT NULL
            ');
        }

        // 2. Workspaces foreign key indexes and sorting index
        Schema::table('workspaces', function (Blueprint $table) {
            $table->index('reference_dataset_id', 'workspaces_ref_dataset_idx');
            $table->index('input_dataset_id', 'workspaces_input_dataset_idx');
            $table->index('matching_job_id', 'workspaces_matching_job_idx');
            $table->index(['user_id', 'updated_at'], 'workspaces_user_updated_idx');
        });

        // 3. Matching jobs composite status index
        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->index(['workspace_id', 'status'], 'matching_jobs_workspace_status_idx');
        });

        // 4. Review decisions foreign key and ordering indexes
        Schema::table('review_decisions', function (Blueprint $table) {
            $table->index('matching_result_id', 'review_decisions_result_idx');
            $table->index('reviewer_user_id', 'review_decisions_reviewer_idx');
            $table->index(['matching_job_id', 'created_at'], 'review_decisions_job_created_idx');
            $table->index(['matching_job_id', 'undone_at'], 'review_decisions_job_undone_idx');
        });

        // 5. Matching results candidate ranking & score retrieval index
        Schema::table('matching_results', function (Blueprint $table) {
            $table->index(['matching_job_id', 'candidate_rank', 'overall_score'], 'matching_results_job_rank_score_idx');
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropIndex('matching_results_job_rank_score_idx');
        });

        Schema::table('review_decisions', function (Blueprint $table) {
            $table->dropIndex('review_decisions_job_undone_idx');
            $table->dropIndex('review_decisions_job_created_idx');
            $table->dropIndex('review_decisions_reviewer_idx');
            $table->dropIndex('review_decisions_result_idx');
        });

        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->dropIndex('matching_jobs_workspace_status_idx');
        });

        Schema::table('workspaces', function (Blueprint $table) {
            $table->dropIndex('workspaces_user_updated_idx');
            $table->dropIndex('workspaces_matching_job_idx');
            $table->dropIndex('workspaces_input_dataset_idx');
            $table->dropIndex('workspaces_ref_dataset_idx');
        });

        if (Schema::hasColumn('datasets', 'user_id')) {
            Schema::table('datasets', function (Blueprint $table) {
                $table->dropConstrainedForeignId('user_id');
            });
        }
    }
};
