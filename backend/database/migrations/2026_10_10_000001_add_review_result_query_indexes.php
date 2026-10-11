<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            // Review pagination filters by job and candidate rank, then orders by id.
            $table->index(
                ['matching_job_id', 'candidate_rank', 'id'],
                'matching_results_job_rank_id_idx',
            );

            // Summary counts and status-filtered review pages use these columns together.
            $table->index(
                ['matching_job_id', 'candidate_rank', 'result_type'],
                'matching_results_job_rank_type_idx',
            );

            // Case-group discovery includes reviewed outcomes as well as pending matches.
            $table->index(
                ['matching_job_id', 'candidate_rank', 'review_status'],
                'matching_results_job_rank_review_idx',
            );
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropIndex('matching_results_job_rank_review_idx');
            $table->dropIndex('matching_results_job_rank_type_idx');
            $table->dropIndex('matching_results_job_rank_id_idx');
        });
    }
};
