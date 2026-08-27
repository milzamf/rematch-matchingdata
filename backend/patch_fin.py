import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

fin_old = """        if (isset($indexes['client']) && isset($indexes['uid'])) {
            try {
                $indexes['client']->deleteIndex($indexes['uid']);
            } catch (\Throwable $e) {}
        }

        return $summary;
    }"""
fin_new = """        if (isset($indexes['client']) && isset($indexes['uid'])) {
            try {
                $indexes['client']->deleteIndex($indexes['uid']);
            } catch (\Throwable $e) {}
        }

        \Log::info("MATCHING_JOB_FINISHING");
        \Log::info("MATCHING_JOB_FINISHED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'processed_count' => $job->processed_count, 'total_duration_ms' => (microtime(true) - $jobStartTime) * 1000]);

        return $summary;
    }"""
code = code.replace(fin_old, fin_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MATCHING_JOB_FINISHED")
