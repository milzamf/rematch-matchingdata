import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

db_old = """            DB::transaction(function () use ($batchResults, $job, $processed, $chunk, $summary) {
                if (! empty($batchResults)) {
                    MatchingResult::insert($batchResults);
                }

                $job->update([
                    'processed_count' => $processed + count($chunk),
                    'record_counts' => $summary,
                ]);
            });

            $processed += count($chunk);"""
db_new = """            \Log::info("CANDIDATE_PROCESSING_END");
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
            $processed += count($chunk);"""
            
code = code.replace(db_old, db_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED DB_WRITE")
