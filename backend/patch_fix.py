import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

code = re.sub(
    r'\\Log::info\("MATCHING_JOB_FINISHED", \[\'job_id\' => \$job->id, \'total_count\' => \$job->total_count, \'processed_count\' => \$job->processed_count, \'total_duration_ms\' => \(microtime\(true\) - \$jobStartTime\) \* 1000\]\);',
    r'''\\Log::info("MATCHING_JOB_FINISHED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'processed_count' => $job->processed_count]);''', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MATCHING_JOB_FINISHED_FIX")
