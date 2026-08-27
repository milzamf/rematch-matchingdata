import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

code = re.sub(
    r'(foreach\s*\(array_chunk\(\$inputRows,\s*\$chunkSize\)\s*as\s*\$chunkIndex\s*=>\s*\$chunk\)\s*\{)',
    r'''\1
            if ($chunkIndex === 0) {
                \\Log::info("MATCHING_FIRST_CHUNK_WAIT_END");
                \\Log::info("MATCHING_FIRST_CHUNK_WAIT_DURATION_MS", ['duration' => (microtime(true) - $firstChunkWaitStart) * 1000]);
            }
            \\Log::info("CHUNK_START", ['job_id' => $job->id, 'chunk_number' => $chunkIndex, 'chunk_size' => count($chunk), 'processed_before' => $processed, 'total_count' => $job->total_count]);
            $chunkStart = microtime(true);
            $this->metrics = ['jaro_calls' => 0, 'jaro_time' => 0.0, 'lev_calls' => 0, 'lev_time' => 0.0, 'cand_time' => 0.0];
''', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED CHUNK_START")
