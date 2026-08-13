<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('datasets', function (Blueprint $table) {
            $table->uuid('workspace_id')->nullable()->after('id');
            $table->index('workspace_id');
            $table->foreign('workspace_id')->references('id')->on('workspaces')->nullOnDelete();
        });

        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->uuid('workspace_id')->nullable()->after('id');
            $table->index('workspace_id');
            $table->foreign('workspace_id')->references('id')->on('workspaces')->nullOnDelete();
        });

        Schema::table('review_decisions', function (Blueprint $table) {
            $table->foreignId('reviewer_user_id')->nullable()->after('matching_result_id')->constrained('users')->nullOnDelete();
        });

        $this->backfillWorkspaceOwnership();

        Schema::table('dataset_columns', function (Blueprint $table) {
            $table->unique(['dataset_id', 'position'], 'dataset_columns_dataset_position_unique');
        });

        Schema::table('matching_results', function (Blueprint $table) {
            $table->unique(
                ['matching_job_id', 'input_record_key', 'candidate_rank'],
                'matching_results_job_input_rank_unique',
            );
        });

        Schema::table('column_mappings', function (Blueprint $table) {
            $table->unique(
                ['matching_job_id', 'reference_column_name'],
                'column_mappings_job_reference_name_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::table('column_mappings', function (Blueprint $table) {
            $table->dropUnique('column_mappings_job_reference_name_unique');
        });

        Schema::table('matching_results', function (Blueprint $table) {
            $table->dropUnique('matching_results_job_input_rank_unique');
        });

        Schema::table('dataset_columns', function (Blueprint $table) {
            $table->dropUnique('dataset_columns_dataset_position_unique');
        });

        Schema::table('review_decisions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('reviewer_user_id');
        });

        Schema::table('matching_jobs', function (Blueprint $table) {
            $table->dropForeign(['workspace_id']);
            $table->dropIndex(['workspace_id']);
            $table->dropColumn('workspace_id');
        });

        Schema::table('datasets', function (Blueprint $table) {
            $table->dropForeign(['workspace_id']);
            $table->dropIndex(['workspace_id']);
            $table->dropColumn('workspace_id');
        });
    }

    private function backfillWorkspaceOwnership(): void
    {
        $workspaces = DB::table('workspaces')
            ->select('id', 'reference_dataset_id', 'input_dataset_id', 'matching_job_id')
            ->orderByDesc('updated_at')
            ->get();

        foreach ($workspaces as $workspace) {
            foreach ([$workspace->reference_dataset_id, $workspace->input_dataset_id] as $datasetId) {
                if (! $datasetId) {
                    continue;
                }

                DB::table('datasets')
                    ->where('id', $datasetId)
                    ->whereNull('workspace_id')
                    ->update(['workspace_id' => $workspace->id]);
            }

            if ($workspace->matching_job_id) {
                DB::table('matching_jobs')
                    ->where('id', $workspace->matching_job_id)
                    ->whereNull('workspace_id')
                    ->update(['workspace_id' => $workspace->id]);
            }
        }
    }
};
