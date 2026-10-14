<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->string('input_province_code', 16)->nullable();
            $table->string('input_regency_code', 16)->nullable();
            $table->boolean('input_region_indexed')->default(false);
            $table->index(['matching_job_id', 'candidate_rank', 'overall_score', 'input_record_key'], 'review_score_idx');
            $table->index(['matching_job_id', 'candidate_rank', 'input_province_code', 'input_regency_code', 'overall_score'], 'review_region_idx');
            $table->index(['matching_job_id', 'candidate_rank', 'input_region_indexed', 'id'], 'review_region_ready_idx');
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropIndex('review_score_idx');
            $table->dropIndex('review_region_idx');
            $table->dropIndex('review_region_ready_idx');
            $table->dropColumn(['input_province_code', 'input_regency_code', 'input_region_indexed']);
        });
    }
};
