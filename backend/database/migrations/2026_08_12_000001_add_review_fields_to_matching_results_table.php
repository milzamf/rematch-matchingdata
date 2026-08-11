<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->string('review_status', 32)->default('pending')->after('result_type');
            $table->string('review_decision', 32)->nullable()->after('review_status');
            $table->timestamp('reviewed_at')->nullable()->after('review_decision');

            $table->index(['matching_job_id', 'review_status']);
        });
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropIndex(['matching_job_id', 'review_status']);
            $table->dropColumn(['review_status', 'review_decision', 'reviewed_at']);
        });
    }
};
