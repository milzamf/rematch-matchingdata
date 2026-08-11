<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->constrained('matching_jobs')->cascadeOnDelete();
            $table->foreignUuid('matching_result_id')->nullable()->constrained('matching_results')->nullOnDelete();
            $table->string('input_record_key');
            $table->string('selected_reference_record_key')->nullable();
            $table->string('decision', 32);
            $table->string('previous_result_type', 32)->nullable();
            $table->string('new_result_type', 32);
            $table->json('metadata')->nullable();
            $table->timestamp('undone_at')->nullable();
            $table->timestamps();

            $table->index(['matching_job_id', 'input_record_key']);
            $table->index(['matching_job_id', 'decision']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('review_decisions');
    }
};
