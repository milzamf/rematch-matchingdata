<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    // Each is a leftmost prefix of an existing unique/covering index.
    private array $indexes = [
        'matching_results_matching_job_id_input_record_key_index' => ['matching_job_id', 'input_record_key'],
        'matching_results_matching_job_id_result_type_index' => ['matching_job_id', 'result_type'],
        'matching_results_job_rank_score_idx' => ['matching_job_id', 'candidate_rank', 'overall_score'],
        'matching_results_job_rank_type_idx' => ['matching_job_id', 'candidate_rank', 'result_type'],
    ];

    public function up(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE matching_results '.implode(', ', array_map(
                static fn ($name) => 'DROP INDEX `'.$name.'`', array_keys($this->indexes))));
        } else {
            Schema::table('matching_results', function (Blueprint $table) {
                foreach ($this->indexes as $name => $columns) $table->dropIndex($name);
            });
        }
    }

    public function down(): void
    {
        Schema::table('matching_results', function (Blueprint $table) {
            foreach ($this->indexes as $name => $columns) $table->index($columns, $name);
        });
    }
};
