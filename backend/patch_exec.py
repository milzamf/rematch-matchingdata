import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

code = re.sub(
    r'(public function executePipeline\(MatchingJob \$job\): array\s*\{)',
    r'''\1
        \Log::info("MATCHING_JOB_STARTED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'timestamp' => microtime(true)]);
        $jobStartTime = microtime(true);
''', code)

code = re.sub(
    r'(return \[\s*\'success\' => true,\s*\'message\' => \'Matching pipeline completed\.',
    r'''\Log::info("MATCHING_JOB_FINISHING");
        \Log::info("MATCHING_JOB_FINISHED", ['job_id' => $job->id, 'total_count' => $job->total_count, 'processed_count' => $job->processed_count, 'total_duration_ms' => (microtime(true) - $jobStartTime) * 1000]);
        \1''', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED executePipeline")
