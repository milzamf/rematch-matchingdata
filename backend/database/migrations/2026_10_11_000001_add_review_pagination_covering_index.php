<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            // Cover filters, stable ordering and input-key projection so OFFSET
            // pagination reads index entries instead of large JSON result rows.
            $table->index(
                ['matching_job_id', 'candidate_rank', 'result_type', 'id', 'input_record_key'],
                'matching_results_review_page_cover_idx',
            );
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropIndex('matching_results_review_page_cover_idx');
        });
    }
};
