import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

# 1. Job level
runJob_old = """    public function runJob(MatchingJob $job): void
    {
        // 1. Initial State Checks
"""
runJob_new = """    public function runJob(MatchingJob $job): void
    {
        \Log::info("MATCHING_JOB_STARTED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'timestamp' => microtime(true)]);
        $jobStartTime = microtime(true);
        // 1. Initial State Checks
"""
code = code.replace(runJob_old, runJob_new)

runJob_end_old = """        // Cleanup any temp datasets
        $this->cleanupTempDatasets($job);
    }"""
runJob_end_new = """        // Cleanup any temp datasets
        $this->cleanupTempDatasets($job);
        
        \Log::info("MATCHING_JOB_FINISHING");
        \Log::info("MATCHING_JOB_FINISHED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'processed_count' => $job->processed_count, 'total_duration_ms' => (microtime(true) - $jobStartTime) * 1000]);
    }"""
code = code.replace(runJob_end_old, runJob_end_new)

# 2. Reference Index Phase
ref_start_old = "        // Candidate Generation Index for Phase 3 via Meilisearch"
ref_start_new = """        \Log::info("REFERENCE_INDEX_PHASE_START");
        $refPhaseStart = microtime(true);
        // Candidate Generation Index for Phase 3 via Meilisearch"""
code = code.replace(ref_start_old, ref_start_new)

del_old = """        try {
            $task = $client->deleteIndex($indexUid);
            $client->waitForTask($task['taskUid']);
        } catch (\Throwable $e) {
            // ignore if not exists
        }"""
del_new = """        try {
            \Log::info("REFERENCE_INDEX_DELETE_START");
            $delStart = microtime(true);
            $task = $client->deleteIndex($indexUid);
            \Log::info("WAIT_FOR_MEILISEARCH_TASK_START", ['task_id' => $task['taskUid']]);
            $wStart = microtime(true);
            $client->waitForTask($task['taskUid']);
            \Log::info("WAIT_FOR_MEILISEARCH_TASK_END", ['task_id' => $task['taskUid']]);
            \Log::info("WAIT_FOR_MEILISEARCH_TASK_DURATION_MS", ['duration' => (microtime(true) - $wStart) * 1000]);
            \Log::info("REFERENCE_INDEX_DELETE_END");
            \Log::info("REFERENCE_INDEX_DELETE_DURATION_MS", ['duration' => (microtime(true) - $delStart) * 1000]);
        } catch (\Throwable $e) {
            // ignore if not exists
        }"""
code = code.replace(del_old, del_new)

add_old = """        $index = $client->index($indexUid);
        $task = $index->updateSearchableAttributes($searchableAttributes);
        $client->waitForTask($task['taskUid']);
        
        $task = $index->addDocuments($searchableDocuments);
        $client->waitForTask($task['taskUid']);
        $indexes = ['uid' => $indexUid, 'client' => $client];"""
add_new = """        $index = $client->index($indexUid);
        \Log::info("REFERENCE_INDEX_CONFIGURATION_START");
        $confStart = microtime(true);
        $task = $index->updateSearchableAttributes($searchableAttributes);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_START", ['task_id' => $task['taskUid']]);
        $wStart = microtime(true);
        $client->waitForTask($task['taskUid']);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_END", ['task_id' => $task['taskUid']]);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_DURATION_MS", ['duration' => (microtime(true) - $wStart) * 1000]);
        \Log::info("REFERENCE_INDEX_CONFIGURATION_END");
        \Log::info("REFERENCE_INDEX_CONFIGURATION_DURATION_MS", ['duration' => (microtime(true) - $confStart) * 1000]);
        
        \Log::info("REFERENCE_DOCUMENT_UPLOAD_START");
        $upStart = microtime(true);
        $task = $index->addDocuments($searchableDocuments);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_START", ['task_id' => $task['taskUid']]);
        $wStart = microtime(true);
        $client->waitForTask($task['taskUid']);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_END", ['task_id' => $task['taskUid']]);
        \Log::info("WAIT_FOR_MEILISEARCH_TASK_DURATION_MS", ['duration' => (microtime(true) - $wStart) * 1000]);
        \Log::info("REFERENCE_DOCUMENT_UPLOAD_END");
        \Log::info("REFERENCE_DOCUMENT_UPLOAD_DURATION_MS", ['duration' => (microtime(true) - $upStart) * 1000]);
        
        $indexes = ['uid' => $indexUid, 'client' => $client];
        \Log::info("REFERENCE_INDEX_PHASE_END");
        \Log::info("REFERENCE_INDEX_TOTAL_DURATION_MS", ['duration' => (microtime(true) - $refPhaseStart) * 1000]);"""
code = code.replace(add_old, add_new)

# 3. Matching Phase
match_old = """        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
        ];

        $processed = 0;
        foreach (array_chunk($inputRows, $chunkSize) as $chunkIndex => $chunk) {"""
