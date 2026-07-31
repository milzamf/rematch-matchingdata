<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('datasets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('dataset_role', 32);
            $table->string('name');
            $table->string('original_filename');
            $table->string('file_format', 16);
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('file_size');
            $table->string('storage_path');
            $table->string('selected_sheet')->nullable();
            $table->string('delimiter', 8)->nullable();
            $table->unsignedInteger('header_row')->default(1);
            $table->unsignedInteger('row_count')->default(0);
            $table->unsignedInteger('column_count')->default(0);
            $table->string('parse_status', 32)->default('inspected');
            $table->json('sheet_names')->nullable();
            $table->json('preview_rows')->nullable();
            $table->json('profiling_summary')->nullable();
            $table->timestamps();

            $table->index(['dataset_role', 'parse_status']);
            $table->index('file_format');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('datasets');
    }
};
