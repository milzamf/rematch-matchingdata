<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('matching_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->constrained('matching_jobs')->cascadeOnDelete();
            $table->string('input_record_key');
            $table->string('reference_record_key')->nullable();
            $table->string('result_type', 32);
            $table->decimal('overall_score', 5, 2)->default(0);
            $table->unsignedInteger('candidate_rank')->default(1);
            $table->json('field_scores')->nullable();
            $table->json('candidate_metadata')->nullable();
            $table->string('decision_reason')->nullable();
            $table->timestamps();

            $table->index(['matching_job_id', 'result_type']);
            $table->index(['matching_job_id', 'input_record_key']);
            $table->index(['matching_job_id', 'overall_score']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('matching_results');
    }
};
