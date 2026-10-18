<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('matching_record_snapshots', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->char('id', 64)->primary();
            $table->longText('payload');
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        // Once referenced, dropping snapshots would destroy immutable result evidence.
        if (\Illuminate\Support\Facades\DB::table('matching_results')->whereRaw("JSON_EXTRACT(candidate_metadata, '$._reference_snapshot') IS NOT NULL")->exists()) {
            throw new RuntimeException('Snapshot evidence is referenced; restore a matching database backup instead of dropping this table.');
        }
        Schema::dropIfExists('matching_record_snapshots');
    }
};
