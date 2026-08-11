<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('matching_jobs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('reference_dataset_id')->constrained('datasets')->cascadeOnDelete();
            $table->foreignUuid('input_dataset_id')->constrained('datasets')->cascadeOnDelete();
            $table->string('name')->nullable();
            $table->string('status', 32)->default('queued');
            $table->unsignedInteger('processed_count')->default(0);
            $table->unsignedInteger('total_count')->default(0);
            $table->json('record_counts')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('reference_dataset_id');
            $table->index('input_dataset_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('matching_jobs');
    }
};
