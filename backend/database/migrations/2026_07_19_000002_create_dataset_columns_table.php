<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dataset_columns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('dataset_id')->constrained('datasets')->cascadeOnDelete();
            $table->string('name');
            $table->string('normalized_name');
            $table->string('data_type', 32);
            $table->unsignedInteger('position');
            $table->unsignedInteger('null_count')->default(0);
            $table->decimal('null_percentage', 5, 2)->default(0);
            $table->unsignedInteger('unique_count')->default(0);
            $table->decimal('duplicate_percentage', 5, 2)->default(0);
            $table->json('sample_values')->nullable();
            $table->timestamps();

            $table->index(['dataset_id', 'normalized_name']);
            $table->index(['dataset_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dataset_columns');
    }
};
