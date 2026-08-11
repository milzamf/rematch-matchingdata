<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('column_mappings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->constrained('matching_jobs')->cascadeOnDelete();
            $table->foreignUuid('reference_column_id')->nullable()->constrained('dataset_columns')->nullOnDelete();
            $table->foreignUuid('input_column_id')->nullable()->constrained('dataset_columns')->nullOnDelete();
            $table->string('reference_column_name');
            $table->string('input_column_name');
            $table->string('algorithm', 64)->default('Normalized Exact');
            $table->decimal('weight', 5, 2)->default(0);
            $table->boolean('required_match')->default(false);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index('matching_job_id');
            $table->index('reference_column_id');
            $table->index('input_column_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('column_mappings');
    }
};
