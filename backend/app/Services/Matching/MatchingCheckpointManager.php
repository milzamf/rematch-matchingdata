<?php

namespace App\Services\Matching;

use App\Models\MatchingJob;
use App\Models\MatchingResult;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PDO;
use Throwable;

class MatchingCheckpointManager
{
    private readonly string $dbPath;
    private ?PDO $pdo = null;

    public function __construct(?string $dbPath = null)
    {
        if ($dbPath !== null) {
            $this->dbPath = $dbPath;
            return;
        }

        $cacheDir = (string) (env('MATCHING_CACHE_PATH') ?: storage_path('app'));
        $this->dbPath = rtrim($cacheDir, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'matching_checkpoints.sqlite';

        // Preserve checkpoints created by older versions before the cache volume
        // was introduced, then use the Docker volume for subsequent writes.
        $legacyPath = storage_path('app/matching_checkpoints.sqlite');
        if (!is_file($this->dbPath) && is_file($legacyPath) && $legacyPath !== $this->dbPath) {
            $dir = dirname($this->dbPath);
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            @copy($legacyPath, $this->dbPath);
        }
    }

    /**
     * Get or initialize SQLite PDO connection.
     */
    public function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $dir = dirname($this->dbPath);
        if (! is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $newDatabase = !is_file($this->dbPath) || filesize($this->dbPath) === 0;
        $this->pdo = new PDO('sqlite:' . $this->dbPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);

        if ($newDatabase) $this->pdo->exec('PRAGMA auto_vacuum = INCREMENTAL;');
        $this->pdo->exec('PRAGMA journal_mode = WAL;');
        $this->pdo->exec('PRAGMA synchronous = NORMAL;');
        $this->pdo->exec('PRAGMA temp_store = FILE;');
        $this->pdo->exec('PRAGMA cache_size = -8192;');

        $this->initSchema();

        return $this->pdo;
    }

    /**
     * Create tables and indexes if they do not exist yet.
     */
    private function initSchema(): void
    {
        $this->pdo->exec('
            CREATE TABLE IF NOT EXISTS matching_checkpoints (
                checkpoint_key TEXT PRIMARY KEY,
                matching_job_id TEXT NOT NULL,
                workspace_id TEXT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                processed_count INTEGER NOT NULL DEFAULT 0,
                last_chunk_index INTEGER NOT NULL DEFAULT -1,
                summary_json TEXT NULL,
                status TEXT NOT NULL DEFAULT "in_progress",
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS matching_checkpoint_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                checkpoint_key TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                processed_count INTEGER NOT NULL,
                results_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(checkpoint_key, chunk_index)
            );

            CREATE INDEX IF NOT EXISTS idx_chk_key ON matching_checkpoint_chunks(checkpoint_key, chunk_index);
        ');
    }

    /**
     * Deterministically hash datasets, mappings, and configuration to create a stable checkpoint key.
     *
     * @param array<int, array<string, mixed>> $mappings
     * @param array<string, mixed> $configuration
     */
    public function generateCheckpointKey(
        string $referenceDatasetId,
        string $inputDatasetId,
        array $mappings,
        array $configuration
    ): string {
        $normalizedMappings = array_map(function ($m) {
            return [
                'ref' => (string) ($m['reference_column_name'] ?? $m['referenceColumnName'] ?? ''),
                'inp' => (string) ($m['input_column_name'] ?? $m['inputColumnName'] ?? ''),
                'algo' => (string) ($m['algorithm'] ?? ''),
                'weight' => (float) ($m['weight'] ?? 0),
                'req' => (bool) ($m['required_match'] ?? false),
                'pref' => (string) ($m['parent_reference_column'] ?? $m['parentReferenceColumn'] ?? data_get($m, 'metadata.parent_reference_column') ?? data_get($m, 'metadata.parentReferenceColumn') ?? ''),
                'pinp' => (string) ($m['parent_input_column'] ?? $m['parentInputColumn'] ?? data_get($m, 'metadata.parent_input_column') ?? data_get($m, 'metadata.parentInputColumn') ?? ''),
                'trans' => (string) ($m['transform'] ?? data_get($m, 'metadata.transform') ?? ''),
            ];
        }, $mappings);

        usort($normalizedMappings, fn ($a, $b) => strcmp($a['ref'] . '|' . $a['inp'], $b['ref'] . '|' . $b['inp']));

        $configPayload = [
            'preset' => $configuration['preset'] ?? 'Default',
            'strategy' => $configuration['strategy'] ?? 'Hybrid',
            'thresholds' => $configuration['thresholds'] ?? [],
            'rules' => $configuration['rules'] ?? [],
            'normalization' => $configuration['normalization'] ?? [],
            'weighting' => $configuration['weighting'] ?? [],
            'fields' => $configuration['fields'] ?? [],
            'chunkSize' => max(10, min(250, (int) data_get($configuration, 'runOptions.chunkSize', 250))),
            'candidateGeneration' => $configuration['candidateGeneration'] ?? [],
        ];

        $scope = app(MatchingInputScope::class)->normalize($configuration['inputScope'] ?? []);
        if ($scope['provinceCodes'] || $scope['regencyCodes']) $configPayload['inputScope'] = $scope;

        return hash('sha256', json_encode([
            'engine_version' => 'bounded-recall-snapshot-v4',
            'ref' => $referenceDatasetId,
            'inp' => $inputDatasetId,
            'map' => $normalizedMappings,
            'cfg' => $configPayload,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * Check if a resumable, incomplete checkpoint exists for the given key.
     */
    public function hasIncompleteCheckpoint(string $checkpointKey): bool
    {
        try {
            $stmt = $this->getPdo()->prepare('
                SELECT processed_count, last_chunk_index, status 
                FROM matching_checkpoints 
                WHERE checkpoint_key = :key
            ');
            $stmt->execute([':key' => $checkpointKey]);
            $row = $stmt->fetch();

            if (! $row) {
                return false;
            }

            return $row['status'] === 'in_progress'
                && (int) $row['processed_count'] > 0
                && (int) $row['last_chunk_index'] >= 0;
        } catch (Throwable $e) {
            Log::warning('MatchingCheckpointManager::hasIncompleteCheckpoint failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Retrieve checkpoint row.
     *
     * @return array<string, mixed>|null
     */
    public function getCheckpoint(string $checkpointKey): ?array
    {
        try {
            $stmt = $this->getPdo()->prepare('
                SELECT * FROM matching_checkpoints WHERE checkpoint_key = :key
            ');
            $stmt->execute([':key' => $checkpointKey]);
            $row = $stmt->fetch();

            if (! $row) {
                return null;
            }

            $summary = ! empty($row['summary_json']) ? json_decode($row['summary_json'], true) : [];

            return [
                'checkpoint_key' => $row['checkpoint_key'],
                'matching_job_id' => $row['matching_job_id'],
                'workspace_id' => $row['workspace_id'],
                'total_count' => (int) $row['total_count'],
                'processed_count' => (int) $row['processed_count'],
                'last_chunk_index' => (int) $row['last_chunk_index'],
                'summary' => is_array($summary) ? $summary : [],
                'status' => $row['status'],
                'created_at' => $row['created_at'],
                'updated_at' => $row['updated_at'],
            ];
        } catch (Throwable $e) {
            Log::warning('MatchingCheckpointManager::getCheckpoint failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get list of chunk indices that have already been persisted for this checkpoint.
     *
     * @return array<int, int>
     */
    public function getCompletedChunkIndices(string $checkpointKey): array
    {
        try {
            $stmt = $this->getPdo()->prepare('
                SELECT chunk_index 
                FROM matching_checkpoint_chunks 
                WHERE checkpoint_key = :key
            ');
            $stmt->execute([':key' => $checkpointKey]);
            return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
        } catch (Throwable $e) {
            Log::warning('MatchingCheckpointManager::getCompletedChunkIndices failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Persist progress and results for a completed chunk into SQLite.
     *
     * @param array<string, mixed> $summary
     * @param array<int, array<string, mixed>> $batchResults
     */
    public function saveChunk(
        string $checkpointKey,
        string $matchingJobId,
        ?string $workspaceId,
        int $chunkIndex,
        int $processedCount,
        int $totalCount,
        array $summary,
        array $batchResults
    ): void {
        try {
            $pdo = $this->getPdo();
            $pdo->beginTransaction();

            $now = Carbon::now()->toIso8601String();
            $summaryJson = json_encode($summary, JSON_THROW_ON_ERROR);
            $resultsJson = MatchingPayloadCodec::encode($batchResults);

            // Upsert header checkpoint
            $stmtHeader = $pdo->prepare('
                INSERT INTO matching_checkpoints (
                    checkpoint_key, matching_job_id, workspace_id, total_count, processed_count,
                    last_chunk_index, summary_json, status, created_at, updated_at
                ) VALUES (
                    :key, :job_id, :workspace_id, :total, :processed,
                    :chunk_index, :summary, "in_progress", :created_at, :updated_at
                )
                ON CONFLICT(checkpoint_key) DO UPDATE SET
                    matching_job_id = excluded.matching_job_id,
                    workspace_id = excluded.workspace_id,
                    total_count = excluded.total_count,
                    processed_count = excluded.processed_count,
                    last_chunk_index = MAX(matching_checkpoints.last_chunk_index, excluded.last_chunk_index),
                    summary_json = excluded.summary_json,
                    status = "in_progress",
                    updated_at = excluded.updated_at
            ');

            $stmtHeader->execute([
                ':key' => $checkpointKey,
                ':job_id' => $matchingJobId,
                ':workspace_id' => $workspaceId,
                ':total' => $totalCount,
                ':processed' => $processedCount,
                ':chunk_index' => $chunkIndex,
                ':summary' => $summaryJson,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);

            // Insert chunk results (upsert via INSERT OR REPLACE)
            $stmtChunk = $pdo->prepare('
                INSERT OR REPLACE INTO matching_checkpoint_chunks (
                    checkpoint_key, chunk_index, processed_count, results_json, created_at
                ) VALUES (
                    :key, :chunk_index, :processed, :results, :created_at
                )
            ');

            $stmtChunk->execute([
                ':key' => $checkpointKey,
                ':chunk_index' => $chunkIndex,
                ':processed' => $processedCount,
                ':results' => $resultsJson,
                ':created_at' => $now,
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Log::warning("MatchingCheckpointManager::saveChunk failed for chunk {$chunkIndex}: " . $e->getMessage());
        }
    }

    /**
     * Restore all completed results from SQLite into MySQL matching_results table for target job.
     *
     * @return array<string, mixed>
     */
    public function restoreResultsForJob(string $checkpointKey, string $targetJobId): array
    {
        $checkpoint = $this->getCheckpoint($checkpointKey);
        if (! $checkpoint) {
            return [
                'restored' => false,
                'processed_count' => 0,
                'last_chunk_index' => -1,
                'summary' => [],
                'restored_records_count' => 0,
            ];
        }

        try {
            $pdo = $this->getPdo();
            $stmt = $pdo->prepare('
                SELECT chunk_index, results_json 
                FROM matching_checkpoint_chunks 
                WHERE checkpoint_key = :key 
                ORDER BY chunk_index ASC
            ');
            $stmt->execute([':key' => $checkpointKey]);


            $existingCountInDb = MatchingResult::where('matching_job_id', $targetJobId)->count();
            $totalInserted = 0;

            // If target job in MySQL doesn't have the results yet (e.g. new job created upon restart/rerun),
            // insert the cached results from SQLite in batches.
            // Check dependencies even when resuming the same job with existing rows.
            while ($chunkRow = $stmt->fetch(PDO::FETCH_ASSOC)) {
                MatchingRecordSnapshots::assertReferences(MatchingPayloadCodec::decode($chunkRow['results_json']));
            }
            $stmt->execute([':key' => $checkpointKey]);
            if ($existingCountInDb === 0) {
                $nowFormatted = Carbon::now()->toDateTimeString();
                $rowsToInsert = [];
                while ($chunkRow = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $results = MatchingPayloadCodec::decode($chunkRow['results_json']);
                    if (! is_array($results)) {
                        continue;
                    }

                    foreach ($results as $item) {
                        $item['id'] = (string) Str::uuid7();
                        $item['matching_job_id'] = $targetJobId;
                        $item['created_at'] = $nowFormatted;
                        $item['updated_at'] = $nowFormatted;
                        $rowsToInsert[] = $item;

                        if (count($rowsToInsert) >= 250) {
                            MatchingResult::insert($rowsToInsert);
                            $totalInserted += count($rowsToInsert);
                            $rowsToInsert = [];
                        }
                    }
                }

                if (! empty($rowsToInsert)) {
                    MatchingResult::insert($rowsToInsert);
                    $totalInserted += count($rowsToInsert);
                }
            } else {
                $totalInserted = $existingCountInDb;
            }

            $primaryCount = MatchingResult::where('matching_job_id', $targetJobId)->where('candidate_rank', 1)->count();
            if ($primaryCount < $checkpoint['processed_count']) {
                throw new \RuntimeException('Checkpoint result rows are incomplete.');
            }
            return [
                'restored' => true,
                'processed_count' => $checkpoint['processed_count'],
                'last_chunk_index' => $checkpoint['last_chunk_index'],
                'summary' => $checkpoint['summary'],
                'restored_records_count' => $totalInserted,
            ];
        } catch (Throwable $e) {
            Log::error('MatchingCheckpointManager::restoreResultsForJob failed: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString(),
            ]);

            return [
                'restored' => false,
                'processed_count' => 0,
                'last_chunk_index' => -1,
                'summary' => [],
                'restored_records_count' => 0,
            ];
        }
    }

    /**
     * Mark checkpoint as completed and purge bulky chunk records to keep SQLite database lean.
     */
    public function markCompleted(string $checkpointKey): void
    {
        try {
            $pdo = $this->getPdo();
            $pdo->beginTransaction();

            $stmt = $pdo->prepare('
                UPDATE matching_checkpoints 
                SET status = "completed", updated_at = :now 
                WHERE checkpoint_key = :key
            ');
            $stmt->execute([
                ':now' => Carbon::now()->toIso8601String(),
                ':key' => $checkpointKey,
            ]);

            // Delete bulky chunk results now that job is fully committed and completed
            $delStmt = $pdo->prepare('
                DELETE FROM matching_checkpoint_chunks WHERE checkpoint_key = :key
            ');
            $delStmt->execute([':key' => $checkpointKey]);

            $pdo->commit();
            // Reclaim completed chunk pages without rewriting retained checkpoint data.
            $pdo->exec('PRAGMA incremental_vacuum(1024)');
            $pdo->exec('PRAGMA wal_checkpoint(PASSIVE)');
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Log::warning('MatchingCheckpointManager::markCompleted failed: ' . $e->getMessage());
        }
    }

    /**
     * Clear / remove checkpoint and chunks for a given key.
     */
    public function clearCheckpoint(string $checkpointKey): void
    {
        try {
            $pdo = $this->getPdo();
            $pdo->beginTransaction();

            $del1 = $pdo->prepare('DELETE FROM matching_checkpoint_chunks WHERE checkpoint_key = :key');
            $del1->execute([':key' => $checkpointKey]);

            $del2 = $pdo->prepare('DELETE FROM matching_checkpoints WHERE checkpoint_key = :key');
            $del2->execute([':key' => $checkpointKey]);

            $pdo->commit();
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Log::warning('MatchingCheckpointManager::clearCheckpoint failed: ' . $e->getMessage());
        }
    }
}