match_new = """        $summary = [
            'matched' => 0,
            'possible_match' => 0,
            'unmatched' => 0,
            'candidates_scored' => 0,
        ];

        \Log::info("MATCHING_PHASE_START");
        $firstChunkWaitStart = microtime(true);

        $processed = 0;
        foreach (array_chunk($inputRows, $chunkSize) as $chunkIndex => $chunk) {
            if ($chunkIndex === 0) {
                \Log::info("MATCHING_FIRST_CHUNK_WAIT_END");
                \Log::info("MATCHING_FIRST_CHUNK_WAIT_DURATION_MS", ['duration' => (microtime(true) - $firstChunkWaitStart) * 1000]);
            }
            \Log::info("CHUNK_START", ['job_id' => $job->id, 'chunk_number' => $chunkIndex, 'chunk_size' => count($chunk), 'processed_before' => $processed, 'total_count' => $job->total_count]);
            $chunkStart = microtime(true);
            $this->metrics = ['jaro_calls' => 0, 'jaro_time' => 0.0, 'lev_calls' => 0, 'lev_time' => 0.0, 'cand_time' => 0.0];
"""
code = code.replace(match_old, match_new)

ms_old = """                try {
                    $multiResults = $indexes['client']->multiSearch($queries)['results'] ?? [];
                } catch (\Throwable $e) {"""
ms_new = """                try {
                    \Log::info("MULTISEARCH_START");
                    $msStart = microtime(true);
                    $multiResults = $indexes['client']->multiSearch($queries)['results'] ?? [];
                    \Log::info("MULTISEARCH_END");
                    \Log::info("MULTISEARCH_DURATION_MS", ['duration' => (microtime(true) - $msStart) * 1000, 'query_count' => count($queries)]);
                } catch (\Throwable $e) {"""
code = code.replace(ms_old, ms_new)

cand_old = """                // Phase 3 & Phase 4: Similarity Scoring & Verification Guardrails
                // -------------------------------------------------------------
                $scoredCandidates = $this->evaluateCandidates(
                    $inputRecord,
                    $candidates,
                    $mappings,
                    $configuration
                );"""
cand_new = """                // Phase 3 & Phase 4: Similarity Scoring & Verification Guardrails
                // -------------------------------------------------------------
                $cStart = microtime(true);
                $scoredCandidates = $this->evaluateCandidates(
                    $inputRecord,
                    $candidates,
                    $mappings,
                    $configuration
                );
                $this->metrics['cand_time'] += (microtime(true) - $cStart);"""
code = code.replace(cand_old, cand_new)

db_old = """            // -----------------------------------------------------------------
            // Bulk insert chunk results
            // -----------------------------------------------------------------
            DB::transaction(function () use ($batchResults, $job, $processed, $chunk, $summary) {
                if (! empty($batchResults)) {
                    MatchingResult::insert($batchResults);
                }

                $job->update([
                    'processed_count' => $processed + count($chunk),
                    'record_counts' => $summary,
                ]);
            });"""
db_new = """            // -----------------------------------------------------------------
            // Bulk insert chunk results
            // -----------------------------------------------------------------
            \Log::info("CANDIDATE_PROCESSING_END");
            \Log::info("CANDIDATE_PROCESSING_DURATION_MS", ['duration' => $this->metrics['cand_time'] * 1000]);
            \Log::info("JARO_START");
            \Log::info("JARO_END");
            \Log::info("JARO_DURATION_MS", ['duration' => $this->metrics['jaro_time'] * 1000, 'jaro_call_count' => $this->metrics['jaro_calls']]);
            \Log::info("LEVENSHTEIN_START");
            \Log::info("LEVENSHTEIN_END");
            \Log::info("LEVENSHTEIN_DURATION_MS", ['duration' => $this->metrics['lev_time'] * 1000, 'levenshtein_call_count' => $this->metrics['lev_calls']]);

            \Log::info("DB_WRITE_START");
            $dbStart = microtime(true);
            DB::transaction(function () use ($batchResults, $job, $processed, $chunk, $summary) {
                if (! empty($batchResults)) {
                    MatchingResult::insert($batchResults);
                }
                \Log::info("DB_WRITE_END");
                
                \Log::info("PROGRESS_UPDATE_START");
                $job->update([
                    'processed_count' => $processed + count($chunk),
                    'record_counts' => $summary,
                ]);
                \Log::info("PROGRESS_UPDATE_END");
            });
            \Log::info("DB_WRITE_DURATION_MS", ['duration' => (microtime(true) - $dbStart) * 1000]);
            
            \Log::info("CHUNK_END", ['chunk_number' => $chunkIndex, 'chunk_size' => count($chunk), 'processed_after' => $processed + count($chunk), 'chunk_duration_ms' => (microtime(true) - $chunkStart) * 1000]);
"""
code = code.replace(db_old, db_new)

# 4. Score hook
score_old = """            $score = $isMandatory ? 100.0 : $this->scorer->score(($mapping['algorithm'] ?? null), $left, $right);"""
score_new = """            $alg = ($mapping['algorithm'] ?? null);
            $sStart = microtime(true);
            $score = $isMandatory ? 100.0 : $this->scorer->score($alg, $left, $right);
            $sTime = microtime(true) - $sStart;
            if ($alg === 'jaro_winkler' || $alg === 'jaro') {
                $this->metrics['jaro_calls']++; $this->metrics['jaro_time'] += $sTime;
            } elseif ($alg === 'levenshtein') {
                $this->metrics['lev_calls']++; $this->metrics['lev_time'] += $sTime;
            }"""
code = code.replace(score_old, score_new)

# Add public array $metrics to class
class_old = """class MatchingEngineService
{
    public function __construct(
        private readonly SimilarityScorer $scorer,"""
class_new = """class MatchingEngineService
{
    public array $metrics = [];

    public function __construct(
        private readonly SimilarityScorer $scorer,"""
code = code.replace(class_old, class_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED INSTRUMENTATION")
