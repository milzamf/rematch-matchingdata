import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

match_old = """        $processed = 0;
        $memoizationCache = [];

        foreach (array_chunk($inputRows, $chunkSize) as $chunkIndex => $chunk) {"""

match_new = """        \Log::info("MATCHING_PHASE_START");
        $firstChunkWaitStart = microtime(true);

        $processed = 0;
        $memoizationCache = [];

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

# Let me use regex to make it safer
code = re.sub(r'(\$memoizationCache\s*=\s*\[\];\s*foreach\s*\(array_chunk)', r'\\Log::info("MATCHING_PHASE_START");\n        $firstChunkWaitStart = microtime(true);\n        \1', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MATCHING_PHASE_START")
