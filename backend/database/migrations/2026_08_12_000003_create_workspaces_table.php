<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspaces', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('status', 32)->default('draft')->index();
            $table->unsignedTinyInteger('current_step')->default(1)->index();
            $table->foreignUuid('reference_dataset_id')->nullable()->constrained('datasets')->nullOnDelete();
            $table->foreignUuid('input_dataset_id')->nullable()->constrained('datasets')->nullOnDelete();
            $table->foreignUuid('matching_job_id')->nullable()->constrained('matching_jobs')->nullOnDelete();
            $table->json('workflow_state')->nullable();
            $table->json('sync_state')->nullable();
            $table->json('export_history')->nullable();
            $table->timestamps();

            $table->index('updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('workspaces');
    }
};
