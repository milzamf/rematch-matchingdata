<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('matching_configurations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('matching_job_id')->unique()->constrained('matching_jobs')->cascadeOnDelete();
            $table->string('preset', 32);
            $table->string('strategy', 32);
            $table->json('thresholds')->nullable();
            $table->json('normalization')->nullable();
            $table->json('search_optimization')->nullable();
            $table->json('candidate_generation')->nullable();
            $table->json('output_config')->nullable();
            $table->json('advanced_settings')->nullable();
            $table->string('config_hash', 64);
            $table->timestamps();

            $table->index('config_hash');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('matching_configurations');
    }
};
