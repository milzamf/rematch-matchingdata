<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->index(['matching_job_id', 'candidate_rank', 'input_province_code', 'input_regency_code', 'input_record_key'], 'shared_region_count_idx');
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', fn (Blueprint $table) => $table->dropIndex('shared_region_count_idx'));
    }
};
